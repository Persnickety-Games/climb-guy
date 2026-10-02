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
    maybeMakeMover(row, y);
    maybeAddGhost(row, y);
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
  const BREAK_SECS = 3;                  // hold time before a breakaway ledge crumbles
  const ROCKET_M = 100;
  const ROCKET_SPEED = 1400;

  const POWERS = {
    autoGrab:      { good: true,  weight: 3,   icon: '🎯', name: 'Auto-grab',     text: 'Throws grab the highest ledge they hit' },
    swollen:       { good: true,  weight: 3,   icon: '🔍', name: 'Swollen',       text: 'Ledges grow 25% bigger' },
    freeze:        { good: true,  weight: 3,   icon: '❄️', name: 'Freeze',        text: 'The water stops rising' },
    rocket:        { good: true,  weight: 0.5, icon: '🚀', name: 'Rocket',        text: `Blast off ${ROCKET_M} m, then catch a ledge` },
    butterfingers: { good: false, weight: 2,   icon: '🧈', name: 'Butterfingers', text: 'Both hands let go!' },
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
    state.toast = { kind, at: state.time };
    if (kind === 'butterfingers') dropEverything();
    else if (kind === 'rocket') startRocket();
    else if (kind === 'ouch') state.effects[`ouch:${hand}`] = state.time + OUCH_SECS;
    else state.effects[kind] = state.time + EFFECT_SECS;
    if (kind === 'swollen') {
      // Everything already on screen grows now; new arrivals grow as they appear.
      for (const o of state.holds) if (o.seen) swell(o);
    }
  }

  // Both hands let go, and thumbs already down stop doing anything until lifted.
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
      if (active('breakaway') && !o.ghost) { o.breakable = true; o.heldFor = 0; }
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
    if (h.state === 'held' && h.autoHeld) {
      // An auto-grabbed hand: thumb down takes over the grip (lift to let go, drag to throw).
      h.autoHeld = false;
      thumb.mode = 'grip';
      thumb.canAim = true;
      return;
    }
    const atShoulder = h.state === 'idle' || h.state === 'returning';
    const hold = hurt(i) ? null : holdUnder(h);
    if (hold) {
      // Tap to grab: only works if the hand is over a ledge right now.
      grab(i, hold);
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

  function grab(i, hold) {
    const h = state.hands[i];
    h.state = 'held';
    h.x = clamp(h.x, hold.x - hold.w / 2, hold.x + hold.w / 2);
    h.y = clamp(h.y, hold.y - hold.h / 2, hold.y + hold.h / 2);
    h.vx = h.vy = 0;
    h.hold = hold;
    h.autoHeld = false;
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
          grab(i, o); // auto-grab holds on by itself until that thumb touches down
          h.autoHeld = true;
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
    }
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
    state.phase = 'over';
    state.overAt = state.time;
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

  function skyColor(t) {
    const a = [135, 197, 234], b = [26, 35, 80];
    const c = a.map((v, i) => Math.round(lerp(v, b[i], t)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  function render() {
    screenTransform();
    ctx.fillStyle = '#0b1d2e';
    ctx.fillRect(0, 0, cssW, cssH);

    const t = clamp(state.cam / 12000, 0, 1);
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, skyColor(clamp(t + 0.08, 0, 1)));
    grad.addColorStop(1, skyColor(t));
    ctx.fillStyle = grad;
    ctx.fillRect(ox, 0, WORLD_W * scale, cssH);

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

    drawBalloons();
    drawAimArcs();
    drawClimber();
    drawWater();

    screenTransform();
    drawOffscreenHands();
    drawThumbs();
    drawHud();
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
    ctx.fillText(`${heightMeters()} m`, ox + 14, top + 26);
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
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillText('Splash!', cx, cssH * 0.4);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`${heightMeters()} m`, cx, cssH * 0.4 + 40);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = state.newBest ? '#ffd27a' : 'rgba(255,255,255,0.8)';
      ctx.fillText(state.newBest ? 'New best!' : `Best ${state.best} m`, cx, cssH * 0.4 + 68);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Tap to climb again', cx, cssH * 0.4 + 110);
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
        }
        acc -= DT;
      }
      state.holds = state.holds.filter(h => h.y > state.water - 300);
      state.balloons = state.balloons.filter(b => b.y > state.water - 100 && !(b.popped && state.time - b.popped > 0.4));
    }
    render();
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

  // Read-only handle for debugging in the browser console.
  window.climber = { get state() { return state; }, T, power: (kind, hand = 0) => applyPower(kind, hand) };

  newGame();
  requestAnimationFrame(frame);
})();
