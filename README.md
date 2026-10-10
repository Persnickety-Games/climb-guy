# Climb Guy

A browser climbing game by Persnickety Games. Plain HTML/CSS/JS with no build step, hosted on GitHub Pages.

Mobile, two thumbs, two hands. A blurred start screen waits for a tap, then the climber drops in.

**The daily** is the main event and what the start screen offers. There's one run per day, and everyone gets the same level. The day changes at midnight US Eastern for everyone (`daily.js`). The level comes from a seed made from the date. Ledges, moving, ghost and icy ledges, balloons, wind and birds each get their own seeded random stream, and wind and birds come at set heights. Water speed, ledge sizes and spacing, and feature and balloon frequency get small per-day nudges. Heights count from the ground, the drop starts at the same spot on every screen, and the ⚙ tuning is ignored, so scores compare directly.
- Leaving or reloading mid-run still uses up the day (the height so far is saved as you climb). Missing the catch on the way in (never grabbing a ledge) doesn't count, in any mode: "Missed the catch!", then tap to try the drop again.
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

Developer tuning: add `?tune` to an Endless or Sprint link (e.g. `?mode=endless&tune`) to get the ⚙ button with live tuning sliders, saved in your browser. Runs played with it don't count for anything, and players without `?tune` always get the defaults.

## How to play

`tutorial.js`: five illustrated cards with small looping animations (sides, throw, grab and hold, fling, water and the daily). They open automatically on a brand-new player's first visit (Skip or swipe through), and any time from "❓ How to play" at the bottom of the ☰ menu. The game pauses while they're open.

**Mouse and keyboard** (laptops and desktops): the mouse throws (click, drag down, let go; with one hand free that's the one, with both free it's the one on the side of the climber you clicked). A grabs with the left hand and D with the right (or ← and →); hold the key to hang on, release it to let go. The game switches between touch and mouse controls by whatever the player last used (`window.Controls.mouse`, first guessed from the device), and the hints, tutorial cards and How-to-play cards change wording to match. The hand being aimed gets a thin white ring (on phones too).

**🧪 Experiments** (bottom of ☰ Modes): ideas being tried out, Quick Climb and Grappler. The first time someone opens each one (from the menu or a link), a short wordless clip shows what's different, then "Play ›" (seen flags: `cg.exp.one`, `cg.exp.hook`). Opening one from the menu sends `exp-open-one` / `exp-open-hook`.

**⚡ Quick Climb** (an experiment; `?mode=quick`, also `?mode=one`; it's `one` in the code): no sides and nothing to hold down. Drag anywhere and let go to throw the free hand; tap anywhere while a hand (thrown, or on the way in) is over a ledge and it grabs and holds on by itself, and the other hand lets go, pulling the climber up to it. The mouse works the same way. Otherwise like Endless, with the grab glow; its own best (`cg.oneBest`), nothing else counts, no beginner hints.

**🪝 Grappler** (an experiment, PROTOTYPE: `?mode=grappler`, also `?mode=hook`; it's `hook` in the code; from a Reddit tester's idea): hands are hooks and there's no grabbing. A thrown hook passes through the ledge you're hanging from, bounces off other ledges it hits from below or the side, and catches by itself when it comes down onto the top of one (it falls straight through ghost ledges). When a hook catches higher than the other hand's ledge, the other hand lets go automatically and the climber swings up. It's one-thumb: drag anywhere to throw, and the game picks the hand (a free one, taking turns when both are free; with both hooked, the lower one; nothing while a hook is in the air); the aim arc shows the bounces and rings the spot where it will catch. A falling climber with nothing held hooks on with a hand at the shoulder. Ledges are sparser (mostly one a row, rows 30% further apart) and never stacked: each sits at least 60 units to the side of every ledge in the row below; no tall pillars, narrower checkpoints and start ledge. The opening drop always falls at least a third of the screen before a hook can catch, and the ledges under the drop make sure one does. Otherwise like Endless (random level, water, balloons minus Auto-grab and Swollen). Its own best (`cg.hookBest`); nothing else counts. Grab glow, beginner hints and the A/D keys are off in this mode.

**Grab glow** (everyone, every mode): a free hand touching a ledge it can grab right now gets a pulsing green ring. Not a hurt hand (Ouch!!), not during Auto-grab, and not over a ghost ledge.

**Beginner help** (in training and a player's first 5 runs, across all modes): a short hint when they make a common mistake (tapping or pressing before the hand reaches a ledge; letting go of the holding hand while the other is in the air; clicking to grab on a computer), at most 3 times per hint per run; and, with a mouse, small A and D labels on the hands (also during the opening drop for everyone).

**Intro clip** (`Tutorial.playIntro`, in tutorial.js): training opens with a ~4.5 s wordless loop of the move: hang from one hand, throw the other up, catch, let go of the low hand and swing up. Each thumb is ringed in its hand's color (with a mouse: a mouse drag and the A/D keys). "Let's go" appears once it has played through.

**Training** (shown as "🎓 Tutorial" in ☰ Modes; also `climbguy.xyz/learn`, which goes to `?mode=learn`): brand-new players (no runs yet, haven't finished or skipped it) start here instead of the daily, unless a link asks for Endless or Sprint. It's a guided first climb in two parts. 1) Skills: you start standing on a floor that catches you, with no water and no height count. A coach box shows one move at a time and only moves on when you've done it: throw, grab and hang on for a second, grab with the other hand while keeping the first thumb down, let go low to swing up, then 3 more swing-ups. Each card stays up at least 3 s. 2) Climb: the height count starts where you are, the water starts (60% speed), and the goal is a golden finish ledge 40 m up. Balloons and moving ledges get a short callout as they come on screen, but nothing is required. After a splash in the climb you can try the climb again or skip to the daily, and the start screen has "Skip training". Ghosts, ice, wind and birds stay surprises. Training has its own fixed seed (it never touches the daily), counts toward nothing, and finishing or skipping it marks it (and the How-to-play cards) as seen and leads to today's daily. Events: `learn-started`, `learn-finished`, `learn-splash`, `learn-skipped`.

## Feedback and analytics

- **Feedback** (`feedback.js`): a free-text box (☰ menu footer, and the daily's done screen) that posts to a Google Form, with mode, bests, screen size and browser attached. Set `FORM` to the form id and entry ids. The button stays hidden until then.
- **Analytics** (`analytics.js`): GoatCounter, free, no cookies, visitors by country and region. Events: `visitor-new` and `visitor-returning` (worked out on the device, once a day). Open `climbguy.xyz/#toggle-goatcounter` to stop or restart counting your own browser; the game handles it with a small note instead of GoatCounter's pop-up, `daily-played`, `endless-run`, `sprint-run`, `share-<mode>`, `feedback-sent`, `learn-finished`, `learn-splash`. Set `CODE` to the GoatCounter site code. It only runs on https://climbguy.xyz.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`. Live at https://climbguy.xyz (custom domain set by the `CNAME` file).
