// Daily: one level per day, the same for everyone. The day changes at midnight
// US Eastern for every player, wherever they are. The level comes from a
// "seed" made from the date, so every phone builds the identical level on its
// own; there's no server.
window.Daily = (() => {
  'use strict';

  const TZ = 'America/New_York';
  const EPOCH = '2026-10-02'; // Daily #1

  const parts = (date) => {
    const out = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)) out[p.type] = p.value;
    return out;
  };

  const dayNumber = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    const [ey, em, ed] = EPOCH.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / 86400000) + 1;
  };

  // Today's daily: { key: 'YYYY-MM-DD' (Eastern), n: day number, label }.
  function today(now = new Date()) {
    const p = parts(now);
    const key = `${p.year}-${p.month}-${p.day}`;
    const label = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    return { key, n: dayNumber(key), label };
  }

  // The day before a 'YYYY-MM-DD' key (for streaks).
  function prevKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  }

  // Milliseconds until the next daily (midnight Eastern).
  function msUntilNext(now = new Date()) {
    const p = parts(now);
    const into = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
    return Math.max(0, 86400000 - into);
  }

  const countdown = (ms) => {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
  };

  // Seeded random numbers: the same key always gives the same sequence.
  function seed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A random stream: r(a, b) number in [a, b), p(q) true with chance q, i(n) integer below n.
  function stream(next) {
    return { r: (a, b) => a + next() * (b - a), p: (q) => next() < q, i: (n) => (next() * n) | 0 };
  }

  // One independent stream per part of the level, so climbing faster or
  // slower (which changes the order things get built in) can't change it.
  function streams(key) {
    const make = (name) => stream(key ? mulberry32(seed(`climbguy:${key}:${name}`)) : Math.random);
    return { day: make('day'), rows: make('rows'), features: make('features'), balloons: make('balloons'), wind: make('wind'), birds: make('birds') };
  }

  return { today, prevKey, msUntilNext, countdown, streams };
})();
