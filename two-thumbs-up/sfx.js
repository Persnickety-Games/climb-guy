// Sound effects, synthesized with the Web Audio API (no audio files).
// Browsers only allow audio after a user gesture, so call sfx.unlock() from one.
window.sfx = (() => {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('climber.muted') === '1'; } catch {}

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('climber.muted', m ? '1' : '0'); } catch {}
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  const ready = () => ctx && !muted && ctx.state === 'running';

  // A pitched tone with a frequency glide and a quick fade out.
  function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  let noiseBuf = null;
  // Filtered noise burst; the filter frequency glides from f0 to f1.
  function noise(dur, f0, f1, vol = 0.3, kind = 'bandpass', q = 1) {
    if (!ready()) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  const notes = (freqs, step, type = 'triangle', vol = 0.22) =>
    freqs.forEach((f, i) => tone(f, f, step * 1.6, type, vol, i * step));

  return {
    unlock,
    get muted() { return muted; },
    setMuted,
    throw: () => noise(0.14, 900, 3200, 0.25, 'bandpass', 2),          // thwip
    grab: () => { tone(160, 70, 0.08, 'triangle', 0.4); noise(0.04, 2000, 800, 0.15); }, // slap
    fling: () => noise(0.45, 300, 1400, 0.22, 'bandpass', 0.8),        // whoosh
    splash: () => { noise(0.7, 1500, 200, 0.4, 'lowpass'); tone(300, 80, 0.4, 'sine', 0.15); },
    pop: () => { noise(0.05, 3000, 1500, 0.35, 'highpass'); tone(900, 400, 0.08, 'square', 0.08); },
    good: () => notes([523, 659, 784], 0.07),
    bad: () => tone(220, 110, 0.35, 'sawtooth', 0.12),
    star: () => notes([1319, 1760], 0.06, 'sine', 0.18),
    bird: () => { tone(1800, 1200, 0.07, 'square', 0.06); tone(1700, 1100, 0.07, 'square', 0.06, 0.09); },
    scream: () => tone(900, 300, 0.6, 'sawtooth', 0.07),
    crack: () => noise(0.25, 2500, 300, 0.3, 'bandpass', 3),
    gust: () => noise(1.2, 200, 600, 0.12, 'lowpass'),
    milestone: () => notes([523, 659, 784, 1047], 0.09),
    fanfare: () => notes([523, 659, 784, 1047, 784, 1047], 0.1, 'square', 0.12),
  };
})();
