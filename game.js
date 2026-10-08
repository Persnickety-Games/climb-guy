// Climb Guy — two thumbs, two hands. Outclimb the rising water.
//
// Controls (touch, two thumbs):
//   Left half of the screen = left hand, right half = right hand.
//   - Drag down and release to throw a free hand (slingshot).
//   - Tap while a hand is over a ledge to grab it, and KEEP HOLDING.
//   - Lift that thumb and the hand lets go.
// A held arm is elastic: let go with the lower hand and the upper arm flings you up.
// Balloons pop when a hand passes through them: green = power-up, red = power-down.
// Add ?powerups to the URL to get balloons from the start (for testing).
// Moving ledges slide along their long side from 75-100 m (?moving: from the start).
// Ghost ledges (faint, dotted, can't be grabbed) appear from 175-200 m (?ghosts: from the start).
//
// World units: the play area is 400 units wide; y points UP (height).

(() => {
  'use strict';

  // ---------- Tuning (editable live via the ⚙ panel) ----------
  const DEFAULTS = {
    launchPower: 1700,  // hand throw speed at full drag (enough to cross the whole screen)
    maxDrag: 200,       // drag distance (world units) for full power
    handGravity: 1500,  // gravity on a thrown hand
    armReach: 900,      // max arm length — a held hand limits how far you can go
    maxPull: 9000,      // cap on a stretched arm's pull, so long grabs zip rather than explode
    armStiffness: 38,   // how hard a stretched arm yanks the body
    armDamping: 2.5,    // how quickly the yank settles
    armRest: 34,        // relaxed arm length
    bodyGravity: 1300,  // gravity on the body
    introFall: 260,     // max fall speed during the opening drop
    waterSpeed: 18,     // starting water rise speed
    waterRamp: 4,       // extra water speed per 1000 units climbed
  };

  const FIELDS = [
    ['launchPower', 'Throw power', 400, 2600, 10],
    ['maxDrag', 'Drag for full power', 60, 400, 5],
    ['handGravity', 'Hand gravity', 500, 3000, 50],
    ['armReach', 'Arm reach', 120, 1400, 10],
    ['maxPull', 'Arm max pull', 2000, 30000, 250],
    ['armStiffness', 'Arm springiness', 5, 120, 1],
    ['armDamping', 'Arm damping', 0, 10, 0.1],
    ['armRest', 'Arm length (relaxed)', 15, 80, 1],
    ['bodyGravity', 'Body gravity', 300, 3000, 50],
    ['introFall', 'Opening drop speed', 80, 800, 10],
    ['waterSpeed', 'Water speed', 0, 120, 1],
    ['waterRamp', 'Water speed-up', 0, 30, 0.5],
  ];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const T = Object.assign({}, DEFAULTS, store.get('climber3.tuning', {}));

  // ---------- Constants ----------
  const WORLD_W = 400;
  const BODY_R = 16;
  const HAND_R = 9;
  const SHOULDER_X = 13;
  const SHOULDER_Y = 5;
  const UNITS_PER_METER = 40;
  const START_Y = 160;
  const DT = 1 / 120;
  const DRAG_START_PX = 12;  // thumb movement that turns a tap into a throw
  const AIM_WINDOW_MS = 150; // ...but only this soon after touching; after that a grip is locked
  const LEFT = 0, RIGHT = 1;

  // Sound is off for now (so the game never interrupts a podcast or music).
  // The sound code lives in sfx.js and the sound board (sounds.html); to turn
  // it back on, load sfx.js in index.html and set this to true.
  const SOUND_ON = false;
  const sfx = SOUND_ON && window.sfx ? window.sfx : new Proxy({}, { get: () => () => {} });
  // The equipped skin (see skins.js / progress.js); refreshed when the menu closes.
  let skin = Progress.equipped();
  const handColor = (i) => Skins.color(i === LEFT ? skin.leftHand : skin.rightHand, state ? state.time : 0);
  const arcColor = (i) => Skins.color(i === LEFT ? skin.leftArc : skin.rightArc, state ? state.time : 0);
  const ledgeTheme = () => Skins.byId(Skins.LEDGES, skin.ledges);

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let cssW = 0, cssH = 0, dpr = 1, scale = 1, ox = 0, viewH = 0;

  // Measure the canvas as laid out. Called on resize events and also checked
  // every frame, since a share sheet or tab switch can change the size without
  // a resize event when you come back.
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    if (!w || !h) return; // a hidden tab can measure 0 x 0: keep the last good size
    cssW = w;
    cssH = h;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = Math.min(cssW / WORLD_W, cssH / 560);
    ox = (cssW - WORLD_W * scale) / 2;
    viewH = cssH / scale;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('pageshow', resize);
  document.addEventListener('visibilitychange', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  function checkSize() {
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0); // never leave the page scrolled
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (w !== cssW || h !== cssH || Math.min(window.devicePixelRatio || 1, 3) !== dpr)) resize();
  }

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  function circleHitsRect(cx, cy, r, h) {
    const nx = clamp(cx, h.x - h.w / 2, h.x + h.w / 2);
    const ny = clamp(cy, h.y - h.h / 2, h.y + h.h / 2);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  // ---------- Mode ----------
  // Daily is the main event: one run a day, the same level for everyone (see
  // daily.js). Endless and Sprint (60 s, no rising water or balloons, its own
  // best) are in the ☰ Modes tab, or opened by a ?mode=endless / ?mode=sprint link.
  const SPRINT_SECS = 60;
  // Training (?mode=learn, or climbguy.xyz/learn) is a guided first climb; see "Training" below.
  const URL_MODE = { grappler: 'hook' }[new URLSearchParams(location.search).get('mode')] || new URLSearchParams(location.search).get('mode'); // Grappler is 'hook' inside
  // Brand-new players (no runs yet, haven't finished or skipped training) start
  // in training, unless a link asks for Endless or Sprint.
  let mode = ['sprint', 'endless', 'learn', 'hook'].includes(URL_MODE) ? URL_MODE : Tutorial.shouldShow ? 'learn' : 'daily';
  const sprint = () => mode === 'sprint';
  const daily = () => mode === 'daily';
  const learn = () => mode === 'learn';
  const hook = () => mode === 'hook'; // Grappler (PROTOTYPE, unlisted, ?mode=grappler): see "Hook mode" below
  const modeBest = () => (learn() ? 0 : hook() ? store.get('cg.hookBest', 0) : sprint() ? Progress.sprintBest : daily() ? Progress.best : Progress.endlessBest);
  const MODE_LABEL = { daily: '', endless: 'Endless ', sprint: 'Sprint ', learn: '', hook: 'Grappler ' };
  // The main badges, stats and landmarks come only from the daily.
  const mainAward = (id) => (daily() ? Progress.award(id) : null);
  let day = Daily.today();         // the daily being played; refreshed at each new game
  let R = Daily.streams(null);     // random streams for the level (seeded in the daily)
  const NO_DAY = { rowGap: 1, ledgeW: 1, pairs: 1, balloonGap: 1, featureGap: 1, water: 1 };
  let DAY = NO_DAY;                // the daily's small nudges to the usual settings
  const DROP_TOP = START_Y + 640;  // where the daily's opening drop starts: the same on every screen (just above the top on short ones)
  // Is the level being built for real yet? In the daily it's fixed from the
  // start; otherwise features start once you catch on.
  const levelLive = () => state.phase === 'playing' || daily() || learn();

  // The ⚙ tuning sliders are a hidden developer tool: only with ?tune in the
  // URL, never in the daily, and runs played with it don't count for anything.
  // Everyone else always plays with the defaults.
  const TUNING = new URLSearchParams(location.search).has('tune');
  function applyTuning() {
    const on = TUNING && !daily();
    Object.assign(T, DEFAULTS, on ? store.get('climber3.tuning', {}) : {});
    document.getElementById('tune-btn').hidden = !on;
  }

  // ---------- Game state ----------
  // Hand states: held | idle | flying | returning
  let state;

  function newGame() {
    if (daily()) day = Daily.today();
    R = Daily.streams(daily() ? day.key : learn() ? 'learn' : null);
    DAY = daily() ? {
      rowGap: R.day.r(0.92, 1.08), ledgeW: R.day.r(0.9, 1.1), pairs: R.day.r(0.85, 1.15),
      balloonGap: R.day.r(0.85, 1.15), featureGap: R.day.r(0.85, 1.15), water: R.day.r(0.94, 1.06),
    } : NO_DAY;
    applyTuning();
    CHALLENGE = challengeFor(mode);
    const startHold = learn() ? { x: WORLD_W / 2, y: START_Y, w: WORLD_W, h: 24, floor: true, color: '#7a6a58' }
      : { x: 200, y: START_Y, w: hook() ? 160 : 240, h: 20, ci: 0 }; // hook mode: narrower, so the row above can sit beside it
    const cam = learn() ? START_Y - 40 : START_Y - 120;
    state = {
      phase: 'ready',          // ready (opening drop) | playing | over
      overAt: 0,
      time: 0,
      // The climber drops in from the top of the screen; tap to catch a ledge.
      body: { x: 200, y: daily() ? DROP_TOP : learn() ? floorTop(startHold) : cam + viewH - 40, vx: 0, vy: 0 },
      hands: [
        { state: 'idle', x: 0, y: 0, vx: 0, vy: 0, t: 0, launchY: 0 },
        { state: 'idle', x: 0, y: 0, vx: 0, vy: 0, t: 0, launchY: 0 },
      ],
      thumbs: [null, null],    // per side: { id, mode: aim|grip|none, sx, sy, cx, cy }
      holds: [startHold],
      balloons: [],            // { kind, x, y, phase, popped }
      effects: {},             // power name -> game time it wears off
      toast: null,             // { kind, at } — the last power popped
      rocket: null,            // { toY } while blasting off
      dropping: !learn(),      // slow fall until a hand catches something
      holdsTop: START_Y,
      water: learn() ? -1e6 : -120, // in training, out of sight until it's introduced
      cam,
      baseY: START_Y,          // height 0 m; set to wherever you first catch on
      maxY: START_Y,
      badFromM: R.day.r(...BAD_FROM_M), // where power-downs start this run
      best: modeBest(),
      newBest: false,
      bestAtStart: modeBest(),
      startTime: null,         // game time the climb started (first catch)
      unlockedBefore: Progress.unlockedSnapshot(), // to list what this run unlocked
      runPopped: 0,
      runBadges: [],           // badges earned this run
      result: null,            // what recordRun returned, for the game-over screen
      lastHeightM: 0,
      fallTop: null,           // highest point of the current fall (Freefall badge)
      clutchY: null,           // where you were when the water nearly got you (Clutch)
      flingFromY: 0,
      birds: [],
      wind: { a: 0, target: 0, until: 0, next: 0, nextM: 0 },
      windBits: [],            // streaks and leaves showing the wind
      confetti: [],
      banner: null,            // { text, sub, at, small }
      grinUntil: 0,
      flinging: false,
      screamed: false,
    };
    if (daily() || learn()) initFeatures(); // fixed from the ground up, so it's the same for everyone
    if (learn()) startTraining(startHold);
    state.beginner = !hook() && (learn() || runsSoFar() < BEGINNER_RUNS);
    if (hook()) state.hookFrom = state.body.y - viewH / 3; // hooks catch only after falling a third of the screen
    state.hints = {};
    placeIdle(LEFT);
    placeIdle(RIGHT);
    generateHolds();
  }

  function heightMeters() {
    return Math.max(0, Math.floor((state.maxY - state.baseY) / UNITS_PER_METER));
  }

  function shoulder(i) {
    const side = i === LEFT ? -1 : 1;
    return { x: state.body.x + side * SHOULDER_X, y: state.body.y + SHOULDER_Y };
  }

  // Free hands dangle at the sides, or reach up when nothing is holding on.
  function placeIdle(i) {
    const s = shoulder(i);
    const side = i === LEFT ? -1 : 1;
    const falling = !state.hands.some(h => h.state === 'held');
    state.hands[i].x = s.x + side * (falling ? 12 : 8);
    state.hands[i].y = s.y + (falling ? 18 : -14);
  }

  function startPlaying() {
    if (state.phase !== 'ready') return;
    state.phase = 'playing';
    // Heights count from where you catch on; in the daily, from the ground,
    // so everyone's heights compare directly.
    if (!daily() && !learn()) {
      state.baseY = state.body.y;
      initFeatures();
    }
    state.maxY = state.body.y;
    state.startTime = state.time;
    badge(mainAward('first'));
  }

  // Where each feature first appears (in meters). The ?powerups-style test
  // flags don't apply to the daily.
  function initFeatures() {
    const d = R.day, test = !daily();
    state.nextBalloonM = sprint() ? Infinity : test && EARLY ? 3 : d.r(...FIRST_BALLOON_M);
    state.nextMoverM = test && MOVERS_EARLY ? 2 : d.r(...FIRST_MOVER_M);
    state.nextGhostM = test && GHOSTS_EARLY ? 2 : d.r(...FIRST_GHOST_M);
    state.nextIcyM = test && ICY_EARLY ? 2 : d.r(...FIRST_ICY_M);
    state.windFromM = test && WIND_EARLY ? 2 : d.r(...FIRST_WIND_M);
    state.birdFromM = test && BIRDS_EARLY ? 2 : d.r(...FIRST_BIRD_M);
    state.wind.nextM = state.windFromM;
    state.nextBirdM = state.birdFromM;
    state.nextCheckpointM = CHECKPOINT_EVERY_M;
    state.nextMilestoneM = CHECKPOINT_EVERY_M;
    state.landmarkIdx = 0;
    if (learn()) trainingFeatures();
  }

  function letGo(i) {
    const h = state.hands[i];
    if (h.state !== 'held') return;
    if (learn()) trainingLetGo(i);
    h.state = 'returning';
    h.hold = null;
    h.autoHeld = false;
  }

  function holdUnder(h) {
    return state.holds.find(o => !o.broken && !o.ghost && circleHitsRect(h.x, h.y, HAND_R, o)) || null;
  }

  // ---------- Level generation ----------

  function generateHolds() {
    while (state.holdsTop < state.cam + viewH + T.armReach + 200) {
      // Difficulty 0..1, ramping gently over the first 500 m climbed.
      const d = clamp((state.holdsTop - state.baseY) / (FULL_DIFFICULTY_M * UNITS_PER_METER), 0, 1) * (learn() ? 0.3 : 1);
      const y = state.holdsTop + lerp(85, 155, d) * R.rows.r(0.75, 1.25) * DAY.rowGap;
      spawnRow(y, d);
      state.holdsTop = y;
    }
  }

  // Each row keeps at least one ledge within horizontal reach of the row below,
  // since a held hand limits how far the other can go.
  const MAX_ROW_SHIFT = 160;
  const FULL_DIFFICULTY_M = 500; // ledges keep thinning out and shrinking until here

  function spawnRow(y, d) {
    if (hook()) return spawnHookRow(y, d);
    const r = R.rows;
    const count = r.p(clamp(lerp(0.55, 0.15, d) * DAY.pairs, 0, 0.9)) ? 2 : 1;
    const slotW = WORLD_W / count;
    const row = [];
    for (let i = 0; i < count; i++) {
      const tall = r.p(0.15);
      const w = tall ? r.r(16, 24) : Math.min(lerp(140, 70, d) * r.r(0.7, 1.3) * DAY.ledgeW / (count === 2 ? 1.4 : 1), slotW - 12);
      const h = tall ? r.r(50, 90) : r.r(14, 22);
      const x = r.r(slotW * i + w / 2 + 6, slotW * (i + 1) - w / 2 - 6);
      row.push({
        x, y: y + r.r(-15, 15), w, h,
        ci: r.i(5), // which of the ledge theme's colors
      });
    }
    const prev = state.lastRow || [state.holds[0]];
    const gap = (a, b) => Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
    let best = null, bestGap = Infinity, anchor = null;
    for (const a of row) for (const b of prev) {
      if (gap(a, b) < bestGap) { bestGap = gap(a, b); best = a; anchor = b; }
    }
    if (bestGap > MAX_ROW_SHIFT) {
      const dir = Math.sign(anchor.x - best.x);
      best.x += dir * (bestGap - MAX_ROW_SHIFT + r.r(0, 40));
    }
    if (daily() ? y < DROP_TOP : state.phase === 'ready' && y < state.body.y) centerForDrop(row);
    const checkpoint = checkpointFor(y);
    if (checkpoint) {
      row.length = 0;
      row.push(checkpoint);
    } else {
      maybeMakeMover(row, y);
      maybeAddGhost(row, y);
      maybeMakeIcy(row, y);
    }
    state.holds.push(...row);
    state.lastRow = row;
  }

  // Hook mode's ledges: never stacked. A hook has to rise beside a ledge and
  // come down onto it, so no ledge sits over one in the row below: there's
  // always a gap of at least HOOK_GAP between them. No tall pillars, and
  // checkpoints are narrower. (The opening drop lands on the start ledge,
  // which is centered under it.)
  const HOOK_GAP = 45;
  function spawnHookRow(y, d) {
    const r = R.rows;
    const prev = state.lastRow || [state.holds[0]];
    const count = r.p(clamp(lerp(0.5, 0.2, d), 0, 0.9)) ? 2 : 1;
    const slotW = WORLD_W / count;
    const row = [];
    // Where a ledge of width w may go: not over (or within HOOK_GAP of) any ledge below, nor this row's others.
    const fits = (x, w) => x >= w / 2 + 6 && x <= WORLD_W - w / 2 - 6
      && prev.concat(row).every(o => Math.abs(o.x - x) >= (o.w + w) / 2 + HOOK_GAP);
    const place = (want, w) => {
      if (fits(want, w)) return want;
      const spots = [];
      for (const o of prev.concat(row)) for (const side of [-1, 1]) spots.push(o.x + side * ((o.w + w) / 2 + HOOK_GAP + 1));
      spots.push(w / 2 + 6, WORLD_W - w / 2 - 6);
      const ok = spots.filter(x => fits(x, w)).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
      return ok.length ? ok[0] : null;
    };
    const cp = checkpointFor(y);
    if (cp) {
      cp.w = 140;
      cp.x = place(WORLD_W / 2, cp.w) ?? place(WORLD_W / 2, (cp.w = 90));
      if (cp.x != null) row.push(cp);
    }
    for (let i = 0; i < count && !cp; i++) {
      let w = Math.min(lerp(140, 70, d) * r.r(0.7, 1.3) * DAY.ledgeW / (count === 2 ? 1.4 : 1), slotW - 12);
      const h = r.r(14, 22);
      const want = r.r(slotW * i + w / 2 + 6, slotW * (i + 1) - w / 2 - 6);
      let x = place(want, w);
      if (x == null) x = place(want, (w = 60));
      if (x == null) continue;
      row.push({ x, y: y + r.r(-15, 15), w, h, ci: r.i(5) });
    }
    if (!row.length) { // no room: a short ledge in the widest open space
      const x = place(WORLD_W / 2, 50) ?? (prev[0].x < WORLD_W / 2 ? WORLD_W - 31 : 31);
      row.push({ x, y, w: 50, h: 16, ci: r.i(5) });
    }
    if (!cp) {
      maybeMakeMover(row, y);
      maybeAddGhost(row, y);
      maybeMakeIcy(row, y);
    }
    state.hookRow = (state.hookRow || 0) + 1;
    for (const o of row) o.row = state.hookRow; // for checking the layout
    state.holds.push(...row);
    state.lastRow = row;
  }

  // The opening drop falls straight down the middle, so every row it passes
  // gets a ledge across the center: several easy chances to catch on.
  function centerForDrop(row) {
    const mid = WORLD_W / 2;
    const o = row.reduce((a, b) => (Math.abs(b.x - mid) < Math.abs(a.x - mid) ? b : a));
    o.w = Math.max(o.w, R.rows.r(110, 160));
    o.h = R.rows.r(16, 22);
    o.x = mid + R.rows.r(-o.w / 2 + 40, o.w / 2 - 40);
    for (let k = row.length - 1; k >= 0; k--) {
      const other = row[k];
      if (other !== o && Math.abs(other.x - o.x) < (other.w + o.w) / 2 + 10) row.splice(k, 1);
    }
  }

  // ---------- Moving ledges ----------
  const MOVERS_EARLY = new URLSearchParams(location.search).has('moving');
  const FIRST_MOVER_M = [75, 100];
  // Height between moving ledges: starts a bit more often than balloons and
  // tightens as you climb.
  function moverGapM(m) {
    const k = clamp((m - FIRST_MOVER_M[0]) / 500, 0, 1);
    return lerp(30, 8, k) * R.features.r(0.7, 1.3) * DAY.featureGap;
  }

  function maybeMakeMover(row, y) {
    if (!levelLive() || state.nextMoverM == null) return;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextMoverM) return;
    makeMover(row[R.features.i(row.length)]);
    state.nextMoverM = m + (learn() ? R.features.r(5, 9) : moverGapM(m));
  }

  // Slide back and forth along the long side, each with its own distance and pace.
  function makeMover(o) {
    const axis = o.w >= o.h ? 'x' : 'y';
    let amp = axis === 'x' ? R.features.r(30, 110) : R.features.r(25, 70);
    let base = o[axis];
    if (axis === 'x') {
      const room = (WORLD_W - o.w) / 2 - 6;
      amp = Math.min(amp, Math.max(room, 15));
      base = clamp(base, o.w / 2 + 6 + amp, WORLD_W - o.w / 2 - 6 - amp);
      if (!(base > 0)) base = WORLD_W / 2;
    }
    o.move = { axis, base, amp, speed: (Math.PI * 2) / R.features.r(2.5, 5), phase: R.features.r(0, Math.PI * 2) };
  }

  // Move ledges, and carry any hand holding one along with it.
  function moveLedges() {
    for (const o of state.holds) {
      if (!o.move || o.broken) continue;
      const mv = o.move;
      const before = o[mv.axis];
      o[mv.axis] = mv.base + mv.amp * Math.sin(mv.phase + state.time * mv.speed);
      const d = o[mv.axis] - before;
      for (const h of state.hands) if (h.state === 'held' && h.hold === o) h[mv.axis] += d;
    }
  }

  // ---------- Ghost ledges ----------
  // Decoys: faint with a dotted outline, and hands pass straight through them.
  // They're added alongside real ledges, never in place of one, so the climb stays possible.
  const GHOSTS_EARLY = new URLSearchParams(location.search).has('ghosts');
  const FIRST_GHOST_M = [175, 200];

  function ghostGapM(m) {
    const k = clamp((m - FIRST_GHOST_M[0]) / 500, 0, 1);
    return lerp(30, 10, k) * R.features.r(0.7, 1.3) * DAY.featureGap;
  }

  function maybeAddGhost(row, y) {
    if (!levelLive() || state.nextGhostM == null) return;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextGhostM) return;
    // Find a spot in this row that doesn't overlap a real ledge.
    const f = R.features;
    const w = f.r(55, 130), h = f.r(14, 22);
    for (let tries = 0; tries < 12; tries++) {
      const x = f.r(w / 2 + 6, WORLD_W - w / 2 - 6);
      if (row.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 12)) continue;
      state.holds.push({
        x, y: y + f.r(-15, 15), w, h, ghost: true,
        ci: f.i(5), // which of the ledge theme's colors
      });
      state.nextGhostM = m + ghostGapM(m);
      return;
    }
    // No room in this row; try the next one.
  }

  // ---------- Checkpoints, icy ledges, wind, birds ----------
  const PARAMS = new URLSearchParams(location.search);
  const ICY_EARLY = PARAMS.has('icy');
  const WIND_EARLY = PARAMS.has('wind');
  const BIRDS_EARLY = PARAMS.has('birds');
  const CHECKPOINT_EVERY_M = 100;
  const FIRST_ICY_M = [225, 250];
  const FIRST_WIND_M = [275, 300];
  const FIRST_BIRD_M = [325, 350];
  const ICE_ACCEL = 25;   // how quickly a hand starts sliding on ice
  const ICE_MAX = 80;
  const BIRD_R = 16;

  const climbedM = () => (state.maxY - state.baseY) / UNITS_PER_METER;

  // A gap that starts at ~30 m and tightens to ~10 m over 500 m.
  const featureGapM = (m, from) => lerp(30, 10, clamp((m - from) / 500, 0, 1)) * R.features.r(0.7, 1.3) * DAY.featureGap;

  // Every 100 m, a wide, sturdy golden ledge with a flag.
  function checkpointFor(y) {
    if (!levelLive()) return null;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextCheckpointM) return null;
    const cp = { x: WORLD_W / 2, y, w: 230, h: 24, color: '#c9a227', checkpoint: state.nextCheckpointM };
    if (learn()) { // just the one, at exactly 40 m (this row gives way to it)
      state.nextCheckpointM = Infinity;
      return finishLedge(state.baseY + FINISH_M * UNITS_PER_METER + FINISH_ABOVE);
    }
    state.nextCheckpointM += CHECKPOINT_EVERY_M;
    return cp;
  }

  // Icy ledges: a hand holding one slowly slides off the end.
  function maybeMakeIcy(row, y) {
    if (!levelLive() || state.nextIcyM == null) return;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextIcyM) return;
    const o = row.find(o => o.w > o.h && !o.move);
    if (!o) return; // try the next row
    o.icy = true;
    o.color = '#bfe3f2';
    state.nextIcyM = m + featureGapM(m, FIRST_ICY_M[0]);
  }

  function slideOnIce(dt) {
    state.hands.forEach((h, i) => {
      if (h.state !== 'held' || !h.hold || !h.hold.icy) return;
      const o = h.hold;
      // Slides toward whichever side the body hangs on.
      if (!h.slideDir) h.slideDir = Math.sign(state.body.x - h.x) || (Math.random() < 0.5 ? -1 : 1);
      h.slideV = Math.min((h.slideV || 0) + ICE_ACCEL * dt, ICE_MAX);
      h.x += h.slideDir * h.slideV * dt;
      if (Math.abs(h.x - o.x) > o.w / 2 + HAND_R * 0.5) {
        letGo(i);
        const t = state.thumbs[i];
        if (t) { t.mode = 'none'; t.canAim = false; }
      }
    });
  }

  // Wind: gusts push thrown hands sideways. (The aim arc doesn't include the wind.)
  function stepWind(dt) {
    const w = state.wind;
    const m = climbedM();
    if (state.phase === 'playing' && m >= state.windFromM) {
      // Gusts come every few seconds; in the daily, at set heights instead, so
      // fast and slow climbers meet the same gusts in the same places.
      if (w.target === 0 && (daily() ? m >= w.nextM : state.time >= w.next)) {
        const k = clamp(((daily() ? w.nextM : m) - state.windFromM) / 400, 0, 1);
        w.target = (R.wind.p(0.5) ? -1 : 1) * R.wind.r(250, 450) * (1 + k);
        w.until = state.time + R.wind.r(2.5, 4.5);
        if (daily()) w.nextM += lerp(20, 10, k) * R.wind.r(0.7, 1.3) * DAY.featureGap;
        sfx.gust();
      } else if (w.target !== 0 && state.time >= w.until) {
        const k = clamp((m - state.windFromM) / 400, 0, 1);
        w.target = 0;
        w.next = state.time + lerp(10, 5, k) * rand(0.7, 1.3);
      }
    }
    w.a += (w.target - w.a) * (1 - Math.exp(-3 * dt));
    for (const h of state.hands) if (h.state === 'flying') h.vx += w.a * dt;

    // Streaks and leaves drifting with the wind (screen space).
    const strength = Math.abs(w.a);
    if (strength > 40 && Math.random() < strength / 2400) { // ~10-20 per second in a strong gust
      const dir = Math.sign(w.a);
      state.windBits.push({
        x: dir > 0 ? -30 : cssW + 30, y: rand(0, cssH),
        vx: dir * rand(250, 500) * (strength / 450), vy: rand(-20, 20),
        leaf: Math.random() < 0.3, spin: rand(0, 6.3), life: 0,
        color: Math.random() < 0.5 ? '#7cbf5a' : '#e0a040',
      });
    }
    for (const b of state.windBits) { b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(b.life * 4 + b.spin) * 0.6; b.life += dt; b.spin += dt * 5; }
    state.windBits = state.windBits.filter(b => b.x > -60 && b.x < cssW + 60 && b.life < 4);
  }

  // Birds fly across and knock thrown hands off course.
  function stepBirds(dt) {
    const m = climbedM();
    // Birds come every few seconds; in the daily, at set heights instead.
    if (state.phase === 'playing' && m >= state.birdFromM && (daily() ? m >= state.nextBirdM : state.time >= (state.nextBirdAt || 0))) {
      const at = daily() ? state.nextBirdM : m;
      const k = clamp((at - state.birdFromM) / 400, 0, 1);
      const dir = R.birds.p(0.5) ? -1 : 1;
      const y = daily() ? state.baseY + (at + R.birds.r(4, 10)) * UNITS_PER_METER : state.cam + viewH * rand(0.35, 0.92);
      state.birds.push({ dir, x: dir > 0 ? -30 : WORLD_W + 30, y, speed: R.birds.r(110, 190), phase: rand(0, 6.3) });
      if (daily()) state.nextBirdM += lerp(24, 10, k) * R.birds.r(0.7, 1.3) * DAY.featureGap;
      else state.nextBirdAt = state.time + lerp(12, 5, k) * rand(0.7, 1.3);
    }
    for (const b of state.birds) {
      b.x += b.dir * b.speed * dt;
      b.y += Math.sin(state.time * 3 + b.phase) * 12 * dt;
      for (const h of state.hands) {
        if (h.state !== 'flying' || Math.hypot(h.x - b.x, h.y - b.y) > BIRD_R + HAND_R) continue;
        h.vx = b.dir * 380;
        h.vy = -150;
        h.autoTarget = null;
        if (!b.hitAt || state.time - b.hitAt > 0.5) {
          b.hitAt = state.time;
          sfx.bird();
          if (daily()) badge(Progress.noteBirdHit());
          burstConfetti(ox + b.x * scale, cssH - (b.y - state.cam) * scale, 10, ['#ddd', '#999', '#fff']);
        }
      }
    }
    state.birds = state.birds.filter(b => b.x > -60 && b.x < WORLD_W + 60);
  }

  // ---------- Training ----------
  // A guided first climb (?mode=learn, or climbguy.xyz/learn) for players who
  // find the start hard. It has two parts:
  //  1. Skills: you start standing on a floor that catches you. There's no
  //     water and no height count. A coach box shows one move at a time and
  //     moves on only when you've done it: throw, grab and hang on, grab with
  //     the other hand (keeping the first thumb down), let go low to swing up,
  //     then a few more swing-ups.
  //  2. Climb: the height count starts from where you are, the water starts
  //     (slower than usual), and the goal is a golden finish ledge 40 m up.
  //     Balloons and moving ledges get a short callout as they come on
  //     screen, but nothing is required: you always end at the finish.
  // A splash in part 2 restarts at part 2. Ghosts, ice, wind and birds are
  // left as surprises for later. Nothing here counts toward stats or badges.
  // It has its own fixed seed, so it never touches the daily.
  const TRAINING_WATER = 0.6;   // water speed compared to normal
  const FINISH_M = 40;
  const FINISH_ABOVE = 140;     // the ledge sits this far above 40 m, so hanging from it reads about 40 m
  const TRAINING_BALLOONS = [[12, 'freeze'], [21, 'swollen'], [29, 'flood']]; // meters into the climb
  const MOVERS_FROM_M = 12;     // moving ledges from here in the climb, every few meters
  const SWINGS = 3;             // swing-ups to practice before the climb
  const SETTLE_SECS = 1;        // hang on this long to count as holding a ledge
  const CARD_MIN_SECS = 3;      // each card stays up at least this long, so there's time to read it
  const CALLOUT_SECS = 4.5;
  let skillsDone = false;       // after the skills part, a splash restarts at the climb

  const COACH = [
    { text: () => (Controls.mouse ? 'Click and drag DOWN, then let go' : 'Drag a thumb DOWN, then let go'),
      sub: () => (Controls.mouse ? 'A hand flies up, like a slingshot.' : 'That hand flies up. Left side = left hand.'),
      done: t => t.thrown },
    { text: () => (Controls.mouse ? 'Press A or D when a hand touches a ledge' : 'Tap when a hand touches a ledge'),
      sub: () => (Controls.mouse ? 'A = left hand, D = right. Hold the key to hang on.' : 'Keep your thumb down to hang on.'),
      done: t => t.settled },
    { text: 'Throw your other hand up and grab', sub: () => (Controls.mouse ? 'Keep holding the first key!' : 'Keep the first thumb pressed down!'),
      done: t => t.both >= 0.3 },
    { text: 'Let go of your LOWER hand', sub: "You'll swing up. Then grab again.",
      start: t => { t.swingsAt = t.swings; },
      done: t => t.swings > t.swingsAt && t.both >= 0.3 },
    { text: 'Keep going: grab high, let go low', sub: t => `Swing up ${SWINGS} more times (${Math.min(SWINGS, t.swings - t.swingsAt)}/${SWINGS})`,
      start: t => { t.swingsAt = t.swings; },
      done: t => t.swings - t.swingsAt >= SWINGS && t.both >= 0.3 },
    { text: t => `Climb to the finish: ${Math.max(0, FINISH_M - heightMeters())} m to go`, sub: 'The water is rising (slower than usual).',
      start: startClimb },
  ];
  const CLIMB_STEP = COACH.length - 1;

  const floorTop = (f) => f.y + f.h / 2 + BODY_R;
  const realHold = (h) => h.state === 'held' && h.hold && !h.hold.floor;

  function startTraining(floor) {
    state.training = {
      step: 0, stepAt: 0, floor, thrown: false, held: [0, 0], settled: false, both: 0, swings: 0, swingsAt: 0,
      water: false, climbing: false, callouts: [], callout: null, calledMover: false, finished: false, balloons: [],
    };
    if (skillsDone) goToStep(CLIMB_STEP);
  }

  function goToStep(n) {
    const t = state.training;
    t.step = n;
    t.stepAt = state.time;
    if (COACH[n].start) COACH[n].start(t);
  }

  // Where things start in training (called from initFeatures): nothing until the climb.
  function trainingFeatures() {
    state.nextBalloonM = state.nextMoverM = Infinity;
    state.nextGhostM = state.nextIcyM = state.windFromM = state.birdFromM = Infinity;
    state.wind.nextM = state.nextBirdM = Infinity;
    state.nextCheckpointM = Infinity;
    state.nextMilestoneM = Infinity;
    state.landmarkIdx = LANDMARKS.length;
  }

  // A swing-up: letting go of the lower hand while the higher one holds on.
  function trainingLetGo(i) {
    const t = state.training, other = state.hands[1 - i];
    if (t && realHold(other) && other.y > state.hands[i].y + 10) t.swings++;
  }

  // The skills cards move on when you've done the move, one at a time.
  function stepTraining(dt) {
    const t = state.training;
    state.hands.forEach((h, i) => { t.held[i] = realHold(h) ? t.held[i] + dt : 0; });
    t.settled = t.held.some(x => x >= SETTLE_SECS);
    t.both = t.held[0] > 0 && t.held[1] > 0 ? t.both + dt : 0;
    if (t.floor && state.water >= t.floor.y) t.floor = null; // the water has reached the floor
    if (t.step < CLIMB_STEP && state.time - t.stepAt >= CARD_MIN_SECS && COACH[t.step].done(t)) {
      goToStep(t.step + 1);
      sfx.milestone();
    }
    if (!t.climbing) return;
    // Callouts for balloons and moving ledges as they come into view.
    const top = state.cam + viewH - 60;
    for (const b of state.balloons) {
      if (b.called || b.y > top) continue;
      b.called = true;
      const p = POWERS[b.kind];
      t.callouts.push(p.good
        ? { text: `${p.icon} Green balloon: touch it!`, sub: `${p.name}: ${p.text}` }
        : { text: `${p.icon} Red balloon: avoid it!`, sub: `${p.name}: ${p.text}` });
    }
    if (!t.calledMover && state.holds.some(o => o.move && o.y < top && o.y > state.cam)) {
      t.calledMover = true;
      t.callouts.push({ text: '↔️ Moving ledge!', sub: 'Watch it, then time your grab.' });
    }
    const free = state.time - t.stepAt > CARD_MIN_SECS + 1 && (!t.callout || state.time - t.callout.at > CALLOUT_SECS);
    if (free && t.callouts.length) t.callout = { ...t.callouts.shift(), at: state.time };
    if (state.hands.some(h => h.state === 'held' && h.hold && h.hold.finish)) completeTraining();
  }

  // Part 2: start counting from here, start the water, and set out the course.
  function startClimb(t) {
    skillsDone = true;
    t.climbing = true;
    state.baseY = state.body.y;
    state.maxY = state.body.y;
    state.lastHeightM = 0;
    const floorY = t.floor ? t.floor.y : -Infinity;
    state.water = Math.max(floorY - 100, state.cam - 30);
    t.water = true;
    t.balloons = TRAINING_BALLOONS.slice();
    // Rows already built above get the finish ledge and moving ledges now;
    // rows built later get them as they're made.
    const finishY = state.baseY + FINISH_M * UNITS_PER_METER + FINISH_ABOVE;
    if (state.holdsTop >= finishY - 40) {
      state.holds = state.holds.filter(o => Math.abs(o.y - finishY) > 70);
      state.holds.push(finishLedge(finishY));
    } else state.nextCheckpointM = FINISH_M + FINISH_ABOVE / UNITS_PER_METER;
    let next = MOVERS_FROM_M;
    for (const o of state.holds.slice().sort((a, b) => a.y - b.y)) {
      const m = (o.y - state.baseY) / UNITS_PER_METER;
      if (m < next || o.finish || o.floor || state.hands.some(h => h.hold === o)) continue;
      makeMover(o);
      next = m + R.features.r(5, 9);
    }
    state.nextMoverM = Math.max(next, (state.holdsTop - state.baseY) / UNITS_PER_METER);
    if (skillsDone && state.phase === 'ready') return; // a retry: no fanfare
    celebrate('🌊 Uh oh, water!', 'Climb to the finish!');
  }

  function finishLedge(y) {
    return { x: WORLD_W / 2, y, w: WORLD_W - 40, h: 24, color: '#c9a227', checkpoint: FINISH_M, finish: true };
  }

  // Standing on the floor: it holds the body up until the water reaches it.
  function standOnFloor(dt) {
    const t = state.training, body = state.body;
    if (!t.floor || body.y >= floorTop(t.floor)) return;
    if (body.vy < -500 && state.phase === 'playing' && !t.landedTip) {
      t.landedTip = true;
      celebrate('Phew! The floor catches you, just in training.', '', true);
    }
    body.y = floorTop(t.floor);
    if (body.vy < 0) body.vy = 0;
    body.vx *= Math.exp(-8 * dt);
  }

  function spawnTrainingBalloons() {
    const t = state.training;
    while (t.water && t.balloons.length && state.baseY + t.balloons[0][0] * UNITS_PER_METER < state.cam + viewH + 600) {
      const [m, kind] = t.balloons.shift();
      state.balloons.push({ kind, x: R.balloons.r(110, WORLD_W - 110), y: state.baseY + m * UNITS_PER_METER, phase: rand(0, 6.3), popped: 0 });
    }
  }

  function completeTraining() {
    const t = state.training;
    t.finished = true;
    state.trainingDone = true;
    state.phase = 'over';
    state.overAt = state.time;
    releaseAllThumbs();
    burstConfetti(cssW / 2, cssH * 0.3, 90);
    sfx.fanfare();
    Tutorial.markSeen();
    Analytics.event('learn-finished');
  }

  // Done: on to today's daily (or its result, if it's already been played).
  function finishTraining() {
    Tutorial.markSeen();
    leaveTrainingUrl();
    mode = 'daily';
    skin = Progress.equipped();
    newGame();
    showStart();
  }

  // Drop ?mode=learn from the address, so a reload doesn't land back in training.
  function leaveTrainingUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('mode') !== 'learn') return;
    q.delete('mode');
    q.delete('v');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : ''));
  }

  function wrapText(text, maxW) {
    const lines = [];
    let line = '';
    for (const w of text.split(' ')) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // The coach box: one line saying what to do and a smaller line under it,
  // tucked under the height. A callout (balloon, moving ledge) takes it over
  // for a few seconds.
  const COACH_H = 50;
  function drawCoach(y) {
    const t = state.training;
    if (!t || state.phase === 'over') return;
    const call = t.callout && state.time - t.callout.at < CALLOUT_SECS ? t.callout : null;
    const c = call || COACH[t.step];
    const val = (x) => (typeof x === 'function' ? x(t) : x);
    const age = state.time - (call ? call.at : t.stepAt);
    const w = Math.min(cssW - 16, WORLD_W * scale - 12, 420), x0 = ox + (WORLD_W * scale - w) / 2, pad = 12;
    ctx.globalAlpha = clamp(age * 4, 0, 1);
    ctx.fillStyle = 'rgba(10, 25, 40, 0.68)';
    roundRect(x0, y, w, COACH_H, 12);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 209, 102, ${age < 1.5 ? 0.9 : 0.3})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Skill number on the right, while learning the moves.
    let right = x0 + w - pad;
    if (!call && !t.climbing) {
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(`${t.step + 1}/${CLIMB_STEP}`, right, y + 20);
      right -= 30;
    }
    ctx.textAlign = 'left';
    const fit = (text, weight, size, maxW) => {
      let px = size;
      do { ctx.font = `${weight} ${px}px system-ui, sans-serif`; } while (ctx.measureText(text).width > maxW && (px -= 0.5) > 9);
    };
    ctx.fillStyle = call ? '#7df9ff' : '#ffd166';
    fit(val(c.text), 'bold', 16, right - x0 - pad);
    ctx.fillText(val(c.text), x0 + pad, y + 21);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    fit(val(c.sub), '', 13, x0 + w - pad * 2 - x0);
    ctx.fillText(val(c.sub), x0 + pad, y + 40);
    ctx.globalAlpha = 1;
  }

  function drawTrainingOver(cx) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cssW, cssH);
    const y0 = cssH * 0.34, maxW = Math.min(cssW - 32, WORLD_W * scale - 16);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    if (state.trainingDone) {
      ctx.fillText("You're ready! 🎉", cx, y0);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      fitText('You know the moves. More surprises wait higher up.', cx, y0 + 44, maxW, 15);
      ctx.fillStyle = '#7dffb0';
      fitText("Today's daily is the same climb for everyone.", cx, y0 + 72, maxW, 15);

    } else {
      ctx.fillText('Splash!', cx, y0);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`${heightMeters()} m`, cx, y0 + 40);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      fitText('The water got you. Practice makes perfect!', cx, y0 + 72, maxW, 15);
      ctx.fillStyle = '#7dffb0';
      fitText("Training doesn't count toward your stats.", cx, y0 + 96, maxW, 14);

    }
    ctx.textAlign = 'left';
  }

  // ---------- Celebrations ----------
  // A friend's link: ?daily=12&beat=152&from=Sam (that day's daily), or
  // ?mode=endless|sprint&beat=...
  const PARAMS_CHALLENGE = (() => {
    const m = parseInt(PARAMS.get('beat'), 10);
    if (!(m > 0)) return null;
    const name = (PARAMS.get('from') || '').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 20);
    const n = parseInt(PARAMS.get('daily'), 10);
    return { m, name, mode: n > 0 ? 'daily' : PARAMS.get('mode') === 'sprint' ? 'sprint' : 'endless', n: n > 0 ? n : null };
  })();
  // The challenge only applies in its own mode (and, for a daily, on that day).
  const challengeFor = (md) => {
    const c = PARAMS_CHALLENGE;
    return c && c.mode === md && (md !== 'daily' || c.n === Daily.today().n) ? c : null;
  };
  let CHALLENGE = null; // set by newGame
  const challengerName = () => (CHALLENGE.name ? CHALLENGE.name : 'your friend');
  const challengerPossessive = () => (CHALLENGE.name ? `${CHALLENGE.name}'s` : "Your friend's");

  const LANDMARKS = Progress.LANDMARKS; // real things you climb past, at their real heights

  // Show newly earned badge(s) and remember them for the game-over screen.
  function badge(b) {
    for (const x of [].concat(b || [])) {
      if (!x) continue;
      state.runBadges.push(x);
      celebrate(`${x.icon} ${x.mode ? `${Progress.MODE_NAME[x.mode]} badge` : 'Badge'}: ${x.name}!`, '', true);
    }
  }

  function celebrate(text, sub, small = false) {
    state.banner = { text, sub, at: state.time, small };
    if (!small) burstConfetti(cssW / 2, cssH * 0.3, 60);
  }

  function burstConfetti(x, y, n, colors = ['#ffd166', '#ff5fa8', '#7dffb0', '#7cc6ff', '#fff']) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 420);
      state.confetti.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, life: 0, max: rand(0.9, 1.6), color: colors[i % colors.length], spin: rand(0, 6) });
    }
  }

  function stepConfetti(dt) {
    for (const c of state.confetti) { c.vy += 600 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.life += dt; c.spin += dt * 8; }
    state.confetti = state.confetti.filter(c => c.life < c.max);
  }

  // Milestones, your best, a friend's challenge, and landmarks you pass.
  function checkCrossings() {
    if (state.phase !== 'playing') return;
    if (daily() && heightMeters() !== state.savedM) {
      state.savedM = heightMeters();
      Progress.dailyProgress(day, state.savedM);
    }
    const m = climbedM();
    while (state.landmarkIdx < LANDMARKS.length && m >= LANDMARKS[state.landmarkIdx][0]) {
      if (daily()) Progress.noteLandmark(state.landmarkIdx);
      const [, icon, name] = LANDMARKS[state.landmarkIdx++];
      celebrate(`${icon} Higher than ${name}!`, '', true);
    }
    if (Math.floor(m) > state.lastHeightM) {
      state.lastHeightM = Math.floor(m);
      if (daily()) badge(Progress.noteHeight(state.lastHeightM));
    }
    const secs = state.time - state.startTime;
    if (m >= 300 && state.runPopped === 0) badge(mainAward('purist'));
    // Endless and Sprint have badges of their own.
    const side = TUNING ? () => null : Progress.award;
    if (sprint() && m >= 150) badge(side('speed'));
    if (sprint() && m >= 250) badge(side('blur'));
    if (mode === 'endless' && m >= 500) badge(side('deepend'));
    if (mode === 'endless' && m >= 1000) badge(side('longhaul'));
    if (secs >= 480) badge(mainAward('marathon'));
    while (m >= state.nextMilestoneM) {
      celebrate(`${state.nextMilestoneM} m!`, 'Checkpoint');
      sfx.milestone();
      state.nextMilestoneM += CHECKPOINT_EVERY_M;
    }
    if (!state.passedBest && state.bestAtStart > 0 && m > state.bestAtStart) {
      state.passedBest = true;
      celebrate('New best!', `Beat your ${state.bestAtStart} m`);
      sfx.fanfare();
    }
    if (CHALLENGE && !state.beatChallenge && m > CHALLENGE.m) {
      state.beatChallenge = true;
      celebrate(`You beat ${challengerName()}!`, `${CHALLENGE.m} m`);
      sfx.fanfare();
    }
  }

  // Grin and a whoosh on a big fling; a scream when falling with nothing to hold.
  function stepMood() {
    const { body, hands } = state;
    const holding = hands.some(h => h.state === 'held');
    if (!state.flinging && holding && body.vy > 650) {
      state.flinging = true;
      state.flingFromY = body.y;
      state.grinUntil = state.time + 1.2;
      sfx.fling();
    } else if (state.flinging && body.vy < 200) {
      state.flinging = false;
      if (state.phase === 'playing' && body.y - state.flingFromY >= 30 * UNITS_PER_METER) badge(mainAward('fling'));
    }
    if (holding) state.screamed = false;
    else if (state.phase === 'playing' && !state.dropping && !state.rocket) state.fallTop = Math.max(state.fallTop ?? body.y, body.y);
    else if (!state.screamed && state.phase === 'playing' && !state.rocket && body.vy < -300) {
      state.screamed = true;
      sfx.scream();
    }
  }

  // ---------- Power-ups ----------
  const EARLY = new URLSearchParams(location.search).has('powerups');
  const FIRST_BALLOON_M = [30, 50];      // the first power-up appears somewhere in this range
  const BAD_FROM_M = EARLY ? [5, 5] : [125, 150]; // power-downs start somewhere in this range,
                                                  // with the first one guaranteed there
  // Height between balloons. A phone screen shows ~22 m, so before power-downs
  // there's never more than one balloon on screen.
  const BALLOON_GAP_M = EARLY ? [5, 8] : [35, 55];
  const BALLOON_GAP_LATE_M = EARLY ? [5, 8] : [20, 35]; // once power-downs have started
  const BALLOON_R = 18;
  const EFFECT_SECS = 10;
  const OUCH_SECS = 5;
  const BREAK_SECS = 5;                  // hold time before a breakaway ledge crumbles
  const ROCKET_M = 100;
  const ROCKET_SPEED = 1400;

  const POWERS = {
    autoGrab:      { good: true,  weight: 3,   icon: '🎯', name: 'Auto-grab',     text: 'No tapping: throws grab and hold for you' },
    swollen:       { good: true,  weight: 3,   icon: '🔍', name: 'Swollen',       text: 'Ledges grow 25% bigger' },
    freeze:        { good: true,  weight: 3,   icon: '❄️', name: 'Freeze',        text: 'The water stops rising' },
    rocket:        { good: true,  weight: 0.5, icon: '🚀', name: 'Rocket',        text: `Blast off ${ROCKET_M} m, then catch a ledge` },
    breakaway:     { good: false, weight: 2,   icon: '💥', name: 'Breakaway',     text: `New ledges break after ${BREAK_SECS}s of holding` },
    flood:         { good: false, weight: 2,   icon: '🌊', name: 'Flash flood',   text: 'The water rises 25% faster' },
    ouch:          { good: false, weight: 2,   icon: '🤕', name: 'Ouch!!',        text: `That hurt! That hand can't grab for ${OUCH_SECS}s`, secs: OUCH_SECS },
  };

  const active = (kind) => (state.effects[kind] || 0) > state.time;
  const hurt = (i) => active(`ouch:${i}`); // this hand can't grab

  // Balloons are spaced by height. The first power-down sits exactly where
  // power-downs begin, so every climber who gets that far meets one.
  function spawnBalloons() {
    if (!levelLive()) return;
    if (learn()) return spawnTrainingBalloons();
    while (state.baseY + state.nextBalloonM * UNITS_PER_METER < state.cam + viewH + 600) {
      const m = state.nextBalloonM;
      const late = m >= state.badFromM;
      let kind;
      if (late && !state.firstBadPlaced) {
        kind = pickPower(k => !POWERS[k].good);
        state.firstBadPlaced = true;
      } else {
        // The very first balloon is never the (rare) rocket.
        kind = pickPower(k => (POWERS[k].good || late) && (state.balloonCount || k !== 'rocket'));
      }
      state.balloons.push({
        kind, x: R.balloons.r(60, WORLD_W - 60), y: state.baseY + m * UNITS_PER_METER, phase: rand(0, 6.3), popped: 0,
      });
      state.balloonCount = (state.balloonCount || 0) + 1;
      let next = m + R.balloons.r(...(late ? BALLOON_GAP_LATE_M : BALLOON_GAP_M)) * DAY.balloonGap;
      if (!state.firstBadPlaced && next > state.badFromM) next = Math.max(state.badFromM, m + BALLOON_GAP_LATE_M[0]);
      state.nextBalloonM = next;
    }
  }

  function pickPower(allowed) {
    // Hook mode: no Auto-grab (hooks already catch by themselves) and no Swollen (bigger ledges leave smaller gaps to throw through).
    const pool = Object.keys(POWERS).filter(k => allowed(k) && !(hook() && (k === 'autoGrab' || k === 'swollen')));
    let r = R.balloons.r(0, pool.reduce((sum, k) => sum + POWERS[k].weight, 0));
    return pool.find(k => (r -= POWERS[k].weight) < 0) || pool[0];
  }

  // Balloons bob gently.
  function balloonPos(b) {
    return {
      x: b.x + Math.sin(state.time * 1.5 + b.phase) * 6,
      y: b.y + Math.sin(state.time * 2.1 + b.phase) * 4,
    };
  }

  // hand: which hand popped the balloon (Ouch!! only hurts that one).
  function applyPower(kind, hand) {
    if (!POWERS[kind]) return;
    state.toast = { kind, at: state.time };
    state.runPopped++;
    if (daily()) badge(Progress.notePop(kind));
    if (kind === 'ouch' && hurt(1 - hand)) badge(mainAward('doubleouch'));
    sfx.pop();
    (POWERS[kind].good ? sfx.good : sfx.bad)();
    if (kind === 'rocket') startRocket();
    else if (kind === 'ouch') state.effects[`ouch:${hand}`] = state.time + OUCH_SECS;
    else state.effects[kind] = state.time + EFFECT_SECS;
    if (kind === 'autoGrab') {
      // Hands already holding on now hold by themselves; thumbs are free.
      state.hands.forEach((h, i) => {
        if (h.state !== 'held') return;
        h.autoHeld = true;
        const t = state.thumbs[i];
        if (t) { t.mode = 'none'; t.canAim = false; }
      });
    }
    if (kind === 'swollen') {
      // Everything already on screen grows now; new arrivals grow as they appear.
      for (const o of state.holds) if (o.seen) swell(o);
    }
  }

  // Both hands let go (used by Rocket), and thumbs already down stop doing anything until lifted.
  function dropEverything() {
    state.hands.forEach((h, i) => {
      letGo(i);
      const t = state.thumbs[i];
      if (t) { t.mode = 'none'; t.canAim = false; }
    });
  }

  function startRocket() {
    dropEverything();
    state.hands.forEach(h => { if (h.state === 'flying') h.state = 'returning'; });
    state.rocket = { toY: state.body.y + ROCKET_M * UNITS_PER_METER };
    state.body.vx = 0;
  }

  // Auto-grab target: the highest ledge the hand will touch along its arc.
  function autoGrabTarget(i, v) {
    const s = shoulder(i);
    const h = { x: s.x, y: s.y, vx: v.vx, vy: v.vy, t: 0, launchY: s.y };
    let best = null;
    for (let n = 0; n < 600 && !handFlightOver(h); n++) {
      advanceHand(h, s, DT);
      const o = holdUnder(h);
      if (o && (!best || o.y > best.hold.y)) best = { hold: o, t: h.t };
    }
    return best;
  }

  // Ledges pick up Swollen / Breakaway when they first scroll onto the screen.
  function markNewLedges() {
    const top = state.cam + viewH;
    for (const o of state.holds) {
      if (o.seen || o.y - o.h / 2 > top) continue;
      o.seen = true;
      if (active('swollen')) swell(o);
      if (active('breakaway') && !o.ghost && !o.checkpoint) { o.breakable = true; o.heldFor = 0; }
    }
  }

  // Grow a ledge 25%, animated so you can see it happen.
  function swell(o) {
    if (o.swollen || o.broken) return;
    o.swollen = { w: o.w, h: o.h, at: state.time };
  }

  function updateLedges(dt) {
    moveLedges();
    for (const o of state.holds) {
      if (o.swollen) {
        const k = clamp((state.time - o.swollen.at) / 0.35, 0, 1);
        const grow = 1 + 0.25 * (1 - (1 - k) * (1 - k)); // ease out
        o.w = o.swollen.w * grow;
        o.h = o.swollen.h * grow;
      }
      if (o.broken) {
        o.vy -= T.bodyGravity * dt;
        o.y += o.vy * dt;
        continue;
      }
      if (!o.breakable) continue;
      const holders = state.hands.filter(h => h.state === 'held' && h.hold === o);
      if (!holders.length) continue;
      o.heldFor += dt; // only counts while something is holding on
      if (o.heldFor >= BREAK_SECS) {
        o.broken = true;
        o.vy = 0;
        sfx.crack();
        state.hands.forEach((h, i) => { if (h.hold === o) letGo(i); });
      }
    }
  }

  function popBalloons() {
    for (const b of state.balloons) {
      if (b.popped) continue;
      const p = balloonPos(b);
      const hand = state.hands.findIndex(h => Math.hypot(h.x - p.x, h.y - p.y) < BALLOON_R + HAND_R);
      if (hand >= 0) {
        b.popped = state.time;
        applyPower(b.kind, hand);
      }
    }
  }

  // ---------- Input: each half of the screen drives one hand ----------
  function sideOf(clientX) {
    return clientX < cssW / 2 ? LEFT : RIGHT;
  }

  function onDown(e) {
    sfx.unlock(); // browsers only allow sound after a touch
    if (!tunePanel.hidden || Menu.isOpen() || Feedback.isOpen() || Tutorial.isOpen()) return;
    e.preventDefault();
    if (state.phase === 'over') {
      // The daily is one run a day: afterwards, back to the start screen.
      if (state.time - state.overAt > 0.6) {
        if (learn()) { if (!state.trainingDone) newGame(); } // or the buttons
        else if (daily() && !state.missed) showStart();
        else newGame();
      }
      return;
    }
    if (state.rocket) return;
    if (e.pointerType === 'mouse') { mouseDown(e); return; }
    setMouse(false);
    // A first finger down means no other finger is touching, so any thumb we
    // still think is down lost its "lifted" event (iPhones sometimes drop it).
    if (e.isPrimary) releaseAllThumbs();
    const i = sideOf(e.clientX);
    if (state.thumbs[i]) {
      if (state.thumbs[i].id === e.pointerId) return;
      // A new finger on a side that we think already has one: the old one must
      // have lifted without telling us. Let it go, then take the new touch.
      releaseThumb(i);
    }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const thumb = { id: e.pointerId, mode: 'none', canAim: false, downAt: performance.now(), sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY };
    state.thumbs[i] = thumb;
    press(i, thumb);
  }

  // A thumb (or a grab key) goes down for hand i: grab if it's over a ledge,
  // otherwise get ready to throw it.
  function press(i, thumb) {
    const h = state.hands[i];
    if (hook()) { if (h.state !== 'flying') thumb.mode = 'aim'; return; } // no grabbing: every drag throws
    const autoGrab = active('autoGrab');
    if (h.state === 'held' && h.autoHeld) {
      // During Auto-grab a holding hand can't be let go of. Afterwards, a thumb
      // on a still auto-held hand takes over the grip (lift to let go).
      if (autoGrab) {
        // ...unless the other hand is holding too: then this one lets go and can be thrown.
        if (state.hands[1 - i].state !== 'held') return;
        letGo(i);
        thumb.mode = 'aim';
        return;
      }
      h.autoHeld = false;
      thumb.mode = 'grip';
      thumb.canAim = true;
      return;
    }
    const atShoulder = h.state === 'idle' || h.state === 'returning';
    // During Auto-grab, taps only throw a resting hand, so a stray tap can't
    // grab with it (which would make the other hand let go).
    const hold = hurt(i) || (autoGrab && atShoulder) ? null : holdUnder(h);
    if (!hold && state.holds.some(o => o.ghost && circleHitsRect(h.x, h.y, HAND_R, o))) badge(mainAward('fooled'));
    if (hold) {
      // Tap to grab: only works if the hand is over a ledge right now.
      grab(i, hold);
      if (h.autoHeld) return; // Auto-grab holds on for you
      thumb.mode = 'grip';
      thumb.canAim = atShoulder; // a quick flick from the shoulder can still turn this into a throw
    } else if (atShoulder) {
      thumb.mode = 'aim';
    } else if (h.state === 'flying' && !hurt(i) && !autoGrab) {
      hint('early'); // tapped before the hand reached a ledge
    }
    // Otherwise it's a missed grab: this thumb does nothing until lifted.
  }

  // ---------- Mouse and keyboard ----------
  // The mouse throws: drag and let go, like a thumb. With only one hand free,
  // that's the one; with both free, the one on the side of the climber you
  // clicked. Two keys grab and hold, the left one for the left hand: A and D,
  // or the left and right arrows. Hold the key to hang on, let go of it to let go.
  const tapWord = () => (Controls.mouse ? 'Click' : 'Tap');
  const KEYS = { KeyA: LEFT, KeyD: RIGHT, ArrowLeft: LEFT, ArrowRight: RIGHT };

  function setMouse(on) {
    if (Controls.mouse === on) return;
    Controls.mouse = on;
    if (!started) renderStart();
  }

  function mouseDown(e) {
    setMouse(true);
    if (e.button !== 0) return;
    // A mouse thumb we still think is down lost its "released" event.
    state.thumbs.forEach((t, i) => t && t.mouse && releaseThumb(i));
    let free = [LEFT, RIGHT].filter(i => {
      const h = state.hands[i], t = state.thumbs[i];
      return (h.state === 'idle' || h.state === 'returning') && (!t || t.mode === 'none');
    });
    if (hook() && !free.length) free = [LEFT, RIGHT].filter(i => state.hands[i].state === 'held' && !state.thumbs[i]);
    // Clicking to grab (a hand passing a ledge, or the opening drop): the keys do that.
    if (state.phase === 'ready' || state.hands.some((h, k) => h.state !== 'held' && !hurt(k) && holdUnder(h))) hint('keys');
    if (!free.length) return;
    const bodyX = ox + state.body.x * scale;
    const i = free.length === 1 ? free[0] : e.clientX < bodyX ? LEFT : RIGHT;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    state.thumbs[i] = { id: e.pointerId, mouse: true, mode: 'aim', canAim: false, downAt: performance.now(), sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY };
  }

  const typing = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

  window.addEventListener('keydown', (e) => {
    const i = KEYS[e.code];
    if (i === undefined || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault(); // arrows would scroll
    if (e.repeat) return;
    setMouse(true);
    if (!started || !tunePanel.hidden || Menu.isOpen() || Feedback.isOpen() || Tutorial.isOpen()) return;
    if (state.phase === 'over' || state.rocket || hook()) return;
    const old = state.thumbs[i];
    if (old && old.mouse && old.mode === 'aim') return; // that hand is being thrown
    if (old) releaseThumb(i);
    const thumb = { id: `key${i}`, key: true, mode: 'none', canAim: false, downAt: performance.now() };
    state.thumbs[i] = thumb;
    press(i, thumb);
    // Keys only grab and hold; throwing is the mouse's job.
    if (thumb.mode === 'aim') {
      thumb.mode = 'none';
      if (!active('autoGrab') && !hurt(i)) hint('early'); // nothing to grab yet
    }
    thumb.canAim = false;
  });
  window.addEventListener('keyup', (e) => {
    const i = KEYS[e.code];
    if (i === undefined || !state) return;
    const t = state.thumbs[i];
    if (t && t.key) releaseThumb(i);
  });

  // ---------- Hook mode: "Grappler" to players (PROTOTYPE, unlisted: ?mode=grappler, or ?mode=hook) ----------
  // Hands are hooks: no grabbing. A thrown hook bounces off a ledge it hits
  // from below or the side, and catches by itself when it comes down onto the
  // top of one. When a hook catches higher than the other hand's ledge, the
  // other hand lets go, so the climber swings up on its own. Drag any hand,
  // hooked or not, to throw it. A falling climber with nothing held hooks on
  // with a hand at the shoulder too, so a miss isn't the end. The opening drop always falls a third of the screen before a hook
  // can catch, and the ledges under the drop make sure one does.
  // h: the hand; py: its height before this step. `sim` is a copy used to
  // draw the aim arc (bounces and all) without catching anything.
  function hookCollide(i, h, py, sim = false) {
    if (!sim && !state.hookArmed) { // the opening drop: not until it has fallen a third of the screen
      if (state.body.y > state.hookFrom) return null;
      state.hookArmed = true;
    }
    if (!sim && hurt(i)) return null;
    const r = HAND_R;
    for (const o of state.holds) {
      if (o.ghost || o.broken) continue; // ghost ledges: hooks fall straight through
      const top = o.y + o.h / 2, bottom = o.y - o.h / 2;
      if (Math.abs(h.x - o.x) > o.w / 2 + r * 0.5 || h.y - r > top || h.y + r < bottom) continue;
      if (py - r >= top - 1 && h.y <= py) { // coming down onto the top: hook on
        if (sim) return o;
        h.y = top;
        grab(i, o);
        return o;
      }
      if (h.state !== 'flying') continue; // a hand at the shoulder passes up through ledges
      // A thrown hook passes through the ledge you're hanging from (and the one it was just on).
      if (o === h.fromHold || state.hands.some(k => k !== h && k.state === 'held' && k.hold === o)) continue;
      if (py + r <= bottom + 1 && h.vy > 0) { // from below: bounce off the underside
        h.y = bottom - r;
        h.vy = -Math.abs(h.vy) * 0.35;
      } else { // the side: bounce away
        const side = Math.sign(h.x - o.x) || 1;
        h.x = o.x + side * (o.w / 2 + r);
        h.vx = side * Math.abs(h.vx) * 0.5;
      }
    }
    return null;
  }

  // ---------- Beginner help ----------
  // For a player's first few runs (and in training): a short hint when they
  // make one of the common early mistakes, and with a mouse, A and D labels on
  // the hands. (The glow on a hand that can grab is for everyone.)
  const BEGINNER_RUNS = 5;
  const runsSoFar = () => Progress.stats().totalRuns + Progress.endlessRuns + Progress.sprintRuns;
  const HINTS = {
    early: () => (Controls.mouse ? 'Too early! Press when the hand touches a ledge' : 'Too early! Tap when the hand touches a ledge'),
    hold: () => (Controls.mouse ? 'Keep holding the other key!' : 'Keep your other thumb down!'),
    keys: () => 'Grab with A (left hand) or D (right hand)',
  };
  const HINT_SECS = 2.6;

  function hint(kind) {
    if (!state.beginner || state.phase === 'over') return;
    const h = state.hints[kind] || (state.hints[kind] = { n: 0, at: -99 });
    if (h.n >= 3 || state.time - h.at < 5) return; // not too often
    h.n++;
    h.at = state.time;
    state.hint = { text: HINTS[kind](), at: state.time };
  }

  // A small see-through note along the bottom edge, out of the way of the climb.
  function drawHint() {
    const t = state.hint;
    if (!t || state.phase === 'over') return;
    const age = state.time - t.at;
    if (age > HINT_SECS) return;
    const maxW = Math.min(cssW - 24, WORLD_W * scale - 16);
    let size = 13;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    while (size > 10 && ctx.measureText(t.text).width + 24 > maxW) { size -= 0.5; ctx.font = `bold ${size}px system-ui, sans-serif`; }
    const w = Math.min(maxW, ctx.measureText(t.text).width + 24), cx = ox + (WORLD_W * scale) / 2, y = cssH - 30;
    ctx.globalAlpha = Math.min(1, age * 6, (HINT_SECS - age) * 2);
    ctx.fillStyle = 'rgba(10, 25, 40, 0.45)';
    roundRect(cx - w / 2, y - 17, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#ffe29a';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, cx, y + 1);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // A hand that can grab right now glows, for everyone (world space). Not a
  // hurt hand (Ouch!!) or during Auto-grab, and ghost ledges don't count.
  function drawGrabGlow() {
    if (state.phase === 'over' || active('autoGrab') || hook()) return;
    state.hands.forEach((h, i) => {
      if (h.state === 'held' || hurt(i) || !holdUnder(h)) return;
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 14);
      ctx.fillStyle = `rgba(125, 255, 176, ${0.25 + 0.2 * pulse})`;
      ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R + 7 + pulse * 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R + 4, 0, Math.PI * 2); ctx.stroke();
    });
  }

  // With a mouse: which key grabs with which hand, right on the hands (screen space).
  function drawKeyLabels() {
    if (!Controls.mouse || state.phase === 'over' || !(state.beginner || state.phase === 'ready')) return;
    state.hands.forEach((h, i) => {
      const side = i === LEFT ? -1 : 1;
      const sx = ox + h.x * scale + side * 20, sy = cssH - (h.y - state.cam) * scale - 18;
      if (sy < -20 || sy > cssH + 20) return;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      roundRect(sx - 10, sy - 10, 20, 20, 5);
      ctx.fill();
      ctx.fillStyle = '#1b1b1b';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(i === LEFT ? 'A' : 'D', sx, sy + 5);
      ctx.textAlign = 'left';
    });
  }

  function onMove(e) {
    const i = state.thumbs.findIndex(t => t && t.id === e.pointerId);
    if (i < 0) return;
    e.preventDefault();
    const t = state.thumbs[i];
    t.cx = e.clientX;
    t.cy = e.clientY;
    if (t.canAim && performance.now() - t.downAt > AIM_WINDOW_MS) t.canAim = false; // grip locked in
    if (t.canAim && Math.hypot(t.cx - t.sx, t.cy - t.sy) > DRAG_START_PX) {
      // Dragging, not holding: drop the grab and aim a throw instead.
      t.canAim = false;
      t.mode = 'aim';
      state.hands[i].state = 'idle';
      state.hands[i].hold = null;
    }
  }

  function onUp(e) {
    const i = state.thumbs.findIndex(t => t && t.id === e.pointerId);
    if (i < 0) return;
    if (e.cancelable) e.preventDefault();
    releaseThumb(i, e.type === 'pointerup');
  }

  // A thumb lifted: let go of a grip, or throw if it was aiming. (When we only
  // find out late that a finger is gone, don't throw: just let go.)
  function releaseThumb(i, canThrow = false) {
    const t = state.thumbs[i];
    if (!t) return;
    state.thumbs[i] = null;
    if (state.phase === 'over') return;
    if (t.mode === 'grip') {
      const other = state.hands[1 - i], ot = state.thumbs[1 - i];
      if (state.phase === 'playing' && other.state !== 'held' && (other.state === 'flying' || (ot && ot.mode === 'aim'))) hint('hold');
      letGo(i);
    } else if (t.mode === 'aim' && canThrow) {
      const v = throwVelocity(t);
      if (v) throwHand(i, v);
    }
  }

  function releaseAllThumbs() {
    if (state) state.thumbs.forEach((t, i) => t && releaseThumb(i));
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  // Safety nets for lost "lifted" events: when no fingers are left on the
  // screen, or the game is interrupted (notification shade, call, app switch).
  // (A moment later, so the normal "lifted" event gets first go and can still
  // throw; and only thumbs that were down before, not a brand-new touch.)
  const allLifted = (e) => {
    if (e.touches && e.touches.length) return;
    const at = performance.now();
    setTimeout(() => {
      if (state) state.thumbs.forEach((t, i) => t && t.downAt < at && releaseThumb(i));
    }, 80);
  };
  window.addEventListener('touchend', allLifted, { passive: true });
  window.addEventListener('touchcancel', allLifted, { passive: true });
  window.addEventListener('blur', releaseAllThumbs);
  window.addEventListener('pagehide', releaseAllThumbs);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllThumbs(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function grab(i, hold, auto = false) {
    const h = state.hands[i];
    h.state = 'held';
    h.x = clamp(h.x, hold.x - hold.w / 2, hold.x + hold.w / 2);
    h.y = clamp(h.y, hold.y - hold.h / 2, hold.y + hold.h / 2);
    h.vx = h.vy = 0;
    h.hold = hold;
    h.slideDir = 0;
    h.slideV = 0;
    sfx.grab();
    if (state.fallTop != null && state.fallTop - state.body.y >= 20 * UNITS_PER_METER) badge(mainAward('freefall'));
    state.fallTop = null;
    // Auto-grab: holding is automatic, and the other hand lets go once this one
    // has hold of something new. A hand left auto-held after the timer ends also
    // lets go when the other hand grabs.
    h.autoHeld = auto || active('autoGrab');
    const j = 1 - i, other = state.hands[j];
    if (other.state === 'held' && (other.autoHeld || h.autoHeld || (hook() && hold.y > other.hold.y))) {
      letGo(j);
      if (state.thumbs[j]) { state.thumbs[j].mode = 'none'; state.thumbs[j].canAim = false; }
    }
    state.dropping = false;
    startPlaying();
  }

  // Slingshot: hand flies opposite to the drag, speed scales with drag length.
  function throwVelocity(t) {
    const dx = (t.cx - t.sx) / scale;
    const dy = (t.cy - t.sy) / scale;     // screen y points down
    const len = Math.hypot(dx, dy);
    if (len < 10) return null;
    const power = Math.min(len, T.maxDrag) / T.maxDrag;
    const speed = T.launchPower * power;
    return { vx: (-dx / len) * speed, vy: (dy / len) * speed };
  }

  function throwHand(i, v) {
    const h = state.hands[i];
    const from = h.state === 'held' ? h.hold : null;
    if (hook() && h.state === 'held') letGo(i); // unhook and throw in one move
    if (h.state !== 'idle' && h.state !== 'returning') return;
    h.fromHold = hook() ? from : null;
    const s = shoulder(i);
    Object.assign(h, { state: 'flying', x: s.x, y: s.y, vx: v.vx, vy: v.vy, t: 0, launchY: s.y });
    sfx.throw();
    h.autoTarget = active('autoGrab') ? autoGrabTarget(i, v) : null;
    startPlaying();
    if (learn()) state.training.thrown = true;
  }

  // ---------- Simulation ----------
  // A thrown hand: gravity, walls, and the arm can't stretch past its reach.
  function advanceHand(h, s, dt) {
    h.vy -= T.handGravity * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.t += dt;
    if (h.x < HAND_R) { h.x = HAND_R; h.vx = Math.abs(h.vx) * 0.4; }
    if (h.x > WORLD_W - HAND_R) { h.x = WORLD_W - HAND_R; h.vx = -Math.abs(h.vx) * 0.4; }
    const dx = h.x - s.x, dy = h.y - s.y, dist = Math.hypot(dx, dy);
    if (dist > T.armReach) {
      const nx = dx / dist, ny = dy / dist;
      h.x = s.x + nx * T.armReach;
      h.y = s.y + ny * T.armReach;
      const out = h.vx * nx + h.vy * ny;
      if (out > 0) { h.vx -= out * nx; h.vy -= out * ny; }
    }
  }

  // The hand is done once it falls back below where it was thrown from.
  function handFlightOver(h) {
    return (h.vy < 0 && h.y < h.launchY - 10) || h.t > 5;
  }

  function step(dt) {
    const { body, hands } = state;
    markNewLedges();
    updateLedges(dt);
    slideOnIce(dt);
    stepWind(dt);
    stepBirds(dt);
    stepConfetti(dt);

    if (state.rocket) {
      body.vx = 0;
      body.vy = ROCKET_SPEED;
      body.y += body.vy * dt;
      if (body.y >= state.rocket.toY) {
        // Burn-out: drop in from the top of the screen, like the start.
        state.rocket = null;
        state.dropping = true;
        body.vy = 0;
      }
      hands.forEach((h, i) => { if (h.state !== 'flying') { h.state = 'idle'; placeIdle(i); } });
      state.maxY = Math.max(state.maxY, body.y);
      checkCrossings();
      stepWater(dt);
      state.cam += (body.y - viewH * 0.6 - state.cam) * (1 - Math.exp(-8 * dt)); // lags to ~80% up the screen
      return;
    }

    // Body: gravity + an elastic pull from every held hand.
    let ax = 0, ay = -T.bodyGravity;
    hands.forEach((h, i) => {
      if (h.state !== 'held') return;
      const s = shoulder(i);
      const dx = h.x - s.x, dy = h.y - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= T.armRest) return;
      const nx = dx / dist, ny = dy / dist;
      const radialV = body.vx * nx + body.vy * ny;
      const f = Math.min(T.armStiffness * (dist - T.armRest), T.maxPull) - T.armDamping * radialV * 3;
      ax += nx * f;
      ay += ny * f;
    });
    body.vx += ax * dt;
    body.vy += ay * dt;
    body.vx *= Math.exp(-0.4 * dt); // light air drag
    body.vy *= Math.exp(-0.4 * dt);
    if (state.dropping) body.vy = Math.max(body.vy, -T.introFall);
    body.x += body.vx * dt;
    body.y += body.vy * dt;

    // Arms can't stretch past their reach: a held hand is a hard limit.
    hands.forEach((h, i) => {
      if (h.state !== 'held') return;
      const s = shoulder(i);
      const dx = s.x - h.x, dy = s.y - h.y, dist = Math.hypot(dx, dy);
      if (dist <= T.armReach) return;
      const nx = dx / dist, ny = dy / dist;
      body.x -= nx * (dist - T.armReach);
      body.y -= ny * (dist - T.armReach);
      const out = body.vx * nx + body.vy * ny;
      if (out > 0) { body.vx -= out * nx; body.vy -= out * ny; }
    });

    if (body.x < BODY_R) { body.x = BODY_R; body.vx = Math.abs(body.vx) * 0.5; }
    if (body.x > WORLD_W - BODY_R) { body.x = WORLD_W - BODY_R; body.vx = -Math.abs(body.vx) * 0.5; }
    if (learn()) standOnFloor(dt);

    // Hands.
    hands.forEach((h, i) => {
      const s = shoulder(i);
      const py = h.y;
      if (h.state === 'flying') {
        advanceHand(h, s, dt);
        if (hook()) { // the flight ends the same way: back below where it was thrown from
          if (!hookCollide(i, h, py) && h.state === 'flying' && handFlightOver(h)) h.state = 'returning';
          return;
        }
        const target = h.autoTarget;
        const o = target && !hurt(i) && holdUnder(h);
        if (o && (o === target.hold || h.t >= target.t)) {
          grab(i, o, true);
          h.autoTarget = null;
        } else if (handFlightOver(h)) h.state = 'returning';
      } else if (h.state === 'returning') {
        const k = 1 - Math.exp(-22 * dt);
        h.x += (s.x - h.x) * k;
        h.y += (s.y - h.y) * k;
        if (Math.hypot(s.x - h.x, s.y - h.y) < 4) h.state = 'idle';
      }
      if (h.state === 'idle') placeIdle(i);
      // A falling climber (nothing held) hooks on with a hand at the shoulder too.
      if (hook() && h.state !== 'held' && h.state !== 'flying' && !hands.some(o => o.state === 'held')) hookCollide(i, h, py);
    });

    if (state.phase === 'playing') {
      state.maxY = Math.max(state.maxY, body.y);
      popBalloons();
      checkCrossings();
    }
    stepMood();
    stepWater(dt);
    if (learn()) stepTraining(dt);

    // Camera follows the body, never dipping far below the water.
    // While dropping in it holds still until the climber nears the bottom.
    let target = Math.max(body.y - viewH * 0.4, state.water - 60);
    if (state.dropping) target = Math.max(Math.min(state.cam, body.y - viewH * 0.25), state.water - 60);
    if (learn() && state.training.floor) target = Math.max(target, state.training.floor.y - 40); // the floor sits at the bottom
    state.cam += (target - state.cam) * (1 - Math.exp(-4 * dt));
  }

  function stepWater(dt) {
    if (state.phase === 'playing') {
      // Clutch: the water got within 1 m, then you climbed 10 m clear of that spot.
      if (state.body.y - state.water < UNITS_PER_METER) state.clutchY = state.body.y;
      else if (state.clutchY != null && state.body.y - state.clutchY >= 10 * UNITS_PER_METER) {
        badge(mainAward('clutch'));
        state.clutchY = null;
      }
    }
    if (state.phase === 'playing' && sprint() && state.time - state.startTime >= SPRINT_SECS) {
      gameOver();
      return;
    }
    if (state.phase === 'playing' && !sprint() && !active('freeze') && (!learn() || state.training.water)) {
      const climbed = Math.max(0, state.maxY - state.baseY);
      let speed = (T.waterSpeed + T.waterRamp * climbed / 1000) * DAY.water;
      if (learn()) speed *= TRAINING_WATER;
      if (state.water < state.cam - (learn() ? 320 : 200)) speed *= learn() ? 2 : 4; // catch up if you're far ahead
      if (active('flood')) speed *= 1.25;
      state.water += speed * dt;
    }
    if (state.water >= state.body.y) gameOver();
  }

  function gameOver() {
    sfx.splash();
    const climbing = state.phase === 'playing';
    state.phase = 'over';
    state.overAt = state.time;
    // Never caught a ledge on the way in: that doesn't count as a run (not
    // even the daily's one run a day). Tap to try the drop again.
    if (!climbing) {
      state.missed = true;
      return;
    }
    state.unit = pickUnit(heightMeters());
    const m = heightMeters();
    state.timeUp = sprint() && climbing && state.water < state.body.y;
    if (hook()) { // prototype: its own best, nothing else counts
      const best = store.get('cg.hookBest', 0);
      if (m > best) store.set('cg.hookBest', m);
      state.result = { isBest: m > best, newBadges: [], newUnlocks: [] };
    } else if ((TUNING && !daily()) || learn()) {
      state.result = { isBest: false, newBadges: [], newUnlocks: [] }; // tuned runs and training don't count
    } else if (sprint()) {
      state.result = Progress.recordSprint({ m, unlockedBefore: state.unlockedBefore });
    } else if (!daily()) {
      state.result = Progress.recordEndless({ m, unlockedBefore: state.unlockedBefore });
    } else {
      state.result = Progress.recordRun({
        m, secs: climbing ? state.time - state.startTime : 0, splash: climbing && m < 5,
        unlockedBefore: state.unlockedBefore, daily: day,
      });
      store.set('climber2.best', Progress.best);
    }
    state.newBest = state.result.isBest;
    state.best = modeBest();
    if (climbing) Analytics.event(daily() ? 'daily-played' : learn() ? 'learn-splash' : `${mode}-run`);
  }

  // ---------- Rendering ----------
  function worldTransform() {
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * ox, dpr * cssH + dpr * scale * state.cam);
  }

  function screenTransform() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Sky by height, from the equipped backdrop (day, dusk, then space for Classic).
  const skyAt = (m) => Skins.skyAt(skin.backdrop, m);

  // Scenery, made once: a city skyline, clouds up to ~600 m, and a star field.
  const SKYLINE = (() => {
    const out = [];
    for (let x = -60; x < WORLD_W + 60;) {
      const w = rand(28, 70);
      out.push({ x, w, h: rand(70, 280), lit: Math.random() });
      x += w + rand(2, 10);
    }
    return out;
  })();
  const CLOUDS = Array.from({ length: 90 }, () => ({
    y: START_Y + rand(60, 650) * UNITS_PER_METER, x: rand(-80, WORLD_W + 80), size: rand(25, 60), speed: rand(3, 10),
  }));
  const STARFIELD = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.6), tw: rand(0, 6.3) }));

  // Screen y for a world height, with parallax factor f (smaller = farther away).
  const parallaxY = (y, f) => cssH - (y - state.cam) * scale * f;

  function drawScenery() {
    const camM = (state.cam - START_Y) / UNITS_PER_METER;
    const bd = Skins.byId(Skins.BACKDROPS, skin.backdrop);
    // Stars fade in as the sky darkens (some backdrops have them from the start).
    const starA = bd.starsFrom === 0 ? 0.8 : clamp((camM - bd.starsFrom) / 250, 0, 1);
    if (starA > 0) {
      for (const st of STARFIELD) {
        ctx.globalAlpha = starA * (0.5 + 0.5 * Math.sin(state.time * 2 + st.tw));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ox + st.x * WORLD_W * scale, st.y * cssH, st.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // City skyline far below, scrolling at half speed.
    const ground = parallaxY(START_Y - 80, 0.5);
    if (ground > -10) {
      Skins.drawSkyline(ctx, skin.backdrop, SKYLINE.map(b => ({ x: ox + b.x * scale, w: b.w * scale, h: b.h * scale * 0.7, lit: b.lit })), ground);
    }
    // Drifting clouds, thinning out toward space.
    const cloudA = 1 - clamp((camM - 450) / 200, 0, 1);
    if (cloudA > 0) {
      ctx.fillStyle = `rgba(${bd.cloud},${0.35 * cloudA})`;
      for (const c of CLOUDS) {
        const sy = parallaxY(c.y, 0.8);
        if (sy < -80 || sy > cssH + 80) continue;
        const span = WORLD_W + 200;
        const cx = ox + ((((c.x + state.time * c.speed) + 100) % span + span) % span - 100) * scale;
        const r = c.size * scale * 0.5;
        ctx.beginPath();
        ctx.arc(cx, sy, r, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.9, sy + r * 0.2, r * 0.75, 0, Math.PI * 2);
        ctx.arc(cx - r * 0.9, sy + r * 0.25, r * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Lines and labels in the world: your best, a friend's challenge, landmarks, checkpoints.
  function drawMarkers() {
    screenTransform();
    const sy = (y) => cssH - (y - state.cam) * scale;
    const left = ox, right = ox + WORLD_W * scale;
    const line = (y, color, label, dashed = true) => {
      const yy = sy(y);
      if (yy < -20 || yy > cssH + 20) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(label, right - 8, yy - 6);
      ctx.textAlign = 'left';
    };
    if (state.phase !== 'ready') {
      if (state.bestAtStart > 0) {
        line(state.baseY + state.bestAtStart * UNITS_PER_METER, 'rgba(255, 209, 102, 0.85)', `Your best · ${state.bestAtStart} m`);
      }
      if (CHALLENGE) {
        const done = state.beatChallenge;
        line(state.baseY + CHALLENGE.m * UNITS_PER_METER, done ? 'rgba(125, 255, 176, 0.9)' : 'rgba(125, 249, 255, 0.9)',
          done ? `${challengerPossessive()} ${CHALLENGE.m} m ✓` : `Beat ${challengerPossessive()} ${CHALLENGE.m} m`);
      }
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      for (const [m, icon, name] of learn() ? [] : LANDMARKS) {
        const yy = sy(state.baseY + m * UNITS_PER_METER);
        if (yy < -20 || yy > cssH + 20) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(right - 70, yy); ctx.lineTo(right, yy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(`${icon} ${name.replace(/^(a|the) /, '')} · ${m} m`, right - 6, yy - 4);
      }
      ctx.textAlign = 'left';
    }
    // Checkpoint flags.
    for (const o of state.holds) {
      if (!o.checkpoint) continue;
      const yy = sy(o.y + o.h / 2), xx = ox + (o.x + o.w / 2 - 14) * scale;
      if (yy < -60 || yy > cssH + 20) continue;
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy - 36); ctx.stroke();
      ctx.fillStyle = '#ff5f5f';
      ctx.beginPath(); ctx.moveTo(xx, yy - 36); ctx.lineTo(xx - 24, yy - 29); ctx.lineTo(xx, yy - 22); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.finish ? 'Finish!' : `${o.checkpoint} m`, ox + o.x * scale, yy - 6);
      ctx.textAlign = 'left';
    }
    worldTransform();
  }

  function drawBirds() {
    for (const b of state.birds) {
      const flap = Math.sin(state.time * 14 + b.phase) * 7;
      ctx.strokeStyle = '#2b2b33';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - 13, b.y + flap); ctx.quadraticCurveTo(b.x - 6, b.y + 4, b.x, b.y);
      ctx.quadraticCurveTo(b.x + 6, b.y + 4, b.x + 13, b.y + flap);
      ctx.stroke();
      ctx.fillStyle = '#2b2b33';
      ctx.beginPath(); ctx.ellipse(b.x, b.y - 1, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0a020';
      ctx.beginPath(); ctx.moveTo(b.x + b.dir * 6, b.y); ctx.lineTo(b.x + b.dir * 11, b.y - 1); ctx.lineTo(b.x + b.dir * 6, b.y - 3); ctx.fill();
    }
  }

  function drawWindAndConfetti() {
    for (const b of state.windBits) {
      if (b.leaf) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin);
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.sign(b.vx) * 40, b.y); ctx.stroke();
      }
    }
    if (state.phase === 'over') return;
    for (const c of state.confetti) {
      ctx.globalAlpha = 1 - c.life / c.max;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.spin);
      ctx.fillStyle = c.color;
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Big centered text for milestones and records; a smaller line for landmarks.
  function drawBanner() {
    const b = state.banner;
    if (!b || state.phase === 'over') return;
    const age = state.time - b.at, dur = b.small ? 2.2 : 2.4;
    if (age > dur) return;
    ctx.globalAlpha = Math.min(1, age * 6, (dur - age) * 2);
    ctx.textAlign = 'center';
    const cx = cssW / 2, y = cssH * 0.3;
    if (b.small) {
      ctx.font = 'bold 15px system-ui, sans-serif';
      const w = ctx.measureText(b.text).width + 28;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(cx - w / 2, y - 20, w, 30, 15);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(b.text, cx, y);
    } else {
      const pop = 1 + Math.max(0, 0.25 - age) * 1.2;
      ctx.font = `900 ${Math.round(34 * pop)}px system-ui, sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeText(b.text, cx, y);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(b.text, cx, y);
      if (b.sub) {
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(b.sub, cx, y + 24);
      }
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // "Aaah!" over the climber while falling.
  function drawScream() {
    if (!state.screamed || state.phase !== 'playing') return;
    const sx = ox + state.body.x * scale, sy = cssH - (state.body.y - state.cam) * scale;
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('Aaah!', sx + Math.sin(state.time * 40) * 1.5, sy - 30);
    ctx.textAlign = 'left';
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  function render() {
    screenTransform();
    ctx.fillStyle = '#0b1d2e';
    ctx.fillRect(0, 0, cssW, cssH);

    const camM = (state.cam - START_Y) / UNITS_PER_METER;
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, skyAt(camM + viewH / UNITS_PER_METER));
    grad.addColorStop(1, skyAt(camM));
    ctx.fillStyle = grad;
    ctx.fillRect(ox, 0, WORLD_W * scale, cssH);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, 0, WORLD_W * scale, cssH); ctx.clip();
    drawScenery();
    ctx.restore();

    // Height markers every 10 m.
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    const step10 = UNITS_PER_METER * 10;
    const base = state.baseY;
    if (!learn() || state.training.climbing) for (let y = Math.ceil((state.cam - base) / step10) * step10 + base; y < state.cam + viewH; y += step10) {
      const sy = cssH - (y - state.cam) * scale;
      ctx.beginPath();
      ctx.moveTo(ox, sy); ctx.lineTo(ox + WORLD_W * scale, sy);
      ctx.stroke();
      ctx.fillText(`${Math.round((y - base) / UNITS_PER_METER)} m`, ox + 6, sy - 4);
    }

    // Faint divider between the two thumb zones (touch only).
    if (!Controls.mouse) {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 10]);
      ctx.beginPath(); ctx.moveTo(cssW / 2, 0); ctx.lineTo(cssW / 2, cssH); ctx.stroke();
      ctx.setLineDash([]);
    }

    worldTransform();

    for (const h of state.holds) {
      if (h.y + h.h < state.cam - 50 || h.y - h.h > state.cam + viewH + 50) continue;
      drawLedge(h);
    }

    drawMarkers();
    drawBalloons();
    drawBirds();
    drawAimArcs();
    drawClimber();
    drawAimRings();
    drawGrabGlow();
    drawWater();

    screenTransform();
    drawWindAndConfetti();
    drawScream();
    drawOffscreenHands();
    drawThumbs();
    drawHud();
    drawBanner();
  }

  function drawLedge(h) {
    const theme = ledgeTheme();
    const special = h.icy || h.checkpoint || h.floor;
    const color = special ? h.color : theme.colors[h.ci || 0];
    if (h.ghost) {
      // Faint fill and a dotted outline: obvious if you look, easy to miss in a hurry.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = color;
      roundRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      roundRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    // A breakaway ledge shakes harder the longer it's held.
    const strain = h.breakable && !h.broken ? h.heldFor / BREAK_SECS : 0;
    const x = h.x + (strain ? Math.sin(state.time * 70) * strain * 2.5 : 0);
    ctx.globalAlpha = h.broken ? 0.6 : 1;
    ctx.fillStyle = special ? color : Skins.ledgeFill(theme.style, color);
    roundRect(x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
    ctx.fill();
    if (!special) Skins.decorateLedge(ctx, x - h.w / 2, h.y - h.h / 2, h.w, h.h, theme.style, color);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x - h.w / 2 + 2, h.y + h.h / 2 - 4, h.w - 4, 2);
    if (h.icy) {
      // Glossy streaks and a glint.
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = -h.w / 2 + 10; k < h.w / 2 - 6; k += 22) { ctx.moveTo(x + k, h.y - h.h / 2 + 3); ctx.lineTo(x + k + 7, h.y + h.h / 2 - 3); }
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(state.time * 3 + h.x)})`;
      ctx.beginPath(); ctx.arc(x + h.w / 2 - 8, h.y + 2, 2, 0, Math.PI * 2); ctx.fill();
    }
    if (h.checkpoint) {
      ctx.strokeStyle = '#fff2b0';
      ctx.lineWidth = 2;
      roundRect(x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
      ctx.stroke();
    }
    if (h.swollen) {
      ctx.strokeStyle = 'rgba(160,255,190,0.7)';
      ctx.lineWidth = 2;
      roundRect(x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
      ctx.stroke();
    }
    if (h.breakable) {
      // Zigzag crack, reddening with strain.
      ctx.strokeStyle = `rgba(${Math.round(lerp(30, 230, strain))},20,20,0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const n = Math.max(3, Math.round(h.w / 12));
      for (let k = 0; k <= n; k++) {
        const px = x - h.w / 2 + (h.w * k) / n;
        const py = h.y + (k % 2 ? 1 : -1) * h.h * 0.25;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Balloons draw in screen space so their icons aren't flipped.
  function drawBalloons() {
    screenTransform();
    for (const b of state.balloons) {
      const p = balloonPos(b);
      const sx = ox + p.x * scale, sy = cssH - (p.y - state.cam) * scale;
      const r = BALLOON_R * scale;
      if (sy < -r * 2 || sy > cssH + r * 3) continue;
      const good = POWERS[b.kind].good;
      if (b.popped) {
        const k = (state.time - b.popped) / 0.4;
        ctx.strokeStyle = good ? '#3ddc84' : '#ff5a5a';
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx, sy, r * (1 + k * 1.5), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sx, sy + r); ctx.quadraticCurveTo(sx + 5, sy + r * 1.6, sx, sy + r * 2.3); ctx.stroke();
      ctx.fillStyle = good ? '#2fbf6e' : '#e04848';
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.9, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - 4, sy + r + 4); ctx.lineTo(sx + 4, sy + r + 4); ctx.lineTo(sx, sy + r - 1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(sx - r * 0.35, sy - r * 0.4, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(r * 1.05)}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(POWERS[b.kind].icon, sx, sy + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
    }
    worldTransform();
  }

  // Faint dotted arc for a hand being aimed (respecting arm reach).
  function drawAimArcs() {
    if (state.phase === 'over') return;
    state.thumbs.forEach((t, i) => {
      if (!t || t.mode !== 'aim') return;
      const v = throwVelocity(t);
      if (!v) return;
      const s = shoulder(i);
      const h = { x: s.x, y: s.y, vx: v.vx, vy: v.vy, t: 0, launchY: s.y };
      ctx.fillStyle = arcColor(i);
      ctx.globalAlpha = 0.8;
      let caught = null;
      h.state = 'flying';
      h.fromHold = state.hands[i].state === 'held' ? state.hands[i].hold : null;
      for (let n = 0; n < 600 && !handFlightOver(h); n++) {
        const py = h.y;
        advanceHand(h, s, DT);
        // Hook mode: the arc bounces like the hook will, and ends where it catches.
        if (hook() && (caught = hookCollide(i, h, py, true))) break;
        if (n % 7) continue;
        ctx.beginPath(); ctx.arc(h.x, h.y, 2.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (caught) {
        const top = caught.y + caught.h / 2;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(h.x, top, HAND_R + 3, 0, Math.PI * 2); ctx.stroke();
      }
      const target = active('autoGrab') && autoGrabTarget(i, v);
      if (target) {
        const o = target.hold;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        roundRect(o.x - o.w / 2 - 3, o.y - o.h / 2 - 3, o.w + 6, o.h + 6, 6);
        ctx.stroke();
      }
    });
  }

  // A thin ring around the hand that's about to be thrown.
  function drawAimRings() {
    if (state.phase === 'over') return;
    state.thumbs.forEach((t, i) => {
      if (!t || t.mode !== 'aim') return;
      const h = state.hands[i];
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R + 3.5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawClimber() {
    const { body, hands } = state;

    ctx.lineCap = 'round';
    hands.forEach((h, i) => {
      const s = shoulder(i);
      const len = Math.hypot(h.x - s.x, h.y - s.y);
      ctx.strokeStyle = handColor(i);
      ctx.lineWidth = clamp(8 - len * 0.02, 2.5, 7);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(h.x, h.y); ctx.stroke();
    });

    if (state.rocket) {
      const flicker = 1 + Math.sin(state.time * 60) * 0.15;
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.moveTo(body.x - 10, body.y - 10);
      ctx.lineTo(body.x + 10, body.y - 10);
      ctx.lineTo(body.x, body.y - 10 - 45 * flicker);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.moveTo(body.x - 5, body.y - 10);
      ctx.lineTo(body.x + 5, body.y - 10);
      ctx.lineTo(body.x, body.y - 10 - 22 * flicker);
      ctx.closePath();
      ctx.fill();
    }

    Skins.drawBody(ctx, body.x, body.y, BODY_R, skin.body);

    // Eyes follow a flying hand, else look up; they go wide when falling.
    const fly = hands.find(h => h.state === 'flying');
    const lx = fly ? fly.x - body.x : 0, ly = fly ? fly.y - body.y : 1;
    const ll = Math.hypot(lx, ly) || 1;
    const falling = !hands.some(h => h.state === 'held');
    const inPain = (hurt(LEFT) || hurt(RIGHT)) && !(state.screamed && falling);
    for (const ex of [-6, 6]) {
      if (inPain) {
        // Eyes squeezed shut: > <
        const d = ex < 0 ? 1 : -1;
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(body.x + ex - 3 * d, body.y + 7);
        ctx.lineTo(body.x + ex + 3 * d, body.y + 4);
        ctx.lineTo(body.x + ex - 3 * d, body.y + 1);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(body.x + ex, body.y + 4, falling ? 5.5 : 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath(); ctx.arc(body.x + ex + (lx / ll) * 2, body.y + 4 + (ly / ll) * 2, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    drawFace(body, falling, inPain);
    Skins.drawFaceExtra(ctx, body.x, body.y, BODY_R, skin.face);
    Skins.drawHat(ctx, body.x, body.y, BODY_R, skin.hat, state.time);

    hands.forEach((h, i) => {
      ctx.fillStyle = handColor(i);
      ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R, 0, Math.PI * 2); ctx.fill();
      if (h.state === 'held') {
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R, 0, Math.PI * 2); ctx.stroke();
      }
      if (hurt(i)) {
        // Hurt: a pulsing red tint and ring.
        const pulse = 0.5 + 0.5 * Math.sin(state.time * 10);
        ctx.fillStyle = `rgba(230, 30, 30, ${0.35 + 0.35 * pulse})`;
        ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255, 40, 40, ${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R + 2 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
    });
  }

  // Mood: screaming when falling, a grin after a big fling, worried near the water.
  function drawFace(body, falling, inPain) {
    const bx = body.x, by = body.y;
    if (inPain) {
      // Grimace: clenched teeth, with a little shake.
      const jx = Math.sin(state.time * 50) * 0.6;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3a1a10';
      ctx.lineWidth = 1.4;
      roundRect(bx - 7 + jx, by - 10, 14, 6, 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - 7 + jx, by - 7); ctx.lineTo(bx + 7 + jx, by - 7);
      for (const tx of [-3.5, 0, 3.5]) { ctx.moveTo(bx + tx + jx, by - 10); ctx.lineTo(bx + tx + jx, by - 4); }
      ctx.stroke();
      return;
    }
    const screaming = state.screamed && falling && state.phase !== 'ready';
    const grinning = state.time < state.grinUntil;
    const worried = state.phase === 'playing' && body.y - state.water < 220;
    ctx.strokeStyle = '#3a1a10';
    ctx.fillStyle = '#3a1a10';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    if (screaming || worried) {
      // Worried brows: inner ends raised.
      ctx.beginPath();
      ctx.moveTo(bx - 10, by + 9); ctx.lineTo(bx - 3, by + 11.5);
      ctx.moveTo(bx + 3, by + 11.5); ctx.lineTo(bx + 10, by + 9);
      ctx.stroke();
    }
    if (screaming) {
      ctx.beginPath(); ctx.ellipse(bx, by - 7, 3.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    } else if (grinning) {
      ctx.beginPath();
      ctx.moveTo(bx - 8, by - 3);
      for (let t = -1; t <= 1.001; t += 0.25) ctx.lineTo(bx + t * 8, by - 3 - (1 - t * t) * 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx - 5, by - 4.5, 10, 1.8);
    } else if (worried) {
      ctx.beginPath();
      for (let t = -1; t <= 1.001; t += 0.25) {
        const px = bx + t * 5, py = by - 7 + Math.sin(t * Math.PI * 2) * 1.2;
        t === -1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Sweat drop.
      ctx.fillStyle = '#8fd3ff';
      ctx.beginPath(); ctx.arc(bx + 15, by + 6, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx + 12.6, by + 7); ctx.lineTo(bx + 15, by + 12); ctx.lineTo(bx + 17.4, by + 7); ctx.fill();
    } else {
      ctx.beginPath();
      for (let t = -1; t <= 1.001; t += 0.25) {
        const px = bx + t * 5, py = by - 5 - (1 - t * t) * 2.5;
        t === -1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  function drawWater() {
    const top = state.water;
    const bottom = state.cam - 50;
    if (top < bottom) return;
    const frozen = active('freeze'), flood = active('flood');
    const wave = frozen ? 0 : flood ? 5 : 3;
    const waveSpeed = flood ? 6 : 3;
    const wt = Skins.byId(Skins.WATERS, skin.water);
    ctx.fillStyle = frozen ? 'rgba(200, 235, 255, 0.88)' : flood ? wt.flood : wt.fill;
    ctx.beginPath();
    ctx.moveTo(-500, bottom);
    for (let x = -500; x <= WORLD_W + 500; x += 10) {
      ctx.lineTo(x, top + Math.sin(x * 0.05 + state.time * waveSpeed) * wave);
    }
    ctx.lineTo(WORLD_W + 500, bottom);
    ctx.closePath();
    ctx.fill();
    if (!frozen && (wt.glow || wt.shine)) {
      // Lava glows along the surface; chocolate gets a glossy streak.
      ctx.strokeStyle = wt.glow || wt.shine;
      ctx.lineWidth = wt.glow ? 3 : 2;
      ctx.beginPath();
      for (let x = -500; x <= WORLD_W + 500; x += 10) {
        const y = top - (wt.glow ? 0 : 5) + Math.sin(x * 0.05 + state.time * waveSpeed) * wave;
        x === -500 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (!frozen && wt.bubbles) {
      // Bubbles rising and popping just under the surface.
      ctx.fillStyle = wt.bubbles;
      for (let k = 0; k < 9; k++) {
        const cyc = (state.time * 0.6 + k * 0.37) % 1;
        const bx = ((k * 53) % WORLD_W) + Math.sin(k + state.time) * 6;
        ctx.beginPath(); ctx.arc(bx, top - 30 + cyc * 26, 2 + (k % 3) * 1.5 * (1 - cyc), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (frozen) {
      // Ice: a bright surface line and a few cracks.
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-500, top); ctx.lineTo(WORLD_W + 500, top); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,180,220,0.6)';
      ctx.lineWidth = 1.5;
      for (const cx of [60, 170, 290, 360]) {
        ctx.beginPath();
        ctx.moveTo(cx, top); ctx.lineTo(cx + 12, top - 14); ctx.lineTo(cx + 4, top - 26); ctx.lineTo(cx + 18, top - 40);
        ctx.stroke();
      }
    }
  }

  // A hand thrown above the screen shows as an arrow on the top edge.
  function drawOffscreenHands() {
    state.hands.forEach((h, i) => {
      const sy = cssH - (h.y - state.cam) * scale;
      if (sy > -HAND_R * scale) return;
      const sx = ox + h.x * scale;
      const above = Math.min(1, -sy / (viewH * scale)); // fades as it goes further
      ctx.fillStyle = handColor(i);
      ctx.globalAlpha = 1 - above * 0.6;
      ctx.beginPath();
      ctx.moveTo(sx, 6);
      ctx.lineTo(sx - 9, 22);
      ctx.lineTo(sx + 9, 22);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  // Show where each thumb is and what it's doing.
  function drawThumbs() {
    state.thumbs.forEach((t, i) => {
      if (!t || t.key) return;
      if (t.mouse && t.mode !== 'aim') return;
      ctx.strokeStyle = handColor(i);
      ctx.fillStyle = handColor(i);
      if (t.mode === 'aim') {
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(t.sx, t.sy); ctx.lineTo(t.cx, t.cy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.3;
        ctx.beginPath(); ctx.arc(t.sx, t.sy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(t.cx, t.cy, 9, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = t.mode === 'grip' ? 0.6 : 0.2;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.cx, t.cy, 26, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }

  // Centered text that shrinks to fit a width (down to 10px).
  function fitText(text, x, y, maxW, size) {
    let px = size;
    do {
      ctx.font = `bold ${px}px system-ui, sans-serif`;
      if (ctx.measureText(text).width <= maxW) break;
      px -= 0.5;
    } while (px > 10);
    ctx.fillText(text, x, y);
  }

  // Wrap a comma-separated list over at most 2 lines (at the current font),
  // ending with "+N more" if it still doesn't fit.
  function listLines(prefix, items, maxW) {
    const out = [];
    let line = prefix, i = 0;
    while (i < items.length) {
      const piece = (line === prefix || line === '' ? '' : ', ') + items[i];
      if (ctx.measureText(line + piece).width <= maxW || line === prefix || line === '') { line += piece; i++; continue; }
      if (out.length === 1) break;
      out.push(line + ',');
      line = '';
    }
    if (i < items.length) {
      // Out of room: drop items from the end of line 2 until "+N more" fits.
      let rest = items.length - i;
      while (ctx.measureText(`${line}, +${rest} more`).width > maxW && line.includes(', ')) {
        line = line.slice(0, line.lastIndexOf(', ')); rest++;
      }
      line += `, +${rest} more`;
    }
    out.push(line);
    return out;
  }

  // Sprint countdown, top center. Starts on the first catch.
  function drawSprintClock(top) {
    const used = state.startTime == null ? 0 : state.time - state.startTime;
    const left = state.phase === 'over' ? 0 : Math.max(0, SPRINT_SECS - used);
    const secs = Math.ceil(left);
    const cx = ox + (WORLD_W * scale) / 2;
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('⏱️ SPRINT', cx, top + 10);
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillStyle = left <= 10 && state.phase === 'playing' && Math.floor(left * 2) % 2 === 0 ? '#ff6b6b' : '#fff';
    ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, cx, top + 40);
    ctx.textAlign = 'left';
  }

  function drawHud() {
    const top = 16;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    const mText = `${heightMeters()} m`;
    if (!learn() || state.training.climbing) ctx.fillText(mText, ox + 14, top + 26); // training counts only in the climb
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    if (!learn()) ctx.fillText(`${MODE_LABEL[mode]}${daily() ? 'Best' : 'best'} ${state.best} m`, ox + 14, top + 46);
    if (sprint()) drawSprintClock(top);
    if (daily() || learn()) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(learn() ? '🎓 TRAINING' : `📅 DAILY #${day.n}`, ox + (WORLD_W * scale) / 2, top + 10);
      ctx.textAlign = 'left';
    }
    if (learn()) drawCoach(top + 38);
    drawKeyLabels();
    drawHint();
    drawEffects(learn() ? top + 38 + COACH_H + 6 : top + 60);
    if (!learn()) drawToast(); // in training, the callouts say what balloons do

    ctx.textAlign = 'center';
    const cx = ox + (WORLD_W * scale) / 2;
    if (learn() && state.phase === 'over') {
      drawTrainingOver(cx);
    } else if (state.phase === 'ready' && !learn()) {
      const by = cssH * 0.86;
      // Touch: each half of the screen. Mouse: each half of the game column.
      const zx = Controls.mouse ? ox : 0, zw = Controls.mouse ? WORLD_W * scale : cssW;
      [LEFT, RIGHT].forEach((i) => {
        const hx = zx + zw * (i === LEFT ? 0.25 : 0.75);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRect(hx - zw * 0.23, by, zw * 0.46, 64, 12);
        ctx.fill();
        // White text with a hand-colored dot, so dark hand colors stay readable.
        const label = Controls.mouse ? `${i === LEFT ? 'A' : 'D'} to grab` : 'TAP to grab';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(label, hx + 9, by + 26);
        const tw = ctx.measureText(label).width;
        ctx.beginPath(); ctx.arc(hx + 9 - tw / 2 - 12, by + 21, 6, 0, Math.PI * 2);
        ctx.fillStyle = handColor(i); ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('then keep holding', hx, by + 46);
      });
    } else if (state.phase === 'over' && state.missed) {
      // Missed the catch on the way in: no run, just try again.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, cssW, cssH);
      const y0 = cssH * 0.36, maxW = Math.min(cssW - 32, WORLD_W * scale - 16);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.fillText('Missed the catch!', cx, y0);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      fitText(Controls.mouse ? 'Press A or D as a hand passes a ledge on the way in.' : 'Tap as a hand passes a ledge on the way in.', cx, y0 + 40, maxW, 16);
      ctx.fillStyle = '#7dffb0';
      fitText(daily() ? "No worries, this one doesn't count toward today's daily." : "No worries, this one doesn't count.", cx, y0 + 68, maxW, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText(`${tapWord()} anywhere to try again`, cx, y0 + 120);
    } else if (state.phase === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#fff';
      const y0 = cssH * 0.3;
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText(state.timeUp ? 'Time!' : 'Splash!', cx, y0);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`${heightMeters()} m`, cx, y0 + 40);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = state.newBest ? '#ffd27a' : 'rgba(255,255,255,0.8)';
      if (daily()) {
        const streak = Progress.dailyStreak(day.key);
        ctx.fillStyle = '#ffd27a';
        ctx.fillText(`Daily #${day.n}${streak >= 2 ? ` · 🔥 ${streak}-day streak` : ''}${state.newBest ? ' · New best!' : ''}`, cx, y0 + 68);
      } else {
        ctx.fillText(state.newBest ? `New ${MODE_LABEL[mode]}best!` : `${MODE_LABEL[mode]}best ${state.best} m`, cx, y0 + 68);
      }
      if (state.unit) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'italic 14px system-ui, sans-serif';
        ctx.fillText(`That's ${unitPhrase(state.unit)}`, cx, y0 + 94);
      }
      if (CHALLENGE) {
        const left = CHALLENGE.m - heightMeters();
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillStyle = state.beatChallenge ? '#7dffb0' : '#7df9ff';
        ctx.fillText(state.beatChallenge ? `You beat ${challengerPossessive().replace("Your friend's", "your friend's")} ${CHALLENGE.m} m!`
          : `${challengerPossessive()} ${CHALLENGE.m} m still stands (${left} m to go)`, cx, y0 + 118);
      }
      // Badges and unlocks from this run, and what's next.
      const lines = [];
      const seen = new Set();
      const newBadges = [...state.runBadges, ...(state.result ? state.result.newBadges : [])].filter(b => !seen.has(b.id) && seen.add(b.id));
      const maxW = Math.min(cssW - 32, WORLD_W * scale - 16);
      ctx.font = 'bold 14px system-ui, sans-serif';
      if (newBadges.length) lines.push(...listLines(`🏅 New ${daily() ? '' : MODE_LABEL[mode]}badge${newBadges.length > 1 ? 's' : ''}: `, newBadges.map(b => b.name), maxW).map(t => [t, '#ffd166']));
      if (state.result && state.result.newUnlocks.length) {
        lines.push(...listLines('🔓 Unlocked: ', state.result.newUnlocks, maxW).map(t => [t, '#7dffb0']));
        lines.push(['Equip them with 🎨 Customize', 'rgba(255,255,255,0.75)']);
      }
      const next = Progress.nextUnlock();
      if (next && daily()) lines.push([next.text, 'rgba(255,255,255,0.75)']);
      // Below the buttons (Endless and Sprint have an extra row of them).
      let ly = y0 + 300;
      if (!daily() && !overActions.hidden) ly = Math.max(ly, overActions.getBoundingClientRect().bottom + 24);
      for (const [text, color] of lines) {
        ctx.fillStyle = color;
        fitText(text, cx, ly, maxW, 14);
        ly += 20;
      }
      if (daily() || hook()) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '15px system-ui, sans-serif';
        ctx.fillText(daily() ? `${tapWord()} to continue` : `${tapWord()} anywhere to climb again`, cx, ly + 14);
      }
    }
    ctx.textAlign = 'left';
  }

  // Active timed effects: icon + a shrinking bar, under the score.
  function drawEffects(y) {
    for (const [key, until] of Object.entries(state.effects)) {
      const left = until - state.time;
      if (left <= 0) continue;
      const p = POWERS[key.split(':')[0]];
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(p.icon, ox + 14, y + 16);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(ox + 40, y + 7, 60, 6);
      ctx.fillStyle = p.good ? '#3ddc84' : '#ff6b6b';
      ctx.fillRect(ox + 40, y + 7, 60 * (left / (p.secs || EFFECT_SECS)), 6);
      const hand = key.split(':')[1];
      if (hand !== undefined) {
        // Which hand is hurt.
        ctx.fillStyle = handColor(+hand);
        ctx.beginPath(); ctx.arc(ox + 108, y + 10, 4, 0, Math.PI * 2); ctx.fill();
      }
      y += 24;
    }
  }

  // What the last balloon did: a small note in the top-right corner that fades out.
  function drawToast() {
    const t = state.toast;
    if (!t) return;
    const age = state.time - t.at;
    if (age > 3.5) return;
    const p = POWERS[t.kind];
    const right = ox + WORLD_W * scale - 12;
    const maxW = Math.min(300, WORLD_W * scale - 150);
    let size = 12;
    ctx.font = `${size}px system-ui, sans-serif`;
    while (size > 9 && ctx.measureText(p.text).width > maxW - 20) {
      size -= 0.5;
      ctx.font = `${size}px system-ui, sans-serif`;
    }
    const w = Math.min(maxW, Math.max(ctx.measureText(p.text).width, 110) + 20);
    const y = 66;
    ctx.globalAlpha = Math.min(1, age * 5, (3.5 - age) * 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(right - w, y, w, 42, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = p.good ? '#7dffb0' : '#ff9a9a';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`${p.icon} ${p.name}`, right - w / 2, y + 17);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.fillText(p.text, right - w / 2, y + 34);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // ---------- Sharing ----------
  const overActions = document.getElementById('over-actions');
  const shareStatus = document.getElementById('share-status');
  const overModes = document.getElementById('over-modes');
  for (const b of overModes.querySelectorAll('[data-mode]')) b.addEventListener('click', () => playMode(b.dataset.mode));

  // Pick a random absurd unit that gives a fun-sized number, skipping the
  // last few this device has seen so it feels different every time.
  const RECENT_UNITS = 30;

  function pickUnit(meters) {
    const units = window.CLIMBER_UNITS || [];
    if (!units.length || meters <= 0) return null; // "0 Petronas Towers" helps no one
    const fits = units.filter(([, , h]) => meters / h >= 1.5 && meters / h <= 50000);
    const recent = store.get('climber.recentUnits', []);
    const fresh = fits.filter(([one]) => !recent.includes(one));
    const pool = fresh.length ? fresh : fits.length ? fits : units;
    const [one, many, h] = pool[(Math.random() * pool.length) | 0];
    store.set('climber.recentUnits', [one, ...recent.filter(r => r !== one)].slice(0, RECENT_UNITS));
    return { one, many, count: meters / h };
  }

  function formatCount(n) {
    if (n === 0) return '0';
    if (n < 10) return String(Math.round(n * 10) / 10);
    return Math.round(n).toLocaleString('en-US');
  }

  function unitPhrase(u) {
    const n = formatCount(u.count);
    return `${n} ${n === '1' ? u.one : u.many}`;
  }

  const nameInput = document.getElementById('name-input');
  nameInput.value = store.get('climber.name', '');
  nameInput.addEventListener('input', () => store.set('climber.name', nameInput.value.trim().slice(0, 20)));

  // The link carries the mode (or daily number), your height and name, so a
  // friend gets the same level and a line to beat.
  function shareUrl(md, m, n) {
    const base = location.origin + location.pathname;
    const p = new URLSearchParams(md === 'daily' ? { daily: String(n) } : { mode: md });
    if (m) {
      p.set('beat', String(m));
      const name = nameInput.value.trim().slice(0, 20);
      if (name) p.set('from', name);
    }
    return `${base}?${p}`;
  }

  function shareText(md = mode, m = heightMeters(), u = state.unit, n = day.n) {
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const units = u ? ` That's ${unitPhrase(u)}. How many ${u.many} could you climb?` : ' Think you can do better?';
    const url = shareUrl(md, m, n);
    if (md === 'daily') return `Climb Guy #${n} 🧗 I climbed ${m} meters before my demise.${units} ${url}`;
    if (md === 'sprint') return `I climbed ${m} meters in 60 seconds on ${date}.${units} ⏱️ ${url}`;
    return `I climbed ${m} meters before my demise on ${date}.${units} 🧗 ${url}`;
  }

  // Native share sheet on phones; otherwise copy to the clipboard.
  async function share(text = shareText(), shareStatus = document.getElementById('share-status')) {
    shareStatus.textContent = '';
    Analytics.event(`share-${/^Climb Guy #/.test(text) ? 'daily' : mode}`);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(text);
      shareStatus.textContent = 'Copied! Paste it anywhere.';
    } catch {
      shareStatus.textContent = text; // last resort: show it to copy by hand
    }
  }

  document.getElementById('share-btn').addEventListener('click', () => share());
  document.getElementById('reroll-btn').addEventListener('click', () => {
    state.unit = pickUnit(heightMeters());
    shareStatus.textContent = '';
  });

  const learnActions = document.getElementById('learn-actions');
  document.getElementById('learn-retry').addEventListener('click', () => newGame());
  document.getElementById('learn-skip').addEventListener('click', () => finishTraining());
  function syncOverlay() {
    const showLearn = started && learn() && state.phase === 'over' && state.time - state.overAt > 0.6 && !Menu.isOpen();
    if (learnActions.hidden === showLearn) {
      learnActions.hidden = !showLearn;
      document.getElementById('learn-retry').hidden = !!state.trainingDone;
      document.getElementById('learn-skip').textContent = state.trainingDone ? "Play today's daily ›" : 'Skip to the daily ›';
      document.getElementById('learn-skip').className = state.trainingDone ? '' : 'learn-secondary';
    }
    const show = started && state.phase === 'over' && !state.missed && !learn() && !hook() && tunePanel.hidden && !Menu.isOpen();
    if (overActions.hidden === show) { // only touch the DOM when it changes
      overActions.hidden = !show;
      if (!show) shareStatus.textContent = '';
      overModes.hidden = daily();
    }
  }

  // ---------- Loop ----------
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (started && tunePanel.hidden && !Menu.isOpen() && !Feedback.isOpen() && !Tutorial.isOpen()) { // paused on the start screen and while the tuning panel or menu is open
      acc += elapsed;
      while (acc >= DT) {
        state.time += DT;
        if (state.phase !== 'over') {
          step(DT);
          generateHolds();
          spawnBalloons();
        }
        acc -= DT;
      }
      state.holds = state.holds.filter(h => h.y > state.water - 300);
      state.balloons = state.balloons.filter(b => b.y > state.water - 100 && !(b.popped && state.time - b.popped > 0.4));
    }
    checkSize();
    render();
    syncOverlay();
    requestAnimationFrame(frame);
  }

  // ---------- Tuning panel ----------
  const tunePanel = document.getElementById('tune');
  const tuneFields = document.getElementById('tune-fields');

  function buildTuning() {
    tuneFields.innerHTML = '';
    for (const [key, label, min, max, stepSize] of FIELDS) {
      const wrap = document.createElement('label');
      const val = document.createElement('span');
      val.textContent = T[key];
      wrap.textContent = label;
      wrap.appendChild(val);
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min, max, step: stepSize, value: T[key] });
      input.addEventListener('input', () => {
        T[key] = parseFloat(input.value);
        val.textContent = T[key];
        store.set('climber3.tuning', T);
      });
      tuneFields.append(wrap, input);
    }
  }

  document.getElementById('tune-btn').addEventListener('click', () => {
    buildTuning();
    tunePanel.hidden = !tunePanel.hidden;
  });
  document.getElementById('tune-close').addEventListener('click', () => { tunePanel.hidden = true; });
  document.getElementById('tune-reset').addEventListener('click', () => {
    Object.assign(T, DEFAULTS);
    store.set('climber3.tuning', T);
    buildTuning();
  });

  // ---------- Start screen ----------
  // The game waits, blurred, behind the start screen. Normally a tap starts
  // today's daily. Once it's done, the screen shows your result, a countdown
  // to the next one, and the other modes.
  let started = false;
  const startEl = document.getElementById('start');
  const $ = (id) => document.getElementById(id);
  const youVs = (c, m) => (m > c.m ? `You beat ${challengerPossessive().replace("Your friend's", "your friend's")} ${c.m} m by ${m - c.m} m!`
    : m === c.m ? `You tied ${challengerPossessive().replace("Your friend's", "your friend's")} ${c.m} m!`
    : `${challengerPossessive()} ${c.m} m beat you by ${c.m - m} m.`);
  let doneTimer = null;

  function renderStart() {
    const today = Daily.today();
    const result = daily() ? Progress.dailyResult(today.key) : null;
    const streak = Progress.dailyStreak(today.key);
    const c = CHALLENGE;
    startEl.classList.toggle('done', !!result);
    $('start-done').hidden = !result;
    $('start-tap').hidden = !!result;
    if (daily()) {
      $('start-day').textContent = `📅 Daily #${today.n} · ${today.label}`;
      const lines = [];
      if (!result && c) lines.push(`Beat ${challengerPossessive().replace("Your friend's", "your friend's")} ${c.m} m!`);
      if (!result && !c && PARAMS_CHALLENGE && PARAMS_CHALLENGE.mode === 'daily') {
        const pc = PARAMS_CHALLENGE;
        lines.push(`${pc.name || 'Your friend'} climbed ${pc.m} m on Daily #${pc.n}. Today's is a new climb.`);
      }
      if (streak >= 2) lines.push(`🔥 ${streak}-day streak${result ? '' : ': keep it going!'}`);
      $('start-line').textContent = lines.join('\n');
      if (result) {
        $('done-score').textContent = `✓ ${result.m} m`;
        $('done-vs').textContent = c ? youVs(c, result.m) : '';
        $('done-status').textContent = '';
        const tick = () => {
          if (Daily.today().key !== today.key) { clearInterval(doneTimer); doneTimer = null; newGame(); renderStart(); return; }
          $('done-next').textContent = `Next daily in ${Daily.countdown(Daily.msUntilNext())}`;
        };
        tick();
        if (!doneTimer) doneTimer = setInterval(tick, 1000);
      }
    } else {
      $('start-day').textContent = learn() ? '🎓 Training' : hook() ? '🪝 Grappler (prototype)' : sprint() ? '⏱️ Sprint: 60 seconds' : '🌊 Endless';
      $('start-line').textContent = learn() ? "Learn the moves one at a time,\nthen climb to the finish." : c ? `Beat ${challengerPossessive().replace("Your friend's", "your friend's")} ${c.m} m!`
        : modeBest() > 0 ? `Your best: ${modeBest()} m` : '';
    }
    if (!result && doneTimer) { clearInterval(doneTimer); doneTimer = null; }
    $('start-skip').hidden = !learn();
    $('start-tap').textContent = `${tapWord()} anywhere to start`;
  }

  function showStart() {
    started = false;
    startEl.hidden = false;
    startEl.classList.remove('gone');
    renderStart();
  }

  function begin(e) {
    if (started || startEl.classList.contains('done') || e.target.closest('button')) return;
    e.preventDefault();
    // Left the start screen open past midnight Eastern? Build the new day's level.
    if (daily() && Daily.today().key !== day.key) newGame();
    // Training opens with a short clip of the move.
    if (learn() && !state.training.climbing) Tutorial.playIntro(dismissStart);
    else dismissStart();
  }
  function dismissStart() {
    started = true;
    last = performance.now();
    startEl.classList.add('gone');
    setTimeout(() => { if (started) startEl.hidden = true; }, 450);
  }
  startEl.addEventListener('pointerdown', begin);
  startEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') begin(e); });

  function playMode(m) {
    // Leaving a daily mid-climb ends it: the daily is one run a day.
    if (daily() && state.phase === 'playing') gameOver();
    mode = m;
    if (m === 'learn') skillsDone = false; // from the menu: the whole tutorial
    else leaveTrainingUrl();
    skin = Progress.equipped();
    newGame();
    if (m === 'learn') Tutorial.playIntro(dismissStart);
    else dismissStart();
  }
  $('start-skip').addEventListener('click', () => { Analytics.event('learn-skipped'); finishTraining(); });
  for (const b of startEl.querySelectorAll('[data-mode]')) b.addEventListener('click', () => playMode(b.dataset.mode));
  $('done-share').addEventListener('click', () => {
    const today = Daily.today();
    const result = Progress.dailyResult(today.key);
    if (result) share(shareText('daily', result.m, pickUnit(result.m), today.n), $('done-status'));
  });

  // ---------- Menu (stats, passport, badges, customize, modes) ----------
  document.getElementById('menu-btn').addEventListener('click', () => Menu.open());
  document.getElementById('customize-btn').addEventListener('click', () => Menu.open('customize'));
  Menu.mode = () => (started ? mode : null);
  Menu.onMode = playMode;
  Menu.onClose = () => {
    skin = Progress.equipped();
    last = performance.now(); // don't fast-forward the time spent in the menu
  };

  // Details sent along with feedback, to help with bugs.
  Feedback.details = () => [
    `mode ${mode}`, `daily #${Daily.today().n}${Progress.dailyResult(Daily.today().key) ? ' (played)' : ''}`,
    `best ${Progress.best} m`, `dailies ${Progress.stats().totalRuns}`,
    `endless best ${Progress.endlessBest} m`, `sprint best ${Progress.sprintBest} m`,
    `screen ${innerWidth}x${innerHeight}@${devicePixelRatio}`, Controls.mouse ? 'mouse+keys' : 'touch', navigator.userAgent,
  ].join(' · ');

  // Read-only handle for debugging in the browser console.
  // Hook mode: where would a throw with velocity v from hand i catch? (for testing)
  function predictHook(i, v) {
    const s = shoulder(i), h = { state: 'flying', x: s.x, y: s.y, vx: v.vx, vy: v.vy, t: 0, launchY: s.y, fromHold: state.hands[i].state === 'held' ? state.hands[i].hold : null };
    for (let n = 0; n < 600 && !handFlightOver(h); n++) {
      const py = h.y;
      advanceHand(h, s, DT);
      const o = hookCollide(i, h, py, true);
      if (o) return o;
    }
    return null;
  }

  window.climber = { predictHook, get state() { return state; }, get mode() { return mode; }, T, power: (kind, hand = 0) => applyPower(kind, hand), shareText: () => shareText() };

  newGame();
  renderStart();
  startEl.focus();
  if (learn()) Analytics.event('learn-started');
  requestAnimationFrame(frame);
})();
