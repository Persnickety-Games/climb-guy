// Climber — two thumbs, two hands. Outclimb the rising water.
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
  const GAME_NAME = 'Two Thumbs Up';
  const SIDE_COLOR = ['#ff5fa8', '#ffd166']; // left: pink (reads well on the blue sky), right: yellow

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let cssW = 0, cssH = 0, dpr = 1, scale = 1, ox = 0, viewH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = Math.min(cssW / WORLD_W, cssH / 560);
    ox = (cssW - WORLD_W * scale) / 2;
    viewH = cssH / scale;
  }
  window.addEventListener('resize', resize);
  resize();

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

  // ---------- Game state ----------
  // Hand states: held | idle | flying | returning
  let state;

  function newGame() {
    const startHold = { x: 200, y: START_Y, w: 240, h: 20, color: '#6b5440' };
    const cam = START_Y - 120;
    state = {
      phase: 'ready',          // ready (opening drop) | playing | over
      overAt: 0,
      time: 0,
      // The climber drops in from the top of the screen; tap to catch a ledge.
      body: { x: 200, y: cam + viewH - 40, vx: 0, vy: 0 },
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
      dropping: true,          // slow fall until a hand catches something
      holdsTop: START_Y,
      water: -120,
      cam,
      baseY: START_Y,          // height 0 m; set to wherever you first catch on
      maxY: START_Y,
      badFromM: rand(...BAD_FROM_M), // where power-downs start this run
      best: store.get('climber2.best', 0),
      newBest: false,
      bestAtStart: store.get('climber2.best', 0),
      starsList: [],           // collectible stars { x, y, got }
      starCount: 0,
      popped: [],              // icons of balloons popped this run, for the share text
      birds: [],
      wind: { a: 0, target: 0, until: 0, next: 0 },
      windBits: [],            // streaks and leaves showing the wind
      confetti: [],
      banner: null,            // { text, sub, at, small }
      grinUntil: 0,
      flinging: false,
      screamed: false,
    };
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
    state.baseY = state.maxY = state.body.y;
    state.nextBalloonM = EARLY ? 3 : rand(...FIRST_BALLOON_M);
    state.nextMoverM = MOVERS_EARLY ? 2 : rand(...FIRST_MOVER_M);
    state.nextGhostM = GHOSTS_EARLY ? 2 : rand(...FIRST_GHOST_M);
    state.nextIcyM = ICY_EARLY ? 2 : rand(...FIRST_ICY_M);
    state.windFromM = WIND_EARLY ? 2 : rand(...FIRST_WIND_M);
    state.birdFromM = BIRDS_EARLY ? 2 : rand(...FIRST_BIRD_M);
    state.nextStarM = rand(8, 14);
    state.nextCheckpointM = CHECKPOINT_EVERY_M;
    state.nextMilestoneM = CHECKPOINT_EVERY_M;
    state.landmarkIdx = 0;
  }

  function letGo(i) {
    const h = state.hands[i];
    if (h.state !== 'held') return;
    h.state = 'returning';
    h.hold = null;
    h.autoHeld = false;
  }

  function holdUnder(h) {
    return state.holds.find(o => !o.broken && !o.ghost && circleHitsRect(h.x, h.y, HAND_R, o)) || null;
  }

  // ---------- Level generation ----------
  const HOLD_COLORS = ['#6b5440', '#5a6b48', '#4f5d73', '#7a5a5a', '#5e5470'];

  function generateHolds() {
    while (state.holdsTop < state.cam + viewH + T.armReach + 200) {
      // Difficulty 0..1, ramping gently over the first 500 m climbed.
      const d = clamp((state.holdsTop - state.baseY) / (FULL_DIFFICULTY_M * UNITS_PER_METER), 0, 1);
      const y = state.holdsTop + lerp(85, 155, d) * rand(0.75, 1.25);
      spawnRow(y, d);
      state.holdsTop = y;
    }
  }

  // Each row keeps at least one ledge within horizontal reach of the row below,
  // since a held hand limits how far the other can go.
  const MAX_ROW_SHIFT = 160;
  const FULL_DIFFICULTY_M = 500; // ledges keep thinning out and shrinking until here

  function spawnRow(y, d) {
    const count = Math.random() < lerp(0.55, 0.15, d) ? 2 : 1;
    const slotW = WORLD_W / count;
    const row = [];
    for (let i = 0; i < count; i++) {
      const tall = Math.random() < 0.15;
      const w = tall ? rand(16, 24) : lerp(140, 70, d) * rand(0.7, 1.3) / (count === 2 ? 1.4 : 1);
      const h = tall ? rand(50, 90) : rand(14, 22);
      const x = rand(slotW * i + w / 2 + 6, slotW * (i + 1) - w / 2 - 6);
      row.push({
        x, y: y + rand(-15, 15), w, h,
        color: HOLD_COLORS[(Math.random() * HOLD_COLORS.length) | 0],
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
      best.x += dir * (bestGap - MAX_ROW_SHIFT + rand(0, 40));
    }
    if (state.phase === 'ready' && y < state.body.y) centerForDrop(row);
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

  // The opening drop falls straight down the middle, so every row it passes
  // gets a ledge across the center: several easy chances to catch on.
  function centerForDrop(row) {
    const mid = WORLD_W / 2;
    const o = row.reduce((a, b) => (Math.abs(b.x - mid) < Math.abs(a.x - mid) ? b : a));
    o.w = Math.max(o.w, rand(110, 160));
    o.h = rand(16, 22);
    o.x = mid + rand(-o.w / 2 + 40, o.w / 2 - 40);
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
    return lerp(30, 8, k) * rand(0.7, 1.3);
  }

  function maybeMakeMover(row, y) {
    if (state.phase !== 'playing' || state.nextMoverM == null) return;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextMoverM) return;
    makeMover(row[(Math.random() * row.length) | 0]);
    state.nextMoverM = m + moverGapM(m);
  }

  // Slide back and forth along the long side, each with its own distance and pace.
  function makeMover(o) {
    const axis = o.w >= o.h ? 'x' : 'y';
    let amp = axis === 'x' ? rand(30, 110) : rand(25, 70);
    let base = o[axis];
    if (axis === 'x') {
      const room = (WORLD_W - o.w) / 2 - 6;
      amp = Math.min(amp, Math.max(room, 15));
      base = clamp(base, o.w / 2 + 6 + amp, WORLD_W - o.w / 2 - 6 - amp);
      if (!(base > 0)) base = WORLD_W / 2;
    }
    o.move = { axis, base, amp, speed: (Math.PI * 2) / rand(2.5, 5), phase: rand(0, Math.PI * 2) };
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
    return lerp(30, 10, k) * rand(0.7, 1.3);
  }

  function maybeAddGhost(row, y) {
    if (state.phase !== 'playing' || state.nextGhostM == null) return;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextGhostM) return;
    // Find a spot in this row that doesn't overlap a real ledge.
    const w = rand(55, 130), h = rand(14, 22);
    for (let tries = 0; tries < 12; tries++) {
      const x = rand(w / 2 + 6, WORLD_W - w / 2 - 6);
      if (row.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 12)) continue;
      state.holds.push({
        x, y: y + rand(-15, 15), w, h, ghost: true,
        color: HOLD_COLORS[(Math.random() * HOLD_COLORS.length) | 0],
      });
      state.nextGhostM = m + ghostGapM(m);
      return;
    }
    // No room in this row; try the next one.
  }

  // ---------- Checkpoints, icy ledges, stars, wind, birds ----------
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
  const STAR_R = 11;
  const BIRD_R = 16;

  const climbedM = () => (state.maxY - state.baseY) / UNITS_PER_METER;

  // A gap that starts at ~30 m and tightens to ~10 m over 500 m.
  const featureGapM = (m, from) => lerp(30, 10, clamp((m - from) / 500, 0, 1)) * rand(0.7, 1.3);

  // Every 100 m, a wide, sturdy golden ledge with a flag.
  function checkpointFor(y) {
    if (state.phase !== 'playing') return null;
    const m = (y - state.baseY) / UNITS_PER_METER;
    if (m < state.nextCheckpointM) return null;
    const cp = { x: WORLD_W / 2, y, w: 230, h: 24, color: '#c9a227', checkpoint: state.nextCheckpointM };
    state.nextCheckpointM += CHECKPOINT_EVERY_M;
    return cp;
  }

  // Icy ledges: a hand holding one slowly slides off the end.
  function maybeMakeIcy(row, y) {
    if (state.phase !== 'playing' || state.nextIcyM == null) return;
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

  // Stars to collect, placed off the safe route (near the walls or in open air).
  function spawnStars() {
    if (state.phase !== 'playing') return;
    while (state.baseY + state.nextStarM * UNITS_PER_METER < state.cam + viewH + 600) {
      const y = state.baseY + state.nextStarM * UNITS_PER_METER;
      let x = 0;
      for (let tries = 0; tries < 12; tries++) {
        x = Math.random() < 0.65 ? (Math.random() < 0.5 ? rand(22, 80) : rand(320, 378)) : rand(40, 360);
        if (!state.holds.some(o => Math.abs(o.y - y) < 50 && Math.abs(o.x - x) < o.w / 2 + 30)) break;
      }
      state.starsList.push({ x, y, got: 0 });
      state.nextStarM += rand(6, 12);
    }
  }

  function collectStars() {
    for (const st of state.starsList) {
      if (st.got) continue;
      if (state.hands.some(h => Math.hypot(h.x - st.x, h.y - st.y) < STAR_R + HAND_R)) {
        st.got = state.time;
        state.starCount++;
        sfx.star();
      }
    }
  }

  // Wind: gusts push thrown hands sideways. (The aim arc doesn't include the wind.)
  function stepWind(dt) {
    const w = state.wind;
    const m = climbedM();
    if (state.phase === 'playing' && m >= state.windFromM) {
      if (w.target === 0 && state.time >= w.next) {
        const k = clamp((m - state.windFromM) / 400, 0, 1);
        w.target = (Math.random() < 0.5 ? -1 : 1) * rand(250, 450) * (1 + k);
        w.until = state.time + rand(2.5, 4.5);
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
    if (state.phase === 'playing' && m >= state.birdFromM && state.time >= (state.nextBirdAt || 0)) {
      const k = clamp((m - state.birdFromM) / 400, 0, 1);
      const dir = Math.random() < 0.5 ? -1 : 1;
      state.birds.push({
        dir, x: dir > 0 ? -30 : WORLD_W + 30,
        y: state.cam + viewH * rand(0.35, 0.92), speed: rand(110, 190), phase: rand(0, 6.3),
      });
      state.nextBirdAt = state.time + lerp(12, 5, k) * rand(0.7, 1.3);
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
          burstConfetti(ox + b.x * scale, cssH - (b.y - state.cam) * scale, 10, ['#ddd', '#999', '#fff']);
        }
      }
    }
    state.birds = state.birds.filter(b => b.x > -60 && b.x < WORLD_W + 60);
  }

  // ---------- Celebrations ----------
  const PARAMS_CHALLENGE = (() => {
    const m = parseInt(PARAMS.get('beat'), 10);
    if (!(m > 0)) return null;
    const name = (PARAMS.get('from') || '').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 20);
    return { m, name };
  })();
  const CHALLENGE = PARAMS_CHALLENGE;
  const challengerName = () => (CHALLENGE.name ? CHALLENGE.name : 'your friend');
  const challengerPossessive = () => (CHALLENGE.name ? `${CHALLENGE.name}'s` : "Your friend's");

  // Real things you climb past, at their real heights.
  const LANDMARKS = [
    [5.5, '🦒', 'a giraffe'], [12, '🦕', 'a Brachiosaurus'], [21, '🎈', 'a hot air balloon'],
    [46, '🗽', 'the Statue of Liberty'], [84, '🌲', 'the biggest tree on Earth'], [96, '🕰️', 'Big Ben'],
    [108, '🦖', 'Godzilla'], [139, '🔺', 'the Great Pyramid'], [269, '🚢', 'the Titanic (on end)'],
    [330, '🗼', 'the Eiffel Tower'], [381, '🏙️', 'the Empire State Building'],
    [541, '🏢', 'One World Trade Center'], [828, '🌆', 'the Burj Khalifa'], [979, '💧', 'Angel Falls'],
  ];

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
    const m = climbedM();
    while (state.landmarkIdx < LANDMARKS.length && m >= LANDMARKS[state.landmarkIdx][0]) {
      const [, icon, name] = LANDMARKS[state.landmarkIdx++];
      celebrate(`${icon} Higher than ${name}!`, '', true);
    }
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
      state.grinUntil = state.time + 1.2;
      sfx.fling();
    } else if (state.flinging && body.vy < 200) {
      state.flinging = false;
    }
    if (holding) state.screamed = false;
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
    if (state.phase !== 'playing') return;
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
        kind, x: rand(60, WORLD_W - 60), y: state.baseY + m * UNITS_PER_METER, phase: rand(0, 6.3), popped: 0,
      });
      state.balloonCount = (state.balloonCount || 0) + 1;
      let next = m + rand(...(late ? BALLOON_GAP_LATE_M : BALLOON_GAP_M));
      if (!state.firstBadPlaced && next > state.badFromM) next = Math.max(state.badFromM, m + BALLOON_GAP_LATE_M[0]);
      state.nextBalloonM = next;
    }
  }

  function pickPower(allowed) {
    const pool = Object.keys(POWERS).filter(allowed);
    let r = Math.random() * pool.reduce((sum, k) => sum + POWERS[k].weight, 0);
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
    state.popped.push(POWERS[kind].icon);
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
    if (!tunePanel.hidden) return;
    e.preventDefault();
    if (state.phase === 'over') {
      if (state.time - state.overAt > 0.6) newGame();
      return;
    }
    if (state.rocket) return;
    const i = sideOf(e.clientX);
    if (state.thumbs[i]) return; // that side already has a thumb on it
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const thumb = { id: e.pointerId, mode: 'none', canAim: false, downAt: performance.now(), sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY };
    state.thumbs[i] = thumb;

    const h = state.hands[i];
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
    if (hold) {
      // Tap to grab: only works if the hand is over a ledge right now.
      grab(i, hold);
      if (h.autoHeld) return; // Auto-grab holds on for you
      thumb.mode = 'grip';
      thumb.canAim = atShoulder; // a quick flick from the shoulder can still turn this into a throw
    } else if (atShoulder) {
      thumb.mode = 'aim';
    }
    // Otherwise it's a missed grab: this thumb does nothing until lifted.
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
    e.preventDefault();
    const t = state.thumbs[i];
    state.thumbs[i] = null;
    if (state.phase === 'over') return;
    if (t.mode === 'grip') {
      letGo(i);
    } else if (t.mode === 'aim') {
      const v = throwVelocity(t);
      if (v) throwHand(i, v);
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
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
    // Auto-grab: holding is automatic, and the other hand lets go once this one
    // has hold of something new. A hand left auto-held after the timer ends also
    // lets go when the other hand grabs.
    h.autoHeld = auto || active('autoGrab');
    const j = 1 - i, other = state.hands[j];
    if (other.state === 'held' && (other.autoHeld || h.autoHeld)) {
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
    if (h.state !== 'idle' && h.state !== 'returning') return;
    const s = shoulder(i);
    Object.assign(h, { state: 'flying', x: s.x, y: s.y, vx: v.vx, vy: v.vy, t: 0, launchY: s.y });
    sfx.throw();
    h.autoTarget = active('autoGrab') ? autoGrabTarget(i, v) : null;
    startPlaying();
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

    // Hands.
    hands.forEach((h, i) => {
      const s = shoulder(i);
      if (h.state === 'flying') {
        advanceHand(h, s, dt);
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
    });

    if (state.phase === 'playing') {
      state.maxY = Math.max(state.maxY, body.y);
      popBalloons();
      collectStars();
      checkCrossings();
    }
    stepMood();
    stepWater(dt);

    // Camera follows the body, never dipping far below the water.
    // While dropping in it holds still until the climber nears the bottom.
    let target = Math.max(body.y - viewH * 0.4, state.water - 60);
    if (state.dropping) target = Math.max(Math.min(state.cam, body.y - viewH * 0.25), state.water - 60);
    state.cam += (target - state.cam) * (1 - Math.exp(-4 * dt));
  }

  function stepWater(dt) {
    if (state.phase === 'playing' && !active('freeze')) {
      const climbed = Math.max(0, state.maxY - state.baseY);
      let speed = T.waterSpeed + T.waterRamp * climbed / 1000;
      if (state.water < state.cam - 200) speed *= 4; // catch up if you're far ahead
      if (active('flood')) speed *= 1.25;
      state.water += speed * dt;
    }
    if (state.water >= state.body.y) gameOver();
  }

  function gameOver() {
    sfx.splash();
    state.phase = 'over';
    state.overAt = state.time;
    state.unit = pickUnit(heightMeters());
    const m = heightMeters();
    if (m > state.best) {
      state.best = m;
      state.newBest = true;
      store.set('climber2.best', m);
    }
  }

  // ---------- Rendering ----------
  function worldTransform() {
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * ox, dpr * cssH + dpr * scale * state.cam);
  }

  function screenTransform() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Sky by height: day, then dusk, then space.
  const SKY = [[0, [135, 197, 234]], [250, [95, 150, 205]], [450, [70, 60, 120]], [650, [14, 14, 34]]];
  function skyAt(m) {
    let i = 0;
    while (i < SKY.length - 2 && m > SKY[i + 1][0]) i++;
    const [m0, a] = SKY[i], [m1, b] = SKY[i + 1];
    const t = clamp((m - m0) / (m1 - m0), 0, 1);
    const c = a.map((v, k) => Math.round(lerp(v, b[k], t)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

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
    // Stars fade in as the sky darkens.
    const starA = clamp((camM - 380) / 250, 0, 1);
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
      for (const b of SKYLINE) {
        const top = ground - b.h * scale * 0.7;
        if (top > cssH) continue;
        ctx.fillStyle = 'rgba(30, 55, 90, 0.35)';
        ctx.fillRect(ox + b.x * scale, top, b.w * scale, ground - top + cssH);
        ctx.fillStyle = 'rgba(255, 230, 150, 0.25)';
        for (let wy = top + 8; wy < ground - 6; wy += 14) {
          for (let wx = 6; wx < b.w * scale - 6; wx += 12) {
            if (((wx * 7 + wy * 13 + b.lit * 100) | 0) % 5 === 0) ctx.fillRect(ox + b.x * scale + wx, wy, 4, 5);
          }
        }
      }
    }
    // Drifting clouds, thinning out toward space.
    const cloudA = 1 - clamp((camM - 450) / 200, 0, 1);
    if (cloudA > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * cloudA})`;
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
      for (const [m, icon, name] of LANDMARKS) {
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
      ctx.fillText(`${o.checkpoint} m`, ox + o.x * scale, yy - 6);
      ctx.textAlign = 'left';
    }
    worldTransform();
  }

  function drawStars() {
    screenTransform();
    for (const st of state.starsList) {
      const sx = ox + st.x * scale, sy = cssH - (st.y - state.cam) * scale;
      if (sy < -30 || sy > cssH + 30) continue;
      const k = st.got ? (state.time - st.got) / 0.4 : 0;
      const r = STAR_R * scale * (1 + k) * (1 + 0.08 * Math.sin(state.time * 5 + st.x));
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#ffe14d';
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        i ? ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr) : ctx.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
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
    for (let y = Math.ceil((state.cam - base) / step10) * step10 + base; y < state.cam + viewH; y += step10) {
      const sy = cssH - (y - state.cam) * scale;
      ctx.beginPath();
      ctx.moveTo(ox, sy); ctx.lineTo(ox + WORLD_W * scale, sy);
      ctx.stroke();
      ctx.fillText(`${Math.round((y - base) / UNITS_PER_METER)} m`, ox + 6, sy - 4);
    }

    // Faint divider between the two thumb zones.
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.moveTo(cssW / 2, 0); ctx.lineTo(cssW / 2, cssH); ctx.stroke();
    ctx.setLineDash([]);

    worldTransform();

    for (const h of state.holds) {
      if (h.y + h.h < state.cam - 50 || h.y - h.h > state.cam + viewH + 50) continue;
      drawLedge(h);
    }

    drawMarkers();
    drawBalloons();
    drawStars();
    drawBirds();
    drawAimArcs();
    drawClimber();
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
    if (h.ghost) {
      // Faint fill and a dotted outline: obvious if you look, easy to miss in a hurry.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = h.color;
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
    ctx.fillStyle = h.color;
    roundRect(x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
    ctx.fill();
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
      ctx.fillStyle = SIDE_COLOR[i];
      ctx.globalAlpha = 0.8;
      for (let n = 0; n < 600 && !handFlightOver(h); n++) {
        advanceHand(h, s, DT);
        if (n % 7) continue;
        ctx.beginPath(); ctx.arc(h.x, h.y, 2.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
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

  function drawClimber() {
    const { body, hands } = state;

    ctx.lineCap = 'round';
    hands.forEach((h, i) => {
      const s = shoulder(i);
      const len = Math.hypot(h.x - s.x, h.y - s.y);
      ctx.strokeStyle = SIDE_COLOR[i];
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

    ctx.fillStyle = '#e8873a';
    ctx.beginPath(); ctx.arc(body.x, body.y, BODY_R, 0, Math.PI * 2); ctx.fill();

    // Eyes follow a flying hand, else look up; they go wide when falling.
    const fly = hands.find(h => h.state === 'flying');
    const lx = fly ? fly.x - body.x : 0, ly = fly ? fly.y - body.y : 1;
    const ll = Math.hypot(lx, ly) || 1;
    const falling = !hands.some(h => h.state === 'held');
    for (const ex of [-6, 6]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(body.x + ex, body.y + 4, falling ? 5.5 : 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath(); ctx.arc(body.x + ex + (lx / ll) * 2, body.y + 4 + (ly / ll) * 2, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    drawFace(body, falling);

    hands.forEach((h, i) => {
      ctx.fillStyle = SIDE_COLOR[i];
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
  function drawFace(body, falling) {
    const bx = body.x, by = body.y;
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
    ctx.fillStyle = frozen ? 'rgba(200, 235, 255, 0.88)' : flood ? 'rgba(20, 80, 160, 0.8)' : 'rgba(30, 110, 200, 0.72)';
    ctx.beginPath();
    ctx.moveTo(-500, bottom);
    for (let x = -500; x <= WORLD_W + 500; x += 10) {
      ctx.lineTo(x, top + Math.sin(x * 0.05 + state.time * waveSpeed) * wave);
    }
    ctx.lineTo(WORLD_W + 500, bottom);
    ctx.closePath();
    ctx.fill();
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
      ctx.fillStyle = SIDE_COLOR[i];
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
      if (!t) return;
      ctx.strokeStyle = SIDE_COLOR[i];
      ctx.fillStyle = SIDE_COLOR[i];
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

  function drawHud() {
    const top = 16;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    const mText = `${heightMeters()} m`;
    ctx.fillText(mText, ox + 14, top + 26);
    if (state.starCount) {
      const w = ctx.measureText(mText).width;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(`⭐ ${state.starCount}`, ox + 24 + w, top + 25);
    }
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`Best ${state.best} m`, ox + 14, top + 46);
    drawEffects(top + 60);
    drawToast();

    ctx.textAlign = 'center';
    const cx = ox + (WORLD_W * scale) / 2;
    if (state.phase === 'ready') {
      const by = cssH * 0.86;
      [LEFT, RIGHT].forEach((i) => {
        const hx = i === LEFT ? cssW * 0.25 : cssW * 0.75;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRect(hx - cssW * 0.23, by, cssW * 0.46, 64, 12);
        ctx.fill();
        ctx.fillStyle = SIDE_COLOR[i];
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText('TAP to grab', hx, by + 26);
        ctx.fillStyle = '#fff';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('then keep holding', hx, by + 46);
      });
    } else if (state.phase === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#fff';
      const y0 = cssH * 0.3;
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText('Splash!', cx, y0);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`${heightMeters()} m${state.starCount ? `  ·  ⭐ ${state.starCount}` : ''}`, cx, y0 + 40);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = state.newBest ? '#ffd27a' : 'rgba(255,255,255,0.8)';
      ctx.fillText(state.newBest ? 'New best!' : `Best ${state.best} m`, cx, y0 + 68);
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
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Tap anywhere to climb again', cx, y0 + 290);
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
        ctx.fillStyle = SIDE_COLOR[hand];
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

  // The link carries your height (and name) so a friend gets a line to beat.
  function shareUrl() {
    const base = location.origin + location.pathname;
    const m = heightMeters();
    if (!m) return base;
    const p = new URLSearchParams({ beat: String(m) });
    const name = nameInput.value.trim().slice(0, 20);
    if (name) p.set('from', name);
    return `${base}?${p}`;
  }

  // Wordle-style summary of the run: height, stars, balloons popped, then the water.
  function runSummary() {
    const parts = [`🧗 ${heightMeters()} m`];
    if (state.starCount) parts.push(`⭐ ${state.starCount}`);
    if (state.popped.length) parts.push(state.popped.slice(0, 12).join(''));
    parts.push('🌊');
    return parts.join(' · ');
  }

  function shareText() {
    const m = heightMeters();
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const u = state.unit;
    const units = u ? ` That's ${unitPhrase(u)}. How many ${u.many} could you climb?` : ' Think you can do better?';
    return `I climbed ${m} meters before my demise on ${date}.${units}\n${runSummary()}\n${GAME_NAME} 👍👍 ${shareUrl()}`;
  }

  // Native share sheet on phones; otherwise copy to the clipboard.
  async function share() {
    const text = shareText();
    shareStatus.textContent = '';
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

  document.getElementById('share-btn').addEventListener('click', share);
  document.getElementById('reroll-btn').addEventListener('click', () => {
    state.unit = pickUnit(heightMeters());
    shareStatus.textContent = '';
  });

  function syncOverlay() {
    const show = state.phase === 'over' && tunePanel.hidden;
    if (overActions.hidden === show) { // only touch the DOM when it changes
      overActions.hidden = !show;
      if (!show) shareStatus.textContent = '';
    }
  }

  // ---------- Loop ----------
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (tunePanel.hidden) {
      acc += elapsed;
      while (acc >= DT) {
        state.time += DT;
        if (state.phase !== 'over') {
          step(DT);
          generateHolds();
          spawnBalloons();
          spawnStars();
        }
        acc -= DT;
      }
      state.holds = state.holds.filter(h => h.y > state.water - 300);
      state.balloons = state.balloons.filter(b => b.y > state.water - 100 && !(b.popped && state.time - b.popped > 0.4));
      state.starsList = state.starsList.filter(st => st.y > state.water - 100 && !(st.got && state.time - st.got > 0.4));
    }
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

  // ---------- Sound toggle ----------
  const muteBtn = document.getElementById('mute-btn');
  const syncMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; };
  syncMute();
  muteBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.setMuted(!sfx.muted);
    syncMute();
  });

  // Read-only handle for debugging in the browser console.
  window.climber = { get state() { return state; }, T, power: (kind, hand = 0) => applyPower(kind, hand), shareText: () => shareText() };

  newGame();
  requestAnimationFrame(frame);
})();
