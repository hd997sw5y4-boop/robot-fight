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
| Big crowd talking loop | 364 | `crowd_loop.ogg` (quiet ambience bed) |
| Huge crowd cheering victory | 462 | `crowd_win.ogg` |
| Cheering crowd loud whistle | 610 | `crowd_whistle.ogg` |
| Male crowd cheering short | 459 | `crowd_short.ogg` |

Full-quality WAV masters were downloaded from Mixkit and recompressed to mono OGG for the game.


## Announcer voice

Original lines written for the game (Window Workshop Games). 97 of the 108 clips in `sounds/announcer/` are voiced with Chatterbox TTS (Resemble AI, MIT license; outputs carry Resemble's inaudible PerTh watermark) at exaggeration 1.2, using a synthetic Kokoro v1.0 am_onyx clip (Apache-2.0) as the voice prompt, so no real person's voice is used or imitated. The other 11 clips (listed in `manifest.json`) still use the earlier Kokoro v1.0 blend of am_michael / am_onyx / am_fenrir. All clips: EQ, compression, -16 LUFS. Clips are dry; a light send into the arena reverb is applied at runtime (`js/announcer.js`, `js/audio.js`).

## Arena reverb

The arena reverb impulse (~1.6 s, early reflections plus a darkening tail) is generated in code at startup (`hookConvolver` in `js/audio.js`); no recording is used. The sub "thump" layer under impacts, falls and footsteps is a synthesized Web Audio sine sweep.

Walking footsteps layer existing CC0 Kenney `thud_*` + `clank_h_*` (and sometimes `metal_m_*`) with a light rubberduck `servo_*` and a short sub thump, pitched per plant, synced to foot contacts. The older Thimras `stomp_m_*` and Kenney `stomp_k_*` concrete-stomp layers are no longer used for walking.

## ambientCG textures — CC0 1.0

- **Metal001** — https://ambientcg.com/view?id=Metal001 — octagon fighting mat base (1K JPG color, OpenGL normal, roughness, metalness; `textures/mat_metal_*.jpg`), tiled in world XZ. Painted start lines, corner wedges, ROBOT FIGHT text and the LED edge are a transparent decal layered on top (`matDecalTexture` in `js/arena.js`).
- **Metal009** — https://ambientcg.com/view?id=Metal009 — cage/post metal (`textures/metal_*.jpg`).
- **Metal008** (scratched metal) — https://ambientcg.com/view?id=Metal008 — previously the chrome mat; the chrome texture files have been removed.
- **Rust004** — https://ambientcg.com/view?id=Rust004 — rust and grunge masks previously mixed into the chrome mat; the rust texture files have been removed.

## Poly Haven HDRI — CC0 1.0

[Industrial Pipe and Valve 01](https://polyhaven.com/a/industrial_pipe_and_valve_01) 2K HDRI (`hdris/industrial_pipe_and_valve_01_2k.hdr`), used for robot and mat reflections when Settings → HDRI environment is on (default). The surround stays a dark void; the HDRI is not used as a backdrop. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Credit is optional.

## Broadcast director

The Broadcast camera view and post-fight replay recorder (`js/arena/broadcast.js`) are original code with no third-party assets.
