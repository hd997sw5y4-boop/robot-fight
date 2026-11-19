# Sound, texture, and environment licenses

Robot Fight uses public-domain (CC0) and royalty-free clips and textures that do not require credit. Sources are listed here for the record. Files in `sounds/` and `textures/` are short, recompressed excerpts; original pack archives are not redistributed.

## OpenGameArt — CC0 1.0

No attribution required. Optional credit is appreciated.

- **100 CC0 metal and wood SFX** — rubberduck, https://opengameart.org/content/100-cc0-metal-and-wood-sfx  
  Hammer and metal hits, sheet metal, slams, falling scrap, springs, and tools.  
  Game files: `metal_m_0`–`metal_m_2`, `metal_h_2`, `tear_*`, `cage_0`, `hydro_3`.

- **100 CC0 SFX** — rubberduck, https://opengameart.org/content/100-cc0-sfx  
  Additional metal hits and slams, recorded machine/spring bursts used as servo and hydraulic layers, noise crackles, and a crash/explosion.  
  Game files: `metal_m_5`, `metal_h_3`, `metal_h_4`, `metal_h_6`, `punch_*`, `servo_0`–`servo_2`, `servo_4`, `hydro_0`–`hydro_2`, `spark_1`, `spark_2`, `crash_1`, `crash_3`, `crash_4`, `tear_3`, `cage_1`.

- **Wood and Metal Sound Effects: Volume 2** — Ogrebane, https://opengameart.org/content/wood-and-metal-sound-effects-volume-2  
  Recorded metal impacts. Game files: `metal_m_3`, `metal_m_4`, `metal_h_5`, `cage_2`.

- **Metal Interactions** — Iwan “qubodup” Gabovitch, https://opengameart.org/content/metal-interactions  
  Recorded metal contacts, buttons, and a swing. Game files: `block_0`–`block_2`, `servo_5`.

- **Metal Impact Sounds** — Brian MacIntosh, https://opengameart.org/content/metal-impact-sounds  
  Recorded thuds and a long bong. Game files: `metal_h_0`, `metal_h_1`, `punch_3`.

- **Metal footsteps on concrete** — Thimras, https://opengameart.org/content/metal-footsteps-on-concrete  
  Recorded metal-foot steps, 48 kHz, pitched down ~34% with a low-shelf boost for heavy servo stomps. Game files: `stomp_m_*`.

- **Mech Stomp / Step Sound** — hc, based on a recording by qubodup, https://opengameart.org/content/mech-stomp-step-sound  
  Game files: `crash_2`.

- **Factory ambiance** — yd, https://opengameart.org/content/factory-ambiance  
  A mid section was looped, filtered, and ducked as the arena hum. Game file: `arena_hum.ogg`.

## Kenney — CC0 1.0

