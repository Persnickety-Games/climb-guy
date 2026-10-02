// Progress: run history, stats, badges, landmarks reached and unlocked skins.
// Everything is saved on this device (localStorage); there is no server.
window.Progress = (() => {
  'use strict';

  const KEY = 'tt.profile.v1';
  const MAX_RUNS = 300; // run history kept for the stats page

  // Real things you climb past, at their real heights: [m, icon, name].
  const LANDMARKS = [
    [5.5, '🦒', 'a giraffe'], [12, '🦕', 'a Brachiosaurus'], [21, '🎈', 'a hot air balloon'],
    [46, '🗽', 'the Statue of Liberty'], [108, '🦖', 'Godzilla'], [139, '🔺', 'the Great Pyramid'],
    [184, '🛸', 'the Space Needle'], [227, '🌉', 'the Golden Gate Bridge towers'], [269, '🚢', 'the Titanic (on end)'],
    [330, '🗼', 'the Eiffel Tower'], [381, '🏙️', 'the Empire State Building'], [442, '🏢', 'the Willis Tower'],
    [508, '🎋', 'Taipei 101'], [553, '🍁', 'the CN Tower'], [604, '🪨', 'Pulpit Rock (Norway)'],
    [679, '🌴', 'Merdeka 118'], [739, '💦', 'Yosemite Falls'], [828, '🌆', 'the Burj Khalifa'],
    [914, '🧗', 'El Capitan'], [979, '💧', 'Angel Falls'],
    [1085, '⛰️', 'Table Mountain'], [1250, '⚡', "Mount Thor's sheer cliff"], [1345, '🏔️', 'Ben Nevis'],
    [1444, '🌓', 'Half Dome'],
    // Far-off goals.
    [3776, '🗻', 'Mount Fuji'], [4000, '🪂', 'a skydiving jump'], [4478, '🏔️', 'the Matterhorn'],
    [5895, '🦁', 'Kilimanjaro'], [8849, '🚩', 'Mount Everest'], [10700, '✈️', 'a plane at cruising altitude'],
    [100000, '🌌', 'the edge of space'], [408000, '🛰️', 'the ISS'],
  ];

  const POWER_KINDS = ['autoGrab', 'swollen', 'freeze', 'rocket', 'breakaway', 'flood', 'ouch'];

  // Badges. Height badges are checked from your best; the rest are awarded by
  // the game (award) or at the end of a run (recordRun).
  const BADGES = [
    { id: 'first', icon: '🤚', name: 'First Grip', desc: 'Catch your first ledge.' },
    { id: 'm50', icon: '🥉', name: '50 m', desc: 'Climb 50 m in one run.', best: 50 },
    { id: 'm100', icon: '🥈', name: '100 m', desc: 'Climb 100 m in one run.', best: 100 },
    { id: 'm250', icon: '🥇', name: '250 m', desc: 'Climb 250 m in one run.', best: 250 },
    { id: 'm500', icon: '🏆', name: '500 m', desc: 'Climb 500 m in one run.', best: 500 },
    { id: 'm1000', icon: '👑', name: '1 km', desc: 'Climb 1,000 m in one run.', best: 1000 },
    { id: 'fling', icon: '💪', name: 'Fling King', desc: 'Gain 20 m in a single fling.' },
    { id: 'clutch', icon: '😅', name: 'Clutch', desc: 'Get within 1 m of the water, then climb 10 m clear.' },
    { id: 'freefall', icon: '🪂', name: 'Freefall', desc: 'Catch a ledge after falling 10 m.' },
    { id: 'purist', icon: '🧘', name: 'Purist', desc: 'Reach 150 m without popping a balloon.' },
    { id: 'speed', icon: '⚡', name: 'Speedrun', desc: 'Reach 100 m within 60 seconds.' },
    { id: 'marathon', icon: '⏱️', name: 'Marathon', desc: 'Survive 5 minutes in one run.' },
    { id: 'balloons', icon: '🎈', name: 'Balloon Animal', desc: 'Pop 25 balloons in total.' },
    { id: 'rocket', icon: '🚀', name: 'Rocket Rider', desc: 'Pop a rocket balloon.' },
    { id: 'allpowers', icon: '🌈', name: 'Tried Everything', desc: 'Pop every kind of balloon.' },
    { id: 'regular', icon: '📅', name: 'Regular', desc: 'Play on 3 different days.' },
    { id: 'dedicated', icon: '🔁', name: 'Dedicated', desc: 'Play 50 runs.' },
    { id: 'km1', icon: '🥾', name: 'Hiker', desc: 'Climb 1,000 m in total.' },
    { id: 'km10', icon: '🏔️', name: 'Mountaineer', desc: 'Climb 10,000 m in total.' },
    { id: 'fooled', icon: '👻', name: 'Fooled', desc: 'Try to grab a ghost ledge.' },
    { id: 'birdbrain', icon: '🐦', name: 'Bird Brain', desc: 'Get knocked by birds 5 times.' },
    { id: 'splash', icon: '💦', name: 'Splash Landing', desc: 'Fall in the water below 5 m.' },
    { id: 'doubleouch', icon: '🤕', name: 'Double Ouch', desc: 'Have both hands hurt at once.' },
  ];

  // What unlocks each skin item: { best: m } or { badge: id }. Missing = free.
  const UNLOCKS = {
    body: { green: { best: 25 }, purple: { best: 50 }, red: { badge: 'fling' }, gold: { best: 500 }, stripes: { badge: 'dedicated' }, polka: { badge: 'balloons' } },
    hat: { party: { badge: 'first' }, bucket: { best: 75 }, cowboy: { badge: 'freefall' }, propeller: { best: 150 }, tophat: { badge: 'clutch' }, crown: { best: 250 }, astronaut: { best: 400 } },
    face: { sunglasses: { best: 100 }, mustache: { badge: 'birdbrain' }, monocle: { badge: 'fooled' } },
    color: { orange: { best: 25 }, purple: { best: 75 }, red: { badge: 'speed' }, black: { badge: 'splash' }, gold: { best: 500 }, rainbow: { best: 300 } },
    backdrop: { sunset: { best: 50 }, night: { best: 100 }, forest: { badge: 'purist' }, candy: { badge: 'allpowers' }, synthwave: { best: 750 } },
    ledges: { wood: { best: 35 }, stone: { best: 150 }, candy: { badge: 'rocket' }, neon: { best: 200 }, gold: { best: 1000 } },
    water: { slime: { badge: 'doubleouch' }, chocolate: { badge: 'marathon' }, lava: { best: 300 } },
  };

  // The customize screen's slots, which list each slot draws from, and the default.
  const SLOTS = [
    { id: 'body', label: 'Body', list: 'BODIES', kind: 'body', def: 'orange' },
    { id: 'hat', label: 'Hat', list: 'HATS', kind: 'hat', def: 'none' },
    { id: 'face', label: 'Face', list: 'FACES', kind: 'face', def: 'none' },
    { id: 'leftHand', label: 'Left hand', list: 'COLORS', kind: 'color', def: 'pink' },
    { id: 'rightHand', label: 'Right hand', list: 'COLORS', kind: 'color', def: 'yellow' },
    { id: 'leftArc', label: 'Left aim arc', list: 'COLORS', kind: 'color', def: 'pink' },
    { id: 'rightArc', label: 'Right aim arc', list: 'COLORS', kind: 'color', def: 'yellow' },
    { id: 'backdrop', label: 'Backdrop', list: 'BACKDROPS', kind: 'backdrop', def: 'classic' },
    { id: 'ledges', label: 'Ledges', list: 'LEDGES', kind: 'ledges', def: 'classic' },
    { id: 'water', label: 'Water', list: 'WATERS', kind: 'water', def: 'water' },
  ];

  function blank() {
    let oldBest = 0;
    try { oldBest = JSON.parse(localStorage.getItem('climber2.best')) || 0; } catch {}
    return {
      runs: [],               // { m, ts, secs }
      best: oldBest,
      totalRuns: 0,
      totalM: 0,
      totalSecs: 0,
      popped: 0,
      kinds: {},              // balloon kinds ever popped
      birdHits: 0,
      days: {},               // 'YYYY-MM-DD' -> true
      badges: {},             // id -> timestamp earned
      landmarks: {},          // index -> timestamp first reached
      equipped: {},
    };
  }

  let p = blank();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) p = Object.assign(blank(), saved);
  } catch {}

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  }

  const has = (id) => !!p.badges[id];

  function requirementMet(req) {
    if (!req) return true;
    if (req.best != null) return p.best >= req.best;
    if (req.badge) return has(req.badge);
    return true;
  }

  const isUnlocked = (kind, id) => requirementMet((UNLOCKS[kind] || {})[id]);

  function requirementText(kind, id) {
    const req = (UNLOCKS[kind] || {})[id];
    if (!req) return '';
    if (req.best != null) return `Reach ${req.best} m`;
    const b = BADGES.find(x => x.id === req.badge);
    return b ? `Badge: ${b.name}` : '';
  }

  // Everything currently unlocked, as "kind:id" strings (to spot new unlocks).
  function unlockedSet() {
    const out = new Set();
    for (const [kind, items] of Object.entries(UNLOCKS)) {
      for (const id of Object.keys(items)) if (isUnlocked(kind, id)) out.add(`${kind}:${id}`);
    }
    return out;
  }

  function itemFor(kind, id) {
    const list = { body: Skins.BODIES, hat: Skins.HATS, face: Skins.FACES, color: Skins.COLORS, backdrop: Skins.BACKDROPS, ledges: Skins.LEDGES, water: Skins.WATERS }[kind];
    return list.find(x => x.id === id);
  }

  // How an unlock reads in a sentence ("the Crown", "the Sunset backdrop").
  const KIND_SUFFIX = { body: ' body', hat: '', face: '', color: ' hand & arc color', backdrop: ' backdrop', ledges: ' ledges', water: '' };
  function unlockLabel(key) {
    const [kind, id] = key.split(':');
    const item = itemFor(kind, id);
    return `${item ? item.name : id}${KIND_SUFFIX[kind]}`;
  }

  // The equipped skin, falling back to defaults (and away from anything locked).
  function equipped() {
    const out = {};
    for (const s of SLOTS) {
      const id = p.equipped[s.id];
      out[s.id] = id && isUnlocked(s.kind, id) ? id : s.def;
    }
    return out;
  }

  function equip(slotId, id) {
    const s = SLOTS.find(x => x.id === slotId);
    if (!s || !isUnlocked(s.kind, id)) return false;
    p.equipped[slotId] = id;
    save();
    return true;
  }

  // Award a badge now (during a run). Returns the badge if it's new.
  function award(id) {
    if (has(id)) return null;
    const b = BADGES.find(x => x.id === id);
    if (!b) return null;
    p.badges[id] = Date.now();
    save();
    return b;
  }

  // Track a popped balloon (counts toward balloon badges).
  function notePop(kind) {
    p.popped++;
    p.kinds[kind] = true;
    const got = [];
    if (p.popped >= 25) got.push(award('balloons'));
    if (kind === 'rocket') got.push(award('rocket'));
    if (POWER_KINDS.every(k => p.kinds[k])) got.push(award('allpowers'));
    save();
    return got.filter(Boolean);
  }

  function noteBirdHit() {
    p.birdHits++;
    save();
    return p.birdHits >= 5 ? award('birdbrain') : null;
  }

  // Mark a landmark reached; returns true the first time.
  function noteLandmark(index) {
    if (p.landmarks[index]) return false;
    p.landmarks[index] = Date.now();
    save();
    return true;
  }

  // A height reached mid-run: height badges and a live best (for unlocks).
  function noteHeight(m) {
    const got = BADGES.filter(b => b.best != null && m >= b.best).map(b => award(b.id)).filter(Boolean);
    return got;
  }

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

  // Save a finished run. Returns what's new: badges, unlocks, and whether it's a best.
  function recordRun({ m, secs, splash, unlockedBefore }) {
    const before = unlockedBefore || unlockedSet();
    const badgesBefore = new Set(Object.keys(p.badges));
    const isBest = m > p.best;
    p.runs.push({ m, ts: Date.now(), secs: Math.round(secs) });
    if (p.runs.length > MAX_RUNS) p.runs.splice(0, p.runs.length - MAX_RUNS);
    p.best = Math.max(p.best, m);
    p.totalRuns++;
    p.totalM += m;
    p.totalSecs += secs;
    p.days[dayKey()] = true;
    for (const b of BADGES) if (b.best != null && p.best >= b.best) award(b.id);
    if (Object.keys(p.days).length >= 3) award('regular');
    if (p.totalRuns >= 50) award('dedicated');
    if (p.totalM >= 1000) award('km1');
    if (p.totalM >= 10000) award('km10');
    if (splash) award('splash');
    save();
    const after = unlockedSet();
    return {
      isBest,
      newBadges: BADGES.filter(b => p.badges[b.id] && !badgesBefore.has(b.id)),
      newUnlocks: [...after].filter(k => !before.has(k)).map(unlockLabel),
    };
  }

  // The closest height-based unlock you haven't reached yet.
  function nextUnlock() {
    let best = null;
    for (const [kind, items] of Object.entries(UNLOCKS)) {
      for (const [id, req] of Object.entries(items)) {
        if (req.best == null || p.best >= req.best) continue;
        if (!best || req.best < best.m) best = { m: req.best, label: unlockLabel(`${kind}:${id}`) };
      }
    }
    return best;
  }

  function stats() {
    const runs = p.runs;
    const last10 = runs.slice(-10);
    return {
      best: p.best,
      totalRuns: p.totalRuns,
      totalM: p.totalM,
      totalSecs: p.totalSecs,
      avg10: last10.length ? Math.round(last10.reduce((s, r) => s + r.m, 0) / last10.length) : 0,
      popped: p.popped,
      landmarks: Object.keys(p.landmarks).length,
      badges: Object.keys(p.badges).length,
      runs,
    };
  }

  return {
    LANDMARKS, BADGES, UNLOCKS, SLOTS,
    get best() { return p.best; },
    get badges() { return p.badges; },
    get landmarks() { return p.landmarks; },
    unlockedSnapshot: () => unlockedSet(),
    isUnlocked, requirementText, equipped, equip, award, notePop, noteBirdHit, noteLandmark, noteHeight,
    recordRun, nextUnlock, stats,
    // Debug: wipe all progress on this device.
    reset() { p = blank(); p.best = 0; save(); },
  };
})();
