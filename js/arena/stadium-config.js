'use strict';
/* [stadium-arena] Config flag + layout for the stadium arena (js/arena/stadium.js).
   The fight floor (ARENA in js/config.js) is untouched; everything here sits outside the mat. */
export const STADIUM = {
  // Master flag. false = Industrial only and the Arena picker is hidden.
  enabled: true,
  // Arena used when the player has not picked one yet: 'stadium' | 'industrial'.
  defaultArena: 'stadium',
  storageKey: 'rf_arena',
  floorY: 0,              // concrete arena floor; the octagon stage rises 0.9 m above this
  barrierR: 15.6,         // LED barrier: every camera view stays inside this radius
  lower: { r0: 16.2, y0: 0.6, depth: 0.85, rise: 0.4, rows: 16 },
  upper: { r0: 30.4, y0: 9.9, depth: 0.85, rise: 0.52, rows: 14 },
  fasciaR: 29.9,
  wallR: 42.6,
  roofY: 25.6,
  truss: { inner: 6, outer: 42.4, top: 24, bottom: 22.4, spokes: 12 },
  board: { y: 15.6, size: 5.8, height: 3.6 },
  tunnels: [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4],
  // Crowd, seats, bowl segments and truss detail stay at the Low layout on every
  // graphics setting. Medium/High only change render quality (spots, normals).
  layout: { segs: 72, crowd: 0.34, crowdUpper: 0.16, seatDetail: false, diagonals: false },
  quality: {
    high: { spots: 4, normals: true },
    medium: { spots: 2, normals: false },
    low: { spots: 0, normals: false },
  },
};
