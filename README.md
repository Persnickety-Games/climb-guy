# Arcade

Simple browser games for mobile and desktop. Plain HTML/CSS/JS with no build step, hosted on GitHub Pages.

## Games

- **Two Thumbs Up** (`two-thumbs-up/`, mobile; originally "Climber"): two thumbs, two hands. The left half of the screen controls the left hand and the right half controls the right.
  - Drag down and release to throw a free hand.
  - Tap while the hand is over a ledge to grab it, and keep your thumb down to hold on. Lift it and the hand lets go.
  - Arms are elastic: let go with the lower hand and the upper arm flings you up. A held hand limits how far the other can reach.
  - Balloons pop when a hand passes through them: green ones are power-ups (first at 30–50 m, then every 35–55 m), red ones are power-downs (first at 125–150 m, then mixed in every 20–35 m). Add `?powerups` to the URL to get balloons from the start. See [ROADMAP.md](ROADMAP.md).
  - Moving ledges slide back and forth along their long side, starting at 75–100 m and getting more common as you climb. Hold one and you ride along. Add `?moving` to the URL to get them from the start.
  - Ghost ledges are faint decoys with a dotted outline. Hands pass straight through them. They start at 175–200 m and get more common. Add `?ghosts` to the URL to get them from the start.
  - Every 100 m there's a golden checkpoint ledge and a celebration. Lines mark your best height and real landmarks at their real heights (a giraffe, Big Ben, the Eiffel Tower…). The sky goes from city to clouds to space.
  - Icy ledges (from 225–250 m) slowly slide you off; wind gusts (from 275–300 m) push thrown hands; birds (from 325–350 m) knock thrown hands away. Test from the start with `?icy`, `?wind` or `?birds`.
  - Sound effects are made in code (Web Audio). 🔊 toggles mute.
  - Sharing adds `?beat=<height>&from=<name>` to the link; a friend who opens it gets a line to beat and a celebration when they pass it.
  - Game over shows your height in a random absurd unit (about 300 of them in `two-thumbs-up/units.js`, never repeating your last 30; 🎲 picks another) and a Share button: the phone's share sheet, or copy to clipboard elsewhere.
- **Two Thumbs Up Classic** (`two-thumbs-up-classic/`): the original one-finger version. Drag to slingshot, and the hand auto-grabs near the top of its arc.

Both have a ⚙ button with live tuning sliders, saved in your browser.

`climber/` and `climber-classic/` just forward to the new addresses.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`.
