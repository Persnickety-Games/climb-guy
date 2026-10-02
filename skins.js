// Skins: everything cosmetic you can customize, plus the drawing helpers the
// game and the customize screen share. Drawing helpers work in "world" space,
// where y points UP (the game flips its canvas so up is +y); the customize
// preview sets up the same flip.
window.Skins = (() => {
  'use strict';

  // Colors for hands and aim arcs (each hand and arc is picked separately).
  const COLORS = [
    { id: 'pink', name: 'Pink', hex: '#ff5fa8' },
    { id: 'yellow', name: 'Yellow', hex: '#ffd166' },
    { id: 'cyan', name: 'Cyan', hex: '#4fd8ff' },
    { id: 'lime', name: 'Lime', hex: '#9be15d' },
    { id: 'white', name: 'White', hex: '#ffffff' },
    { id: 'orange', name: 'Orange', hex: '#ff9f43' },
    { id: 'purple', name: 'Purple', hex: '#b388ff' },
    { id: 'red', name: 'Red', hex: '#ff4d4d' },
    { id: 'black', name: 'Black', hex: '#222831' },
    { id: 'gold', name: 'Gold', hex: '#f5c542' },
    { id: 'rainbow', name: 'Rainbow', hex: null },
  ];

  const BODIES = [
    { id: 'orange', name: 'Orange', fill: '#e8873a' },
    { id: 'blue', name: 'Blue', fill: '#4a90d9' },
    { id: 'green', name: 'Green', fill: '#4caf6a' },
    { id: 'purple', name: 'Purple', fill: '#9b6bd6' },
    { id: 'red', name: 'Red', fill: '#e05252' },
    { id: 'gold', name: 'Gold', fill: '#e6b422', shine: true },
    { id: 'stripes', name: 'Stripes', fill: '#e8873a', pattern: 'stripes', alt: '#fff0d9' },
    { id: 'polka', name: 'Polka dots', fill: '#4a90d9', pattern: 'dots', alt: '#ffffff' },
  ];

  const HATS = [
    { id: 'none', name: 'No hat' },
    { id: 'party', name: 'Party hat' },
    { id: 'bucket', name: 'Bucket hat' },
    { id: 'cowboy', name: 'Cowboy hat' },
    { id: 'propeller', name: 'Propeller cap' },
    { id: 'tophat', name: 'Top hat' },
    { id: 'crown', name: 'Crown' },
    { id: 'astronaut', name: 'Astronaut helmet' },
  ];

  const FACES = [
    { id: 'none', name: 'Nothing' },
    { id: 'sunglasses', name: 'Sunglasses' },
    { id: 'mustache', name: 'Mustache' },
    { id: 'monocle', name: 'Monocle' },
  ];

  // Sky color stops are [height in m, [r, g, b]].
  const BACKDROPS = [
    { id: 'classic', name: 'Classic', skyline: 'city', sky: [[0, [135, 197, 234]], [250, [95, 150, 205]], [450, [70, 60, 120]], [650, [14, 14, 34]]],
      ground: 'rgba(30, 55, 90, 0.35)', windows: 'rgba(255, 230, 150, 0.25)', cloud: '255,255,255', starsFrom: 380 },
    { id: 'sunset', name: 'Sunset', skyline: 'city', sky: [[0, [255, 176, 120]], [200, [235, 110, 120]], [450, [90, 50, 110]], [650, [20, 14, 40]]],
      ground: 'rgba(70, 30, 60, 0.45)', windows: 'rgba(255, 220, 140, 0.35)', cloud: '255,220,200', starsFrom: 350 },
    { id: 'night', name: 'Night city', skyline: 'city', sky: [[0, [32, 48, 92]], [300, [20, 28, 64]], [600, [10, 10, 30]]],
      ground: 'rgba(8, 12, 28, 0.6)', windows: 'rgba(255, 220, 120, 0.7)', cloud: '160,170,210', starsFrom: 0 },
    { id: 'forest', name: 'Forest', skyline: 'trees', sky: [[0, [170, 220, 200]], [250, [110, 170, 190]], [500, [60, 70, 110]], [700, [14, 18, 30]]],
      ground: 'rgba(30, 80, 50, 0.45)', windows: null, cloud: '255,255,255', starsFrom: 420 },
    { id: 'candy', name: 'Candyland', skyline: 'candy', sky: [[0, [255, 205, 230]], [250, [210, 180, 255]], [500, [150, 120, 220]], [700, [50, 30, 80]]],
      ground: 'rgba(255, 140, 190, 0.4)', windows: 'rgba(255, 255, 255, 0.5)', cloud: '255,240,250', starsFrom: 450 },
    { id: 'synthwave', name: 'Synthwave', skyline: 'neon', sky: [[0, [80, 20, 90]], [200, [45, 15, 70]], [500, [15, 8, 35]]],
      ground: 'rgba(255, 60, 200, 0.9)', windows: 'rgba(80, 230, 255, 0.6)', cloud: '255,120,220', starsFrom: 0 },
  ];

  // Ledge themes: five base colors (ledges pick one at random) and a surface style.
  const LEDGES = [
    { id: 'classic', name: 'Classic', style: 'plain', colors: ['#6b5440', '#5a6b48', '#4f5d73', '#7a5a5a', '#5e5470'] },
    { id: 'wood', name: 'Wood', style: 'wood', colors: ['#8a5a32', '#9a6a3c', '#7a4e2a', '#a0703f', '#86572f'] },
    { id: 'stone', name: 'Stone', style: 'stone', colors: ['#7d7f86', '#8e9096', '#6f7178', '#868a92', '#777a80'] },
    { id: 'candy', name: 'Candy', style: 'candy', colors: ['#ff8fc4', '#8fd8ff', '#b9f28c', '#ffd27f', '#c9a6ff'] },
    { id: 'neon', name: 'Neon', style: 'neon', colors: ['#ff4fd8', '#4ff0ff', '#9dff4f', '#ffe14f', '#ff8a4f'] },
    { id: 'gold', name: 'Gold bars', style: 'gold', colors: ['#d9a521', '#e6b432', '#cf9a1a', '#e0ad2a', '#d4a01e'] },
  ];

  const WATERS = [
    { id: 'water', name: 'Water', fill: 'rgba(30, 110, 200, 0.72)', flood: 'rgba(20, 80, 160, 0.8)' },
    { id: 'slime', name: 'Slime', fill: 'rgba(90, 200, 60, 0.82)', flood: 'rgba(60, 160, 40, 0.88)', bubbles: 'rgba(200, 255, 160, 0.7)' },
    { id: 'chocolate', name: 'Chocolate', fill: 'rgba(110, 62, 32, 0.92)', flood: 'rgba(85, 45, 22, 0.95)', shine: 'rgba(200, 140, 90, 0.5)' },
    { id: 'lava', name: 'Lava', fill: 'rgba(230, 80, 20, 0.9)', flood: 'rgba(200, 40, 10, 0.95)', glow: '#ffd23f', bubbles: 'rgba(255, 210, 80, 0.85)' },
  ];

  const byId = (list, id) => list.find(x => x.id === id) || list[0];

  // A color id to a CSS color; rainbow cycles over time.
  function color(id, t = 0) {
    const c = byId(COLORS, id);
    return c.hex || `hsl(${Math.round((t * 90) % 360)}, 90%, 62%)`;
  }

  // ---------- Drawing (world space, y up) ----------

  function drawBody(ctx, x, y, r, bodyId) {
    const b = byId(BODIES, bodyId);
    ctx.fillStyle = b.fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (b.pattern) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = b.alt;
      if (b.pattern === 'stripes') {
        for (let k = -r; k < r; k += r * 0.5) ctx.fillRect(x - r, y + k, r * 2, r * 0.22);
      } else {
        for (const [dx, dy] of [[-0.55, -0.45], [0.5, -0.55], [0, -0.05], [-0.6, 0.45], [0.55, 0.4], [0, 0.8], [0.05, -0.85]]) {
          ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, r * 0.16, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
    if (b.shine) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.ellipse(x - r * 0.4, y + r * 0.45, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Hats sit on top of a body of radius r centered at (x, y). t animates the propeller.
  function drawHat(ctx, x, y, r, hatId, t = 0) {
    const top = y + r * 0.82;
    ctx.save();
    ctx.lineJoin = 'round';
    switch (hatId) {
      case 'party': {
        ctx.fillStyle = '#ff5f8f';
        ctx.beginPath(); ctx.moveTo(x - r * 0.55, top - r * 0.1); ctx.lineTo(x + r * 0.45, top - r * 0.05); ctx.lineTo(x - r * 0.02, top + r * 1.05); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = r * 0.1;
        ctx.beginPath(); ctx.moveTo(x - r * 0.38, top + r * 0.25); ctx.lineTo(x + r * 0.3, top + r * 0.3); ctx.stroke();
        ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(x - r * 0.02, top + r * 1.08, r * 0.16, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'bucket': {
        ctx.fillStyle = '#d8c39a';
        ctx.beginPath(); ctx.ellipse(x, top - r * 0.02, r * 0.95, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - r * 0.62, top); ctx.lineTo(x - r * 0.5, top + r * 0.55); ctx.lineTo(x + r * 0.5, top + r * 0.55); ctx.lineTo(x + r * 0.62, top); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8a6d3b'; ctx.fillRect(x - r * 0.6, top + r * 0.08, r * 1.2, r * 0.12);
        break;
      }
      case 'cowboy': {
        ctx.fillStyle = '#8b5a2b';
        ctx.beginPath(); ctx.moveTo(x - r * 1.15, top + r * 0.2); ctx.quadraticCurveTo(x, top - r * 0.25, x + r * 1.15, top + r * 0.2); ctx.quadraticCurveTo(x, top + r * 0.05, x - r * 1.15, top + r * 0.2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - r * 0.55, top + r * 0.05); ctx.quadraticCurveTo(x - r * 0.6, top + r * 0.85, x - r * 0.2, top + r * 0.8); ctx.lineTo(x, top + r * 0.65); ctx.lineTo(x + r * 0.2, top + r * 0.8); ctx.quadraticCurveTo(x + r * 0.6, top + r * 0.85, x + r * 0.55, top + r * 0.05); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3d2412'; ctx.fillRect(x - r * 0.56, top + r * 0.12, r * 1.12, r * 0.13);
        break;
      }
      case 'propeller': {
        ctx.fillStyle = '#4a90d9';
        ctx.beginPath(); ctx.arc(x, top - r * 0.05, r * 0.62, 0, Math.PI); ctx.fill();
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath(); ctx.moveTo(x, top - r * 0.05); ctx.arc(x, top - r * 0.05, r * 0.62, Math.PI * 0.33, Math.PI * 0.66); ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(x - r * 0.65, top - r * 0.08, r * 1.3, r * 0.1);
        ctx.strokeStyle = '#555'; ctx.lineWidth = r * 0.08;
        ctx.beginPath(); ctx.moveTo(x, top + r * 0.55); ctx.lineTo(x, top + r * 0.75); ctx.stroke();
        const spin = Math.cos(t * 18);
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath(); ctx.ellipse(x, top + r * 0.78, r * 0.7 * Math.abs(spin) + r * 0.08, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'tophat': {
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.ellipse(x, top, r * 0.85, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - r * 0.5, top, r * 1.0, r * 0.95);
        ctx.fillStyle = '#c0392b'; ctx.fillRect(x - r * 0.5, top + r * 0.12, r * 1.0, r * 0.16);
        break;
      }
      case 'crown': {
        ctx.fillStyle = '#f5c542';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.62, top - r * 0.05); ctx.lineTo(x - r * 0.62, top + r * 0.55); ctx.lineTo(x - r * 0.33, top + r * 0.28);
        ctx.lineTo(x, top + r * 0.7); ctx.lineTo(x + r * 0.33, top + r * 0.28); ctx.lineTo(x + r * 0.62, top + r * 0.55); ctx.lineTo(x + r * 0.62, top - r * 0.05);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e0457b'; ctx.beginPath(); ctx.arc(x, top + r * 0.15, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3db2ff';
        for (const d of [-0.38, 0.38]) { ctx.beginPath(); ctx.arc(x + d * r, top + r * 0.12, r * 0.07, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'astronaut': {
        // A glass bubble around the whole head.
        ctx.strokeStyle = 'rgba(230,240,255,0.95)'; ctx.lineWidth = r * 0.14;
        ctx.fillStyle = 'rgba(180,220,255,0.18)';
        ctx.beginPath(); ctx.arc(x, y + r * 0.08, r * 1.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.ellipse(x - r * 0.65, y + r * 0.75, r * 0.22, r * 0.1, -0.7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = r * 0.08;
        ctx.beginPath(); ctx.moveTo(x + r * 0.7, y + r * 1.2); ctx.lineTo(x + r * 0.95, y + r * 1.7); ctx.stroke();
        ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(x + r * 0.97, y + r * 1.75, r * 0.12, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  // Face extras, drawn over the eyes (at y + 4 * r/16) and mouth.
  function drawFaceExtra(ctx, x, y, r, faceId) {
    const k = r / 16, ey = y + 4 * k;
    ctx.save();
    switch (faceId) {
      case 'sunglasses': {
        ctx.fillStyle = '#111';
        for (const ex of [-6, 6]) { ctx.beginPath(); ctx.ellipse(x + ex * k, ey, 5.2 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6 * k;
        ctx.beginPath(); ctx.moveTo(x - 1.5 * k, ey + 0.8 * k); ctx.lineTo(x + 1.5 * k, ey + 0.8 * k); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (const ex of [-8, 4]) ctx.fillRect(x + ex * k, ey + 1 * k, 2.2 * k, 1.2 * k);
        break;
      }
      case 'mustache': {
        ctx.fillStyle = '#3a2416';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, y - 2.5 * k);
          ctx.quadraticCurveTo(x + s * 5 * k, y - 0.5 * k, x + s * 8.5 * k, y - 4.5 * k);
          ctx.quadraticCurveTo(x + s * 5 * k, y - 4 * k, x, y - 4.2 * k);
          ctx.fill();
        }
        break;
      }
      case 'monocle': {
        ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1.4 * k;
        ctx.beginPath(); ctx.arc(x + 6 * k, ey, 5.5 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 9.5 * k, ey - 4.5 * k); ctx.quadraticCurveTo(x + 13 * k, ey - 10 * k, x + 10 * k, ey - 14 * k); ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  // Surface details for a ledge rectangle (x, y = bottom-left in world space).
  function decorateLedge(ctx, x, y, w, h, style, color) {
    ctx.save();
    switch (style) {
      case 'wood': {
        ctx.strokeStyle = 'rgba(60, 30, 10, 0.45)'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 1; k < 3; k++) { ctx.moveTo(x + 3, y + (h * k) / 3); ctx.lineTo(x + w - 3, y + (h * k) / 3 + (k === 1 ? 1 : -1)); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(60, 30, 10, 0.5)';
        for (const fx of [0.25, 0.7]) { ctx.beginPath(); ctx.ellipse(x + w * fx, y + h * 0.5, 2.5, 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'stone': {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let i = 0; i < Math.max(3, w / 14); i++) {
          const px = x + ((i * 37) % 100) / 100 * (w - 6) + 3, py = y + ((i * 61) % 100) / 100 * (h - 4) + 2;
          ctx.beginPath(); ctx.arc(px, py, 1.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + w * 0.35, y + h); ctx.lineTo(x + w * 0.42, y + h * 0.4); ctx.lineTo(x + w * 0.38, y); ctx.stroke();
        break;
      }
      case 'candy': {
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let k = -h; k < w + h; k += 12) {
          ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k + 5, y); ctx.lineTo(x + k + 5 + h, y + h); ctx.lineTo(x + k + h, y + h); ctx.fill();
        }
        break;
      }
      case 'neon': {
        ctx.shadowColor = color; ctx.shadowBlur = 8;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        break;
      }
      case 'gold': {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,250,210,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
        break;
      }
    }
    ctx.restore();
  }

  // The base fill for a ledge: neon ledges are dark with a glowing edge.
  const ledgeFill = (style, color) => (style === 'neon' ? '#1a1030' : color);

  function skyAt(backdropId, m) {
    const sky = byId(BACKDROPS, backdropId).sky;
    let i = 0;
    while (i < sky.length - 2 && m > sky[i + 1][0]) i++;
    const [m0, a] = sky[i], [m1, b] = sky[i + 1];
    const t = Math.max(0, Math.min(1, (m - m0) / (m1 - m0)));
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // Skyline buildings in screen space: each { x, w, h, lit } (x, w in pixels; h in pixels).
  function drawSkyline(ctx, backdropId, buildings, ground) {
    const bd = byId(BACKDROPS, backdropId);
    for (const b of buildings) {
      const top = ground - b.h;
      ctx.fillStyle = bd.ground;
      if (bd.skyline === 'trees') {
        // Pine trees: stacked triangles on a trunk.
        const cx = b.x + b.w / 2;
        ctx.fillRect(cx - b.w * 0.06, ground - b.h * 0.2, b.w * 0.12, b.h * 0.2 + 400);
        for (let k = 0; k < 3; k++) {
          const ty = top + (b.h * 0.8 * k) / 3, half = (b.w * (0.3 + k * 0.12));
          ctx.beginPath(); ctx.moveTo(cx, ty); ctx.lineTo(cx - half, ty + b.h * 0.4); ctx.lineTo(cx + half, ty + b.h * 0.4); ctx.fill();
        }
        continue;
      }
      if (bd.skyline === 'candy') {
        ctx.beginPath();
        ctx.moveTo(b.x, ground + 400); ctx.lineTo(b.x, top + b.w / 2);
        ctx.arc(b.x + b.w / 2, top + b.w / 2, b.w / 2, Math.PI, 0);
        ctx.lineTo(b.x + b.w, ground + 400); ctx.fill();
      } else if (bd.skyline === 'neon') {
        ctx.fillStyle = 'rgba(20, 5, 40, 0.85)';
        ctx.fillRect(b.x, top, b.w, b.h + 400);
        ctx.strokeStyle = bd.ground; ctx.lineWidth = 1.5;
        ctx.strokeRect(b.x + 0.5, top + 0.5, b.w - 1, b.h + 400);
      } else {
        ctx.fillRect(b.x, top, b.w, b.h + 400);
      }
      if (bd.windows) {
        ctx.fillStyle = bd.windows;
        for (let wy = top + 8; wy < ground - 6; wy += 14) {
          for (let wx = 6; wx < b.w - 6; wx += 12) {
            if (((wx * 7 + wy * 13 + b.lit * 100) | 0) % 5 === 0) ctx.fillRect(b.x + wx, wy, 4, 5);
          }
        }
      }
    }
  }

  return { COLORS, BODIES, HATS, FACES, BACKDROPS, LEDGES, WATERS, byId, color, drawBody, drawHat, drawFaceExtra, decorateLedge, ledgeFill, skyAt, drawSkyline };
})();