No attribution required. Optional credit is appreciated: [Kenney](https://kenney.nl).

- **Interface Sounds** — https://kenney.nl/assets/interface-sounds  
  Also on [OpenGameArt](https://opengameart.org/content/interface-sounds).  
  UI clicks, ticks, confirm, and close.  
  Game files: `ui_click.ogg`, `ui_click_2.ogg`, `ui_tick.ogg`, `ui_confirm.ogg`, `ui_close.ogg`.

- **Furniture Kit** — https://kenney.nl/assets/furniture-kit  
  Desk, office chair, laptop, keyboard, monitor and mouse used in the pit-crew corners (`models/pit-crew/desk.glb`, `chairDesk.glb`, `laptop.glb`, `computerKeyboard.glb`, `computerScreen.glb`, `computerMouse.glb`).

- **Factory Kit** — https://kenney.nl/assets/factory-kit  
  Floor crane, hoist, tall frame, crate, cog, robot arm and lever used as the pit-crew lifting rack and tools (`models/pit-crew/crane.glb`, `crane-lift.glb`, `structure-tall.glb`, `box-small.glb`, `cog-a.glb`, `robot-arm-a.glb`, `lever-single.glb`).

- **Impact Sounds** — https://kenney.nl/assets/impact-sounds  
  Fight bells, plus heavy-robot impact layers. The impact layers are pitched down 20–38% with a
  low-shelf boost (ffmpeg) so they read as human-size machines: `impactMetal_heavy` → `clank_h_*`
  (debris on the mat), `impactPlate_heavy` / `impactPlate_medium` → `plate_h_*` / `plate_m_*`
  (big metal impact), `impactPunch_heavy` → `thud_*` (body thud), `impactMining` → `rattle_*`
  (short debris rattle), `footstep_concrete` → `stomp_k_*` (stomp body).  
  Game files: `bell_*`, `clank_h_*`, `plate_h_*`, `plate_m_*`, `thud_*`, `rattle_*`, `stomp_k_*`.

## Brian MacIntosh (BMacZero) — CC0 1.0

[Electricity Sound Effects](https://opengameart.org/content/electricity-sound-effects-0) on OpenGameArt. Recorded from a small Tesla generator. Credit is optional.

- `spark.wav` → `spark_0.ogg` (spark crackle)
- `continuousspark.wav` → `buzz_loop.ogg` (looped electrical buzz on damaged parts)

## Mixkit — Mixkit License (royalty-free, no attribution required)

[Mixkit License](https://mixkit.co/license/): free for commercial and non-commercial use; attribution not required. Clips from the [crowd sound-effects](https://mixkit.co/free-sound-effects/crowd/) library.

| Mixkit title | ID | Game file |
| --- | --- | --- |
| Big crowd talking loop | 364 | `crowd_loop.ogg` (ambience bed) |
| Stadium joy shouting crowd | 3022 | `crowd_stadium.ogg` |
| Huge crowd cheering victory | 462 | `crowd_win.ogg` |
| Cheering crowd loud whistle | 610 | `crowd_whistle.ogg` |
| Male crowd cheering short | 459 | `crowd_short.ogg` |
| Crowd at the stadium | 2111 | `crowd_stadium_short.ogg` |

Full-quality WAV masters were downloaded from Mixkit and recompressed to mono OGG for the game.


## Announcer voice

Original lines written for the game (Window Workshop Games), voiced with the Kokoro v1.0 TTS model (Apache-2.0; excited Voice D blend of am_michael / am_onyx / am_fenrir, phrase-level prosody, no pitch shift; EQ, compression, -16 LUFS). The full event set lives in `sounds/announcer/` (108 clips plus `manifest.json`): intro and blue/red walkouts, round starts, FIGHT, big hits and combos, knockdowns and get-ups, torn parts and a lost head, jump kicks and dodges, low health, the last 10 seconds, round end, decision, KO, winner, and rematch. Clips are dry; a light send into the arena reverb is applied at runtime (`js/announcer.js`, `js/audio.js`).

## Arena reverb

The arena reverb impulse (~1.6 s, early reflections plus a darkening tail) is generated in code at startup (`hookConvolver` in `js/audio.js`); no recording is used. The sub "thump" layer under impacts, falls and footsteps is a synthesized Web Audio sine sweep.

Walking footsteps layer existing CC0 Kenney `thud_*` + `clank_h_*` (and sometimes `metal_m_*`) with a light rubberduck `servo_*` and a short sub thump, pitched per plant, synced to foot contacts. The older Thimras `stomp_m_*` and Kenney `stomp_k_*` concrete-stomp layers are no longer used for walking.

## ambientCG textures — CC0 1.0

- **Metal001** — https://ambientcg.com/view?id=Metal001 — octagon fighting mat base (1K JPG color, OpenGL normal, roughness, metalness; `textures/mat_metal_*.jpg`), tiled in world XZ. Painted start lines, corner wedges, ROBOT FIGHT text and the LED edge are a transparent decal layered on top (`matDecalTexture` in `js/arena.js`).
- **Metal009** — https://ambientcg.com/view?id=Metal009 — cage/post metal (`textures/metal_*.jpg`); also applied to pit-crew racks and tools.
- **Wood062** — https://ambientcg.com/view?id=Wood062 — pit-crew desks and chairs (1K JPG color, OpenGL normal, roughness, resized to 512; `textures/pit-crew/wood_*.jpg`).
- **Metal008** (scratched metal) — https://ambientcg.com/view?id=Metal008 — previously the chrome mat; the chrome texture files have been removed.
- **Rust004** — https://ambientcg.com/view?id=Rust004 — rust and grunge masks previously mixed into the chrome mat the rust texture files have been removed.
- **Concrete034** — https://ambientcg.com/view?id=Concrete034 — stadium stands and walls (`textures/stadium/concrete_*.jpg`; color and normal are non-square 1024×512, roughness 512). No longer used on the arena floor.
- **Concrete023** — https://ambientcg.com/view?id=Concrete023 — polished dark concrete arena floor outside the ring (`textures/stadium/floor_*.jpg`; square 1K JPG color, OpenGL normal, roughness), tiled at 4 m.

## Quaternius — CC0 1.0

[Ultimate Modular Men Pack](https://quaternius.com/packs/ultimatemodularcharacters.html) (CC0 1.0). Worker, Casual and Casual2 characters used as the blue and red pit-crew figures (`models/pit-crew/Worker.glb`, `Casual.glb`, `Casual2.glb`). Suit character used as team owners/managers beside each pit (`models/pit-crew/Suit.glb`). Idle, typing, cheer, clap and arms-crossed poses are applied on the pack's CharacterArmature at runtime (the showcase GLBs ship without clips). No attribution required; credit is given anyway.

## Poly Haven HDRI — CC0 1.0

[Industrial Pipe and Valve 01](https://polyhaven.com/a/industrial_pipe_and_valve_01) 2K HDRI (`hdris/industrial_pipe_and_valve_01_2k.hdr`), on by default (Settings → HDRI environment). License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Credit is optional.

## Stadium arena (original design)

The stadium (`js/arena/stadium.js`) is an original layout built from code: stepped concrete bowls, instanced seats and crowd, roof truss, lights and screens. Screen and LED-board graphics are drawn at runtime on canvases with generic text (Robot Fight / Window Workshop Games); no third-party logos, leagues or brands. File assets: ambientCG Concrete034 on the stands and walls, ambientCG Concrete023 on the arena floor (CC0 1.0, above).

## Background music — CC0 1.0 (OpenGameArt)

Re-encoded to small Ogg Vorbis files in `sounds/music/`; mixed low in `js/arena/music.js`. No attribution required (credit given anyway).

- **Cathedral in the forest (ambient loop)** — congusbongus, https://opengameart.org/content/cathedral-in-the-forest-ambient-loop — CC0 1.0. Menus and intros. Game file: `sounds/music/menu_cathedral.ogg`.
- **Tense Future Loop** — gmason, https://opengameart.org/content/tense-future-loop — CC0 1.0. Fights (quieter). Game file: `sounds/music/fight_tense_future.ogg`.

## Stadium broadcast and crowd watch

The scoreboard feed, replay graphics and crowd-watch seat (`js/arena/broadcast.js`, `js/arena/crowdcam.js`) are original code with no third-party assets.
