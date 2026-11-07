// Timeline of the Vasa short: shots timed to the voice words (vasa/voice/words.json), ship physics (moored, sail,
// heel, sink, wreck, raise) and the camera grammar of the bridge short (symmetric smootherstep glides, cuts on big
// jumps, creeping push-ins on every hold, 7-frame flip kicks on impacts, no hand-held float).
export const FPS = 30;
export const TOTAL = 1995; // 66.5 s: 65.2 s of voice + a 1.3 s tail
export const D0 = 2.4; // quay top above the water (m); the water is y = 0
export type V3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 4;
const rad = (d: number) => (d * Math.PI) / 180;

// ---------------- ship ----------------
export const HULL_L = 46, DRAFT = 4.2, DECK_Y = 4.2, SEA_Y = -33, SAIL_X = 26;
export type Ship = { x: number; y: number; z: number; heel: number; pitch: number; sails: number; wind: number; ports: number };
/** `ports` 0..1 = how far the lower gun-port row is under water (spray + water inside) */
export const shipFor = (id: number, t: number): Ship => {
  const moored = (): Ship => ({ x: 0, y: 0.05 * Math.sin(t * 1.3), z: 0, heel: 0.3 * Math.sin(t * 0.9), pitch: 0, sails: 0, wind: 0.1, ports: 0 });
  if (id <= 7 || (id >= 16 && id <= 19) || (id >= 21 && id <= 23) || id >= 26) {
    const s = moored();
    if (id >= 26) s.wind = 0.25;
    return s;
  }
  if (id <= 15 && id >= 8) {
    const u = (a: number, b: number) => smooth((t - a) / (b - a));
    const sails = u(17.67, 19.2);
    const x = SAIL_X * u(18.6, 27.0), z = 1.5 * u(18.6, 27.0);
    const bump = (a: number, b: number) => Math.sin(Math.PI * clamp01((t - a) / (b - a)));
    // two gusts: a little (to 6 deg and back), then a lot (22 deg, then on to 36 and under)
    const heel = 6 * bump(20.5, 22.0) + (t >= 22.0 ? 1 + 21 * u(22.0, 23.5) + 14 * u(23.5, 25.3) : 0);
    const sink = u(24.8, 28.0);
    const y = SEA_Y * sink * sink * (3 - 2 * sink) * (0.6 + 0.4 * sink) + 0.04 * Math.sin(t * 1.3) * (1 - sink);
    const settle = u(28.0, 31.0);
    const hl = t < 28 ? heel : 36 + (12 - 36) * settle;
    const wind = t < 19.2 ? 0.2 : 0.2 + 0.8 * u(19.2, 21.0);
    return { x, y, z, heel: hl, pitch: -6 * sink, sails: id >= 14 ? 1 : sails, wind: id >= 14 ? 0.3 : wind, ports: clamp01((heel - 14) / 10) * (1 - sink) };
  }
  if (id === 20) {
    const A = 11 * smooth((t - 42.6) / 2.4) * (1 - smooth((t - 45.8) / 0.8));
    return { x: 0, y: 0, z: 0, heel: A * Math.sin((2 * Math.PI * (t - 42.4)) / 2.1), pitch: 0, sails: 0, wind: 0.1, ports: 0 };
  }
  if (id === 24) return { x: SAIL_X, y: SEA_Y, z: 1.5, heel: 12, pitch: -5, sails: 1, wind: 0, ports: 0 };
  // 25: rising from the mud
  const r = smooth((t - 56.7) / 1.9);
  return { x: SAIL_X, y: SEA_Y * (1 - r), z: 1.5, heel: 12 * (1 - r) + 1 * r, pitch: -5 * (1 - r), sails: 1, wind: 0.1, ports: 0 };
};

