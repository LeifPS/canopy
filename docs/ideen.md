# Canopy: Ideen und Plan

**Namen:** Canopy (Marke/Studio „Canopy Games“), Canopy ID (Account), Canopy Base (Website mit allen Spielen).

## Reihenfolge

1. **Absichern:** Backups/PITR, Foil-Regeln auf Vereinskonten beschränken (foil-xi PR #2), eigene Datenbank `canopy`, Functions-Codebase `canopy`. ← erledigt 27.09. (Foil-Regeln live, Datenbank `canopy` + Regeln live, Backups, Budget, Login-Arten, Domain canopybase.pages.dev)
2. **Canopy Base:** alle Spiele, Status, Neu/Bald, Countdown, Changelog aus GitHub, Statusseite. ← erste Version steht
3. **Canopy ID + SDK:** ← live und getestet 27.09. (Login, Kontoseite, Spielzeit, Rekorde, Cloud-Saves mit Versionen, SDK, Snake nutzt es). Login (Nutzername+Passwort oder Google, Gastmodus per Anonymous Auth), `canopy-sdk.js` mit Spielzeit, Events, Scores, Cloud-Saves (local-first, Versionen, Konfliktabfrage). Profil, „Account löschen“, Datenschutzseite.
4. **Spiele umziehen:** siehe `spiele-speicher.md`.
5. **Achievements & Motivation:** ← erste Version 27.09. (16 Achievements, XP/Level, Tages-Serie; `js/progress.js`). Achievements als Regeln pro Spiel, Meta-Achievements, XP/Level, Daily/Weekly Quests, Event-Wochen.
6. **Social:** ← erste Version 27.09. (Freunde, Aktivitäten, Bestenlisten gesamt/pro Spiel/Freunde, öffentliches Profil). Offen: Rekord-Duelle, „gerade online in …“. Freundescodes, Profile vergleichen, Bestenlisten (global + Freunde), Activity Feed, Rekord-Duelle, „gerade online in …“.
7. **Für Leif:** ← Feedback-Knopf im Player + Neuigkeiten-Seite aus GitHub fertig. Offen: Prototypen-Bereich mit Feedback, Bug-Melder mit Spielstand, Beta-Tester-Rolle, Admin-Dashboard, Discord-Ankündigungen (Foil-Bot mitnutzen), öffentliche Roadmap mit Abstimmung.

## Ideen-Sammlung

- Spielstand-Zeitmaschine für alle Spiele (wie Foils `saveHistory`)
- „Weiterspielen“-Leiste mit zuletzt gespielten Spielen
- Monogames: Snake zuerst, dann weitere schnelle Spiele, jeweils mit Bestenliste; „Monogame der Woche“
- Countdown + „Benachrichtige mich“ für kommende Spiele
- Statistik-Seite: Spielzeit pro Spiel, Highscore-Verlauf, Seltenheit von Achievements („nur 4 % haben das“)
- Hub-Kosmetik (Avatare, Rahmen, Banner), nur Kosmetik, damit die Spiel-Wirtschaften heil bleiben
- Kleine Belohnungen über Spiele hinweg (sparsam)
- Challenges: Freund einen Score schicken, den er schlagen muss
- Jahresrückblick („Wrapped“)
- Später: alle Spiele unter eine eigene Domain (ein Login für alles), „Druckerei“ für Pets Go / Anstoß Elf

## Vorerst nicht dabei

Pets Go, Anstoß Elf, Texas Hold'em Online.
