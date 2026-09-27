# Canopy

- **Canopy Base**: die Website mit allen Spielen (`index.html`, Daten in `games.json`)
- **Canopy ID**: der gemeinsame Account für alle Spiele (`account.html`, Logik in `js/canopy-id.js`)
- **Canopy-Player**: `play.html?g=<id>` bettet Spiele mit `"embed": true` ein und speichert Spielzeit, Rekorde und Spielstände
- **SDK für Spiele**: `sdk/canopy-sdk.js` (Anleitung oben in der Datei)

## Neues Spiel eintragen

Einen Eintrag in `games.json` ergänzen. Status: `live`, `beta`, `prototyp`, `mono`, `demnaechst`.
Mit `releaseAt` (z. B. `"2026-11-01"`) zeigt die Seite bei kommenden Spielen einen Countdown.
Ist `repo` gesetzt, holt die Seite das Datum des letzten Updates automatisch von GitHub.

## Lokal ansehen

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Hosting

Live: **https://canopybase.pages.dev** (Cloudflare Pages, deployt automatisch von `main`).

Statische Seite, z. B. über Cloudflare Pages wie die anderen Spiele (kein Build-Schritt,
Ausgabeordner `/`).

## Firebase: Sicherheitsregeln (wichtig)

Canopy nutzt das Firebase-Projekt von Foil Eleven (`chess-rng`, Blaze-Tarif), aber eine
**eigene Firestore-Datenbank namens `canopy`**. Foil Eleven bleibt in `(default)`.

1. **Nie Foil-Regeln aus diesem Repo deployen.** `firebase.json` hier kennt nur die Datenbank
   `canopy`. Die Foil-Regeln liegen im Repo `foil-xi`.
2. **Keine Cloud Functions mit der Codebase `default`.** Die gehört Foil (Discord-Bot,
   Liga-Rollover). Canopy-Functions bekommen die Codebase `canopy`, sonst löscht ein Deploy die
   Foil-Funktionen.
3. **Vor dem ersten Canopy-Account** muss der Foil-PR „geschützte Foil-Daten nur für
   Vereinskonten“ deployt sein. Sonst könnten Canopy-Konten Foil-Spielstände lesen und schreiben.
4. **Spielstand-Versionen** (`saves/{uid}/games/{gameId}/versions`) dürfen von Spielern nie
   gelöscht oder überschrieben werden, nur neue angelegt.

### Einmalige Einrichtung in der Firebase-Konsole

- Firestore → Datenbank hinzufügen → ID `canopy`, Region wie `(default)`
- Firestore → Disaster Recovery: Point-in-Time-Recovery und tägliche Backups für **beide** Datenbanken
- Abrechnung → Budget-Warnung setzen
- Authentication: Anbieter Google aktivieren, autorisierte Domain der Canopy-Base-Seite eintragen

### Regeln testen und deployen

```bash
npm i --no-save firebase-tools @firebase/rules-unit-testing firebase
npx firebase emulators:exec --only firestore --project demo-canopy "node tests/rules.emulator.js"
# nur wenn "Alle Regel-Tests bestanden":
npx firebase deploy --only firestore --project chess-rng
```

Deployt ausschließlich die Regeln der Datenbank `canopy` (siehe `firebase.json`).

### Cloud Functions (Foil-Login im Player)

Codebase `canopy`, Region `europe-west3`. **Immer mit `functions:canopy` deployen**, sonst könnte die
CLI die Foil-Funktionen (Codebase `default`) anfassen:

```bash
node tests/functions.mock.test.js        # Test ohne echtes Firebase
cd functions && npm install && cd ..
npx firebase deploy --only functions:canopy --project chess-rng
```

`foilToken` stellt Einmal-Logins aus (`createCustomToken`). Dafür braucht das Dienstkonto der
Functions einmalig die Rolle **Ersteller von Dienstkonto-Tokens** (Service Account Token Creator).