// ---------------- shots ----------------
export type Light = "day" | "golden";
export type ShotDef = { id: number; a: number; b: number; light: Light; under?: boolean };
const F = (s: number) => Math.round(s * FPS);
const cuts = [0, 93, 205, 285, 336, 402, 473, 530, 575, 615, 660, 705, 780, 840, 925, 1005, 1080, 1112, 1206, 1272, 1400, 1455, 1518, 1608, 1695, 1760, 1830, TOTAL];
export const SHOTS: ShotDef[] = cuts.slice(0, -1).map((a, i) => ({
  id: i + 1, a, b: cuts[i + 1], light: i + 1 >= 26 ? "golden" : "day", under: i + 1 === 24,
}));
export const XFADE: Record<number, number> = { 14: 6, 16: 8, 24: 8, 25: 8, 26: 8 };
export const FLASH_AT = 93;
export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};

// ---------------- camera ----------------
export type Cam = { pos: V3; look: V3; fov: number; roll: number };
type Shot = Partial<Cam> & { pos: V3; look: V3 };
type Key = { f: number; dur?: number; cut?: boolean; s: (f: number) => Shot };
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
const mix = (a: Cam, b: Cam, k: number): Cam => ({
  pos: a.pos.map((v, i) => v + (b.pos[i] - v) * k) as V3, look: a.look.map((v, i) => v + (b.look[i] - v) * k) as V3,
  fov: a.fov + (b.fov - a.fov) * k, roll: a.roll + (b.roll - a.roll) * k,
});
const full = (c: Shot): Cam => ({ fov: 40, roll: 0, ...c });
const run = (keys: Key[], f: number) => {
  let cur = full(keys[0].s(f));
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (f < k.f) break;
    cur = k.cut ? full(k.s(f)) : mix(cur, full(k.s(f)), glide((f - k.f) / (k.dur ?? 24)));
  }
  return cur;
};
const T = (f: number) => f / FPS;
const pushK = (f: number, f0: number, rate: number, punch = 0, n = 35) => {
  const x = Math.max(0, f - f0);
  let s = rate * x;
  if (punch > rate) for (let i = 0; i < Math.min(x, n); i++) s += (punch - rate) * Math.max(0, Math.min(1, (i + 0.5) / 8, (n - i - 0.5) / 8));
  return Math.exp(-s);
};
const dolly = (pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos: [look[0] + (pos[0] - look[0]) * k, look[1] + (pos[1] - look[1]) * k, look[2] + (pos[2] - look[2]) * k], look, ...rest });
const zoom = (pos: V3, look: V3, fov: number, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos, look, fov: (360 / Math.PI) * Math.atan(Math.tan((fov * Math.PI) / 360) * k), ...rest });
const rolled = (s: (f: number) => Shot, roll: number) => (f: number): Shot => ({ ...s(f), roll });
/** ship-relative point (follows the ship's x/z drift in the sailing shots) */
const sh = (id: number, f: number, d: V3): V3 => { const s = shipFor(id, T(f)); return [s.x + d[0], d[1], s.z + d[2]]; };

export const FIG: V3 = [23.6, 6.2, 0]; // lion figurehead (gilded) at the bow
export const KING: V3 = [-6, D0, -24];
export const ADM: V3 = [3.5, D0, -25];
export const CANOE: V3 = [-4, 0, -11];

