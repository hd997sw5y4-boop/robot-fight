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

Original lines written for the game (Window Workshop Games), voiced with the Kokoro v1.0 TTS model (Apache-2.0; voice blend of am_michael / am_onyx / am_fenrir, processed: EQ, compression, -16 LUFS). Only the round start, round end, knockdown and KO lines are used (`sounds/announcer/ann_*.mp3`, 22 clips), played dry plus a light send into the arena reverb.

## Arena reverb

The arena reverb impulse (~1.6 s, early reflections plus a darkening tail) is generated in code at startup (`hookConvolver` in `js/audio.js`); no recording is used. The sub "thump" layer under impacts, falls and footsteps is a synthesized Web Audio sine sweep.

## ambientCG textures — CC0 1.0

- **Metal009** — https://ambientcg.com/view?id=Metal009 — cage/post metal (`textures/metal_*.jpg`).
- **Metal008** (scratched metal) — https://ambientcg.com/view?id=Metal008 — chrome mat color, roughness, metalness, and normal (`textures/chrome_*.jpg`).
- **Rust004** — https://ambientcg.com/view?id=Rust004 — rust and grunge masks mixed into the mat (`textures/rust_*.jpg`).
- **Concrete034** — https://ambientcg.com/view?id=Concrete034 — stadium stands, walls and arena floor (`textures/stadium/concrete_*.jpg`; 1K color + normal, roughness resized to 512).

## Poly Haven HDRI — CC0 1.0

[Industrial Pipe and Valve 01](https://polyhaven.com/a/industrial_pipe_and_valve_01) 2K HDRI (`hdris/industrial_pipe_and_valve_01_2k.hdr`), on by default (Settings → HDRI environment). License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Credit is optional.

## Stadium arena (original design)

The stadium (`js/arena/stadium.js`) is an original layout built from code: stepped concrete bowls, instanced seats and crowd, roof truss, lights and screens. Screen and LED-board graphics are drawn at runtime on canvases with generic text (Robot Fight / Window Workshop Games); no third-party logos, leagues or brands. Its only file asset is ambientCG Concrete034 (CC0 1.0, above).

## Background music — CC0 1.0 (OpenGameArt)

Re-encoded to small Ogg Vorbis files in `sounds/music/`; mixed low in `js/arena/music.js`. No attribution required (credit given anyway).

- **Cathedral in the forest (ambient loop)** — congusbongus, https://opengameart.org/content/cathedral-in-the-forest-ambient-loop — CC0 1.0. Menus and intros. Game file: `sounds/music/menu_cathedral.ogg`.
- **Tense Future Loop** — gmason, https://opengameart.org/content/tense-future-loop — CC0 1.0. Fights (quieter). Game file: `sounds/music/fight_tense_future.ogg`.

## Stadium broadcast and crowd watch

The scoreboard feed, replay graphics and crowd-watch seat (`js/arena/broadcast.js`, `js/arena/crowdcam.js`) are original code with no third-party assets.
