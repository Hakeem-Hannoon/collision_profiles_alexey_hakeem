# STELLAR // Simulation Observatory

Dark, space-themed interactive static site for exploring PNG outputs of
N-body simulations. Pure HTML / CSS / vanilla JS — no backend, no build
step, no dependencies.

## File tree

```
.
├── index.html           # Single page entry point
├── styles.css           # All styling
├── app.js               # Data loading, parsing, rendering, interactivity
├── data/
│   └── files.json       # Manifest of available PNG filenames
└── images/              # Drop your *.png simulation outputs here
```

## Filename format

Every PNG must be named:

```
d_<d>_N_<N>_tau_<tau>_rinit_<rinit>_T_<T>_count_<count>.png
```

Example: `d_03_N_12_tau_09_rinit_15000R_T_100bil_count_384.png`

Fields are parsed with the regex:

```js
/^d_(\d+)_N_(\d+)_tau_([^_]+)_rinit_([^_]+)_T_([^_]+)_count_(\d+)\.png$/i
```

The app tolerates the unit-bearing tokens (`15000R`, `100bil`,
`1trillion`) and converts them to numeric values for sorting.
Malformed entries in `files.json` are logged to the console and skipped.

## Updating the dataset

1. Place new PNGs into `images/`.
2. Add their filenames to `data/files.json` — just the filenames, not paths:
   ```json
   [
     "d_03_N_12_tau_09_rinit_15000R_T_100bil_count_384.png",
     "d_03_N_16_tau_12_rinit_15000R_T_100bil_count_1024.png"
   ]
   ```
3. Reload. All unique `N`, `d`, `tau`, `rinit`, `T`, and `count` values
   are inferred from the manifest — nothing is hardcoded.

If an image file is missing but is listed in the manifest, the UI will
render a procedural SVG fallback (orbital rings + phyllotactic particle
distribution) keyed on that run's `N` and `d`.

## GitHub Pages deployment

1. Commit the project to a GitHub repo.
2. Settings → Pages → Deploy from a branch → `main` / root → Save.
3. All paths in the site are relative, so it works from
   `https://<user>.github.io/<repo>/` without config changes.

For a user/org site at `https://<user>.github.io/` just push to the
root of a repo named `<user>.github.io`.

## Features

- **Cascading navigation**: N → d → gallery. Clicking an N card filters
  down to its available dimensions; clicking a dimension reveals runs.
- **Filters**: N, d, τ, r_init, T, count — all with multi-select chips.
- **Sort**: N↑·d↑ (default), N↓·d↑, d↑·N↑, count↓.
- **Lightbox**: mouse-wheel zoom, drag to pan, pinch-to-zoom on touch,
  keyboard `← →` to navigate, `+ − 0` to zoom, `Esc` to close.
- **Comparison**: ◎ on each card queues to the bottom tray; open the
  comparison modal to see tiles side-by-side with full metadata labels.
- **Responsive**: sidebar collapses behind a hamburger on ≤ 960 px,
  single-column layouts below 620 px, grid of one for mobile comparison.
- **Empty / loading / error states**: all three explicitly handled.

## Easter eggs

- Hover the `.` in **STELLAR.** — briefly becomes a black hole that
  bends nearby stars.
- A satellite crosses the top of the screen roughly every 45 seconds.
- A comet streaks across every 12–28 seconds.
- Every 30-ish seconds, a small Ursa-like constellation fades into one
  of the screen corners.

## Browser support

Modern evergreen browsers. Uses `backdrop-filter`, CSS `@property`,
pointer events, and `ResizeObserver`-equivalents via `resize` listeners.
Gracefully degrades: fallback SVG renders if `img.onerror` fires, and
cursor effects are disabled on touch devices (`hover: none`).

## License

Do whatever you want with this; attribution appreciated.