// shot 1 hook: figurehead CU -> 3/4 front wide of the whole ship
const S1a = (f: number) => dolly([31.5, 5.4, -5.8], FIG, pushK(f, 0, 0.003), { fov: 34 });
const S1b = (f: number) => dolly([66, 14, -46], [4, 9, 0], pushK(f, 30, 0.002), { fov: 46, roll: -0.04 });
// shot 2 aerial of Stockholm harbour
const S2a = (f: number) => zoom([26, 44, -76], [0, 4, -8], 44, pushK(f, 93, 0.002));
const S2b = (f: number) => zoom([-24, 30, -60], [10, 6, 0], 42, pushK(f, 150, 0.002));
// shots 3-7
const S3a = (f: number) => dolly([-3.5, 3.9, -13.5], [KING[0], KING[1] + 1.3, KING[2]], pushK(f, 205, 0.0025, 0.006, 35), { fov: 36 });
const S4a = (f: number) => dolly([-41, 7.5, -6], [-23.5, 9.5, 0], pushK(f, 285, 0.0025), { fov: 40 });
const S4b = (f: number) => dolly([-39, 12.5, -4], [-23.5, 10.5, 0], pushK(f, 310, 0.003), { fov: 38, roll: 0.03 });
const S5a = (f: number) => dolly([-9, 3.0, -19.5], [-3, 3.0, -5.4], pushK(f, 336, 0.002), { fov: 40 });
const S5b = (f: number) => dolly([8, 3.0, -19.5], [14, 3.0, -5.4], pushK(f, 372, 0.002), { fov: 40, roll: -0.03 });
const S6a = (f: number) => dolly([33, 6.6, -9.5], [FIG[0], FIG[1] + 0.2, 0], pushK(f, 402, 0.0025), { fov: 34 });
const S6b = (f: number) => dolly([29.5, 5.4, -6.0], [FIG[0], FIG[1] + 0.4, 0], pushK(f, 440, 0.003, 0.006, 30), { fov: 32, roll: 0.04 });
const S7a = (f: number) => dolly([3, 4.9, -17.5], [0, 3.7, -26], pushK(f, 473, 0.0022), { fov: 42 });
// shot 8: sails go up (low angle up the main mast)
const S8a = (f: number) => dolly([-4.5, 5.0, -3.2], [0, 17, 0], pushK(f, 530, 0.0025), { fov: 56 });
// shot 9: breeze: 3/4 wide as the ship starts to move
const S9a = (f: number) => dolly(sh(9, f, [36, 10, -42]), sh(9, f, [0, 12, 0]), pushK(f, 575, 0.0018), { fov: 46, roll: 0.03 });
// shot 10: side wide, leans a little
const S10a = (f: number) => dolly(sh(10, f, [6, 7, -54]), sh(10, f, [0, 9, 0]), pushK(f, 615, 0.0018), { fov: 46 });
// shot 11: from the quay edge, leans a lot (roll with the heel)
const S11a = (f: number) => { const s = shipFor(11, T(f)); return dolly(sh(11, f, [10, 3.6, -21]), sh(11, f, [0, 8, 0]), pushK(f, 660, 0.002, 0.006, 25), { fov: 48, roll: -0.015 * s.heel }); };
// shot 12: water level at the ports
const S12a = (f: number) => dolly(sh(12, f, [8, 1.0, -15]), sh(12, f, [1, 1.6, -5]), pushK(f, 705, 0.002), { fov: 42, roll: -0.03 });
const S12b = (f: number) => dolly(sh(12, f, [2, 1.4, -12]), sh(12, f, [-1, 1.2, -5.4]), pushK(f, 745, 0.0025, 0.006, 25), { fov: 40, roll: 0.04 });
// shot 13: the sinking, wide and high
const S13a = (f: number) => dolly([44, 15, -56], [26, 3, 0], pushK(f, 780, 0.0015), { fov: 48 });
const S13b = (f: number) => dolly([46, 6, -22], [26, 1, 0], pushK(f, 822, 0.002), { fov: 44, roll: -0.04 });
// shot 14: mast tips and floating hats
const S14a = (f: number) => dolly([29, 2.2, -14], [26, 3, 1.5], pushK(f, 840, 0.0015), { fov: 42 });
// shot 15: the king
const S15a = (f: number) => dolly([KING[0] + 8, 3.9, -19.5], [KING[0] + 5.5, KING[1] + 1.3, KING[2]], pushK(f, 925, 0.0025), { fov: 34 });
const S15b = (f: number) => dolly([KING[0] + 7.2, 3.8, -22.0], [KING[0] + 5.5, KING[1] + 1.45, KING[2]], pushK(f, 975, 0.003, 0.006, 30), { fov: 30, roll: -0.04 });
// shots 16-17: tall and heavy up top, light down low
const S16a = (f: number) => dolly([-14, 2.8, -20], [-12, 8, 0], pushK(f, 1005, 0.0015), { fov: 52 });
const S16b = (f: number) => dolly([-12, 4.5, -22], [-12, 20, 0], pushK(f, 1030, 0.002), { fov: 54, roll: 0.03 });
const S17a = (f: number) => dolly([9, 0.7, -12], [9, -0.4, -5.2], pushK(f, 1080, 0.002), { fov: 40, roll: -0.03 });
// shot 18: the canoe
const S18a = (f: number) => dolly([CANOE[0], 3.2, -17], [CANOE[0], 1.4, CANOE[2]], pushK(f, 1112, 0.002), { fov: 40 });
// shots 19-20: the dock test
const S19a = (f: number) => dolly([-30, 6, -31], [-2, 4.5, -4], pushK(f, 1206, 0.0015), { fov: 46 });
const S20a = (f: number) => { const s = shipFor(20, T(f)); return dolly([3.0, 6.4, -10], [0, 5.2, 0], pushK(f, 1272, 0.0015), { fov: 44, roll: -0.012 * s.heel }); };
// shots 21-23: the court
const S21a = (f: number) => dolly([ADM[0], 3.95, -20.5], [ADM[0], ADM[1] + 1.45, ADM[2]], pushK(f, 1400, 0.0028), { fov: 32 });
const S22a = (f: number) => dolly([0, 4.3, -17], [0, 3.8, -26.5], pushK(f, 1455, 0.002), { fov: 42 });
const S23a = (f: number) => dolly([1, 4.0, -19], [0.5, 3.7, -27], pushK(f, 1518, 0.0022), { fov: 40, roll: 0.03 });
// shots 24-25: wreck, raising
const S24a = (f: number) => dolly([SAIL_X - 16, -26, -26], [SAIL_X, -30, 1.5], pushK(f, 1608, 0.0012), { fov: 46 });
const S25a = (f: number) => dolly([SAIL_X + 12, 4, -50], [SAIL_X, 5, 1.5], pushK(f, 1695, 0.0015), { fov: 46 });
// shots 26-27 golden
const S26a = (f: number) => dolly([-40, 3.4, -23], [-6, 8, 0], pushK(f, 1760, 0.0015), { fov: 44 });
const S27a = (f: number) => dolly([-4, 3.9, -30.5], [2, 6.5, 0], pushK(f, 1830, 0.0015), { fov: 42 });
const CRANE: V3[] = [[8, 12, -34], [30, 22, -48], [0, 7, -2]];
const S27b = (f: number): Shot => {
  const a = S27a(1930), s = glide((f - 1930) / 62), r = 1 - s, [C, B, L] = CRANE;
  return { pos: [0, 1, 2].map((i) => r * r * a.pos[i] + 2 * s * r * C[i] + s * s * B[i]) as V3,
    look: [0, 1, 2].map((i) => a.look[i] + (L[i] - a.look[i]) * s) as V3, fov: (a.fov ?? 42) + (46 - (a.fov ?? 42)) * s, roll: 0 };
};

