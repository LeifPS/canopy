// Canopy ID: ein Account für alle Canopy-Spiele.
// Login per Nutzername + Passwort (intern {name}@canopy-id.auth, keine echte E-Mail),
// per Google, oder als Gast (anonym, lässt sich später in einen richtigen Account umwandeln).
import { firebaseConfig, CANOPY_DB, FB } from './firebase-config.js';
import { newlyUnlocked, nextStreak, localDay } from './progress.js';

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

// Alle Spiele, die für "Komplettist" zählen (setzt der Player aus games.json).
let allGameIds = [];
export function setGameIds(ids) { allGameIds = ids || []; }
const achListeners = new Set();
/** fn(achievement) wird aufgerufen, wenn gerade ein Achievement freigeschaltet wurde. */
export function onAchievement(fn) { achListeners.add(fn); return () => achListeners.delete(fn); }

// Lokale Kopie des eigenen Profils nach einem Schreibvorgang nachführen (spart einen Lesevorgang).
function patchLocal(patch) {
  const p = currentProfile || {};
  const games = { ...(p.games || {}) };
  for (const [g, v] of Object.entries(patch.games || {})) games[g] = { ...(games[g] || {}), ...v };
  currentProfile = { ...p, ...patch, games };
}

async function checkAchievements(extra = {}) {
  if (!currentUser || !currentProfile?.name) return; // nur echte Accounts, keine Gäste
  const fresh = newlyUnlocked(currentProfile, { allGameIds, ...extra });
  if (!fresh.length) return;
  const now = Date.now();
  const add = {}; for (const a of fresh) add[a.id] = now;
  await sdk.setDoc(sdk.doc(db, 'profiles', currentUser.uid), { achievements: add }, { merge: true });
  currentProfile = { ...currentProfile, achievements: { ...(currentProfile.achievements || {}), ...add } };
  for (const a of fresh) for (const fn of achListeners) { try { fn(a); } catch (e) {} }
  emit();
}

export async function addPlaytime(gameId, seconds) {
  if (!currentUser || seconds <= 0) return;
  const sec = Math.round(seconds);
  const streak = nextStreak(currentProfile?.streak, localDay());
  const night = new Date().getHours() < 4;
  const patch = { streak, lastGame: gameId };
  if (night) patch.nightPlay = true;
  await sdk.setDoc(sdk.doc(db, 'profiles', currentUser.uid), {
    ...patch,
    totalSec: sdk.increment(sec),
    lastSeen: sdk.serverTimestamp(),
    games: { [gameId]: { playSec: sdk.increment(sec), lastPlayed: sdk.serverTimestamp() } },
  }, { merge: true });
  const g = currentProfile?.games?.[gameId] || {};
  patchLocal({ ...patch, totalSec: (currentProfile?.totalSec || 0) + sec,
    games: { [gameId]: { playSec: (g.playSec || 0) + sec, lastPlayed: { toMillis: () => Date.now() } } } });
  await checkAchievements();
}

export async function reportScore(gameId, score) {
  if (!currentUser || typeof score !== 'number' || !isFinite(score)) return false;
  const ref = sdk.doc(db, 'profiles', currentUser.uid);
  let record = false, best;
  await sdk.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    best = snap.exists() ? snap.data().games?.[gameId]?.best : undefined;
    const g = { runs: sdk.increment(1), lastPlayed: sdk.serverTimestamp() };
    if (best === undefined || score > best) { g.best = score; g.bestAt = sdk.serverTimestamp(); record = true; }
    tx.set(ref, { lastGame: gameId, games: { [gameId]: g } }, { merge: true });
  });
  const old = currentProfile?.games?.[gameId] || {};
  patchLocal({ lastGame: gameId, games: { [gameId]: { runs: (old.runs || 0) + 1, ...(record ? { best: score, bestAt: { toMillis: () => Date.now() } } : {}) } } });
  await checkAchievements();
  return record;
}

// ---------- Profile, Bestenlisten ----------

export async function profileByName(nameRaw) {
  await load();
  const name = cleanName(nameRaw);
  if (!NAME_RULE.test(name)) return null;
  const u = await sdk.getDoc(sdk.doc(db, 'usernames', name));
  if (!u.exists()) return null;
  const uid = u.data().uid;
  const p = await sdk.getDoc(sdk.doc(db, 'profiles', uid));
  return p.exists() ? { uid, ...p.data() } : null;
}

export async function profileByUid(uid) {
  await load();
  const p = await sdk.getDoc(sdk.doc(db, 'profiles', uid));
  return p.exists() ? { uid, ...p.data() } : null;
}

