// Lightweight analytics with GoatCounter (goatcounter.com): free, no cookies,
// no personal data. It counts page views and shows visitors by country (and
// region, if turned on in GoatCounter's settings). On top of that we send a
// few events. Whether a visitor is new or returning is worked out on the
// device, from a date saved in this browser:
//   visitor-new        first visit on this device (once)
//   visitor-returning  back on a later day (once per day)
//   daily-played / endless-run / sprint-run, share-<mode>, feedback-sent
// Only runs on the live site, so local testing is never counted.
window.Analytics = (() => {
  'use strict';

  const CODE = 'persnickety-games'; // the GoatCounter site code: persnickety-games.goatcounter.com
  const queue = [];

  // Open climbguy.xyz/#toggle-goatcounter to stop (or restart) counting this
  // browser, e.g. your own phone. Handled here with a small note, not by
  // GoatCounter's script, whose pop-up during page load upset iPhone browsers.
  let skip = false;
  try { skip = localStorage.getItem('skipgc') === 't'; } catch {}
  const onSite = !!CODE && location.protocol === 'https:' && location.hostname === 'climbguy.xyz';
  let live = false, loaded = false;

  function start() {
    live = onSite && !skip;
    if (!live || loaded) return;
    loaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
    s.addEventListener('load', flush);
    document.head.append(s);
  }

  function toggle() {
    if (location.hash !== '#toggle-goatcounter') return;
    skip = !skip;
    try { skip ? localStorage.setItem('skipgc', 't') : localStorage.removeItem('skipgc'); } catch {}
    history.replaceState(null, '', location.pathname + location.search);
    const note = document.createElement('div');
    note.textContent = skip ? '📊 This browser is no longer counted in stats.' : '📊 This browser is counted in stats again.';
    note.style.cssText = 'position:fixed;left:50%;top:max(60px,env(safe-area-inset-top));transform:translateX(-50%);z-index:30;'
      + 'background:#ffd166;color:#1b1b1b;font:700 14px system-ui,sans-serif;padding:10px 16px;border-radius:999px;'
      + 'box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:nowrap;pointer-events:none;transition:opacity .5s';
    const show = () => {
      document.body.append(note);
      setTimeout(() => { note.style.opacity = '0'; }, 3500);
      setTimeout(() => note.remove(), 4200);
    };
    document.body ? show() : addEventListener('DOMContentLoaded', show);
    start();
  }

  toggle();
  addEventListener('hashchange', toggle); // typed onto an already-open page
  start();

  function flush() {
    const gc = window.goatcounter;
    if (!gc || !gc.count) return;
    while (queue.length) gc.count(queue.shift());
  }

  function event(name) {
    if (!live) return;
    queue.push({ path: name, title: name, event: true });
    flush();
  }

  // New or returning: once per day per device.
  try {
    const KEY = 'cg.visits';
    const today = Daily.today().key;
    const seen = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!seen) {
      // Someone who played before this was added is returning, not new.
      event(Progress.stats().totalRuns || Progress.endlessRuns || Progress.sprintRuns ? 'visitor-returning' : 'visitor-new');
    } else if (seen.last !== today) {
      event('visitor-returning');
    }
    localStorage.setItem(KEY, JSON.stringify({ first: seen ? seen.first : today, last: today }));
  } catch {}

  return { event };
})();