const CAMS: Record<number, Key[]> = {
  1: [{ f: 0, s: S1a }, { f: 30, dur: 40, s: S1b }],
  2: [{ f: 93, s: S2a }, { f: 150, dur: 30, s: S2b }],
  3: [{ f: 205, s: S3a }],
  4: [{ f: 285, s: S4a }, { f: 310, dur: 26, s: S4b }],
  5: [{ f: 336, s: S5a }, { f: 372, dur: 30, s: S5b }],
  6: [{ f: 402, s: S6a }, { f: 440, dur: 20, s: S6b }],
  7: [{ f: 473, s: S7a }],
  8: [{ f: 530, s: S8a }],
  9: [{ f: 575, s: S9a }],
  10: [{ f: 615, s: S10a }],
  11: [{ f: 660, s: S11a }],
  12: [{ f: 705, s: S12a }, { f: 745, cut: true, s: S12b }],
  13: [{ f: 780, s: S13a }, { f: 822, cut: true, s: S13b }],
  14: [{ f: 840, s: S14a }],
  15: [{ f: 925, s: S15a }, { f: 975, dur: 24, s: S15b }],
  16: [{ f: 1005, s: S16a }, { f: 1030, dur: 36, s: S16b }],
  17: [{ f: 1080, s: S17a }],
  18: [{ f: 1112, s: S18a }],
  19: [{ f: 1206, s: S19a }],
  20: [{ f: 1272, s: S20a }],
  21: [{ f: 1400, s: S21a }],
  22: [{ f: 1455, s: S22a }],
  23: [{ f: 1518, s: S23a }],
  24: [{ f: 1608, s: S24a }],
  25: [{ f: 1695, s: S25a }],
  26: [{ f: 1760, s: S26a }],
  27: [{ f: 1830, s: S27a }, { f: 1930, cut: true, s: S27b }],
};
void rolled; void rad; void F;

