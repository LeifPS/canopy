// Prüft firestore.canopy.rules im lokalen Emulator (nie gegen die echte Datenbank).
//
//   npm i --no-save firebase-tools @firebase/rules-unit-testing firebase
//   npx firebase emulators:exec --only firestore --project demo-canopy "node tests/rules.emulator.js"

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, runTransaction, writeBatch } = require('firebase/firestore');

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-canopy',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.canopy.rules'), 'utf8') },
  });
  const max = env.authenticatedContext('uMax', { email: 'max@canopy-id.auth' }).firestore();
  const eva = env.authenticatedContext('uEva', { email: 'eva@canopy-id.auth' }).firestore();
  const guest = env.authenticatedContext('uGuest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const admin = env.authenticatedContext('uAdmin', { canopyAdmin: true }).firestore();
  const nobody = env.unauthenticatedContext().firestore();

  let failed = 0;
  const check = async (label, p) => {
    try { await p; console.log('ok   ', label); } catch (e) { failed++; console.log('FAIL ', label, '-', e.message); }
  };
  const claim = (db, uid, name) => { const b = writeBatch(db); b.set(doc(db, 'usernames', name), { uid }); b.set(doc(db, 'profiles', uid), { name }, { merge: true }); return b.commit(); };

  // Nutzernamen und Profile
  await check('Max reserviert "max" und setzt Profilnamen', assertSucceeds(claim(max, 'uMax', 'max')));
  await check('Eva kann "max" nicht nochmal reservieren', assertFails(setDoc(doc(eva, 'usernames', 'max'), { uid: 'uEva' })));
  await check('Eva kann sich nicht "max" als Profilnamen geben', assertFails(setDoc(doc(eva, 'profiles', 'uEva'), { name: 'max' })));
  await check('Ungültiger Name "Max!" wird abgelehnt', assertFails(setDoc(doc(eva, 'usernames', 'Max!'), { uid: 'uEva' })));
  await check('Max aktualisiert Spielzeit (Name bleibt)', assertSucceeds(setDoc(doc(max, 'profiles', 'uMax'), { games: { snake: { playSec: 60 } } }, { merge: true })));
  await check('Eva schreibt NICHT in Max\' Profil', assertFails(setDoc(doc(eva, 'profiles', 'uMax'), { games: {} }, { merge: true })));
  await check('Jeder liest Profile', assertSucceeds(getDoc(doc(nobody, 'profiles', 'uMax'))));
  await check('Gast legt Profil ohne Namen an (Statistik)', assertSucceeds(setDoc(doc(guest, 'profiles', 'uGuest'), { games: { snake: { best: 3 } } }, { merge: true })));

  // Spielstände
  const save = (db, uid) => doc(db, 'saves', uid, 'games', 'snake');
  const ver = (db, uid, v) => doc(db, 'saves', uid, 'games', 'snake', 'versions', v);
  await check('Max speichert eigenen Spielstand', assertSucceeds(setDoc(save(max, 'uMax'), { data: '{}', version: 1 })));
  await check('Max legt Version an', assertSucceeds(setDoc(ver(max, 'uMax', '00000001'), { data: '{}', version: 1 })));
  await check('Max überschreibt Version NICHT', assertFails(setDoc(ver(max, 'uMax', '00000001'), { data: 'kaputt', version: 1 })));
  await check('Eva liest Max\' Spielstand NICHT', assertFails(getDoc(save(eva, 'uMax'))));
  await check('Eva schreibt Max\' Spielstand NICHT', assertFails(setDoc(save(eva, 'uMax'), { data: 'x', version: 9 })));
  await check('Ohne Login kein Spielstand', assertFails(getDoc(save(nobody, 'uMax'))));
  await check('Admin liest Max\' Spielstand (Support)', assertSucceeds(getDoc(save(admin, 'uMax'))));
  await check('Max löscht eigene Version (Account löschen)', assertSucceeds(deleteDoc(ver(max, 'uMax', '00000001'))));

  // Feedback
  await check('Max gibt Feedback ab', assertSucceeds(setDoc(doc(max, 'feedback', 'f1'), { uid: 'uMax', text: 'cool' })));
  await check('Max liest Feedback NICHT', assertFails(getDoc(doc(max, 'feedback', 'f1'))));
  await check('Admin liest Feedback', assertSucceeds(getDoc(doc(admin, 'feedback', 'f1'))));

  // Alles andere
  await check('Unbekannte Collection gesperrt', assertFails(setDoc(doc(max, 'irgendwas', 'x'), { a: 1 })));

  await env.cleanup();
  console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Regel-Tests bestanden');
  process.exit(failed ? 1 : 0);
})();
