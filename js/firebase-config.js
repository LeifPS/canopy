// Öffentliche Web-Konfiguration des Firebase-Projekts chess-rng (dasselbe wie Foil Eleven).
// Diese Werte dürfen im Browser stehen, geschützt wird alles über die Firestore-Regeln.
// Canopy nutzt darin die eigene Datenbank "canopy", nie "(default)".
export const firebaseConfig = {
  apiKey: 'AIzaSyBViVDKpq_nXMTMsScWrP8dkenBFtikgkc',
  authDomain: 'chess-rng.firebaseapp.com',
  projectId: 'chess-rng',
  storageBucket: 'chess-rng.firebasestorage.app',
  messagingSenderId: '1071354935766',
  appId: '1:1071354935766:web:0e5c5a6a2f0f0b95be4c77',
};
export const CANOPY_DB = 'canopy';
export const FB = 'https://www.gstatic.com/firebasejs/10.13.2';