// impact kicks: flip sign every frame, decay over 7 f. Times: breeze gust, the lean, the slam under water, the canoe, the stop
const KICKS: [number, number][] = [[22.1, 0.6], [25.1, 0.8], [26.9, 1.2], [27.55, 1.0], [39.6, 0.9], [45.95, 0.7]];
export const kickAt = (t: number) => {
  let a = 0;
  for (const [t0, g] of KICKS) {
    const n = Math.floor((t - t0) * FPS + 1e-6);
    if (n >= 0 && n < 7) a += g * (n % 2 ? -1 : 1) * (1 - n / 7) ** 1.5;
  }
  return a;
};
export const camAt = (id: number, f: number): Cam => {
  const c = run(CAMS[id], f), a = kickAt(T(f));
  if (!a) return c;
  const d: V3 = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
  const L = Math.hypot(...d), h = Math.hypot(d[0], d[2]) || 1;
  const m = (3 / 640) * Math.tan((c.fov * Math.PI) / 360) * L * a;
  return { ...c, look: [c.look[0] - (d[2] / h) * m, c.look[1] + 0.6 * m, c.look[2] + (d[0] / h) * m], roll: c.roll + a * 0.004 };
};
export const keyEnd = (id: number, f: number) => {
  let e = 0;
  for (const k of CAMS[id]) if (f >= k.f) e = k.f + (k.cut ? 0 : k.dur ?? 24);
  return Math.max(f, e);
};

// ---------------- lens: depth of field ----------------
export type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
export const DOF: Dof[] = [
  { f: 0, cInf: 14 }, // figurehead CU (focus = look)
  { f: 30, dur: 40, cInf: 0 }, // wide: everything sharp
  { f: 285, cInf: 13 }, // stern CU
  { f: 336, cInf: 0 }, // hull side tracking
  { f: 402, cInf: 14 }, // figurehead glint
  { f: 473, cInf: 8 }, // crowd
  { f: 530, cInf: 0 },
  { f: 705, cInf: 8 }, // water-level ports
  { f: 780, cInf: 0 },
  { f: 840, cInf: 7 }, // mast tips
  { f: 925, cInf: 14 }, // king
  { f: 1005, cInf: 0 },
  { f: 1080, cInf: 12 }, // waterline CU
  { f: 1112, cInf: 8 }, // canoe
  { f: 1206, cInf: 0 },
  { f: 1272, cInf: 6 }, // deck run
  { f: 1400, cInf: 14 }, // admiral CU
  { f: 1455, cInf: 9 }, // court
  { f: 1608, cInf: 5 }, // wreck
  { f: 1695, cInf: 0 },
  { f: 1760, cInf: 5 },
  { f: 1830, cInf: 7 },
  { f: 1930, cInf: 0 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus };
};
export const focusAt = (id: number, f: number): V3 => {
  const d = dofAt(f);
  return d.focus ? d.focus(f) : camAt(id, f).look;
};
/** near framing objects (unused in the Vasa short for now) */
export type Fg = { a: number; b: number; kit: string; pos: V3; s?: number; yaw?: number };
export const FOREGROUND: Fg[] = [];
