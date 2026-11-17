# Sound, texture, and environment licenses

Robot Fight uses public-domain (CC0) and royalty-free clips and textures that do not require credit. Sources are listed here for the record. Files in `sounds/` and `textures/` are short, recompressed excerpts; original pack archives are not redistributed.

## OpenGameArt — CC0 1.0

No attribution required. Optional credit is appreciated.

- **100 CC0 metal and wood SFX** — rubberduck, https://opengameart.org/content/100-cc0-metal-and-wood-sfx  
  Hammer and metal hits, sheet metal, slams, falling scrap, springs, and tools.  
  Game files: `metal_l_3`, `metal_m_0`–`metal_m_2`, `metal_h_2`, `bounce_*` (sheets), `tear_*`, `cage_0`, `hydro_3`.

- **100 CC0 SFX** — rubberduck, https://opengameart.org/content/100-cc0-sfx  
  Additional metal hits and slams, recorded machine/spring bursts used as servo and hydraulic layers, noise crackles, and a crash/explosion.  
  Game files: `metal_l_4`, `metal_l_5`, `metal_m_5`, `metal_h_3`, `metal_h_4`, `metal_h_6`, `punch_*`, `servo_0`–`servo_2`, `servo_4`, `hydro_0`–`hydro_2`, `spark_1`, `spark_2`, `crash_1`, `crash_3`, `crash_4`, `tear_3`, `cage_1`.

- **Wood and Metal Sound Effects: Volume 2** — Ogrebane, https://opengameart.org/content/wood-and-metal-sound-effects-volume-2  
  Recorded metal impacts. Game files: `metal_m_3`, `metal_m_4`, `metal_h_5`, `cage_2`.

- **Metal Interactions** — Iwan “qubodup” Gabovitch, https://opengameart.org/content/metal-interactions  
  Recorded metal contacts, buttons, and a swing. Game files: `block_0`–`block_2`, `bounce_3`, `servo_5`.

- **Metal Impact Sounds** — Brian MacIntosh, https://opengameart.org/content/metal-impact-sounds  
  Recorded clinks, thuds, and a long bong. Game files: `metal_l_0`–`metal_l_2`, `metal_h_0`, `metal_h_1`, `punch_3`, `bounce_2`.

- **Metal footsteps on concrete** — Thimras, https://opengameart.org/content/metal-footsteps-on-concrete  
  Recorded metal-foot steps, 48 kHz. Game files: `step_01` … `step_23`.

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
  Fight bells only (combat impacts were replaced with recorded metal).  
  Game files: `bell_*`.

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


## Arena reverb

`ir_hall.ogg` is an original, short hall impulse generated for this game (not a third-party recording). It feeds a light Web Audio convolver on the SFX bus.

## ambientCG textures — CC0 1.0

- **Metal009** — https://ambientcg.com/view?id=Metal009 — cage/post metal (`textures/metal_*.jpg`).
- **Metal008** (scratched metal) — https://ambientcg.com/view?id=Metal008 — chrome mat color, roughness, metalness, and normal (`textures/chrome_*.jpg`).
- **Rust004** — https://ambientcg.com/view?id=Rust004 — rust and grunge masks mixed into the mat (`textures/rust_*.jpg`).

## Poly Haven HDRI — CC0 1.0

[Industrial Pipe and Valve 01](https://polyhaven.com/a/industrial_pipe_and_valve_01) 2K HDRI (`hdris/industrial_pipe_and_valve_01_2k.hdr`), used when `ARENA.hdri` or the Settings toggle is on. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Credit is optional.
