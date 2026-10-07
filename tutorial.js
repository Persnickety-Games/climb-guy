// How to play: a few illustrated cards with small looping animations. Opens on
// a new player's first visit (with Skip), and any time from the ☰ menu.
window.Tutorial = (() => {
  'use strict';

  const KEY = 'cg.tutorial';
  const $ = (sel) => root.querySelector(sel);
  const root = document.getElementById('tutorial');
  const art = $('.tut-art');
  // The drawing helpers below draw on ctx at size W x H: the cards' canvas, or
  // the intro clip's while it plays.
  const cardCtx = art.getContext('2d');
  let ctx = cardCtx, W = 300, H = 190;
  let slide = 0, firstTime = false, raf = 0, t0 = 0;

  const PINK = '#ff5fa2', YELLOW = '#ffd166', BODY = '#e8873a', LEDGE = '#6b5440', WATER = '#3a7bd5';

  const SLIDES = [
    { title: 'Two thumbs, two hands', text: 'The left side of the screen controls the left hand. The right side controls the right.', draw: drawSides,
      mouse: { title: 'Mouse throws, keys grab', text: 'Drag with the mouse to throw a hand. A grabs with the left hand, D with the right.' } },
    { title: 'Drag down to throw', text: "Pull a thumb down and let go to fling that hand up, like a slingshot. The dotted arc shows where it'll go.", draw: drawThrow,
      mouse: { title: 'Drag down to throw', text: "Click, drag down and let go to fling a hand up, like a slingshot. The dotted arc shows where it'll go." } },
    { title: 'Tap to grab, hold to hang on', text: "Tap when the hand reaches a ledge, and keep your thumb down to hold on. Lift it to let go. You start by falling in, so grab a ledge quick!", draw: drawGrab,
      mouse: { title: 'Press to grab, hold to hang on', text: 'Press A or D when that hand reaches a ledge, and keep holding the key. Let go of it to let go. You start by falling in, so grab a ledge quick!' } },
    { title: 'Let go to fling up', text: "Arms are stretchy. Hang from a high hand, let go with the lower one, and you'll zoom up. Keep swapping hands.", draw: drawFling },
    { title: 'Outclimb the water', text: "The water keeps rising. Green balloons help; red ones don't. There's one daily climb a day, the same for everyone. How high can you get?", draw: drawWater },
  ];

  // ---------- Drawing helpers (screen space, y down) ----------
  const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
  const lerp = (a, b, k) => a + (b - a) * k;

  function bg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#5aa7dd'); g.addColorStop(1, '#8ac6ec');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function ledge(x, y, w) {
    ctx.fillStyle = LEDGE; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 6, w, 12, 4); ctx.fill();
  }
  function arm(a, b, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function hand(x, y, color, held) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    if (held) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function body(x, y, face = 'smile') {
    ctx.fillStyle = BODY; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
    for (const ex of [-6, 6]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + ex, y - 4, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(x + ex, y - 5.5, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#3a1a10'; ctx.lineWidth = 1.6; ctx.beginPath();
    if (face === 'wow') { ctx.fillStyle = '#3a1a10'; ctx.ellipse(x, y + 7, 3, 4, 0, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.arc(x, y + 3, 5, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  }
  // A climber at (x, y) with hands at l and r (null = at the shoulder).
  function climber(x, y, l, r, lHeld, rHeld, face) {
    const ls = [x - 13, y - 5], rs = [x + 13, y - 5];
    const L = l || [x - 20, y + 8], R = r || [x + 20, y + 8];
    arm(ls, L, PINK); arm(rs, R, YELLOW);
    body(x, y, face);
    hand(L[0], L[1], PINK, lHeld); hand(R[0], R[1], YELLOW, rHeld);
  }
  const mouse = () => !!(window.Controls && Controls.mouse);

  // A thumb on the glass (or a key): a soft circle, pressed (filled) or just a ring.
  function thumb(x, y, pressed, label) {
    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (label) { ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x, y + 30); }
  }
  function tapRing(x, y, k) {
    if (k <= 0 || k >= 1) return;
    ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 10 + k * 22, 0, Math.PI * 2); ctx.stroke();
  }
  function dotsArc(from, to, lift, color, upto = 1) {
    ctx.fillStyle = color;
    for (let k = 0.1; k <= upto; k += 0.1) {
      const x = lerp(from[0], to[0], k), y = lerp(from[1], to[1], k) - Math.sin(k * Math.PI) * lift;
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function waterAt(level, time) {
    ctx.fillStyle = WATER; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, level + Math.sin(x * 0.06 + time * 3) * 3);
    ctx.lineTo(W, H); ctx.fill();
  }

  // ---------- Slides ----------
  function drawSides(time) {
    bg();
    ctx.fillStyle = 'rgba(255,95,162,0.22)'; ctx.fillRect(0, 0, W / 2, H);
    ctx.fillStyle = 'rgba(255,209,102,0.25)'; ctx.fillRect(W / 2, 0, W / 2, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);
    ledge(W / 2, 40, 150);
    const sway = Math.sin(time * 2) * 3;
    climber(W / 2 + sway, 92, [W / 2 - 22, 40], [W / 2 + 22, 40], true, true);
    const pulse = (Math.sin(time * 4) + 1) / 2;
    thumb(W / 4, 150, pulse > 0.5, mouse() ? 'A = LEFT' : 'LEFT HAND');
    thumb((W * 3) / 4, 150, pulse <= 0.5, mouse() ? 'D = RIGHT' : 'RIGHT HAND');
  }

  function drawThrow(time) {
    bg();
    const k = (time % 3) / 3; // 3 s loop
    ledge(90, 40, 100); ledge(225, 60, 90);
    const bx = 95, by = 100;
    const shoulder = [bx + 20, by + 8];
    const target = [215, 60];
    const drag = ease(k / 0.35); // pull down
    const fly = ease((k - 0.45) / 0.3); // released
    let r = shoulder;
    if (k < 0.45) r = [shoulder[0] - drag * 6, shoulder[1] + drag * 22];
    else r = [lerp(shoulder[0], target[0], fly), lerp(shoulder[1], target[1], fly) - Math.sin(fly * Math.PI) * 50];
    if (k > 0.15 && k < 0.45) dotsArc(shoulder, target, 50, 'rgba(255,209,102,0.95)', 0.2 + drag * 0.8);
    climber(bx, by, [85, 40], r, true, k > 0.8);
    // The thumb: pressed and dragging down, then lifted.
    const tx = 230, ty = 125 + (k < 0.45 ? drag * 30 : 30);
    thumb(tx, ty, k > 0.05 && k < 0.45, k < 0.45 ? 'DRAG DOWN' : 'LET GO');
  }

  function drawGrab(time) {
    bg();
    const k = (time % 3) / 3;
    ledge(205, 45, 110);
    const start = [140, 128], top = [200, 45];
    const rise = ease(k / 0.4);
    const held = k >= 0.42;
    // Once it grabs, the stretchy arm pulls the climber up under the ledge.
    const swing = ease((k - 0.45) / 0.3);
    const bx = lerp(120, 182, swing), by = lerp(120, 85, swing);
    const r = held ? top : [lerp(start[0], top[0], rise), lerp(start[1], top[1], rise) - Math.sin(rise * Math.PI) * 30];
    climber(bx, by, null, r, false, held);
    tapRing(top[0], top[1], (k - 0.42) / 0.25);
    thumb(235, 145, held, mouse() ? (held ? 'HOLD D' : 'PRESS D…') : held ? 'TAP & HOLD' : 'TAP…');
  }

  function drawFling(time) {
    bg();
    const k = (time % 3.2) / 3.2;
    ledge(110, 30, 90); ledge(165, 150, 90);
    const top = [115, 30], low = [165, 150];
    const go = ease((k - 0.35) / 0.35);
    const by = lerp(120, 62, go) + (k > 0.7 ? Math.sin((k - 0.7) * 30) * 4 * (1 - k) : 0);
    const bx = lerp(140, 118, go);
    const lowHeld = k < 0.35;
    climber(bx, by, top, lowHeld ? low : null, true, lowHeld, go > 0.05 && go < 0.95 ? 'wow' : 'smile');
    if (go > 0.05 && go < 0.95) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      for (const dx of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(bx + dx, by + 24); ctx.lineTo(bx + dx, by + 44); ctx.stroke(); }
    }
    thumb(235, 150, lowHeld, lowHeld ? 'HOLDING…' : mouse() ? 'LET GO!' : 'LIFT!');
  }

  function drawWater(time) {
    bg();
    const k = (time % 4) / 4;
    ledge(80, 50, 90); ledge(210, 95, 90); ledge(120, 140, 80);
    climber(205, 115, [190, 95], [222, 95], true, true, k > 0.6 ? 'wow' : 'smile');
    const bob = Math.sin(time * 2.5) * 4;
    for (const [x, y, c, s] of [[60, 28 + bob, '#3ddc84', '+'], [255, 40 - bob, '#ff6b6b', '!']]) {
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, 13, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x, y + 30); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s, x, y + 5);
    }
    waterAt(lerp(185, 150, ease(k / 0.8)), time);
  }

  // ---------- Showing it ----------
  function render() {
    const s = SLIDES[slide];
    const words = (window.Controls && Controls.mouse && s.mouse) || s;
    $('.tut-title').textContent = words.title;
    $('.tut-text').textContent = words.text;
    $('.tut-step').textContent = `${slide + 1} / ${SLIDES.length}`;
    $('.tut-back').hidden = slide === 0;
    const last = slide === SLIDES.length - 1;
    $('.tut-next').textContent = last ? (firstTime ? "Let's climb!" : 'Done') : 'Next';
    $('.tut-skip').hidden = last;
    $('.tut-dots').replaceChildren(...SLIDES.map((_, i) => {
      const d = document.createElement('span');
      if (i === slide) d.className = 'on';
      return d;
    }));
  }

  function loop(now) {
    if (root.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (art.width !== W * dpr || art.height !== H * dpr) { art.width = W * dpr; art.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'left';
    SLIDES[slide].draw((now - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }

  function go(i) {
    slide = Math.max(0, Math.min(SLIDES.length - 1, i));
    t0 = performance.now();
    render();
  }

  function open(isFirst = false) {
    firstTime = isFirst;
    root.hidden = false;
    go(0);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function close() {
    root.hidden = true;
    cancelAnimationFrame(raf);
    try { localStorage.setItem(KEY, 'seen'); } catch {}
  }

  $('.tut-next').addEventListener('click', () => (slide === SLIDES.length - 1 ? close() : go(slide + 1)));
  $('.tut-back').addEventListener('click', () => go(slide - 1));
  $('.tut-skip').addEventListener('click', close);
  // Swipe between cards.
  let sx = null;
  art.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  art.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 40) go(slide + (dx < 0 ? 1 : -1));
  });
  for (const b of document.querySelectorAll('.tutorial-btn')) b.addEventListener('click', () => open(false));

  let seen = false;
  try { seen = localStorage.getItem(KEY) === 'seen'; } catch {}

  // Finishing training counts as having seen the ropes.
  function markSeen() {
    seen = true;
    try { localStorage.setItem(KEY, 'seen'); } catch {}
  }

  // ---------- Intro clip ----------
  // A few seconds, no words: the whole move, looping. Hang from one hand, throw
  // the other up, catch, let go of the low hand and swing up. Each thumb is
  // ringed in its hand's color (with a mouse: a mouse drag and the A/D keys).
  // Plays before training; "Let's go" appears once it has played through.
  const intro = document.getElementById('intro');
  const introArt = intro.querySelector('.intro-art');
  const introGo = intro.querySelector('.intro-go');
  const IW = 300, IH = 380, LOOP = 5.0;
  let introRaf = 0, introT0 = 0, introDone = null;

  function key(x, y, label, pressed, color) {
    ctx.fillStyle = pressed ? color : 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.roundRect(x - 20, y - 20 + (pressed ? 3 : 0), 40, 40, 8); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 7 + (pressed ? 3 : 0)); ctx.textAlign = 'left';
  }
  // Pressed: filled with its hand's color. Lifted: just a faint ring.
  function finger(x, y, pressed, color) {
    ctx.fillStyle = pressed ? color : 'rgba(255,255,255,0.1)';
    ctx.globalAlpha = pressed ? 0.75 : 1;
    ctx.beginPath(); ctx.arc(x, y, pressed ? 19 : 22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pressed ? '#fff' : color; ctx.lineWidth = 3; ctx.stroke();
  }
  function cursor(x, y, pressed) {
    ctx.fillStyle = pressed ? YELLOW : '#fff'; ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y + 22); ctx.lineTo(x + 6, y + 16); ctx.lineTo(x + 11, y + 26);
    ctx.lineTo(x + 15, y + 24); ctx.lineTo(x + 10, y + 14); ctx.lineTo(x + 17, y + 14); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  // The thrown hand flies like a real throw: up through the ledge (glowing while
  // it touches), a little above it (no glow), back down onto it (glowing
  // again), and the tap freezes it there. A bit slower than the game.
  const SHOULDER0 = [125, 245];            // right shoulder when the throw starts
  const SPEED = 1.25;                      // same path, played 25% faster (about 75% of game speed)
  const VX = 95 * SPEED, VY = 367 * SPEED, G = 459 * SPEED * SPEED; // px/s, px/s up, px/s^2 down
  const L2 = [205, 118], L2W = 100;
  const flightAt = (s) => [SHOULDER0[0] + VX * s, SHOULDER0[1] - VY * s + 0.5 * G * s * s];
  // Touching works like the game: the hand's circle (radius 9) overlaps the ledge (12 tall).
  const onLedge = (p) => Math.abs(p[1] - L2[1]) <= 6 + 9 && p[0] >= L2[0] - L2W / 2 - 9 && p[0] <= L2[0] + L2W / 2 + 9;
  const THROW = 1.25, CATCH_S = 1.07 / SPEED, CATCH = THROW + CATCH_S, LIFT = CATCH + 0.6;

  function drawIntro(time) {
    const t = time % LOOP;
    const at = (a, b) => ease((t - a) / (b - a)); // 0..1 between a and b seconds
    bg();
    const L1 = [95, 200];
    ledge(L1[0], L1[1], 100); ledge(L2[0], L2[1], L2W);
    // Phases: hang; aim 0.5-1.25; throw; catch on the way down; both held; let go and swing up; hang.
    const aim = t >= 0.5 && t < THROW, drag = at(0.5, THROW - 0.2);
    const flying = t >= THROW && t < CATCH, caught = t >= CATCH;
    const lifted = t >= LIFT, swing = at(LIFT, LIFT + 0.7);
    const grip = flightAt(CATCH_S);
    const bx = lerp(112, grip[0] - 9, swing), by = lerp(250, 166, swing) + (swing ? 0 : Math.sin(t * 2) * 1.5);
    const rs = [bx + 13, by - 5];
    let r = null;
    if (aim) r = [rs[0] + 4 * drag, rs[1] + 14 * drag];
    else if (flying) r = flightAt(t - THROW);
    else if (caught) r = grip;
    const touching = flying && onLedge(r);
    if (aim && drag > 0.1) { // the aim arc: where the throw will go
      ctx.fillStyle = 'rgba(255,209,102,0.95)';
      for (let s2 = 0.08; s2 <= 1.3 * (0.2 + 0.8 * drag); s2 += 0.08) {
        const p = flightAt(s2);
        ctx.beginPath(); ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    const swinging = swing > 0.05 && swing < 0.95;
    climber(bx, by, lifted ? null : [L1[0] + 5, L1[1]], r, !lifted, caught, swinging ? 'wow' : 'smile');
    if (swinging) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      for (const dx of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(bx + dx, by + 24); ctx.lineTo(bx + dx, by + 44); ctx.stroke(); }
    }
    if (touching) { // the grab glow, as in the game, moving with the hand
      const pulse = 0.5 + 0.5 * Math.sin(t * 14);
      ctx.fillStyle = `rgba(125, 255, 176, ${0.25 + 0.2 * pulse})`;
      ctx.beginPath(); ctx.arc(r[0], r[1], 16 + pulse * 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(r[0], r[1], 13, 0, Math.PI * 2); ctx.stroke();
      hand(r[0], r[1], YELLOW, false); // the hand on top of its glow
    }
    if (caught) tapRing(grip[0], grip[1], (t - CATCH) / 0.3);
    // The player's side: two thumbs (or mouse and keys) along the bottom.
    ctx.fillStyle = 'rgba(10,25,40,0.25)'; ctx.fillRect(0, 290, W, H - 290);
    const ly = 335, lx = 75, rx = 225;
    if (mouse()) {
      key(lx, ly, 'A', !lifted, PINK);
      key(rx, ly, 'D', caught, YELLOW);
      if (caught) tapRing(rx, ly, (t - CATCH) / 0.3);
      if (lifted) tapRing(lx, ly, (t - LIFT) / 0.35);
      if (aim || (t >= THROW && t < THROW + 0.3)) {
        const cy = 250 + (aim ? drag : 1) * 40;
        if (aim) { ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rx - 60, 250); ctx.lineTo(rx - 60, cy); ctx.stroke(); ctx.setLineDash([]); }
        cursor(rx - 60, cy, aim);
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W / 2, 290); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);
      finger(lx, ly, !lifted, PINK);
      // Throw: drag down from above, let go. Catch: the thumb comes down onto
      // the screen exactly as the grab happens (hovering, raised, until then).
      const fy = aim ? ly - 30 + drag * 40 : flying ? ly - 12 * (1 - at(CATCH - 0.35, CATCH)) : ly;
      if (aim) { ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rx, ly - 30); ctx.lineTo(rx, fy); ctx.stroke(); ctx.setLineDash([]); }
      finger(rx, fy, aim || caught, YELLOW);
      if (caught) tapRing(rx, ly, (t - CATCH) / 0.3);
      if (lifted) tapRing(lx, ly, (t - LIFT) / 0.35);
    }
    // A quick fade at the end of each loop.
    const fade = Math.max(0, (t - (LOOP - 0.35)) / 0.35);
    if (fade > 0) { ctx.fillStyle = `rgba(16,36,58,${fade})`; ctx.fillRect(0, 0, W, H); }
  }

  function introLoop(now) {
    if (intro.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (introArt.width !== IW * dpr || introArt.height !== IH * dpr) { introArt.width = IW * dpr; introArt.height = IH * dpr; }
    const saved = [ctx, W, H];
    ctx = introArt.getContext('2d'); W = IW; H = IH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'left';
    const time = (now - introT0) / 1000;
    drawIntro(time);
    [ctx, W, H] = saved;
    if (time >= LOOP - 0.4 && introGo.hidden) introGo.hidden = false; // played through once
    introRaf = requestAnimationFrame(introLoop);
  }

  function playIntro(onDone) {
    introDone = onDone;
    intro.hidden = false;
    introGo.hidden = true;
    introT0 = performance.now();
    cancelAnimationFrame(introRaf);
    introRaf = requestAnimationFrame(introLoop);
  }

  introGo.addEventListener('click', () => {
    intro.hidden = true;
    cancelAnimationFrame(introRaf);
    const done = introDone;
    introDone = null;
    if (done) done();
  });

  return {
    open, close, markSeen, playIntro,
    isOpen: () => !root.hidden || !intro.hidden,
    // Only for brand-new players: anyone who has played before has seen the ropes.
    get shouldShow() { return !seen && !Progress.stats().totalRuns && !Progress.endlessRuns && !Progress.sprintRuns; },
  };
})();
