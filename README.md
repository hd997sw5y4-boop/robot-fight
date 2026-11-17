# Robot Fight

A 3D robot fighting game by Window Workshop Games (placeholder name).

Play: https://robot-fight-six.vercel.app

Desktop only in this first version. Open the link in a web browser.

## Controls

- **A / D** (or left / right arrows) — sidestep
- **W / S** (or up / down arrows) — step in / out (toward or away from the other robot)
- **J** — punch
- **K** — kick
- **L** — block (hold)
- **Gamepad** (optional) — left stick or D-pad to move, button A/× punch, B/○ kick, X/□ or a shoulder button to block
- **Esc** or the gear button at the top — Settings (pauses the fight)

Press **Fight again** after a knockout to restart.

Settings (saved in the browser) include graphics quality, master and SFX volume, camera shake, CPU difficulty, an optional round timer, a controls overlay, a read-only keyboard/gamepad list, and an FPS counter.

Hits land on a body part (head, torso, left/right arm, left/right leg). That spot dents and scuffs, sparks fly, and heavy damage makes the part smoke and malfunction (weaker or slower punches, a limp, a jittery head). When a limb or the head is wrecked it tears off, falls onto the mat, and stops working. The torso can be crushed but stays attached. Tiny pips under each health bar show part condition.

The part-to-bone map lives in `js/config.js` (`DAMAGE.bind`) so a later Mixamo-rigged Sketchfab robot can use the same system.

## Credits

- **Robot fighter:** [Robot character](https://sketchfab.com/3d-models/robot-character-2fe59c8ef49547d2a1e0a65506701a7e) by assetfactory, Sketchfab Free Standard license (recolored in-game; original source files are not redistributed). See `models/CREDITS.md`.
- **Animations:** [Mixamo](https://www.mixamo.com) (Adobe). Punch, kick, block, hit, stunned, knocked out, and getting up. Idle is Fighting Idle (Injured Stumble Idle when badly hurt). W/S use Walking / Walking Backwards; A/D use Jog Strafe Left / Right. Heavy hits can play Stumble Backwards.
- **3D engine:** [three.js](https://threejs.org/) r187, MIT license.
- **Arena metal textures:** [Metal009](https://ambientcg.com/view?id=Metal009) from ambientCG, CC0 1.0 (resized to 512).
- **Settings panel look and volume taper:** adapted from Window Workshop Games UI (periwinkle frosted sheet, squared master-volume taper, graphics quality control). Only those pieces were reused.
