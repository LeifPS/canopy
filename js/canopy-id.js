// Canopy ID: ein Account für alle Canopy-Spiele.
// Login per Nutzername + Passwort (intern {name}@canopy-id.auth, keine echte E-Mail),
// per Google, oder als Gast (anonym, lässt sich später in einen richtigen Account umwandeln).
import { firebaseConfig, CANOPY_DB, FB } from './firebase-config.js';

const ID_DOMAIN = '@canopy-id.auth';
export const NAME_RULE = /^[a-z0-9_]{3,20}$/;
const MAX_SAVE_CHARS = 900000;

let sdk = null;          // geladene Firebase-Module
let app, auth, db;
let ready = null;
let currentUser = null;
let currentProfile = null;
const listeners = new Set();

function load() {
  if (ready) return ready;
  ready = (async () => {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-auth.js`),
      import(`${FB}/firebase-firestore.js`),
    ]);
    sdk = { ...appMod, ...authMod, ...fsMod };
    app = sdk.initializeApp(firebaseConfig, 'canopy');
    auth = sdk.getAuth(app);
    db = sdk.getFirestore(app, CANOPY_DB);
    await new Promise((resolve) => {
      let first = true;
      sdk.onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        currentProfile = user ? await readProfile(user.uid).catch(() => null) : null;
        emit();
        if (first) { first = false; resolve(); }
      });
    });
  })();
  return ready;
}

function emit() { for (const fn of listeners) { try { fn(state()); } catch (e) { console.error(e); } } }

export function state() {
  const u = currentUser;
  return {
    user: u,
    uid: u?.uid || null,
    isGuest: !!u?.isAnonymous,
    profile: currentProfile,
    name: currentProfile?.name || (u?.isAnonymous ? 'Gast' : null),
  };
}

/** Ruft fn sofort und bei jeder Änderung des Login-Zustands auf. Gibt eine Abmeldefunktion zurück. */
export function onChange(fn) {
  listeners.add(fn);
  load().then(() => fn(state())).catch((e) => fn({ ...state(), error: e }));
  return () => listeners.delete(fn);
}

async function readProfile(uid) {
  const snap = await sdk.getDoc(sdk.doc(db, 'profiles', uid));
  return snap.exists() ? snap.data() : null;
}

/** Stellt sicher, dass jemand angemeldet ist. Ohne Account wird ein Gast-Account angelegt. */
export async function ensureUser() {
  await load();
  if (auth.currentUser) return auth.currentUser;
  const cred = await sdk.signInAnonymously(auth);
  return cred.user;
}

const emailFor = (name) => name + ID_DOMAIN;
export const cleanName = (s) => String(s || '').trim().toLowerCase();

async function claimName(uid, name, extra = {}) {
  await sdk.runTransaction(db, async (tx) => {
    const nameRef = sdk.doc(db, 'usernames', name);
    if ((await tx.get(nameRef)).exists()) throw friendly('name-taken');
    tx.set(nameRef, { uid, at: sdk.serverTimestamp() });
    tx.set(sdk.doc(db, 'profiles', uid), { name, createdAt: sdk.serverTimestamp(), ...extra }, { merge: true });
  });
  currentProfile = await readProfile(uid);
  emit();
}

/** Neuen Account mit Nutzername + Passwort. Ein Gast-Account wird dabei übernommen (Fortschritt bleibt). */
export async function register(nameRaw, password) {
  await load();
  const name = cleanName(nameRaw);
  if (!NAME_RULE.test(name)) throw friendly('name-invalid');
  if (String(password).length < 8) throw friendly('weak-password');
  const taken = await sdk.getDoc(sdk.doc(db, 'usernames', name));
  if (taken.exists()) throw friendly('name-taken');
  let user;
  try {
    if (auth.currentUser?.isAnonymous) {
      const cred = sdk.EmailAuthProvider.credential(emailFor(name), password);
      user = (await sdk.linkWithCredential(auth.currentUser, cred)).user;
    } else {
      user = (await sdk.createUserWithEmailAndPassword(auth, emailFor(name), password)).user;
    }
  } catch (e) { throw friendly(e.code || e.message); }
  await claimName(user.uid, name);
  return user;
}

export async function login(nameRaw, password) {
  await load();
  const name = cleanName(nameRaw);
  try {
    return (await sdk.signInWithEmailAndPassword(auth, emailFor(name), password)).user;
  } catch (e) { throw friendly(e.code || e.message); }
}

/** Google-Login. Ein Gast-Account wird mit Google verbunden, damit der Fortschritt bleibt. */
export async function loginWithGoogle() {
  await load();
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    if (auth.currentUser?.isAnonymous) {
      try {
        return (await sdk.linkWithPopup(auth.currentUser, provider)).user;
      } catch (e) {
        // Dieses Google-Konto hat schon einen Canopy-Account: normal anmelden.
        if (e.code !== 'auth/credential-already-in-use') throw e;
        const cred = sdk.GoogleAuthProvider.credentialFromError(e);
        return (await sdk.signInWithCredential(auth, cred)).user;
      }
    }
    return (await sdk.signInWithPopup(auth, provider)).user;
  } catch (e) { throw friendly(e.code || e.message); }
}

/** Google zusätzlich mit einem Nutzername-Account verbinden (zweiter Login-Weg, Passwort vergessen). */
export async function linkGoogle() {
  await load();
  if (!auth.currentUser) throw friendly('not-signed-in');
  try { await sdk.linkWithPopup(auth.currentUser, new sdk.GoogleAuthProvider()); }
  catch (e) { throw friendly(e.code === 'auth/credential-already-in-use' ? 'google-in-use' : (e.code || e.message)); }
  emit();
}

/** Für Google- und Gast-Accounts ohne Nutzernamen. */
export async function chooseName(nameRaw) {
  await load();
  const name = cleanName(nameRaw);
  if (!NAME_RULE.test(name)) throw friendly('name-invalid');
  if (!auth.currentUser) throw friendly('not-signed-in');
  await claimName(auth.currentUser.uid, name);
}

export async function logout() { await load(); await sdk.signOut(auth); }

// ---------- Statistik (Spielzeit, Rekorde) ----------

export async function addPlaytime(gameId, seconds) {
  if (!currentUser || seconds <= 0) return;
  await sdk.setDoc(sdk.doc(db, 'profiles', currentUser.uid), {
    games: { [gameId]: { playSec: sdk.increment(Math.round(seconds)), lastPlayed: sdk.serverTimestamp() } },
  }, { merge: true });
}

export async function reportScore(gameId, score) {
  if (!currentUser || typeof score !== 'number' || !isFinite(score)) return false;
  const ref = sdk.doc(db, 'profiles', currentUser.uid);
  let record = false;
  await sdk.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const best = snap.exists() ? snap.data().games?.[gameId]?.best : undefined;
    const g = { runs: sdk.increment(1), lastPlayed: sdk.serverTimestamp() };
    if (best === undefined || score > best) { g.best = score; record = true; }
    tx.set(ref, { games: { [gameId]: g } }, { merge: true });
  });
  return record;
}

// ---------- Spielstände ----------
// saves/{uid}/games/{gameId} = { data, version, updatedAt }, jede Version zusätzlich unter versions/.
// Speichern mit veralteter Version schlägt fehl (Konflikt) statt still zu überschreiben.

// Pro Spiel merken wir uns die zuletzt bekannte Cloud-Version und wann die letzte Sicherungskopie war.
// So braucht Speichern keinen Lesevorgang: Die Firestore-Regeln lassen nur version = alte version + 1 zu.
// Hat inzwischen ein anderes Gerät gespeichert, lehnen die Regeln ab, und erst dann wird gelesen.
const saveMeta = new Map(); // gameId -> { version, snapAt }

export async function loadSave(gameId) {
  const user = await ensureUser();
  const snap = await sdk.getDoc(sdk.doc(db, 'saves', user.uid, 'games', gameId));
  if (!snap.exists()) { saveMeta.set(gameId, { version: 0, snapAt: 0 }); return { data: null, version: 0 }; }
  const d = snap.data();
  saveMeta.set(gameId, { version: d.version || 0, snapAt: d.snapAt || 0 });
  return { data: d.data ?? null, version: d.version || 0, updatedAt: d.updatedAt?.toMillis?.() || null };
}

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000; // höchstens alle 10 Minuten eine Sicherungskopie

export async function writeSave(gameId, data, baseVersion) {
  const user = await ensureUser();
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (text.length > MAX_SAVE_CHARS) throw friendly('save-too-big');
  const ref = sdk.doc(db, 'saves', user.uid, 'games', gameId);
  const versionRef = (v, t) => sdk.doc(db, 'saves', user.uid, 'games', gameId, 'versions', `${String(v).padStart(8, '0')}-${t}`);
  const forced = typeof baseVersion !== 'number';
  const now = Date.now();
  const batch = sdk.writeBatch(db);
  let base, snapAt;

  if (forced) {
    // Ersetzen ohne Abgleich (Übertragen, "force"): aktuellen Stand lesen und als Kopie behalten.
    const snap = await sdk.getDoc(ref);
    const prev = snap.exists() ? snap.data() : null;
    base = prev?.version || 0;
    if (prev?.data != null) batch.set(versionRef(base, now - 1), { data: prev.data, version: base, updatedAt: sdk.serverTimestamp(), replaced: true });
    snapAt = 0;
  } else {
    base = baseVersion;
    snapAt = saveMeta.get(gameId)?.snapAt || 0;
  }

  const version = base + 1;
  const due = forced || now - snapAt >= SNAPSHOT_EVERY_MS;
  const newSnapAt = due ? now : snapAt;
  batch.set(ref, { data: text, version, updatedAt: sdk.serverTimestamp(), snapAt: newSnapAt });
  if (due) batch.set(versionRef(version, now), { data: text, version, updatedAt: sdk.serverTimestamp() });

  try {
    await batch.commit();
  } catch (e) {
    if (e.code !== 'permission-denied' || forced) throw e;
    // Abgelehnt: vermutlich hat ein anderes Gerät inzwischen gespeichert. Nachsehen.
    const snap = await sdk.getDoc(ref);
    const cur = snap.exists() ? snap.data() : null;
    if (!cur) return writeSave(gameId, text, null); // Stand wurde gelöscht: neu anlegen
    saveMeta.set(gameId, { version: cur.version || 0, snapAt: cur.snapAt || 0 });
    if ((cur.version || 0) !== base) return { ok: false, conflict: true, version: cur.version || 0, data: cur.data ?? null };
    throw e;
  }
  saveMeta.set(gameId, { version, snapAt: newSnapAt });
  return { ok: true, version };
}

// ---------- Cloud Functions (Codebase "canopy") ----------

const FUNCTIONS_REGION = 'europe-west3';
let fnMod = null;
export async function callFunction(name, data) {
  await load();
  if (!fnMod) fnMod = await import(`${FB}/firebase-functions.js`);
  try {
    const res = await fnMod.httpsCallable(fnMod.getFunctions(app, FUNCTIONS_REGION), name)(data || {});
    return res.data;
  } catch (e) {
    const err = new Error(e.message || 'Das hat nicht geklappt.');
    err.code = e.code;
    throw err;
  }
}

export async function readPrivate() {
  await load();
  if (!auth.currentUser) return null;
  const snap = await sdk.getDoc(sdk.doc(db, 'private', auth.currentUser.uid));
  return snap.exists() ? snap.data() : null;
}

// ---------- Account löschen ----------

export async function deleteAccount() {
  await load();
  const user = auth.currentUser;
  if (!user) return;
  const uid = user.uid;
  const games = await sdk.getDocs(sdk.collection(db, 'saves', uid, 'games'));
  for (const g of games.docs) {
    const versions = await sdk.getDocs(sdk.collection(g.ref, 'versions'));
    for (const v of versions.docs) await sdk.deleteDoc(v.ref);
    await sdk.deleteDoc(g.ref);
  }
  const name = currentProfile?.name;
  if (name) await sdk.deleteDoc(sdk.doc(db, 'usernames', name)).catch(() => {});
  await sdk.deleteDoc(sdk.doc(db, 'profiles', uid)).catch(() => {});
  await sdk.deleteDoc(sdk.doc(db, 'private', uid)).catch(() => {});
  try { await sdk.deleteUser(user); }
  catch (e) { throw friendly(e.code === 'auth/requires-recent-login' ? 'recent-login' : (e.code || e.message)); }
}

// ---------- Fehlermeldungen ----------

const MESSAGES = {
  'name-invalid': 'Der Nutzername braucht 3 bis 20 Zeichen: Kleinbuchstaben, Zahlen oder _.',
  'name-taken': 'Dieser Nutzername ist schon vergeben. Probier einen anderen.',
  'weak-password': 'Das Passwort braucht mindestens 8 Zeichen.',
  'auth/weak-password': 'Das Passwort braucht mindestens 8 Zeichen.',
  'auth/email-already-in-use': 'Dieser Nutzername ist schon vergeben. Probier einen anderen.',
  'auth/invalid-credential': 'Nutzername oder Passwort stimmt nicht.',
  'auth/wrong-password': 'Nutzername oder Passwort stimmt nicht.',
  'auth/user-not-found': 'Nutzername oder Passwort stimmt nicht.',
  'auth/invalid-email': 'Der Nutzername braucht 3 bis 20 Zeichen: Kleinbuchstaben, Zahlen oder _.',
  'auth/too-many-requests': 'Zu viele Versuche. Warte kurz und probier es dann noch einmal.',
  'auth/popup-closed-by-user': 'Das Google-Fenster wurde geschlossen, bevor die Anmeldung fertig war.',
  'auth/popup-blocked': 'Der Browser hat das Google-Fenster blockiert. Erlaube Pop-ups für diese Seite.',
  'auth/network-request-failed': 'Keine Verbindung. Prüfe dein Internet und versuch es noch einmal.',
  'auth/operation-not-allowed': 'Diese Anmeldeart ist noch nicht freigeschaltet.',
  'auth/admin-restricted-operation': 'Diese Anmeldeart ist noch nicht freigeschaltet.',
  'auth/unauthorized-domain': 'Diese Adresse ist für die Anmeldung noch nicht freigegeben.',
  'recent-login': 'Aus Sicherheitsgründen bitte einmal ab- und wieder anmelden, dann erneut löschen.',
  'google-in-use': 'Dieses Google-Konto gehört schon zu einem anderen Canopy-Account.',
  'save-too-big': 'Der Spielstand ist zu groß zum Hochladen.',
  'not-signed-in': 'Du bist nicht angemeldet.',
};
function friendly(code) {
  const e = new Error(MESSAGES[code] || 'Das hat nicht geklappt. Versuch es noch einmal.');
  e.code = code;
  return e;
}
