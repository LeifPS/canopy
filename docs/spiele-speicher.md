# Wie die Spiele heute speichern

Stand: 27.09.2026. Grundlage für den Umzug nach Canopy ID. Regel für jeden Umzug: **Der alte
Spielstand wird nie gelöscht**, nur kopiert.

| Spiel | Repo | Firebase-Projekt | Login | Spielstand |
|---|---|---|---|---|
| Foil Eleven | `LeifPS/foil-xi` | `chess-rng` (Blaze, wird Canopy-Master) | Vereinsname + Passwort (`{club}@foileleven-club.auth`) | Firestore `saves/{clubId}` + `saveHistory`, Datenbank `(default)` |
| Tierspiel | `LeifPS/tierspiel` | `tierspiel` | eigenes Firebase | Firestore |
| Chess RNG (`chessrng.web.app`) | `LeifPS/chessrng` | `chessrngreal` (Firebase Hosting) | keins | localStorage `chessrng-player` (Spieler-ID), Online-Partien in Firestore `players`, `games`, `queue`, `results` |
| Ernte-Zeit (Farm) | `LeifPS/rangspiel` | `rangspiel1` | Profile lokal | localStorage `ernteZeitSave`, `ernteZeitProfileNames`, `ernteZeitActiveProfile` |
| Cookie RNG | `LeifPS/cookierng1` (eine kopierte HTML-Datei, ~6.900 Zeilen) | `rangspiel` (nur Rangliste) | keins | localStorage `cookierng_v1`, dazu `cookierng_settings_v1`, `cookierng_rank_v1` |
| Cookie RNG II | `LeifPS/cookierng2` | `cookie-rng` (Firebase Hosting) | anonym + Google | localStorage `cookierng2_save_v1` + Firestore `saves/{uid}` (`json`, `at`), Cloud-Sync alle 2–5 Min. |

## Umzugsweg pro Spiel

- **localStorage-Spiele** (Chess RNG, Ernte-Zeit, Cookie RNG): Button „In Canopy ID übertragen“
  im Spiel. Er läuft auf der alten Domain, liest den lokalen Stand und lädt ihn nach
  `canopy`-Datenbank `saves/{uid}/games/{gameId}` hoch.
- **Cookie RNG II**: hat schon Cloud-Saves im eigenen Projekt. Das Spiel liest beim Verbinden
  seinen eigenen Cloud-Stand (Sitzung im Projekt `cookie-rng`) und kopiert ihn nach Canopy.
- **Foil Eleven**: wird nicht umgezogen, sondern verknüpft (Verein einmal per Passwort bestätigen,
  danach „Mit Canopy anmelden“ über Custom Token einer Cloud Function, Codebase `canopy`).
- **Tierspiel**: noch prüfen, wie Accounts dort aussehen.

## Worauf achten

- Cloud nur alle 30–60 s speichern (Cookie RNG II macht es mit 2–5 Min. schon richtig), lokal weiter sofort.
- Jeder Cloud-Stand hat eine Versionsnummer und Zeitstempel. Ist die Cloud neuer als lokal: nachfragen, nie still überschreiben.
- Firestore-Dokumente max. 1 MB. Cookie RNG II begrenzt schon auf 800 KB.
