// Testet functions/index.js ohne echtes Firebase: firebase-admin wird durch eine Attrappe ersetzt.
//   node tests/functions.mock.test.js
const Module = require('module');
const path = require('path');
const store = new Map();
const users = { 'fcbeispiel@foileleven-club.auth': 'uidClub' };
const tokens = { tokClub: { uid: 'uidClub', email: 'fcbeispiel@foileleven-club.auth' }, tokOther: { uid: 'x', email: 'max@canopy-id.auth' } };
const FV = { arrayUnion: (...v) => ({ _u: v }), arrayRemove: (...v) => ({ _r: v }), serverTimestamp: () => 'ts' };
function merge(old, patch) {
  const out = { ...(old || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v._u) out[k] = [...new Set([...(out[k] || []), ...v._u])];
    else if (v && v._r) out[k] = (out[k] || []).filter((x) => !v._r.includes(x));
    else out[k] = v;
  }
  return out;
}
const docRef = (p) => ({
  path: p,
  get: async () => ({ exists: store.has(p), data: () => store.get(p) }),
  set: async (d, o) => { store.set(p, o && o.merge ? merge(store.get(p), d) : merge({}, d)); },
});
const fakeDb = { doc: docRef, runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o) }) };
const minted = [];
const fakes = {
  'firebase-admin/app': { initializeApp: () => {} },
  'firebase-admin/auth': { getAuth: () => ({
    verifyIdToken: async (t) => { if (!tokens[t]) throw new Error('bad'); return tokens[t]; },
    createCustomToken: async (uid, claims) => { minted.push({ uid, claims }); return 'CUSTOM-' + uid; },
  }) },
  'firebase-admin/firestore': { getFirestore: (name) => { if (name !== 'canopy') throw new Error('falsche DB ' + name); return fakeDb; }, FieldValue: FV },
};
const orig = Module._load;
Module._load = function (req, ...rest) { return fakes[req] || orig.call(this, req, ...rest); };
Module._resolveFilename = ((o) => function (req, ...rest) { return fakes[req] ? req : o.call(this, req, ...rest); })(Module._resolveFilename);
const fns = require(path.join(__dirname, '..', 'functions', 'index.js'));

let failed = 0;
const check = async (label, fn) => { try { await fn(); console.log('ok   ', label); } catch (e) { failed++; console.log('FAIL ', label, '-', e.message); } };
const expect = (c, m) => { if (!c) throw new Error(m || 'erwartet'); };
const run = (f, uid, data) => f.run({ auth: uid ? { uid } : null, data });
const rejects = async (p, code) => { try { await p; } catch (e) { expect(e.code === code, 'Code ' + e.code); return; } throw new Error('kein Fehler'); };

(async () => {
  await check('foilToken ohne Verbindung: linked false', async () => { const r = await run(fns.foilToken, 'uLeif', {}); expect(r.linked === false); });
  await check('foilLink ohne Canopy-Login abgelehnt', () => rejects(run(fns.foilLink, null, { idToken: 'tokClub' }), 'unauthenticated'));
  await check('foilLink mit falschem Token abgelehnt', () => rejects(run(fns.foilLink, 'uLeif', { idToken: 'kaputt' }), 'permission-denied'));
  await check('foilLink mit Nicht-Vereins-Konto abgelehnt', () => rejects(run(fns.foilLink, 'uLeif', { idToken: 'tokOther' }), 'permission-denied'));
  await check('foilLink verbindet Verein', async () => { const r = await run(fns.foilLink, 'uLeif', { idToken: 'tokClub' }); expect(r.clubId === 'fcbeispiel'); expect(store.get('foilLinks/fcbeispiel').uid === 'uLeif'); });
  await check('foilToken liefert Login für den Verein', async () => { const r = await run(fns.foilToken, 'uLeif', {}); expect(r.linked && r.token === 'CUSTOM-uidClub' && r.clubId === 'fcbeispiel'); expect(minted.at(-1).claims.foilClub === 'fcbeispiel'); });
  await check('Fremder Account bekommt keinen Login', async () => { const r = await run(fns.foilToken, 'uEva', {}); expect(r.linked === false); });
  await check('Selbst eingetragener Verein in private/ reicht NICHT', async () => { store.set('private/uEva', { foilClubs: ['fcbeispiel'] }); const r = await run(fns.foilToken, 'uEva', { clubId: 'fcbeispiel' }); expect(r.linked === false); });
  await check('Umverbinden: Verein wandert zu neuem Account', async () => { await run(fns.foilLink, 'uNeu', { idToken: 'tokClub' }); expect(!(store.get('private/uLeif').foilClubs || []).includes('fcbeispiel')); const r = await run(fns.foilToken, 'uLeif', {}); expect(r.linked === false); const r2 = await run(fns.foilToken, 'uNeu', {}); expect(r2.linked); });
  console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Function-Tests bestanden');
  process.exit(failed ? 1 : 0);
})();
