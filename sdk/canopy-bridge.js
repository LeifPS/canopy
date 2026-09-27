/*
 * Canopy-Brücke für Spiele, die im localStorage speichern.
 *
 * Einbinden GANZ OBEN im <head>, vor allen Spiel-Skripten:
 *   <script src="https://canopybase.pages.dev/sdk/canopy-sdk.js"></script>
 *   <script src="https://canopybase.pages.dev/sdk/canopy-bridge.js"></script>
 *   <script>CanopyBridge.init({ game: 'mein-spiel', prefixes: ['meinspiel_'] });</script>
 *
 * Optionen:
 *   game       Spiel-ID wie in games.json
 *   prefixes   localStorage-Schlüssel, die mit diesen Präfixen beginnen, gehören zum Spielstand
 *   keys       zusätzliche einzelne Schlüssel
 *   exclude    Schlüssel, die NICHT dazugehören (z. B. laufende Sitzungen)
 *   volatile   { schlüssel: ['feld', ...] }: Felder im JSON, die sich ständig ändern (Zeitstempel).
 *              Ändern sich nur diese, wird nicht hochgeladen.
 *   button     false = keinen "In Canopy ID übertragen"-Knopf außerhalb von Canopy anzeigen
 *
 * Was passiert:
 *  - Im Canopy-Player: Beim Start wird der Stand mit der Canopy ID abgeglichen, und zwar nach
 *    Cloud-Version, nicht nach Uhrzeit. Ist die Cloud neuer, wird sie übernommen (der lokale Stand wird
 *    vorher gesichert) und die Seite neu geladen. Danach wird bei Änderungen höchstens alle 10 s
 *    hochgeladen, beim Verlassen sofort.
 *  - Direkt auf der Spielseite: nur ein kleiner Knopf "In Canopy ID übertragen" unten links.
 */
