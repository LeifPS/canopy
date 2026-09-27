// Gemeinsame Kopfzeile für die Canopy-Seiten.
import { onChange } from './canopy-id.js';
import { levelOf, xpOf } from './progress.js';

const LINKS = [
  ['./', 'Spiele', 'home'],
  ['leaderboards.html', 'Bestenlisten', 'boards'],
  ['friends.html', 'Freunde', 'friends'],
  ['news.html', 'Neuigkeiten', 'news'],
];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 22a13 13 0 0 1 26 0z" fill="var(--moss)"/><path d="M8 22a8 8 0 0 1 16 0z" fill="var(--sun)"/><rect x="15" y="22" width="2" height="7" rx="1" fill="var(--ink)"/></svg>';

export function mountHeader(active) {
  const el = document.createElement('header');
  el.className = 'top';
  el.innerHTML = `<div class="wrap">
    <a class="brand" href="./" aria-label="Canopy Base">${MARK}<b>Canopy</b></a>
    <nav class="nav" aria-label="Hauptmenü">${LINKS.map(([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="spacer"></div>
    <a class="me" id="me" href="account.html"><span class="av">?</span><span>Anmelden</span></a>
  </div>`;
  document.body.prepend(el);
  onChange((s) => {
    const me = el.querySelector('#me');
    if (s.error || !s.user || s.isGuest || !s.profile?.name) {
      me.href = 'account.html';
      me.innerHTML = `<span class="av">?</span><span>${s.isGuest ? 'Gast · Account erstellen' : 'Anmelden'}</span>`;
      return;
    }
    const lv = levelOf(xpOf(s.profile)).level;
    me.href = 'profile.html';
    me.innerHTML = `<span class="av">${esc(s.profile.name[0].toUpperCase())}</span><span>${esc(s.profile.name)}</span><span class="lv">Lv ${lv}</span>`;
  });
}

let gamesCache = null;
export function loadGames() {
  if (!gamesCache) gamesCache = fetch('games.json').then((r) => r.json()).then((d) => d.games || []).catch(() => []);
  return gamesCache;
}

export function timeAgo(ms) {
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 90) return 'gerade eben';
  if (d < 3600) return `vor ${Math.round(d / 60)} Min.`;
  if (d < 86400) return `vor ${Math.round(d / 3600)} Std.`;
  if (d < 86400 * 7) return `vor ${Math.round(d / 86400)} Tagen`;
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(ms));
}
export const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : t?.seconds ? t.seconds * 1000 : 0);
