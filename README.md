# Arcade

Simple browser games for mobile and desktop. Plain HTML/CSS/JS with no build step, hosted on GitHub Pages.

## Games

- **Climber** (`climber/`, mobile): two thumbs, two hands. The left half of the screen controls the left hand and the right half controls the right.
  - Drag down and release to throw a free hand.
  - Tap while the hand is over a ledge to grab it, and keep your thumb down to hold on. Lift it and the hand lets go.
  - Arms are elastic: let go with the lower hand and the upper arm flings you up. A held hand limits how far the other can reach.
  - Balloons pop when a hand passes through them: green ones are power-ups (from 100 m), red ones are power-downs (from 300 m). Add `?powerups` to the URL to get balloons from the start. See [ROADMAP.md](ROADMAP.md).
- **Climber Classic** (`climber-classic/`): the original one-finger version. Drag to slingshot, and the hand auto-grabs near the top of its arc.

Both have a ⚙ button with live tuning sliders, saved in your browser.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Deploy

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`.
