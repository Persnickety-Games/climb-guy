# Climb Guy

A browser climbing game by Persnickety Games. Plain HTML/CSS/JS with no build step, hosted on GitHub Pages.

Mobile, two thumbs, two hands. A blurred start screen waits for a tap, then the climber drops in.

**The daily** is the main event and what the start screen offers. There's one run per day, and everyone gets the same level. The day changes at midnight US Eastern for everyone (`daily.js`). The level comes from a seed made from the date. Ledges, moving, ghost and icy ledges, balloons, wind and birds each get their own seeded random stream, and wind and birds come at set heights. Water speed, ledge sizes and spacing, and feature and balloon frequency get small per-day nudges. Heights count from the ground, the drop starts at the same spot on every screen, and the ⚙ tuning is ignored, so scores compare directly.
- Leaving or reloading mid-run still uses up the day (the height so far is saved as you climb).
- Afterwards the start screen shows your result, your streak, a countdown to the next daily, Share, and buttons for Endless and Sprint.
- Daily share links are `?daily=<n>&beat=<m>&from=<name>`. A friend who opens one that day gets a line to beat. Endless and Sprint links use `?mode=endless|sprint`.
- `EPOCH` in `daily.js` sets which date is Daily #1.

The rest of the game (also how Endless plays):

 The left half of the screen controls the left hand and the right half controls the right.

- Drag down and release to throw a free hand.
- Tap while the hand is over a ledge to grab it, and keep your thumb down to hold on. Lift it and the hand lets go.
- Arms are elastic: let go with the lower hand and the upper arm flings you up. A held hand limits how far the other can reach.
- Balloons pop when a hand passes through them: green ones are power-ups (first at 30–50 m, then every 35–55 m), red ones are power-downs (first at 125–150 m, then mixed in every 20–35 m). Add `?powerups` to the URL to get balloons from the start. See [ROADMAP.md](ROADMAP.md).
- Moving ledges slide back and forth along their long side, starting at 75–100 m and getting more common as you climb. Hold one and you ride along. Add `?moving` to the URL to get them from the start.
- Ghost ledges are faint decoys with a dotted outline. Hands pass straight through them. They start at 175–200 m and get more common. Add `?ghosts` to the URL to get them from the start.
- Every 100 m there's a golden checkpoint ledge and a celebration. Lines mark your best height and real landmarks at their real heights (a giraffe, Big Ben, the Eiffel Tower…). The sky goes from city to clouds to space.
- Icy ledges (from 225–250 m) slowly slide you off; wind gusts (from 275–300 m) push thrown hands; birds (from 325–350 m) knock thrown hands away. Test from the start with `?icy`, `?wind` or `?birds`.
- Sound is off for now, so the game never interrupts a podcast or music. The synthesized sounds live in `sfx.js` and on the sound board, `sounds.html` (play buttons, synthesis details, measured levels, WAV downloads). To turn sound back on, load `sfx.js` in `index.html` and set `SOUND_ON` in `game.js`.
- Sharing adds `?beat=<height>&from=<name>` to the link; a friend who opens it gets a line to beat and a celebration when they pass it.
- Game over shows your height in a random absurd unit (550+ of them in `units.js`, never repeating your last 30; 🎲 picks another) and a Share button: the phone's share sheet, or copy to clipboard elsewhere.
- The ☰ menu has five tabs:
  - **Stats:** best height, run count, average and totals, plus a chart of your last 30 runs with a table view.
  - **Passport:** the 32 landmarks you've climbed past.
  - **Badges:** 23 badges.
  - **Customize:** equip unlocked bodies, hats, faces, hand and arc colors (each hand and each arc set separately), backdrops, ledge styles and water.
  - **Modes:** Daily (shows today's result once played), Endless, and side modes. **Sprint** is 60 seconds with no rising water and no balloons; it has its own best, its share links add `mode=sprint`, and it doesn't count toward stats. **Classic** opens the one-finger version. Add `?mode=sprint` to the URL to start in Sprint.
- Progress (`progress.js`): stats, best height, total climbed, the passport and the main badges and unlocks come only from the daily. Most skins unlock from total meters climbed in dailies or dailies played, a few from one big daily, and the rest from badges. Endless and Sprint are practice modes with their own bests and their own labeled badges, which unlock a few items of their own. Skin art is in `skins.js`.
- Progress is saved only in the browser (`localStorage`). There's no server or account, so it doesn't follow you to another device or browser.

The ⚙ button has live tuning sliders, saved in your browser (not used in the daily).

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`. Live at https://climbguy.xyz (custom domain set by the `CNAME` file).
