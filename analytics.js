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
  const live = !!CODE && location.protocol === 'https:' && location.hostname === 'climbguy.xyz';
  const queue = [];

  if (live) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
    s.addEventListener('load', flush);
    document.head.append(s);
  }

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
