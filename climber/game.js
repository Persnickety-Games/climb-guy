// Climber — two thumbs, two hands. Outclimb the rising water.
//
// Controls (touch, two thumbs):
//   Left half of the screen = left hand, right half = right hand.
//   - Drag down and release to throw a free hand (slingshot).
//   - Tap while a hand is over a ledge to grab it, and KEEP HOLDING.
//   - Lift that thumb and the hand lets go.
// A held arm is elastic: let go with the lower hand and the upper arm flings you up.
//
// World units: the play area is 400 units wide; y points UP (height).

(() => {
  'use strict';

  // ---------- Tuning (editable live via the ⚙ panel) ----------
  const DEFAULTS = {
    launchPower: 950,   // hand throw speed at full drag
    maxDrag: 150,       // drag distance (world units) for full power
    handGravity: 1500,  // gravity on a thrown hand
    armReach: 250,      // max arm length — a held hand limits how far you can go
    armStiffness: 38,   // how hard a stretched arm yanks the body
    armDamping: 2.5,    // how quickly the yank settles
    armRest: 34,        // relaxed arm length
    bodyGravity: 1300,  // gravity on the body
    introFall: 260,     // max fall speed during the opening drop
    waterSpeed: 18,     // starting water rise speed
    waterRamp: 4,       // extra water speed per 1000 units climbed
  };

  const FIELDS = [
    ['launchPower', 'Throw power', 400, 1600, 10],
    ['maxDrag', 'Drag for full power', 60, 300, 5],
    ['handGravity', 'Hand gravity', 500, 3000, 50],
    ['armReach', 'Arm reach', 120, 400, 5],
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

  const T = Object.assign({}, DEFAULTS, store.get('climber2.tuning', {}));

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
  const LEFT = 0, RIGHT = 1;
  const SIDE_COLOR = ['#5ec8f2', '#ffd166'];

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
      holdsTop: START_Y,
      water: -120,
      cam,
      baseY: START_Y,          // height 0 m; set to wherever you first catch on
      maxY: START_Y,
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
  }

  function letGo(i) {
    const h = state.hands[i];
    if (h.state !== 'held') return;
    h.state = 'returning';
  }

  function holdUnder(h) {
    return state.holds.find(o => circleHitsRect(h.x, h.y, HAND_R, o)) || null;
  }

  // ---------- Level generation ----------
  const HOLD_COLORS = ['#6b5440', '#5a6b48', '#4f5d73', '#7a5a5a', '#5e5470'];

  function generateHolds() {
    while (state.holdsTop < state.cam + viewH + 400) {
      const d = clamp(state.holdsTop / 8000, 0, 1); // difficulty 0..1
      const y = state.holdsTop + lerp(85, 155, d) * rand(0.75, 1.25);
      spawnRow(y, d);
      state.holdsTop = y;
    }
  }

  // Each row keeps at least one ledge within horizontal reach of the row below,
  // since a held hand limits how far the other can go.
  const MAX_ROW_SHIFT = 160;

  function spawnRow(y, d) {
    const count = Math.random() < lerp(0.55, 0.15, d) ? 2 : 1;
    const slotW = WORLD_W / count;
    const row = [];
    for (let i = 0; i < count; i++) {
      const tall = Math.random() < 0.15;
      const w = tall ? rand(16, 24) : lerp(140, 45, d) * rand(0.7, 1.3) / (count === 2 ? 1.4 : 1);
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
    state.holds.push(...row);
    state.lastRow = row;
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
    const i = sideOf(e.clientX);
    if (state.thumbs[i]) return; // that side already has a thumb on it
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const thumb = { id: e.pointerId, mode: 'none', canAim: false, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY };
    state.thumbs[i] = thumb;

    const h = state.hands[i];
    const atShoulder = h.state === 'idle' || h.state === 'returning';
    const hold = holdUnder(h);
    if (hold) {
      // Tap to grab: only works if the hand is over a ledge right now.
      grab(i, hold);
      thumb.mode = 'grip';
      thumb.canAim = atShoulder; // a hand at the shoulder can still turn this into a throw
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
    if (t.canAim && Math.hypot(t.cx - t.sx, t.cy - t.sy) > DRAG_START_PX) {
      // Dragging, not holding: drop the grab and aim a throw instead.
      t.canAim = false;
      t.mode = 'aim';
      state.hands[i].state = 'idle';
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
    return (h.vy < 0 && h.y < h.launchY - 10) || h.t > 2.5;
  }

  function step(dt) {
    const { body, hands } = state;

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
      const f = T.armStiffness * (dist - T.armRest) - T.armDamping * radialV * 3;
      ax += nx * f;
      ay += ny * f;
    });
    body.vx += ax * dt;
    body.vy += ay * dt;
    body.vx *= Math.exp(-0.4 * dt); // light air drag
    body.vy *= Math.exp(-0.4 * dt);
    if (state.phase === 'ready') body.vy = Math.max(body.vy, -T.introFall);
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
        if (handFlightOver(h)) h.state = 'returning';
      } else if (h.state === 'returning') {
        const k = 1 - Math.exp(-22 * dt);
        h.x += (s.x - h.x) * k;
        h.y += (s.y - h.y) * k;
        if (Math.hypot(s.x - h.x, s.y - h.y) < 4) h.state = 'idle';
      }
      if (h.state === 'idle') placeIdle(i);
    });

    if (state.phase === 'playing') state.maxY = Math.max(state.maxY, body.y);

    // Water.
    if (state.phase === 'ready' && state.water >= body.y) gameOver(); // missed every ledge
    if (state.phase === 'playing') {
      const climbed = Math.max(0, state.maxY - state.baseY);
      let speed = T.waterSpeed + T.waterRamp * climbed / 1000;
      if (state.water < state.cam - 200) speed *= 4; // catch up if you're far ahead
      state.water += speed * dt;
      if (state.water >= body.y) gameOver();
    }

    // Camera follows the body, never dipping far below the water.
    // During the opening drop it holds still until the climber nears the bottom.
    let target = Math.max(body.y - viewH * 0.4, state.water - 60);
    if (state.phase === 'ready') target = Math.max(Math.min(state.cam, body.y - viewH * 0.25), state.water - 60);
    state.cam += (target - state.cam) * (1 - Math.exp(-4 * dt));
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
      ctx.fillStyle = h.color;
      roundRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(h.x - h.w / 2 + 2, h.y + h.h / 2 - 4, h.w - 4, 2);
    }

    drawAimArcs();
    drawClimber();
    drawWater();

    screenTransform();
    drawThumbs();
    drawHud();
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
      ctx.globalAlpha = 0.45;
      for (let n = 0; n < 300 && !handFlightOver(h); n++) {
        advanceHand(h, s, DT);
        if (n % 7) continue;
        ctx.beginPath(); ctx.arc(h.x, h.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
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
    });
  }

  function drawWater() {
    const top = state.water;
    const bottom = state.cam - 50;
    if (top < bottom) return;
    ctx.fillStyle = 'rgba(30, 110, 200, 0.72)';
    ctx.beginPath();
    ctx.moveTo(-500, bottom);
    for (let x = -500; x <= WORLD_W + 500; x += 10) {
      ctx.lineTo(x, top + Math.sin(x * 0.05 + state.time * 3) * 3);
    }
    ctx.lineTo(WORLD_W + 500, bottom);
    ctx.closePath();
    ctx.fill();
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
        }
        acc -= DT;
      }
      state.holds = state.holds.filter(h => h.y > state.water - 300);
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
        store.set('climber2.tuning', T);
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
    store.set('climber2.tuning', T);
    buildTuning();
  });

  // Read-only handle for debugging in the browser console.
  window.climber = { get state() { return state; }, T };

  newGame();
  requestAnimationFrame(frame);
})();
