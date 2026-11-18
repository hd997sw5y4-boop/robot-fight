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

A knockdown lets the robot settle, blend back into **Getting Up**, and keep fighting. Only a real knockout (health gone, head gone, or both legs gone) stays down; then the robots remain where they fell (no automatic rematch). A slow camera orbit plays, and **Fight again** (or **R** / **Enter**) is the only way to start another fight.

Settings (saved in the browser) include graphics quality, a field-of-view slider (45–90°, also zoomed with the mouse wheel), a lighting/brightness slider (50–200%), master, SFX, and crowd/ambience volume, camera shake, CPU difficulty, an optional round timer, a controls overlay, a read-only keyboard/gamepad list, and an FPS counter.

Hits land on a body part (head, torso, left/right arm, left/right leg). That spot dents and scuffs, sparks fly, and heavy damage makes the part smoke and malfunction (weaker or slower punches, a limp, a jittery head). When a limb or the head is wrecked it tears off, falls onto the mat, and stops working. The torso can be crushed but stays attached. Tiny pips under each health bar show part condition.

The part-to-bone map lives in `js/config.js` (`DAMAGE.bind`) so a later Mixamo-rigged Sketchfab robot can use the same system.

## Credits

- **Robot fighter:** [Robot character](https://sketchfab.com/3d-models/robot-character-2fe59c8ef49547d2a1e0a65506701a7e) by assetfactory, Sketchfab Free Standard license (recolored in-game; original source files are not redistributed). See `models/CREDITS.md`.
- **Animations:** [Mixamo](https://www.mixamo.com) (Adobe). Punch, kick, block, hit, stunned, knocked out, and getting up. Idle is Fighting Idle (Injured Stumble Idle when badly hurt). W/S use Walking / Walking Backwards; A/D use Jog Strafe Left / Right. Heavy hits can play Stumble Backwards.
- **3D engine:** [three.js](https://threejs.org/) r187, MIT license.
- **Arena metal textures:** [Metal009](https://ambientcg.com/view?id=Metal009) from ambientCG, CC0 1.0 (resized to 512).
- **Settings panel look and volume taper:** adapted from Window Workshop Games UI (periwinkle frosted sheet, squared master-volume taper, graphics quality control). Only those pieces were reused.
- **Sound effects:** CC0 and royalty-free clips (no credit required). Sources and licenses are listed in `CREDITS/LICENSES.md`.
- **Physics:** [cannon-es](https://github.com/pmndrs/cannon-es) (MIT), vendored from the official package. Fighter capsules, cage/posts, ragdoll knockdowns and KOs, and detached parts that bounce then settle.

## Arenas

- **Stadium** (default): an original indoor stadium around the same fight mat, in `js/arena/stadium.js` with its config/flag in `js/arena/stadium-config.js` (`STADIUM.enabled`, `STADIUM.defaultArena`). Two tiered bowls with instanced seats and crowd, roof truss, ring spot cans with fake light cones, flood banks, a center-hung four-sided scoreboard, end-wall screens and LED ribbon boards. Low graphics uses fewer crowd/seat instances, a simpler truss, fewer cones and no extra lights. Only the existing mat spotlight casts shadows.
- **Industrial**: the original chrome mat under the Poly Haven Industrial Pipe and Valve HDRI.

- **Crowd watch** (`js/arena/crowdcam.js`): camera view `crowd` in the V-key cycle and Settings → Camera view — a seat in the lower bowl; drag to look, double-click to recenter. On headsets that support `immersive-vr` an **Enter VR** button seats you there (seated `local` reference space, meters; no camera motion is applied in VR).
- **Broadcast feed** (`js/arena/broadcast.js`): the hanging scoreboard and end-wall screens show a 384×216 live feed (16 fps, 8 fps in VR, no extra shadow pass) that auto-cuts between wide, ringside low, overhead and close-ups. Big hits, knockdowns, torn-off parts and the KO get a slow-motion instant replay from a different angle with a REPLAY tag (a ring buffer of fighter node transforms, read-only state polling). Off on Low graphics (static screen art).
- **Music** (`js/arena/music.js`): two CC0 loops, quieter in fights, ducked under the announcer, through the game's own audio master bus. Settings → Sound → Music (saved as `rf_music`). Starts after the first click or key press.

Pick one in Settings → Display → Arena (saved in `localStorage` as `rf_arena`). Switching disposes the stadium's geometry, textures, lights and environment map. The mat, ring colliders and grounding are the same in both. Hooks in `js/game.js` are marked `[stadium-arena hook]`.

The octagon cage/fence is turned off for now (`ARENA.cage` in `js/config.js`); an invisible ring collider still keeps fighters and loose parts on the mat.

The menu/arcade shell can start and end fights through `js/api.js` (`startFight`, `onFightEnd`, `setFighterConfig` with paint colors and AI personality). Flip attacks and win celebrations will use upcoming Mixamo clips (`MODEL.animations.flipSpecial` / `victory`); missing names are skipped until that pack is in the GLB.

## Fighter select

`js/shell/fighter-select.js` + `css/fighter-select.css` replace the shell's select screen (hooked from `js/shell/menus.js`). Two turntable previews clone the real in-game fighter (same GLB, tint, visor, idle clip), lit with a key/fill and a rim tinted to the side color (P1 blue, P2 red). Stat bars read `COMBAT` / `DAMAGE` from `js/config.js` (Power = average punch/kick damage, Speed = move speed, Armor = total part HP, Reach = kick reach) against reference ceilings in `STAT_SCALE`. Add robots to the `ROBOTS` array; locked entries show as "Coming soon". The Player/CPU toggles switch modes: P2 picks Fight (CPU) or Versus (Player); P1 CPU picks Bot vs Bot. Arcade and Training keep P1 as the player and P2 as the CPU or dummy. Select sounds reuse the Kenney Interface Sounds (CC0) already in `sounds/` and follow the Settings volume.