/**
 * Bestenliste. field: 'best' | 'playSec' (pro Spiel) oder gameId = null für die Gesamtspielzeit.
 * Gäste (ohne Namen) werden ausgeblendet.
 */
export async function leaderboard(gameId, field = 'playSec', max = 25) {
  await load();
  const path = gameId ? new sdk.FieldPath('games', gameId, field) : new sdk.FieldPath('totalSec');
  const q = sdk.query(sdk.collection(db, 'profiles'), sdk.orderBy(path, 'desc'), sdk.limit(max * 2));
  const snap = await sdk.getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((p) => p.name).slice(0, max)
    .map((p) => ({ ...p, value: gameId ? p.games?.[gameId]?.[field] : p.totalSec }));
}

// ---------- Freunde ----------
// friendships/{a_b} (a < b) = { members: [a, b], status: 'pending' | 'accepted', requestedBy, at }

const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export async function friendships() {
  await load();
  if (!currentUser) return [];
  const q = sdk.query(sdk.collection(db, 'friendships'), sdk.where('members', 'array-contains', currentUser.uid));
  const snap = await sdk.getDocs(q);
  const me = currentUser.uid;
  const list = snap.docs.map((d) => {
    const f = d.data();
    const other = f.members.find((m) => m !== me);
    return { id: d.id, other, status: f.status, incoming: f.status === 'pending' && f.requestedBy !== me, outgoing: f.status === 'pending' && f.requestedBy === me };
  });
  const profiles = await Promise.all(list.map((f) => profileByUid(f.other).catch(() => null)));
  list.forEach((f, i) => { f.profile = profiles[i]; });
  const accepted = list.filter((f) => f.status === 'accepted').length;
  if (currentProfile?.name && currentProfile.friendCount !== accepted) {
    await sdk.setDoc(sdk.doc(db, 'profiles', me), { friendCount: accepted }, { merge: true }).catch(() => {});
    currentProfile = { ...currentProfile, friendCount: accepted };
    checkAchievements({ friends: accepted }).catch(() => {});
  }
  return list;
}

export async function addFriend(nameRaw) {
  await load();
  if (!currentUser || !currentProfile?.name) throw friendly('need-account');
  const other = await profileByName(nameRaw);
  if (!other) throw friendly('friend-not-found');
  const me = currentUser.uid;
  if (other.uid === me) throw friendly('friend-self');
  const id = pairId(me, other.uid);
  const ref = sdk.doc(db, 'friendships', id);
  const cur = await sdk.getDoc(ref).catch(() => null);
  if (cur && cur.exists()) {
    const f = cur.data();
    if (f.status === 'accepted') throw friendly('friend-already');
    if (f.requestedBy !== me) { await acceptFriend(id); return 'accepted'; } // hatte mich schon angefragt
    throw friendly('friend-pending');
  }
  const members = [me, other.uid].sort();
  await sdk.setDoc(ref, { members, status: 'pending', requestedBy: me, at: sdk.serverTimestamp() });
  return 'requested';
}

export async function acceptFriend(id) {
  await load();
  await sdk.updateDoc(sdk.doc(db, 'friendships', id), { status: 'accepted', acceptedAt: sdk.serverTimestamp() });
}

export async function removeFriend(id) {
  await load();
  await sdk.deleteDoc(sdk.doc(db, 'friendships', id));
}

// ---------- Feedback ----------

export async function sendFeedback(gameId, rating, text) {
  const user = await ensureUser();
  await sdk.addDoc(sdk.collection(db, 'feedback'), {
    uid: user.uid, name: currentProfile?.name || null, game: gameId,
    rating: Number(rating) || null, text: String(text || '').slice(0, 2000),
    at: sdk.serverTimestamp(), ua: navigator.userAgent.slice(0, 200),
  });
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
  'need-account': 'Dafür brauchst du einen Account mit Nutzernamen.',
  'friend-not-found': 'Diesen Nutzernamen gibt es nicht.',
  'friend-self': 'Das bist du selbst.',
  'friend-already': 'Ihr seid schon befreundet.',
  'friend-pending': 'Die Anfrage läuft schon. Warte, bis sie angenommen wird.',
  'save-too-big': 'Der Spielstand ist zu groß zum Hochladen.',
  'not-signed-in': 'Du bist nicht angemeldet.',
};
function friendly(code) {
  const e = new Error(MESSAGES[code] || 'Das hat nicht geklappt. Versuch es noch einmal.');
  e.code = code;
  return e;
}
