/*
 * Canopy SDK für Spiele.
 *
 *   <script src="https://<canopy-adresse>/sdk/canopy-sdk.js"></script>
 *
 *   Canopy.ready('mein-spiel-id');                 // einmal beim Start
 *   const { data } = await Canopy.load();          // Spielstand aus Canopy ID (oder null)
 *   await Canopy.save({ coins: 12 });              // Spielstand speichern (Objekt oder String)
 *   Canopy.score(1250);                            // Ergebnis einer Runde (für Rekorde)
 *   Canopy.event('level_complete', { level: 3 });  // für spätere Achievements
 *
 * Läuft das Spiel nicht in Canopy Base (Canopy.inHub === false), passiert nichts und
 * load() liefert { data: null }. Das Spiel speichert dann wie bisher nur lokal.
 *
 * Wann speichern: kurz (ca. 2 s) nach jeder Änderung, gebündelt. Nur in Intervallen oder beim
 * Schließen zu speichern reicht nicht: Beim Schließen des Tabs bricht der Browser das Hochladen ab.
 *
 * Konflikte: Wurde der Stand inzwischen auf einem anderen Gerät gespeichert, liefert save()
 * { conflict: true, data, version } statt zu überschreiben. Das Spiel fragt dann den Spieler
 * und ruft ggf. Canopy.save(daten, { force: true }).
 */
(function () {
  var inHub = window.parent !== window;
  var gameId = null;
  var version = 0;
  var seq = 0;
  var pending = {};
  var listeners = [];

  function post(msg) {
    if (!inHub) return;
    msg.canopy = 1;
    msg.game = gameId;
    window.parent.postMessage(msg, '*');
  }

  function request(type, payload) {
    if (!inHub) return Promise.resolve(null);
    return new Promise(function (resolve, reject) {
      var reqId = ++seq;
      var timer = setTimeout(function () { delete pending[reqId]; reject(new Error('Canopy antwortet nicht.')); }, 20000);
      pending[reqId] = function (m) { clearTimeout(timer); m.ok ? resolve(m.result) : reject(new Error(m.error || 'Fehler')); };
      var msg = payload || {};
      msg.type = type; msg.reqId = reqId;
      post(msg);
    });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.canopy !== 1) return;
    if (m.type === 'reply' && pending[m.reqId]) { var fn = pending[m.reqId]; delete pending[m.reqId]; fn(m); }
    if (m.type === 'user') listeners.forEach(function (fn) { try { fn(m.user); } catch (err) {} });
  });

  window.Canopy = {
    inHub: inHub,
    ready: function (id) { gameId = id; post({ type: 'ready' }); },
    score: function (n) { post({ type: 'score', score: Number(n) }); },
    event: function (name, data) { post({ type: 'event', name: String(name), data: data || null }); },
    load: function () {
      if (!inHub) return Promise.resolve({ data: null, version: 0, offline: true });
      return request('load').then(function (r) {
        version = r.version || 0;
        var data = r.data;
        try { data = data == null ? null : JSON.parse(data); } catch (err) {}
        return { data: data, version: version };
      });
    },
    save: function (data, opts) {
      if (!inHub) return Promise.resolve({ ok: false, offline: true });
      var text = typeof data === 'string' ? data : JSON.stringify(data);
      return request('save', { data: text, baseVersion: opts && opts.force ? null : version }).then(function (r) {
        if (r.ok) version = r.version;
        if (r.conflict) {
          var remote = r.data;
          try { remote = remote == null ? null : JSON.parse(remote); } catch (err) {}
          return { ok: false, conflict: true, data: remote, version: r.version };
        }
        return r;
      });
    },
    /** Eine Canopy-Funktion aufrufen, die für dieses Spiel freigegeben ist (z. B. Foil: foilToken, foilLink). */
    call: function (name, data) { return request('call', { name: String(name), data: data || null }); },
    /** Wird aufgerufen, sobald Canopy weiß, wer spielt: { name, guest } */
    onUser: function (fn) { listeners.push(fn); },
  };
})();