(function () {
  var CANOPY_URL = 'https://canopybase.pages.dev';
  var EVERY_MS = 10000;
  var cfg = null;

  function ls() { try { return window.localStorage; } catch (e) { return null; } }
  function ss() { try { return window.sessionStorage; } catch (e) { return null; } }
  function syncKey() { return 'canopy-sync:' + cfg.game; }
  function pendingKey() { return 'canopy-apply:' + cfg.game; }

  function tracked(k) {
    if (!k || k.indexOf('canopy-') === 0) return false;
    if (cfg.exclude.indexOf(k) >= 0) return false;
    if (cfg.keys.indexOf(k) >= 0) return true;
    for (var i = 0; i < cfg.prefixes.length; i++) if (k.indexOf(cfg.prefixes[i]) === 0) return true;
    return false;
  }
  function snapshot() {
    var s = ls(), out = {};
    if (!s) return out;
    for (var i = 0; i < s.length; i++) { var k = s.key(i); if (tracked(k)) out[k] = s.getItem(k); }
    return out;
  }
  function signature(snap) {
    var keys = Object.keys(snap).sort(), parts = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = snap[k], vol = cfg.volatile[k];
      if (vol && v) {
        try { var o = JSON.parse(v); if (o && typeof o === 'object') { for (var j = 0; j < vol.length; j++) delete o[vol[j]]; v = JSON.stringify(o); } } catch (e) {}
      }
      parts.push(k + '=' + v);
    }
    return parts.join('\n');
  }
  function syncedVersion() { try { var o = JSON.parse(ls().getItem(syncKey()) || 'null'); return o && typeof o.v === 'number' ? o.v : null; } catch (e) { return null; } }
  function setSynced(v) { try { ls().setItem(syncKey(), JSON.stringify({ v: v, at: Date.now() })); } catch (e) {} }

  // Übernommenen Stand schreiben. Er wird zusätzlich in der sessionStorage vorgemerkt und beim nächsten
  // Laden (bevor das Spiel startet) nochmal geschrieben: so kann ihn ein Speichern des Spiels beim
  // Entladen der Seite nicht mehr überschreiben.
  function writeSnapshot(snap) {
    var s = ls(); if (!s) return;
    var cur = snapshot();
    for (var k in cur) if (!(k in snap)) s.removeItem(k);
    for (var k2 in snap) s.setItem(k2, snap[k2]);
  }
  var C = null, on = false, busy = false, lastSig = null, lastPush = 0, reloading = false, timer = 0;

  function apply(snap, version) {
    reloading = true; on = false;
    try {
      var cur = snapshot();
      if (Object.keys(cur).length) ls().setItem('canopy-backup:' + cfg.game + ':' + Date.now(), JSON.stringify(cur));
      writeSnapshot(snap);
      setSynced(version);
      ss() && ss().setItem(pendingKey(), JSON.stringify({ snap: snap, version: version }));
    } catch (e) { reloading = false; return; }
    location.reload();
  }

  function push(now) {
    if (!C || !on || busy || reloading) return;
    var snap = snapshot(), sig = signature(snap);
    if (sig === lastSig) return;
    if (!now && Date.now() - lastPush < EVERY_MS) { schedule(); return; }
    busy = true; lastPush = Date.now();
    C.save({ keys: snap }).then(function (r) {
      if (r && r.ok) { setSynced(r.version); lastSig = sig; }
      else if (r && r.conflict && r.data && r.data.keys) apply(r.data.keys, r.version); // woanders neuer: Cloud gewinnt
    }).catch(function () {}).then(function () { busy = false; if (signature(snapshot()) !== lastSig) schedule(); });
  }
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = 0; push(false); }, Math.max(500, EVERY_MS - (Date.now() - lastPush))); }

  function hideUntilReady() {
    var el = document.createElement('div');
    el.id = 'canopy-sync-cover';
    el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0f1513;color:#e3eae6;font:600 15px system-ui,sans-serif');
    el.textContent = 'Spielstand wird geladen \u2026';
    (document.body || document.documentElement).appendChild(el);
    return function () { if (el.parentNode) el.parentNode.removeChild(el); };
  }

  function bootHub() {
    C = window.Canopy;
    C.ready(cfg.game);
    var ready = false, removeCover = function () {};
    var reveal = function () { ready = true; removeCover(); };
    var showCover = function () { if (!ready) removeCover = hideUntilReady(); }; // war das Laden schneller als die Seite, gar nicht erst zeigen
    if (document.body) showCover(); else document.addEventListener('DOMContentLoaded', showCover);
    var giveUp = setTimeout(function () { reveal(); }, 8000); // nie länger als 8 s blockieren
    C.load().then(function (r) {
      var cloud = r.data && r.data.keys, version = r.version, mine = syncedVersion();
      if (cloud && (mine === null || version > mine)) { apply(cloud, version); return; }
      on = true;
      if (cloud && version === mine && signature(cloud) === signature(snapshot())) lastSig = signature(cloud);
      if (cloud && mine !== null && mine > version) {
        // Cloud wurde zurückgesetzt: lokalen Stand erzwingen
        C.save({ keys: snapshot() }, { force: true }).then(function (x) { if (x && x.ok) { setSynced(x.version); lastSig = signature(snapshot()); } }).catch(function () {});
      } else push(true);
      clearTimeout(giveUp); reveal();
    }).catch(function () { clearTimeout(giveUp); reveal(); });
    setInterval(function () { push(false); }, 3000);
    document.addEventListener('visibilitychange', function () { if (document.hidden) push(true); });
    window.addEventListener('pagehide', function () { push(true); });
  }

  // ---------- Außerhalb von Canopy: übertragen ----------

  function transfer() {
    var w = window.open(CANOPY_URL + '/transfer.html?g=' + encodeURIComponent(cfg.game), 'canopy-transfer', 'width=480,height=680');
    if (!w) { note('Bitte Pop-ups f\u00fcr diese Seite erlauben.'); return; }
    function onMsg(e) {
      if (e.origin !== CANOPY_URL || e.source !== w) return;
      var m = e.data; if (!m || m.canopy !== 1) return;
      if (m.type === 'transfer-ready') w.postMessage({ canopy: 1, type: 'transfer-data', data: JSON.stringify({ keys: snapshot() }) }, CANOPY_URL);
      if (m.type === 'transfer-done') { window.removeEventListener('message', onMsg); note('Spielstand ist jetzt in deiner Canopy ID.'); }
    }
    window.addEventListener('message', onMsg);
  }
  function note(text) {
    var n = document.createElement('div');
    n.setAttribute('style', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#15201b;color:#e3eae6;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.3)');
    n.textContent = text; document.body.appendChild(n); setTimeout(function () { n.remove(); }, 4000);
  }
  function addButton() {
    try { if (Number(ls().getItem('canopy-pill-hidden') || 0) > Date.now()) return; } catch (e) {}
    var wrap = document.createElement('div');
    wrap.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:2147483646;display:flex;align-items:center;gap:2px;background:rgba(21,32,27,.88);color:#e3eae6;border-radius:999px;font:600 12px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)');
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = '\u2601 In Canopy ID \u00fcbertragen';
    b.setAttribute('style', 'all:unset;cursor:pointer;padding:7px 4px 7px 12px');
    b.onclick = transfer;
    var x = document.createElement('button');
    x.type = 'button'; x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Ausblenden');
    x.setAttribute('style', 'all:unset;cursor:pointer;padding:7px 12px 7px 6px;opacity:.7');
    x.onclick = function () { try { ls().setItem('canopy-pill-hidden', String(Date.now() + 7 * 864e5)); } catch (e) {} wrap.remove(); };
    wrap.appendChild(b); wrap.appendChild(x);
    document.body.appendChild(wrap);
  }

  window.CanopyBridge = {
    init: function (options) {
      cfg = {
        game: options.game, prefixes: options.prefixes || [], keys: options.keys || [],
        exclude: options.exclude || [], volatile: options.volatile || {}, button: options.button !== false,
      };
      // Vorgemerkten, übernommenen Stand nochmal schreiben, bevor das Spiel startet (siehe writeSnapshot).
      try {
        var p = ss() && ss().getItem(pendingKey());
        if (p) { var o = JSON.parse(p); writeSnapshot(o.snap); setSynced(o.version); ss().removeItem(pendingKey()); }
      } catch (e) {}
      var inHub = !!(window.Canopy && window.Canopy.inHub);
      if (inHub) bootHub();
      else if (cfg.button) {
        if (document.body) addButton(); else document.addEventListener('DOMContentLoaded', addButton);
      }
    },
    transfer: function () { if (cfg) transfer(); },
    syncNow: function () { push(true); },
  };
})();
