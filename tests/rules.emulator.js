// Prüft firestore.canopy.rules im lokalen Emulator (nie gegen die echte Datenbank).
//
//   npm i --no-save firebase-tools @firebase/rules-unit-testing firebase
//   npx firebase emulators:exec --only firestore --project demo-canopy "node tests/rules.emulator.js"

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, updateDoc, getDocs, query, where, collection, runTransaction, writeBatch } = require('firebase/firestore');

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
  await check('Normale Spielzeit (60 s) erlaubt', assertSucceeds(setDoc(doc(max, 'profiles', 'uMax'), { totalSec: 60 }, { merge: true })));
  await check('Spielzeit-Sprung (+100 Std.) abgelehnt', assertFails(setDoc(doc(max, 'profiles', 'uMax'), { totalSec: 360060 }, { merge: true })));
  await check('Eva schreibt NICHT in Max\' Profil', assertFails(setDoc(doc(eva, 'profiles', 'uMax'), { games: {} }, { merge: true })));
  await check('Jeder liest Profile', assertSucceeds(getDoc(doc(nobody, 'profiles', 'uMax'))));
  await check('Gast legt Profil ohne Namen an (Statistik)', assertSucceeds(setDoc(doc(guest, 'profiles', 'uGuest'), { games: { snake: { best: 3 } } }, { merge: true })));

  // Spielstände
  const save = (db, uid) => doc(db, 'saves', uid, 'games', 'snake');
  const ver = (db, uid, v) => doc(db, 'saves', uid, 'games', 'snake', 'versions', v);
  await check('Max speichert eigenen Spielstand', assertSucceeds(setDoc(save(max, 'uMax'), { data: '{}', version: 1 })));
  await check('Max speichert Version 2 auf Basis von 1', assertSucceeds(setDoc(save(max, 'uMax'), { data: '{"a":2}', version: 2 })));
  await check('Veraltetes Gerät (wieder Version 2) wird abgelehnt', assertFails(setDoc(save(max, 'uMax'), { data: 'alt', version: 2 })));
  await check('Versionssprung (Version 9) wird abgelehnt', assertFails(setDoc(save(max, 'uMax'), { data: 'x', version: 9 })));
  await check('Neuer Spielstand muss mit Version 1 beginnen', assertFails(setDoc(doc(max, 'saves', 'uMax', 'games', 'andres'), { data: 'x', version: 5 })));
  await check('Max legt Version an', assertSucceeds(setDoc(ver(max, 'uMax', '00000001'), { data: '{}', version: 1 })));
  await check('Max überschreibt Version NICHT', assertFails(setDoc(ver(max, 'uMax', '00000001'), { data: 'kaputt', version: 1 })));
  await check('Eva liest Max\' Spielstand NICHT', assertFails(getDoc(save(eva, 'uMax'))));
  await check('Eva schreibt Max\' Spielstand NICHT', assertFails(setDoc(save(eva, 'uMax'), { data: 'x', version: 9 })));
  await check('Ohne Login kein Spielstand', assertFails(getDoc(save(nobody, 'uMax'))));
  await check('Admin liest Max\' Spielstand (Support)', assertSucceeds(getDoc(save(admin, 'uMax'))));
  await check('Max löscht eigene Version (Account löschen)', assertSucceeds(deleteDoc(ver(max, 'uMax', '00000001'))));

  // Freunde
  const fr = (db) => doc(db, 'friendships', 'uEva_uMax');
  await check('Max fragt Eva an', assertSucceeds(setDoc(fr(max), { members: ['uEva', 'uMax'], status: 'pending', requestedBy: 'uMax', at: 1 })));
  await check('Anfrage im Namen eines anderen abgelehnt', assertFails(setDoc(doc(max, 'friendships', 'uEva_uX'), { members: ['uEva', 'uX'], status: 'pending', requestedBy: 'uX', at: 1 })));
  await check('Direkt "accepted" anlegen abgelehnt', assertFails(setDoc(doc(max, 'friendships', 'uMax_uZed'), { members: ['uMax', 'uZed'], status: 'accepted', requestedBy: 'uMax', at: 1 })));
  await check('Falsche Paar-ID abgelehnt', assertFails(setDoc(doc(max, 'friendships', 'quatsch'), { members: ['uMax', 'uZed'], status: 'pending', requestedBy: 'uMax', at: 1 })));
  await check('Max kann eigene Anfrage NICHT selbst annehmen', assertFails(updateDoc(fr(max), { status: 'accepted', acceptedAt: 2 })));
  await check('Fremder liest Freundschaft NICHT', assertFails(getDoc(doc(guest, 'friendships', 'uEva_uMax'))));
  await check('Eva nimmt an', assertSucceeds(updateDoc(fr(eva), { status: 'accepted', acceptedAt: 2 })));
  await check('Eva liest Freundschaften per Abfrage', assertSucceeds(getDocs(query(collection(eva, 'friendships'), where('members', 'array-contains', 'uEva')))));
  await check('Max beendet Freundschaft', assertSucceeds(deleteDoc(fr(max))));

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
