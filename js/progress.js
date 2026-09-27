// Fortschritt über alle Spiele: Achievements, XP, Level, Tages-Serie.
// Reine Berechnung ohne Firebase, damit Seiten und Tests sie gleich nutzen.

export const ACHIEVEMENTS = [
  { id: 'first_game', title: 'Erster Schritt', desc: 'Spiel dein erstes Spiel in Canopy.', tier: 1,
    test: (c) => c.gamesPlayed >= 1 },
  { id: 'three_games', title: 'Entdecker', desc: 'Spiel 3 verschiedene Spiele.', tier: 1,
    test: (c) => c.gamesPlayed >= 3 },
  { id: 'all_games', title: 'Komplettist', desc: 'Spiel jedes Spiel in Canopy mindestens einmal.', tier: 3,
    test: (c) => c.allGameIds.length > 0 && c.allGameIds.every((g) => c.played.includes(g)) },
  { id: 'hour_1', title: 'Warmgespielt', desc: 'Spiel insgesamt 1 Stunde.', tier: 1,
    test: (c) => c.totalSec >= 3600 },
  { id: 'hour_10', title: 'Stammgast', desc: 'Spiel insgesamt 10 Stunden.', tier: 2,
    test: (c) => c.totalSec >= 36000 },
  { id: 'hour_50', title: 'Urgestein', desc: 'Spiel insgesamt 50 Stunden.', tier: 3,
    test: (c) => c.totalSec >= 180000 },
  { id: 'game_5h', title: 'Spezialist', desc: 'Spiel ein einzelnes Spiel 5 Stunden lang.', tier: 2,
    test: (c) => c.maxGameSec >= 18000 },
  { id: 'streak_3', title: 'Dranbleiber', desc: 'Spiel an 3 Tagen hintereinander.', tier: 1,
    test: (c) => c.streakBest >= 3 },
  { id: 'streak_7', title: 'Eine ganze Woche', desc: 'Spiel an 7 Tagen hintereinander.', tier: 2,
    test: (c) => c.streakBest >= 7 },
  { id: 'streak_30', title: 'Unaufhaltsam', desc: 'Spiel an 30 Tagen hintereinander.', tier: 3,
    test: (c) => c.streakBest >= 30 },
  { id: 'night_owl', title: 'Nachteule', desc: 'Spiel zwischen 0 und 4 Uhr nachts.', tier: 1,
    test: (c) => c.nightPlay },
  { id: 'snake_10', title: 'Schlängler', desc: 'Schaff 10 Punkte in Snake.', tier: 1,
    test: (c) => (c.best.snake || 0) >= 10 },
  { id: 'snake_30', title: 'Schlangenbeschwörer', desc: 'Schaff 30 Punkte in Snake.', tier: 2,
    test: (c) => (c.best.snake || 0) >= 30 },
  { id: 'snake_60', title: 'Unendliche Schlange', desc: 'Schaff 60 Punkte in Snake.', tier: 3,
    test: (c) => (c.best.snake || 0) >= 60 },
  { id: 'friend_1', title: 'Nicht allein', desc: 'Füg deinen ersten Freund hinzu.', tier: 1,
    test: (c) => c.friends >= 1 },
  { id: 'friend_5', title: 'Clique', desc: 'Hab 5 Freunde.', tier: 2,
    test: (c) => c.friends >= 5 },
];
export const TIER_NAMES = { 1: 'Bronze', 2: 'Silber', 3: 'Gold' };
const TIER_XP = { 1: 100, 2: 300, 3: 800 };

/** Kennzahlen aus einem Profil ableiten. extra: { allGameIds, friends, nightPlay } */
export function context(profile, extra = {}) {
  const games = profile?.games || {};
  const played = Object.keys(games).filter((g) => (games[g].playSec || 0) > 0 || (games[g].runs || 0) > 0);
  const best = {};
  let maxGameSec = 0;
  for (const [g, v] of Object.entries(games)) {
    if (typeof v.best === 'number') best[g] = v.best;
    maxGameSec = Math.max(maxGameSec, v.playSec || 0);
  }
  return {
    played,
    gamesPlayed: played.length,
    totalSec: profile?.totalSec || Object.values(games).reduce((t, v) => t + (v.playSec || 0), 0),
    maxGameSec,
    best,
    streakBest: Math.max(profile?.streak?.best || 0, profile?.streak?.count || 0),
    friends: extra.friends ?? profile?.friendCount ?? 0,
    nightPlay: !!(extra.nightPlay || profile?.nightPlay),
    allGameIds: extra.allGameIds || [],
  };
}

/** Achievements, die laut Kennzahlen erreicht, aber im Profil noch nicht eingetragen sind. */
export function newlyUnlocked(profile, extra) {
  const c = context(profile, extra);
  const have = profile?.achievements || {};
  return ACHIEVEMENTS.filter((a) => !have[a.id] && a.test(c));
}

export function xpOf(profile) {
  const minutes = Math.floor((profile?.totalSec || 0) / 60);
  const ach = profile?.achievements || {};
  const achXp = ACHIEVEMENTS.reduce((t, a) => t + (ach[a.id] ? TIER_XP[a.tier] : 0), 0);
  return minutes + achXp;
}

// Level n braucht insgesamt 50 * (n-1)^2 XP: Level 2 = 50, Level 5 = 800, Level 10 = 4050.
export function levelOf(xp) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const from = 50 * (level - 1) ** 2, to = 50 * level ** 2;
  return { level, xp, from, to, progress: (xp - from) / (to - from) };
}

/** Tages-Serie fortschreiben. day = 'JJJJ-MM-TT' in der Zeitzone des Spielers. */
export function nextStreak(streak, day) {
  const s = streak || {};
  if (s.day === day) return s;
  const y = new Date(day + 'T12:00:00'); y.setDate(y.getDate() - 1);
  const yesterday = localDay(y);
  const count = s.day === yesterday ? (s.count || 0) + 1 : 1;
  return { day, count, best: Math.max(s.best || 0, count) };
}
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 100) return `${h} Std.`;
  return h ? `${h} Std. ${m} Min.` : `${m} Min.`;
}
