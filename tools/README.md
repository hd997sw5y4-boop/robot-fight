# Robot Fight selftest

Headless Bot vs Bot harness. It does not edit game source. A read-only hook (`window.__rfTest`) is injected with Chrome DevTools Protocol when the page is opened with `?selftest=1`.

## Run

From the game root (with `js/game.js` present):

```bash
node tools/selftest.mjs 3
```

That is the usual sample: 3 fights, time scale 3. Reuses `python3 -m http.server 8765` if it is already serving this tree; otherwise starts one. Chrome is launched headless on CDP port 9341 (not 9333).

Reports are written to `tools/selftest-reports/<timestamp>/report.json` and `report.md`, and copied to `tools/selftest-reports/latest.md`.

Options:

```bash
node tools/selftest.mjs 3 --time-scale 3 --port 8765 --cdp 9341 --gfx low --no-hdri
```

- `--fights N` or a bare `N` — number of fights (default 3)
- `--time-scale S` — multiplies `performance.now` / rAF timestamps in the test page only (default 3)
- `--root DIR` — game root if you are not launching from it
- `--out DIR` — report directory
- `--gfx low|high`, `--hdri` / `--no-hdri` — applied only in the disposable Chrome profile

## What it measures

No gameplay judgement: counts and magnitudes only.

- Feet vs `matTop` beyond ±3 cm while standing (`window.__rfMeasureFeet`)
- Root XZ speed over threshold while the clip is idle/block (0.30 m/s) or attack (1.00 m/s)
- Torso / hips XZ distance below 0.72 m (2 × `COMBAT.bodyRadius`)
- Whiffs vs landed, per attack type (`hitThisAttack` / `atkContact` on attack end)
- Hits with no defender reaction state within 0.2 s (`hit` / `down` / `ko`, or a block)
- Attack spam (starts less than 0.3 s apart)
- Attacking a downed opponent (`down` / `ko` / `getup` / ragdoll)
- Time down and get-up durations
- Ragdoll hover (lowest body point more than 8 cm above the mat)
- KO times and fight length (game seconds)
- Console errors and stuck states

## Hook

`tools/selftest-hook.js` is not referenced by `index.html`. The harness injects it with `Page.addScriptToEvaluateOnNewDocument`. No line in `js/game.js` is required.
