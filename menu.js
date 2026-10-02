// The ☰ menu: Stats (with run history), Passport (landmarks), Badges and
// Customize (equip unlocked skins, with a live preview). The game pauses while
// it's open and calls Menu.onClose to pick up skin changes.
window.Menu = (() => {
  'use strict';

  const root = document.getElementById('menu');
  const body = root.querySelector('.menu-body');
  const tabs = [...root.querySelectorAll('.menu-tabs button')];
  let current = 'stats';
  const api = { onClose: null };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
  const fmtTime = (secs) => {
    const m = Math.floor(secs / 60), h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m ${Math.round(secs % 60)}s`;
  };

  function open(tab = current) {
    root.hidden = false;
    show(tab);
  }

  function close() {
    root.hidden = true;
    if (api.onClose) api.onClose();
  }

  function show(tab) {
    current = tab;
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    body.replaceChildren();
    body.scrollTop = 0;
    ({ stats: renderStats, passport: renderPassport, badges: renderBadges, customize: renderCustomize })[tab]();
  }

  tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  root.querySelector('.menu-close').addEventListener('click', close);

  // ---------- Stats ----------
  function renderStats() {
    const s = Progress.stats();
    const tiles = el('div', 'tiles');
    const tile = (label, value) => {
      const t = el('div', 'tile');
      t.append(el('div', 'tile-value', value), el('div', 'tile-label', label));
      tiles.append(t);
    };
    tile('Best height', `${fmtNum(s.best)} m`);
    tile('Runs played', fmtNum(s.totalRuns));
    tile('Average (last 10)', `${fmtNum(s.avg10)} m`);
    tile('Total climbed', `${fmtNum(s.totalM)} m`);
    tile('Time climbing', fmtTime(s.totalSecs));
    tile('Balloons popped', fmtNum(s.popped));
    tile('Landmarks', `${s.landmarks} / ${Progress.LANDMARKS.length}`);
    tile('Badges', `${s.badges} / ${Progress.BADGES.length}`);
    body.append(tiles);

    const runs = s.runs.slice(-30);
    const section = el('section', 'chart-section');
    section.append(el('h3', null, 'Recent runs'));
    if (!runs.length) {
      section.append(el('p', 'muted', 'Play a run to see your history here.'));
      body.append(section);
      return;
    }
    const firstNum = s.totalRuns - runs.length + 1;
    section.append(el('p', 'muted', `Height of your last ${runs.length} run${runs.length > 1 ? 's' : ''}, oldest to newest.`));
    const wrap = el('div', 'chart-wrap');
    section.append(wrap);
    body.append(section);
    drawRunChart(wrap, runs, s.best, firstNum);

    // Table view of the same data.
    const toggle = el('button', 'link-btn', 'Show as table');
    const table = el('table', 'runs-table');
    table.hidden = true;
    table.innerHTML = '<thead><tr><th>Run</th><th>Height</th><th>Date</th></tr></thead>';
    const tb = el('tbody');
    [...runs].reverse().forEach((r, k) => {
      const tr = el('tr');
      tr.append(el('td', null, `#${firstNum + runs.length - 1 - k}`), el('td', null, `${fmtNum(r.m)} m`), el('td', null, fmtDate(r.ts)));
      tb.append(tr);
    });
    table.append(tb);
    toggle.addEventListener('click', () => {
      table.hidden = !table.hidden;
      toggle.textContent = table.hidden ? 'Show as table' : 'Hide table';
    });
    section.append(toggle, table);
  }

  // Columns of run heights with a hairline for your best and a tooltip per run.
  function drawRunChart(wrap, runs, best, firstNum) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = Math.max(260, wrap.clientWidth || 320), H = 190;
    const L = 40, R = 8, T = 22, B = 22;
    const pw = W - L - R, ph = H - T - B;
    const top = Math.max(best, ...runs.map(r => r.m), 10);
    const step = niceStep(top / 3);
    const max = Math.ceil(top / step) * step;
    const y = (m) => T + ph - (m / max) * ph;
    const slot = pw / runs.length;
    const barW = Math.min(24, Math.max(3, slot - 2)); // 2px surface gap between bars
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Heights of your last ${runs.length} runs; best ${best} m`);
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      svg.append(n);
      return n;
    };
    // Gridlines and y-axis labels.
    for (let v = 0; v <= max; v += step) {
      add('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 });
      add('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, fmtNum(v));
    }
    // Bars: 4px rounded tops, square at the baseline.
    const bestIdx = runs.reduce((bi, r, i) => (r.m > runs[bi].m ? i : bi), 0);
    runs.forEach((r, i) => {
      const x = L + i * slot + (slot - barW) / 2, yt = y(r.m), h = T + ph - yt;
      const rad = Math.min(4, barW / 2, h);
      const d = h <= 0 ? '' : `M${x},${T + ph} V${yt + rad} Q${x},${yt} ${x + rad},${yt} H${x + barW - rad} Q${x + barW},${yt} ${x + barW},${yt + rad} V${T + ph} Z`;
      if (d) add('path', { d, fill: 'var(--bar)' });
      // Big invisible hit target for the tooltip.
      const hit = add('rect', { x: L + i * slot, y: T, width: slot, height: ph, fill: 'transparent', class: 'hit' });
      hit.addEventListener('pointerenter', () => tip(i));
      hit.addEventListener('pointerdown', () => tip(i));
    });
    // Your best, as a hairline.
    add('line', { x1: L, x2: W - R, y1: y(best), y2: y(best), stroke: 'var(--ink-2)', 'stroke-width': 1 });
    add('text', { x: W - R, y: y(best) - 5, 'text-anchor': 'end', class: 'label' }, `Best ${fmtNum(best)} m`);
    // Direct labels: just the latest run (and the highest shown, if different).
    const lastI = runs.length - 1;
    const labelAt = (i) => {
      const x = L + i * slot + slot / 2;
      add('text', { x, y: y(runs[i].m) - 5, 'text-anchor': 'middle', class: 'value' }, `${fmtNum(runs[i].m)}`);
    };
    if (Math.abs(y(runs[lastI].m) - y(best)) > 14) labelAt(lastI);
    if (bestIdx !== lastI && Math.abs(y(runs[bestIdx].m) - y(best)) > 14) labelAt(bestIdx);
    add('text', { x: L, y: H - 6, class: 'axis' }, `#${firstNum}`);
    add('text', { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'axis' }, `#${firstNum + runs.length - 1}`);

    const tipEl = el('div', 'chart-tip');
    tipEl.hidden = true;
    function tip(i) {
      const r = runs[i];
      tipEl.textContent = `Run #${firstNum + i} · ${fmtNum(r.m)} m · ${fmtDate(r.ts)}`;
      tipEl.hidden = false;
      const px = ((L + i * slot + slot / 2) / W) * 100;
      tipEl.style.left = `${Math.min(80, Math.max(20, px))}%`;
    }
    svg.addEventListener('pointerleave', () => { tipEl.hidden = true; });
    wrap.append(svg, tipEl);
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // ---------- Passport ----------
  function renderPassport() {
    const reached = Progress.landmarks;
    const n = Object.keys(reached).length;
    body.append(el('p', 'muted', `${n} of ${Progress.LANDMARKS.length} landmarks reached. Climb past one to stamp it.`));
    const grid = el('div', 'passport');
    Progress.LANDMARKS.forEach(([m, icon, name], i) => {
      const got = reached[i];
      const card = el('div', `stamp${got ? ' got' : ''}`);
      card.append(
        el('div', 'stamp-icon', got ? icon : '❔'),
        el('div', 'stamp-name', got ? name.replace(/^(a|the) /, '').replace(/^./, c => c.toUpperCase()) : '???'),
        el('div', 'stamp-meta', `${m < 10 ? m : fmtNum(m)} m${got ? ' · ' + fmtDate(got) : ''}`),
      );
      grid.append(card);
    });
    body.append(grid);
  }

  // ---------- Badges ----------
  function renderBadges() {
    const earned = Progress.badges;
    body.append(el('p', 'muted', `${Object.keys(earned).length} of ${Progress.BADGES.length} badges earned.`));
    const grid = el('div', 'badges');
    for (const b of Progress.BADGES) {
      const got = earned[b.id];
      const card = el('div', `badge${got ? ' got' : ''}`);
      card.append(
        el('div', 'badge-icon', b.icon),
        el('div', 'badge-name', b.name),
        el('div', 'badge-desc', b.desc),
        el('div', 'badge-date', got ? `Earned ${fmtDate(got)}` : 'Not yet'),
      );
      grid.append(card);
    }
    body.append(grid);
  }

  // ---------- Customize ----------
  const LISTS = () => ({ BODIES: Skins.BODIES, HATS: Skins.HATS, FACES: Skins.FACES, COLORS: Skins.COLORS, BACKDROPS: Skins.BACKDROPS, LEDGES: Skins.LEDGES, WATERS: Skins.WATERS });

  function renderCustomize() {
    const preview = el('canvas', 'preview');
    body.append(preview);
    const eq = Progress.equipped();
    drawPreview(preview, eq);
    for (const slot of Progress.SLOTS) {
      const section = el('section', 'slot');
      section.append(el('h3', null, slot.label));
      const row = el('div', 'tiles-row');
      for (const item of LISTS()[slot.list]) {
        const unlocked = Progress.isUnlocked(slot.kind, item.id);
        const btn = el('button', `skin-tile${eq[slot.id] === item.id ? ' selected' : ''}${unlocked ? '' : ' locked'}`);
        btn.setAttribute('aria-label', `${item.name}${unlocked ? '' : ' (locked: ' + Progress.requirementText(slot.kind, item.id) + ')'}`);
        const icon = el('canvas', 'tile-icon');
        btn.append(icon, el('span', 'tile-name', unlocked ? item.name : '🔒 ' + Progress.requirementText(slot.kind, item.id)));
        drawTile(icon, slot, item.id);
        btn.addEventListener('click', () => {
          if (!unlocked) return;
          Progress.equip(slot.id, item.id);
          const y = body.scrollTop;
          show('customize');
          body.scrollTop = y;
        });
        row.append(btn);
      }
      section.append(row);
      body.append(section);
    }
  }

  // A canvas sized for crisp drawing, with world-style coordinates (y up).
  function setup(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, -dpr, 0, h * dpr);
    return c;
  }

  function sky(c, w, h, backdrop) {
    const g = c.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, Skins.skyAt(backdrop, 120));
    g.addColorStop(1, Skins.skyAt(backdrop, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function ledge(c, x, y, w, h, ledgesId, ci = 0) {
    const t = Skins.byId(Skins.LEDGES, ledgesId);
    const color = t.colors[ci];
    c.fillStyle = Skins.ledgeFill(t.style, color);
    c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, 4) : c.rect(x, y, w, h); c.fill();
    Skins.decorateLedge(c, x, y, w, h, t.style, color);
  }

  function water(c, w, top, waterId) {
    const wt = Skins.byId(Skins.WATERS, waterId);
    c.fillStyle = wt.fill;
    c.beginPath(); c.moveTo(0, 0);
    for (let x = 0; x <= w; x += 6) c.lineTo(x, top + Math.sin(x * 0.08) * 3);
    c.lineTo(w, 0); c.fill();
    if (wt.glow) { c.strokeStyle = wt.glow; c.lineWidth = 2; c.beginPath(); for (let x = 0; x <= w; x += 6) x ? c.lineTo(x, top + Math.sin(x * 0.08) * 3) : c.moveTo(x, top); c.stroke(); }
  }

  // The climber: body, face, arms and hands, hat. Left hand at lh, right at rh.
  function climber(c, x, y, r, eq, lh, rh) {
    const k = r / 16;
    c.lineCap = 'round';
    [[lh, eq.leftHand, -1], [rh, eq.rightHand, 1]].forEach(([h, col, side]) => {
      if (!h) return;
      c.strokeStyle = Skins.color(col, 0); c.lineWidth = 5 * k;
      c.beginPath(); c.moveTo(x + side * 13 * k, y + 5 * k); c.lineTo(h[0], h[1]); c.stroke();
    });
    Skins.drawBody(c, x, y, r, eq.body);
    for (const ex of [-6, 6]) {
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x + ex * k, y + 4 * k, 4.5 * k, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(x + ex * k, y + 5.5 * k, 2.2 * k, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#3a1a10'; c.lineWidth = 1.6 * k;
    c.beginPath();
    for (let t = -1; t <= 1.001; t += 0.25) { const px = x + t * 5 * k, py = y - 5 * k - (1 - t * t) * 2.5 * k; t === -1 ? c.moveTo(px, py) : c.lineTo(px, py); }
    c.stroke();
    Skins.drawFaceExtra(c, x, y, r, eq.face);
    Skins.drawHat(c, x, y, r, eq.hat, performance.now() / 1000);
    [[lh, eq.leftHand], [rh, eq.rightHand]].forEach(([h, col]) => {
      if (!h) return;
      c.fillStyle = Skins.color(col, 0); c.beginPath(); c.arc(h[0], h[1], 9 * k, 0, Math.PI * 2); c.fill();
    });
  }

  // The big preview: your climber hanging from a ledge, aiming a throw.
  function drawPreview(canvas, eq) {
    const w = Math.min((body.clientWidth || 372) - 32, 480), h = 230; // body has 16px padding each side
    const c = setup(canvas, w, h);
    sky(c, w, h, eq.backdrop);
    const bd = Skins.byId(Skins.BACKDROPS, eq.backdrop);
    if (bd.starsFrom === 0) {
      c.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 30; i++) { c.beginPath(); c.arc((i * 73) % w, 60 + ((i * 37) % (h - 60)), 1, 0, Math.PI * 2); c.fill(); }
    }
    // Skyline is drawn in screen space (y down), so flip back for it.
    c.save(); c.scale(1, -1); c.translate(0, -h);
    const bs = [];
    for (let x = -10, i = 0; x < w + 10; i++) { const bw = 26 + (i * 17) % 30; bs.push({ x, w: bw, h: 40 + (i * 29) % 70, lit: (i * 0.37) % 1 }); x += bw + 4; }
    Skins.drawSkyline(c, eq.backdrop, bs, h - 26);
    c.restore();
    const cx = w * 0.42;
    ledge(c, cx - 70, h - 62, 120, 16, eq.ledges, 0);
    ledge(c, w * 0.62, h - 130, 90, 16, eq.ledges, 1);
    water(c, w, 26, eq.water);
    // The right hand's aim arc, as dots.
    const sx = cx + 13, sy = 110;
    c.fillStyle = Skins.color(eq.rightArc, 0);
    for (let t = 0.12; t < 1; t += 0.09) {
      const px = sx + t * 130, py = sy + 120 * t - 95 * t * t;
      c.beginPath(); c.arc(px, py, 2.6, 0, Math.PI * 2); c.fill();
    }
    // A hint of the left arc too, so both arc colors show.
    c.fillStyle = Skins.color(eq.leftArc, 0);
    for (let t = 0.15; t < 0.7; t += 0.1) {
      const px = cx - 13 - t * 90, py = sy + 100 * t - 90 * t * t;
      c.beginPath(); c.arc(px, py, 2.6, 0, Math.PI * 2); c.fill();
    }
    climber(c, cx, 105, 22, eq, [cx - 20, h - 54], [cx + 40, 92]);
  }

  // Small tile icons for each choice.
  function drawTile(canvas, slot, id) {
    const s = 44, c = setup(canvas, s, s);
    const eq = Object.assign(Progress.equipped(), { [slot.id]: id });
    switch (slot.kind) {
      case 'color': {
        c.fillStyle = id === 'rainbow' ? rainbow(c, s) : Skins.color(id, 0);
        c.beginPath(); c.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2); c.fill();
        if (id === 'black' || id === 'white') { c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; c.stroke(); }
        break;
      }
      case 'body': Skins.drawBody(c, s / 2, s / 2, s * 0.36, id); break;
      case 'hat':
      case 'face': {
        const r = s * (slot.kind === 'hat' ? 0.24 : 0.34);
        const y = slot.kind === 'hat' ? s * 0.34 : s / 2;
        Skins.drawBody(c, s / 2, y, r, eq.body);
        for (const ex of [-6, 6]) {
          c.fillStyle = '#fff'; c.beginPath(); c.arc(s / 2 + ex * r / 16, y + 4 * r / 16, 4.5 * r / 16, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(s / 2 + ex * r / 16, y + 5 * r / 16, 2.2 * r / 16, 0, Math.PI * 2); c.fill();
        }
        Skins.drawFaceExtra(c, s / 2, y, r, slot.kind === 'face' ? id : eq.face);
        Skins.drawHat(c, s / 2, y, r, slot.kind === 'hat' ? id : 'none', 0);
        break;
      }
      case 'backdrop': {
        sky(c, s, s, id);
        c.save(); c.scale(1, -1); c.translate(0, -s);
        Skins.drawSkyline(c, id, [{ x: 2, w: 12, h: 18, lit: 0.2 }, { x: 16, w: 10, h: 26, lit: 0.6 }, { x: 28, w: 14, h: 14, lit: 0.4 }], s);
        c.restore();
        break;
      }
      case 'ledges': ledge(c, 4, s / 2 - 7, s - 8, 14, id, 0); break;
      case 'water': {
        c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, 0, s, s);
        water(c, s, s * 0.6, id);
        break;
      }
    }
  }

  function rainbow(c, s) {
    const g = c.createLinearGradient(0, 0, s, 0);
    ['#ff4d4d', '#ffb84d', '#ffe14d', '#7dff7d', '#4fd8ff', '#b388ff'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
    return g;
  }

  api.open = open;
  api.close = close;
  api.isOpen = () => !root.hidden;
  return api;
})();
