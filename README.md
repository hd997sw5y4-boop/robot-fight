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

Press **Fight again** after a knockout to restart.

Graphics can be set to High or Low in the bottom-right corner.

Hits land on a body part (head, torso, left/right arm, left/right leg). That spot dents and scuffs, sparks fly, and heavy damage makes the part smoke and malfunction (weaker or slower punches, a limp, a jittery head). When a limb or the head is wrecked it tears off, falls onto the mat, and stops working. The torso can be crushed but stays attached. Tiny pips under each health bar show part condition.

The part-to-bone map lives in `js/config.js` (`DAMAGE.bind`) so a later Mixamo-rigged Sketchfab robot can use the same system.

## Credits

- **Robot stand-in:** [RobotExpressive](https://github.com/mrdoob/three.js/tree/r187/examples/models/gltf/RobotExpressive) by [Tomás Laulhé](https://www.patreon.com/quaternius), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Modifications by [Don McCurdy](https://donmccurdy.com/). This model is behind a single config in `js/config.js` so it can later be swapped for a Mixamo-rigged Sketchfab [Robot character](https://sketchfab.com/3d-models/robot-character-2fe59c8ef49547d2a1e0a65506701a7e) by assetfactory (Free Standard license). That Sketchfab model is not included in this build.
- **3D engine:** [three.js](https://threejs.org/) r187, MIT license.
- **Metal textures:** [Metal009](https://ambientcg.com/view?id=Metal009) from ambientCG, CC0 1.0 (resized to 512).
