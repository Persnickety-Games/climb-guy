# Climb Guy: working notes

Live at https://climbguy.xyz (GitHub Pages from `main`). Real players use it, including people from Reddit.

## Standing rule: level-affecting changes go live just after midnight Eastern

The daily level is generated on each phone from the date (`daily.js`) plus the game's level code. If that code changes mid-day, anyone who loads the game afterwards gets a different layout for the same daily than people who already played it, which breaks "same level for everyone."

- **Level-affecting** (hold until just after 12:00 am America/New_York, then push):
  - anything in `game.js` that builds or places ledges, moving, ghost or icy ledges, checkpoints, balloons, wind or birds
  - the order of calls on the seeded streams (`R.rows`, `R.features`, `R.balloons`, `R.wind`, `R.birds`, `R.day`)
  - the `DAY` nudges, `DROP_TOP`, `DEFAULTS` tuning values, water speed, physics constants
  - `daily.js` (seeding, `EPOCH`, time zone)
- **Safe any time**: menus, text, skins and art, badges and unlocks, stats, tutorial, feedback, analytics, sharing, Endless or Sprint-only rules that don't touch daily generation.

When unsure, treat it as level-affecting. Develop and test it, keep it off `main`, and push it after midnight Eastern (or when the person asks).

## Player-facing text: keep it short

People don't like reading. Menu cards, buttons, prompts and callouts say only what's needed to act, in as few words as possible. Leave out explanations of why something exists or who it's for (e.g. a Tutorial card is "Learn the basics.", not "in case you skipped it"). Most things should be intuitive without text.

## Don't change

- `EPOCH` in `daily.js` (Daily #1 = 2026-10-02): players have already shared daily numbers.
- Saved data keys in `localStorage` (`tt.profile.v1`, `cg.*`, `climber.*`, `skipgc`): changing them wipes players' progress.

## Testing

No build step. The headless Playwright scripts that have been used for testing live outside the repo. Before pushing, check that the page loads with no console errors in Daily, `?mode=endless` and `?mode=sprint`.
