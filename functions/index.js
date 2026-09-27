// Cloud Functions von Canopy. Codebase "canopy" (siehe firebase.json), damit ein Deploy von hier die
// Foil-Eleven-Funktionen (Codebase "default") nie anfasst. Immer so deployen:
//   npx firebase deploy --only functions:canopy --project chess-rng
//
// Foil Eleven im Canopy-Player: Ein Foil-Verein wird einmal mit einer Canopy ID verbunden (foilLink,
// Nachweis über das Login des Vereins). Danach stellt foilToken für genau diesen Verein einen
// Einmal-Login aus, damit Foil im Player ohne Vereinspasswort startet.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore('canopy'); // eigene Datenbank, nie "(default)"
const REGION = 'europe-west3';
const CLUB_DOMAIN = '@foileleven-club.auth';

function needAuth(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Bitte zuerst bei Canopy anmelden.');
  return req.auth.uid;
}

// Verein mit dem Canopy-Account verbinden. data.idToken = ID-Token des gerade eingeloggten Vereins.
exports.foilLink = onCall({ region: REGION }, async (req) => {
  const uid = needAuth(req);
  const idToken = req.data && req.data.idToken;
  if (typeof idToken !== 'string') throw new HttpsError('invalid-argument', 'Vereins-Login fehlt.');
  let dec;
  try { dec = await getAuth().verifyIdToken(idToken); }
  catch (e) { throw new HttpsError('permission-denied', 'Vereins-Login ungültig oder abgelaufen.'); }
  const email = dec.email || '';
  if (!email.endsWith(CLUB_DOMAIN)) throw new HttpsError('permission-denied', 'Das ist kein Foil-Verein.');
  const clubId = email.slice(0, -CLUB_DOMAIN.length);

  await db.runTransaction(async (tx) => {
    const linkRef = db.doc(`foilLinks/${clubId}`);
    const cur = await tx.get(linkRef);
    const oldUid = cur.exists ? cur.data().uid : null;
    if (oldUid && oldUid !== uid) {
      tx.set(db.doc(`private/${oldUid}`), { foilClubs: FieldValue.arrayRemove(clubId) }, { merge: true });
    }
    tx.set(linkRef, { uid, clubUid: dec.uid, at: FieldValue.serverTimestamp() });
    tx.set(db.doc(`private/${uid}`), { foilClubs: FieldValue.arrayUnion(clubId), foilLastClub: clubId }, { merge: true });
  });
  return { clubId };
});

// Einmal-Login für einen verbundenen Verein. data.clubId optional (sonst zuletzt genutzter Verein).
exports.foilToken = onCall({ region: REGION }, async (req) => {
  const uid = needAuth(req);
  const priv = await db.doc(`private/${uid}`).get();
  const p = priv.exists ? priv.data() : {};
  const clubs = Array.isArray(p.foilClubs) ? p.foilClubs : [];
  const wanted = req.data && typeof req.data.clubId === 'string' ? req.data.clubId : null;
  const clubId = (wanted && clubs.includes(wanted)) ? wanted
    : (p.foilLastClub && clubs.includes(p.foilLastClub)) ? p.foilLastClub : clubs[0];
  if (!clubId) return { linked: false };

  // Die Verbindung selbst liegt in foilLinks (nur für Functions schreibbar), nicht in private/:
  // private/ darf der Nutzer selbst schreiben, das allein beweist also nichts.
  const link = await db.doc(`foilLinks/${clubId}`).get();
  if (!link.exists || link.data().uid !== uid) return { linked: false };

  const token = await getAuth().createCustomToken(link.data().clubUid, { foilClub: clubId });
  await db.doc(`private/${uid}`).set({ foilLastClub: clubId }, { merge: true });
  return { linked: true, clubId, clubs, token };
});
