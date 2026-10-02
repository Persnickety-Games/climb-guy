# Two Thumbs Up roadmap (formerly Climber)

Ideas captured for later. Nothing here is built yet unless marked done.

## Daily game (Wordle-style)

- **One run per day.** Each player gets one attempt at the daily climb. After it ends, they can't play again until the next day starts. The reset time is still to be decided, e.g. midnight local time or one fixed global time.
- **Same game for everyone.** Everyone plays the same level layout, settings and balloon placements that day, so scores compare like for like. This needs a seeded random number generator, seeded from the date, in place of `Math.random()`.
- **Something different every day,** the same for everyone. Examples:
  - ledge shapes or sizes
  - water speed
  - a third hand
  - two climbers, one per hand, and you keep both alive
  - more ideas to come; the more creative the better
- **Easy sharing.** One tap shares the day's result as text plus a link to the site, like Wordle or MapTap. This viral loop matters. *(Started: game over has a Share button with the height in a random absurd unit, the date and the link. The daily version will add the day's number.)*
- **Personal records.** Track high scores over time.
- **Awards and achievements,** including streaks for consecutive days above certain heights. A missed day resets the streak.
- **Friend leaderboards.**
- **Archive** of past daily climbs, so people can replay them after the 24 hours are up.
- **Stars (idea, removed for now).** Collectibles placed off the safe route. They need a purpose before coming back, for example: every 5 stars spawns a power-up balloon, 10 stars buys one rescue from the water, or stars unlock cosmetics over time. Unlocks fit best with the daily mode's return visits.

### Technical notes

- Most of this can work with no server: seeded daily levels, one run per day, personal records, streaks, achievements, share text and the archive can all run in the browser with `localStorage`.
- Friend leaderboards, and any cross-device history, need a backend with accounts or friend codes.
- Before the daily mode can work, all game randomness has to go through one seeded generator, including level generation and balloons.

## Power-ups (done)

Balloons pop when a hand passes through them. Green balloons are power-ups. The first appears between 30 and 50 m, then one every 35–55 m, so there is never more than one on screen. Red balloons are power-downs. The first appears between 125 and 150 m, and after that a balloon (green or red) appears every 20–35 m. Add `?powerups` to the URL to get balloons from the start for testing.

| Balloon | Effect |
| --- | --- |
| 🎯 Auto-grab | For 10 s, no tapping: a thrown hand grabs the highest ledge on its arc and holds on by itself, and the other hand lets go once it has. Hands can only let go by grabbing somewhere new with the other hand. A hand still auto-held when the timer ends stays held until the other hand grabs a new ledge. |
| 🔍 Swollen | Every ledge on screen grows 25%, and ledges that scroll on in the next 10 s arrive enlarged. |
| ❄️ Freeze | The water stops rising for 10 s and turns to ice. |
| 🚀 Rocket (rare) | Blast off 100 m, then drop in from the top of the screen and catch a ledge. |
| 💥 Breakaway | Ledges that scroll onto the screen in the next 10 s break after 5 s of total hold time. |
| 🌊 Flash flood | The water rises 25% faster for 10 s. |
| 🤕 Ouch!! | The hand that popped it can't grab for 5 s. It can still be thrown, and it glows red while hurt. |

### Parked

- 🧈 Butterfingers (both hands let go). Removed because it was effectively instant death. It could come back with a softer version, e.g. only the lower hand lets go, or a short grace period to re-grab.

## Sound (later)

- Review every sound on the sound board and give feedback by number.
- Improve the synthesis (envelopes, layering, level-matching) while keeping it all in code.
- When sound comes back: off by default or "ambient" so it mixes with podcasts and music instead of pausing them, plus a mute toggle.

## Done: stickiness batch

- Stats page with a chart of your last 30 runs and a table view.
- Landmark passport (32 landmarks).
- 23 badges.
- Skins unlocked by height and by badges, with a customization screen. Skins cover the body, hat, face, each hand and arc color separately, backdrop, ledges and water.
- "Next unlock" on game over.
- Everything is saved on the device with `localStorage`, with no backend.

Decided against: ghost run, technique tips.

### Ideas for later

- Backup code: export and import progress as a short text code, for moving to a new phone.

## Done: fun, challenge and sharing batch

- Challenge links (`?beat=152&from=Troy`) with a line to beat and a celebration when you pass it.
- Link preview card (`two-thumbs-up/og.png`) and home-screen icon.
- Name: Two Thumbs Up.
- Synthesized sound effects (built, then switched off for now so the game never interrupts a podcast; review them on `two-thumbs-up/sounds.html`).
- Climber personality: worried near the water, grin after a big fling, scream when falling.
- "Your best" line, landmarks at real heights, city → clouds → dusk → space.
- Golden checkpoint ledges and a celebration every 100 m.
- Icy ledges, wind gusts and birds.

### Decided against

Bouncy ledges, phone vibration, random funny endings, share image, and a Wordle-style emoji summary in the share text (tried, then reverted: the emojis needed explaining).
