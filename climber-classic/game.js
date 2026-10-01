// Climber — slingshot your hands up the screen before the water catches you.
//
// World units: the play area is 400 units wide; y points UP (height).
// The canvas transform maps world -> screen, so all physics uses world units.

(() => {
  'use strict';

  // ---------- Tuning (editable live via the ⚙ panel) ----------
  const DEFAULTS = {
    launchPower: 950,   // hand launch speed at full drag
    maxDrag: 150,       // drag distance (world units) for full power
    handGravity: 1500,  // gravity on a flying hand
    grabWindow: 330,    // hand can grab while |vertical speed| < this (i.e. near the apex)
    armStiffness: 38,   // how hard a stretched arm yanks the body
    armDamping: 2.5,    // how quickly the yank settles
    armRest: 34,        // relaxed arm length
    bodyGravity: 1300,  // gravity on the body
    waterSpeed: 22,     // starting water rise speed
    waterRamp: 4,       // extra water speed per 1000 units climbed
  };

  const FIELDS = [
    ['launchPower', 'Launch power', 400, 1600, 10],
    ['maxDrag', 'Drag for full power', 60, 300, 5],
    ['handGravity', 'Hand gravity', 500, 3000, 50],
    ['grabWindow', 'Grab window (apex)', 50, 1000, 10],
    ['armStiffness', 'Arm springiness', 5, 120, 1],
    ['armDamping', 'Arm damping', 0, 10, 0.1],
    ['armRest', 'Arm length', 15, 80, 1],
    ['bodyGravity', 'Body gravity', 300, 3000, 50],
    ['waterSpeed', 'Water speed', 0, 120, 1],
    ['waterRamp', 'Water speed-up', 0, 30, 0.5],
  ];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const T = Object.assign({}, DEFAULTS, store.get('climber.tuning', {}));

  // ---------- Constants ----------
  const WORLD_W = 400;
  const BODY_R = 16;
  const HAND_R = 8;
  const SHOULDER_X = 13;
  const SHOULDER_Y = 5;
  const UNITS_PER_METER = 40;
  const START_Y = 160;
  const DT = 1 / 120;

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
  let state;

  function newGame() {
    const startHold = { x: 200, y: START_Y, w: 240, h: 20, color: '#6b5440' };
    state = {
      phase: 'ready',          // ready | playing | over
      overAt: 0,
      time: 0,
      body: { x: 190, y: START_Y - T.armRest - 8, vx: 0, vy: 0 },
      hands: [
        { state: 'held', x: 186, y: START_Y, vx: 0, vy: 0 },
        { state: 'idle', x: 0, y: 0, vx: 0, vy: 0 },
      ],
      grip: 0,                 // index of the gripping hand
      holds: [startHold],
      holdsTop: START_Y,
      water: -120,
      cam: START_Y - 300,
      maxY: START_Y,
      drag: null,              // { sx, sy, cx, cy } in CSS pixels
      best: store.get('climber.best', 0),
      newBest: false,
    };
    placeIdleHand();
    generateHolds();
  }

  function heightMeters() {
    return Math.max(0, Math.floor((state.maxY - START_Y) / UNITS_PER_METER));
  }

  function shoulder(i) {
    const side = i === 0 ? -1 : 1;
    return { x: state.body.x + side * SHOULDER_X, y: state.body.y + SHOULDER_Y };
  }

  function placeIdleHand() {
    const i = 1 - state.grip;
    const s = shoulder(i);
    const side = i === 0 ? -1 : 1;
    state.hands[i].x = s.x + side * 8;
    state.hands[i].y = s.y - 14;
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

  function spawnRow(y, d) {
    const count = Math.random() < lerp(0.55, 0.15, d) ? 2 : 1;
    const slotW = WORLD_W / count;
    for (let i = 0; i < count; i++) {
      const tall = Math.random() < 0.15;
      const w = tall ? rand(16, 24) : lerp(140, 45, d) * rand(0.7, 1.3) / (count === 2 ? 1.4 : 1);
      const h = tall ? rand(50, 90) : rand(14, 22);
      const x = rand(slotW * i + w / 2 + 6, slotW * (i + 1) - w / 2 - 6);
      state.holds.push({
        x, y: y + rand(-15, 15), w, h,
        color: HOLD_COLORS[(Math.random() * HOLD_COLORS.length) | 0],
      });
    }
  }

  // ---------- Input ----------
  function onDown(e) {
    if (!tunePanel.hidden) return;
    e.preventDefault();
    if (state.phase === 'over') {
      if (state.time - state.overAt > 0.6) newGame();
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    state.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY };
  }

  function onMove(e) {
    const d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    d.cx = e.clientX;
    d.cy = e.clientY;
  }

  function onUp(e) {
    const d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    state.drag = null;
    const v = launchVelocity(d);
    if (v) launch(v);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { state.drag = null; });

  // Slingshot: hand flies opposite to the drag, speed scales with drag length.
  function launchVelocity(d) {
    const dx = (d.cx - d.sx) / scale;
    const dy = (d.cy - d.sy) / scale;     // screen y points down
    const len = Math.hypot(dx, dy);
    if (len < 10) return null;
    const power = Math.min(len, T.maxDrag) / T.maxDrag;
    const speed = T.launchPower * power;
    return { vx: (-dx / len) * speed, vy: (dy / len) * speed };
  }

  function launch(v) {
    const i = 1 - state.grip;
    const hand = state.hands[i];
    if (hand.state === 'flying') return;
    const s = shoulder(i);
    hand.state = 'flying';
    hand.x = s.x; hand.y = s.y;
    hand.vx = v.vx; hand.vy = v.vy;
    if (state.phase === 'ready') state.phase = 'playing';
  }

  // ---------- Simulation ----------
  // Hand flight is shared by the real throw and the aiming preview,
  // so the target marker always matches where the hand will actually grab.
  function advanceHand(h, dt) {
    h.vy -= T.handGravity * dt;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    if (h.x < HAND_R) { h.x = HAND_R; h.vx = Math.abs(h.vx) * 0.4; }
    if (h.x > WORLD_W - HAND_R) { h.x = WORLD_W - HAND_R; h.vx = -Math.abs(h.vx) * 0.4; }
  }

  function grabbableHold(h) {
    if (Math.abs(h.vy) > T.grabWindow) return null;
    return state.holds.find(o => circleHitsRect(h.x, h.y, HAND_R, o)) || null;
  }

  // Simulate a throw: returns the arc points and where it ends (grab or miss).
  function predictThrow(x, y, vx, vy) {
    const h = { x, y, vx, vy };
    const points = [];
    let apex = null;
    for (let n = 0; n < 600; n++) {
      advanceHand(h, DT);
      points.push({ x: h.x, y: h.y, inWindow: Math.abs(h.vy) <= T.grabWindow });
      if (!apex && h.vy <= 0) apex = { x: h.x, y: h.y };
      const hold = grabbableHold(h);
      if (hold) return { points, hit: true, x: h.x, y: h.y };
      if (h.vy < -T.grabWindow) break;
    }
    const end = apex || points[points.length - 1];
    return { points, hit: false, x: end.x, y: end.y };
  }

  function step(dt) {
    const { body, hands } = state;

    // Body: gravity + elastic arm to the gripping hand (only pulls when stretched).
    const g = hands[state.grip];
    let ax = 0, ay = -T.bodyGravity;
    const dx = g.x - body.x, dy = g.y - (body.y + SHOULDER_Y);
    const dist = Math.hypot(dx, dy);
    if (dist > T.armRest) {
      const nx = dx / dist, ny = dy / dist;
      const stretch = dist - T.armRest;
      const radialV = body.vx * nx + body.vy * ny;
      const f = T.armStiffness * stretch - T.armDamping * radialV * 3;
      ax += nx * f;
      ay += ny * f;
    }
    body.vx += ax * dt;
    body.vy += ay * dt;
    body.vx *= Math.exp(-0.4 * dt); // light air drag
    body.vy *= Math.exp(-0.4 * dt);
    body.x += body.vx * dt;
    body.y += body.vy * dt;

    if (body.x < BODY_R) { body.x = BODY_R; body.vx = Math.abs(body.vx) * 0.5; }
    if (body.x > WORLD_W - BODY_R) { body.x = WORLD_W - BODY_R; body.vx = -Math.abs(body.vx) * 0.5; }

    // Free hand.
    const fi = 1 - state.grip;
    const f = hands[fi];
    if (f.state === 'flying') {
      advanceHand(f, dt);
      const hold = grabbableHold(f);
      if (hold) {
        f.state = 'held';
        f.x = clamp(f.x, hold.x - hold.w / 2, hold.x + hold.w / 2);
        f.y = clamp(f.y, hold.y - hold.h / 2, hold.y + hold.h / 2);
        f.vx = f.vy = 0;
        hands[state.grip].state = 'returning';
        state.grip = fi;
      } else if (f.vy < -T.grabWindow) {
        f.state = 'returning'; // missed — past the apex window
      }
    }

    // Any returning hand snaps back to its shoulder.
    hands.forEach((h, i) => {
      if (h.state !== 'returning') return;
      const s = shoulder(i);
      const k = 1 - Math.exp(-22 * dt);
      h.x += (s.x - h.x) * k;
      h.y += (s.y - h.y) * k;
      if (Math.hypot(s.x - h.x, s.y - h.y) < 4) h.state = 'idle';
    });
    hands.forEach((h, i) => {
      if (h.state !== 'idle') return;
      const s = shoulder(i);
      const side = i === 0 ? -1 : 1;
      h.x = s.x + side * 8;
      h.y = s.y - 14;
    });

    state.maxY = Math.max(state.maxY, body.y);

    // Water.
    if (state.phase === 'playing') {
      const climbed = Math.max(0, state.maxY - START_Y);
      let speed = T.waterSpeed + T.waterRamp * climbed / 1000;
      if (state.water < state.cam - 200) speed *= 4; // catch up if you're far ahead
      state.water += speed * dt;
      if (state.water >= body.y) gameOver();
    }

    // Camera follows the body, never dipping far below the water.
    const target = Math.max(body.y - viewH * 0.4, state.water - 60);
    state.cam += (target - state.cam) * (1 - Math.exp(-4 * dt));
  }

  function gameOver() {
    state.phase = 'over';
    state.overAt = state.time;
    state.drag = null;
    const m = heightMeters();
    if (m > state.best) {
      state.best = m;
      state.newBest = true;
      store.set('climber.best', m);
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
    // t: 0 (ground) .. 1 (very high)
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

    // Sky over the play column.
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
    for (let y = Math.ceil((state.cam - START_Y) / step10) * step10 + START_Y; y < state.cam + viewH; y += step10) {
      const sy = cssH - (y - state.cam) * scale;
      ctx.beginPath();
      ctx.moveTo(ox, sy); ctx.lineTo(ox + WORLD_W * scale, sy);
      ctx.stroke();
      ctx.fillText(`${Math.round((y - START_Y) / UNITS_PER_METER)} m`, ox + 6, sy - 4);
    }

    worldTransform();

    // Holds.
    for (const h of state.holds) {
      if (h.y + h.h < state.cam - 50 || h.y - h.h > state.cam + viewH + 50) continue;
      ctx.fillStyle = h.color;
      roundRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(h.x - h.w / 2 + 2, h.y + h.h / 2 - 4, h.w - 4, 2);
    }

    drawPreview();
    drawClimber();
    drawWater();

    screenTransform();
    drawDragIndicator();
    drawHud();
  }

  function drawPreview() {
    const d = state.drag;
    if (!d || state.phase === 'over') return;
    const v = launchVelocity(d);
    if (!v) return;
    const s = shoulder(1 - state.grip);
    const p = predictThrow(s.x, s.y, v.vx, v.vy);

    // Faint arc.
    p.points.forEach((pt, n) => {
      if (n % 6) return;
      ctx.fillStyle = pt.inWindow ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.inWindow ? 2.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    });

    drawTarget(p.x, p.y, p.hit);
  }

  // Crosshair: solid green where the hand will grab, dashed red when it will miss.
  function drawTarget(x, y, hit) {
    const r = HAND_R + 7;
    const pulse = hit ? 1 + Math.sin(state.time * 10) * 0.08 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = hit ? '#5dff8a' : 'rgba(255, 110, 110, 0.85)';
    ctx.lineWidth = hit ? 3 : 2;
    if (!hit) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(ax * (r - 4), ay * (r - 4));
      ctx.lineTo(ax * (r + 6), ay * (r + 6));
    }
    ctx.stroke();
    if (hit) {
      ctx.fillStyle = '#5dff8a';
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawClimber() {
    const { body, hands } = state;

    // Arms.
    ctx.lineCap = 'round';
    hands.forEach((h, i) => {
      const s = shoulder(i);
      const len = Math.hypot(h.x - s.x, h.y - s.y);
      ctx.strokeStyle = '#f0a65a';
      ctx.lineWidth = clamp(8 - len * 0.02, 2.5, 7);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
    });

    // Body.
    ctx.fillStyle = '#e8873a';
    ctx.beginPath();
    ctx.arc(body.x, body.y, BODY_R, 0, Math.PI * 2);
    ctx.fill();

    // Eyes look toward the gripping hand (or the flying one).
    const fh = hands[1 - state.grip];
    const look = fh.state === 'flying' ? fh : hands[state.grip];
    const lx = look.x - body.x, ly = look.y - body.y;
    const ll = Math.hypot(lx, ly) || 1;
    for (const ex of [-6, 6]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(body.x + ex, body.y + 4, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath(); ctx.arc(body.x + ex + (lx / ll) * 2, body.y + 4 + (ly / ll) * 2, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // Hands.
    hands.forEach((h) => {
      const grabbable = h.state === 'flying' && Math.abs(h.vy) <= T.grabWindow;
      ctx.fillStyle = h.state === 'held' ? '#ffd27a' : '#f0a65a';
      ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R, 0, Math.PI * 2); ctx.fill();
      if (grabbable) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(h.x, h.y, HAND_R + 3, 0, Math.PI * 2); ctx.stroke();
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

  function drawDragIndicator() {
    const d = state.drag;
    if (!d) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(d.sx, d.sy); ctx.lineTo(d.cx, d.cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(d.sx, d.sy, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(d.cx, d.cy, 7, 0, Math.PI * 2); ctx.fill();
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
    if (state.phase === 'ready' && !state.drag) {
      const by = cssH * 0.14;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(cx - 160, by, 320, 76, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText('Drag down, then release', cx, by + 30);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Aim for the green crosshair', cx, by + 54);
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
        store.set('climber.tuning', T);
      });
      tuneFields.append(wrap, input);
    }
  }

  document.getElementById('tune-btn').addEventListener('click', () => {
    buildTuning();
    tunePanel.hidden = !tunePanel.hidden;
    state.drag = null;
  });
  document.getElementById('tune-close').addEventListener('click', () => { tunePanel.hidden = true; });
  document.getElementById('tune-reset').addEventListener('click', () => {
    Object.assign(T, DEFAULTS);
    store.set('climber.tuning', T);
    buildTuning();
  });

  // Read-only handle for debugging in the browser console.
  window.climber = { get state() { return state; }, T };

  newGame();
  requestAnimationFrame(frame);
})();
