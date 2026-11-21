# Sound, texture, and environment licenses

Robot Fight uses public-domain (CC0) and royalty-free clips and textures that do not require credit. Sources are listed here for the record. Files in `sounds/` and `textures/` are short, recompressed excerpts; original pack archives are not redistributed.

## OpenGameArt — CC0 1.0

No attribution required. Optional credit is appreciated.

- **100 CC0 metal and wood SFX** — rubberduck, https://opengameart.org/content/100-cc0-metal-and-wood-sfx  
  Hammer and metal hits, sheet metal, slams, falling scrap, springs, and tools.  
  Game files: `metal_m_0`–`metal_m_2`, `metal_h_2`, `cage_0`.

- **100 CC0 SFX** — rubberduck, https://opengameart.org/content/100-cc0-sfx  
  Additional metal hits and slams.  
  Game files: `metal_m_5`, `metal_h_3`, `metal_h_4`, `metal_h_6`, `cage_1`.

- **Wood and Metal Sound Effects: Volume 2** — Ogrebane, https://opengameart.org/content/wood-and-metal-sound-effects-volume-2  
  Recorded metal impacts. Game files: `metal_m_3`, `metal_m_4`, `metal_h_5`, `cage_2`.

- **Metal Impact Sounds** — Brian MacIntosh, https://opengameart.org/content/metal-impact-sounds  
  Recorded thuds and a long bong. Game files: `metal_h_0`, `metal_h_1`.

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
  (short debris rattle).  
  Game files: `bell_*`, `clank_h_*`, `plate_h_*`, `plate_m_*`, `thud_*`, `rattle_*`.

## Brian MacIntosh (BMacZero) — CC0 1.0

[Electricity Sound Effects](https://opengameart.org/content/electricity-sound-effects-0) on OpenGameArt. Recorded from a small Tesla generator. Credit is optional.

- `continuousspark.wav` → `buzz_loop.ogg` (looped electrical buzz on damaged parts)

## Pixabay — Pixabay Content License

[Pixabay Content License](https://pixabay.com/service/license-summary/): free for commercial and non-commercial use, including in games. Attribution is optional but appreciated. Files must not be sold or redistributed as a standalone sound pack. Clips were trimmed, faded, loudness-normalized, and recompressed to mono OGG (with MP3 fallbacks for Safari) for the game.

A movement recording from Pixabay (author and original title were not stored with the source file provided for this project) was cut into `move_0`–`move_7` (arm flicks, swings, and body turns). Pitch and volume follow move speed in-game.

| Title | Author | Page | Game files |
| --- | --- | --- | --- |
| Armor Impact From Sword | Dragon Studio | https://pixabay.com/sound-effects/film-special-effects-armor-impact-from-sword-393843/ | `punch_0`–`punch_3` |
| Sword Block (The Ballad of Blades) | VoiceBosch | https://pixabay.com/sound-effects/sword-block-the-ballad-of-blades-257226/ | `punch_4`–`punch_6` (hit landings, not blocks) |
| Metal Slam 2 | floraphonic | https://pixabay.com/sound-effects/film-special-effects-metal-slam-2-189784/ | `block_0`, `block_1` |
| shield_impact (3) | Yodguard | https://pixabay.com/sound-effects/film-special-effects-shield-impact-3-382411/ | `block_2`, `block_3` |
| Robot Heavy Mechanical Footsteps | DavidDumaisAudio | https://pixabay.com/sound-effects/film-special-effects-robot-heavy-mechanical-footsteps-194039/ | `step_0`–`step_7` |
| Big robot footstep 002 | AudioPapkin | https://pixabay.com/sound-effects/film-special-effects-big-robot-footstep-002-331037/ | `land_0`, `land_1` |
| Iron Smash with Debris | Soumages | https://pixabay.com/sound-effects/film-special-effects-iron-smash-with-debris-351841/ | `crash_0`–`crash_2` |
| Debris On Metal HQ | TanwerAman | https://pixabay.com/sound-effects/film-special-effects-debris-on-metal-hq-275769/ | `debris_0`–`debris_2` |
| sparks | Marregheriti (via freesound_community) | https://pixabay.com/sound-effects/film-special-effects-sparks-84897/ | `spark_0`–`spark_3` |
| Electric Sparks | kev_durr (via freesound_community) | https://pixabay.com/sound-effects/film-special-effects-electric-sparks-6130/ | `sparkarc_0`–`sparkarc_2` |
| Crowd Cheering | storegraphic | https://pixabay.com/sound-effects/people-crowd-cheering-312831/ | `crowd_hit_0`–`crowd_hit_2`, `crowd_ko_0` |
| Crowd - Cheering - Ambience and cheering | GregorQuendel_SoundDesign | https://pixabay.com/sound-effects/people-crowd-cheering-ambience-and-cheering-137247/ | `crowd_loop` |

## Announcer voice

Original lines written for the game (Window Workshop Games). 97 of the 108 clips in `sounds/announcer/` are voiced with Chatterbox TTS (Resemble AI, MIT license; outputs carry Resemble's inaudible PerTh watermark) at exaggeration 1.2, using a synthetic Kokoro v1.0 am_onyx clip (Apache-2.0) as the voice prompt, so no real person's voice is used or imitated. The other 11 clips (listed in `manifest.json`) still use the earlier Kokoro v1.0 blend of am_michael / am_onyx / am_fenrir. All clips: EQ, compression, -16 LUFS. Clips are dry; a light send into the arena reverb is applied at runtime (`js/announcer.js`, `js/audio.js`).

## Arena reverb

The arena reverb impulse (~1.6 s, early reflections plus a darkening tail) is generated in code at startup (`hookConvolver` in `js/audio.js`); no recording is used. The sub "thump" layer under impacts, falls and footsteps is a synthesized Web Audio sine sweep.

Walking footsteps use DavidDumaisAudio mech plants (`step_*`) synced to foot contacts, with a light Kenney thud and a synthesized sub thump. Heavy landings and body falls can layer AudioPapkin `land_*`. Movement whooshes use the Pixabay motor/servo clips (`move_*`), pitched and leveled with move speed.

## ambientCG textures — CC0 1.0

- **Metal001** — https://ambientcg.com/view?id=Metal001 — octagon fighting mat base (1K JPG color, OpenGL normal, roughness, metalness; `textures/mat_metal_*.jpg`), tiled in world XZ. Painted start lines, corner wedges, ROBOT FIGHT text and the LED edge are a transparent decal layered on top (`matDecalTexture` in `js/arena.js`).
- **Metal009** — https://ambientcg.com/view?id=Metal009 — cage/post metal (`textures/metal_*.jpg`).
- **Metal008** (scratched metal) — https://ambientcg.com/view?id=Metal008 — previously the chrome mat; the chrome texture files have been removed.
- **Rust004** — https://ambientcg.com/view?id=Rust004 — rust and grunge masks previously mixed into the chrome mat; the rust texture files have been removed.

## Poly Haven HDRI — CC0 1.0

[Industrial Pipe and Valve 01](https://polyhaven.com/a/industrial_pipe_and_valve_01) 2K HDRI (`hdris/industrial_pipe_and_valve_01_2k.hdr`), used for robot and mat reflections when Settings → HDRI environment is on (default). The surround stays a dark void; the HDRI is not used as a backdrop. License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Credit is optional.

## Broadcast director

The Broadcast camera view and post-fight replay recorder (`js/arena/broadcast.js`) are original code with no third-party assets.
