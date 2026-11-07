// Our cast as lit flat sprites in the 3D world. Each frame every character asks for a drawing (a key + a draw call);
// the pool keeps one canvas per distinct drawing, so soldiers marching in step share canvases (7 head shapes x 4
// outfits). Characters are yaw-only billboards shaded by cardShade() (scene tint, bright floor, side gradient toward
// the sun, painted crescent in the drawing); standing ones get a soft multiply contact blob. Effects are unlit cards.
// Cards, effects and blobs live on the NOINK layer so the world ink pass never outlines their quads.
import * as THREE from "three";
import {
  Pen, bodyFront, bodySide, fxBurst, fxSplash, fxStars, fxRing, fxBlob, fxShadow, fxContact, fxNote, fxPuff,
  Outfit, Expr, FrontOpts, SideOpts, INK,
} from "./toon";
import { FPS, D0, V3, clamp01, smooth } from "./story";
import { NOINK } from "./ink";
import { cardShade, blobMaterial, CARD_K } from "./cardshade";

// ---------------- canvas pool ----------------
type Entry = { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; w: number; h: number };
export type Req = { key: string; w: number; h: number; k: number; draw: (p: Pen) => void; tex?: THREE.CanvasTexture };
const makeEntry = (w: number, h: number): Entry => {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { cv, tex, w, h };
};
export class Pool {
  private live = new Map<string, Entry>();
  private free: Entry[] = [];
  private reqs: Req[] = [];
  req(key: string, w: number, h: number, k: number, draw: (p: Pen) => void) {
    const r: Req = { key: `${w}x${h}|${key}`, w, h, k, draw };
    this.reqs.push(r);
    return r;
  }
  flush() {
    const want = new Map<string, Req[]>();
    for (const r of this.reqs) { const l = want.get(r.key); if (l) l.push(r); else want.set(r.key, [r]); }
    for (const [key, e] of this.live) if (!want.has(key)) { this.live.delete(key); this.free.push(e); }
    for (const [key, rs] of want) {
      let e = this.live.get(key);
      if (!e) {
        const r = rs[0], i = this.free.findIndex((x) => x.w === r.w && x.h === r.h);
        e = i >= 0 ? this.free.splice(i, 1)[0] : makeEntry(r.w, r.h);
        const g = e.cv.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, e.w, e.h); g.setTransform(r.k, 0, 0, r.k, 0, 0);
        r.draw(new Pen(g));
        e.tex.needsUpdate = true;
        this.live.set(key, e);
      }
      for (const r of rs) r.tex = e.tex;
    }
    this.reqs = [];
  }
}

// ---------------- sprite meshes ----------------
const blank = (() => { const c = document.createElement("canvas"); c.width = c.height = 2; return new THREE.CanvasTexture(c); })();
export const SU = 0.00216; // metres per design unit: 1000 units = 2.16 m
export const SU_SWING = 2.3 / 1830; // swing canvas: rope of 1830 units = 2.3 m
const BODY = (() => { const g = new THREE.PlaneGeometry(600 * SU, 1000 * SU); g.translate(0, (975 - 500) * SU, 0); return g; })();
const CARD = new THREE.PlaneGeometry(1, 1);
/** world roots that hold actors (to find the scene's sun when world.ts does not pass it) */
const ROOTS = new Set<THREE.Object3D>();

/** lit flat character: cardShade() material, receives shadows (dims to the bright floor only), casts its silhouette
 *  when world.ts says so (golden). Drawn after the contact blobs (renderOrder 1). */
export class Actor {
  mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; dmat: THREE.MeshDepthMaterial; r: Req | null = null;
  constructor(parent: THREE.Object3D, geo: THREE.BufferGeometry = BODY) {
    this.mat = cardShade(new THREE.MeshLambertMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.mat.alphaToCoverage = false; // A2C + MSAA left 1 px sky-depth seams on blurred far cards (POST)
    this.dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.customDepthMaterial = this.dmat;
    // rim width is in output pixels: tell the card shader the render height (1920 = 1080 x 1920 frame)
    this.mesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); CARD_K.uPx.value = (rt ? rt.height : r.domElement.height) / 1920; };
    this.mesh.castShadow = false; this.mesh.receiveShadow = true; this.mesh.visible = false;
    this.mesh.rotation.order = "YXZ"; this.mesh.renderOrder = 1; this.mesh.layers.set(NOINK);
    parent.add(this.mesh);
    ROOTS.add(parent);
  }
  bind() { const t = this.r?.tex; if (t) { this.mat.map = t; this.dmat.map = t; } }
}
/** unlit effect card: hard cut-out (ink drawings), soft see-through (dust, mist) or a multiply ground blob */
export class Fx {
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; soft: THREE.MeshBasicMaterial; blob: THREE.MeshBasicMaterial; r: Req | null = null;
  constructor(parent: THREE.Object3D) {
    this.mat = new THREE.MeshBasicMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mat.alphaToCoverage = false; // A2C + MSAA left 1 px sky-depth seams on blurred far cards (POST)
    this.soft = new THREE.MeshBasicMaterial({ map: blank, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.blob = blobMaterial(blank);
    this.mesh = new THREE.Mesh(CARD, this.mat);
    this.mesh.visible = false; this.mesh.layers.set(NOINK);
    parent.add(this.mesh);
  }
  use(soft: boolean) { this.mesh.material = soft ? this.soft : this.mat; }
  bind() {
    const t = this.r?.tex;
    if (!t) return;
    if (this.r!.key.includes("|blob|")) {
      // no mipmaps: at grazing views the mip chain averages the blob with its white surround and it fades out
      if (t.generateMipmaps) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
      this.blob.map = t; this.mesh.material = this.blob; this.mesh.renderOrder = 0.5;
    }
    else { this.mat.map = t; this.soft.map = t; this.mesh.renderOrder = 0; }
  }
}

// ---------------- placements ----------------
export type Place = {
  key: string; draw: (p: Pen) => void; x: number; y: number; z: number;
  scale?: number; mirror?: boolean; yaw?: number; geo?: "body" | "swing"; roll?: number; size?: [number, number, number];
};
export type FxPlace = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; rot?: number; soft?: boolean };
/** sun = world direction TOWARD the sun (optional: when absent the scene's shadow-casting light is used) */
export type CamInfo = { pos: THREE.Vector3; right: THREE.Vector3; sun?: THREE.Vector3 };

const hh = (i: number, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const q = (v: number, n = 120) => Math.round(v * n) / n;
const vOf = (i: number) => (i * 7 + (i >> 2)) % 4;
/** head-shape seed: 7 shapes, so marching soldiers in step still share canvases */
const seedOf = (i: number) => ((i * 5 + 3) % 7) + 1;
/** drawing resolution by distance: [canvas w, h, scale from the 600 x 1000 design]; sized for the 1440 x 2560 final */
const tier = (d: number): [number, number, number] =>
  d < 3.2 ? [1800, 3000, 3.0] : d < 6.5 ? [1080, 1800, 1.8] : d < 16 ? [480, 800, 0.8] : [240, 400, 0.4];

// ---------------- light ----------------
const SUN = new THREE.Vector3(0.5, 0.75, -0.4).normalize();
const tmp = new THREE.Vector3();
let LNAME: "day" | "golden" = "day";
const sunOf = (root: THREE.Object3D) => {
  let s: THREE.DirectionalLight | null = null;
  root.traverse((o) => { if (!s && o instanceof THREE.DirectionalLight && o.castShadow) s = o; });
  return s as THREE.DirectionalLight | null;
};
/** the sun of the world that is calling: the attached root whose sun target sits on this camera's view axis */
const findSun = (cam: CamInfo, out: THREE.Vector3) => {
  if (cam.sun) return out.copy(cam.sun).normalize();
  let best: THREE.DirectionalLight | null = null, err = Infinity;
  for (const r of ROOTS) {
    if (!r.parent) continue;
    const s = sunOf(r);
    if (!s) continue;
    const d = tmp.copy(s.target.position).sub(cam.pos), e = Math.abs(d.dot(cam.right)) / (d.length() || 1);
    if (e < err) { err = e; best = s; }
  }
  return best ? out.copy(best.position).sub(best.target.position).normalize() : out;
};
/** canvas angle the sun comes FROM on an upright card facing the camera, in 45-degree steps (small texture cache) */
const light2D = (cam: CamInfo, mirror: boolean) => {
  const sx = SUN.dot(cam.right) * (mirror ? -1 : 1), sy = -SUN.y;
  return Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) * (Math.PI / 4);
};

/** front / side view and mirroring for someone at (x, z) walking along (dx, dz); fs = foreshortening of the walk */
const viewOf = (cam: CamInfo, x: number, z: number, dx: number, dz: number) => {
  const tx = cam.pos.x - x, tz = cam.pos.z - z, tl = Math.hypot(tx, tz) || 1;
  const c = (tx * dx + tz * dz) / tl;
  return { side: c < 0.57, mirror: dx * cam.right.x + dz * cam.right.z < 0, fs: Math.round(Math.sqrt(Math.max(0, 1 - c * c)) * 20) / 20 };
};

// ---------------- life: blinks and reaction timing ----------------
/** reference expression and action changes land 0-3 f before the word onset */
const LEAD = 2 / FPS;
/** eyelid 0 open .. 1 shut. Reference: gaps 0.5-2.3 s, 4-frame blink half / shut / shut / half, plus a blink across
 *  every expression swap (the shut frames hide the swap) */
const LID = [0.5, 1, 1, 0.5];
const SWAPS: Record<number, number[]> = {};
const lidAt = (t: number, i: number, swaps: number[] = []) => {
  const f = Math.round(t * FPS);
  for (const ts of swaps) { const k = f - Math.round((ts - LEAD) * FPS) + 1; if (k >= 0 && k < 4) return LID[k]; }
  let s = Math.round(-60 * hh(i, 9));
  for (let n = 0; s <= f && n < 400; n++) {
    const k = f - s;
    if (k >= 0 && k < 4) return LID[k];
    s += Math.round(15 + 54 * hh(i * 31 + n, 13)); // next blink 0.5-2.3 s later
  }
  return 0;
};
const fkey = (o: object) => JSON.stringify(o, (_k, v) => (typeof v === "number" ? q(v) : v));

type Who = { i: number; o: Outfit; okey: string };
/** one character drawing in the 600 x 1000 design space, sized by distance, lit from the scene's sun */
const person = (cam: CamInfo, who: Who, x: number, y: number, z: number, view: { side: boolean; mirror: boolean }, fo: FrontOpts, so: SideOpts, scale = 1): Place & { tierKey: string } => {
  const d = cam.pos.distanceTo(tmp.set(x, y + 1.2, z)) / scale;
  const [w, h, k] = tier(d);
  const mirror = view.side && view.mirror, light = light2D(cam, mirror), seed = seedOf(who.i);
  const f2: FrontOpts = { ...fo, light, seed }, s2: SideOpts = { ...so, light, seed };
  const key = view.side ? `S|${who.okey}|${fkey(s2)}` : `F|${who.okey}|${fkey(f2)}`;
  return {
    key, x, y, z, scale, mirror, tierKey: `${w}`,
    draw: (p) => (view.side ? bodySide(p, who.o, s2) : bodyFront(p, who.o, f2)),
    size: [w, h, k],
  };
};

/** ground shadow under a standing / sitting card (review rounds 2-4), multiply, blue-violet: a TIGHT contact pool right under
 *  the feet (~.5 on screen at the core) so nobody floats, plus by day (cards cast no real shadow) a lighter soft tail
 *  stretched AWAY from the sun, length ~1.6 m / tan(sun elevation), capped. Golden: world.ts casts real card shadows. */
const CONTACT: Record<"day" | "golden", [number, number, number]> = { day: [0.2, 0.21, 0.33], golden: [0.24, 0.2, 0.33] };
const TAIL: [number, number, number] = [0.42, 0.44, 0.62];
const toSrgb = (v: number) => { const c = clamp01(v); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
const hexOf = (c: [number, number, number], k: number) => "#" + c.map((v) => Math.round(255 * toSrgb(1 - (1 - v) * k)).toString(16).padStart(2, "0")).join("");
const blob = (out: Stage, x: number, y: number, z: number, sc = 1, k = 1) => {
  const hl = Math.hypot(SUN.x, SUN.z) || 1, ox = -SUN.x / hl, oz = -SUN.z / hl, rot = Math.atan2(-ox, -oz);
  if (LNAME === "day") {
    const el = Math.asin(Math.min(0.99, Math.max(0.1, SUN.y)));
    const len = Math.min(2.4, Math.max(0.5, 1.6 / Math.tan(el))) * sc, h = len + 0.55 * sc, c = 0.3 * h; // feet at v = .2 of the card
    const tc = hexOf(TAIL, k);
    out.fx.push({ key: `blob|shadow|${tc}`, cw: 128, ch: 256, draw: (p) => fxShadow(p, tc), x: x + ox * c, y: y + 0.018, z: z + oz * c,
      w: 0.72 * sc, h, flat: true, rot });
  }
  const cc = hexOf(CONTACT[LNAME], k);
  out.fx.push({ key: `blob|contact|${cc}`, cw: 128, ch: 128, draw: (p) => fxContact(p, cc), x: x + ox * 0.03 * sc, y: y + 0.022, z: z + oz * 0.03 * sc,
    w: 0.52 * sc, h: 0.4 * sc, flat: true, rot });
};


export type Stage = { places: Place[]; fx: FxPlace[] };
// ================= the Vasa cast =================
import { KING, ADM, CANOE, SHOTS, shipFor, DECK_Y, SEA_Y, SAIL_X, Ship } from "./story";
import { KID } from "./toon";

const rad = (d: number) => (d * Math.PI) / 180;
/** ship-local point -> world (heel about the x axis first, then pitch about z): same order as the ship group in world.ts */
export const shipToWorld = (s: Ship, p: V3): V3 => {
  const ch = Math.cos(rad(s.heel)), sn = Math.sin(rad(s.heel)), cp = Math.cos(rad(s.pitch)), sp = Math.sin(rad(s.pitch));
  const y1 = p[1] * ch + p[2] * sn, z1 = p[2] * ch - p[1] * sn;
  return [s.x + p[0] * cp - y1 * sp, s.y + p[0] * sp + y1 * cp, s.z + z1];
};

const COATS = ["#3f6fb5", "#8c3b4a", "#5d7a3a", "#b5653f", "#2f5f6a", "#7b5ac9"];
const HATS = ["#5a3b2a", "#2b2a33", "#7a2e3a", "#2f4a6a"];
const SK = ["#ffe2c2", "#f5c9a0", "#ecd0b6", "#c99067"];
const folk = (v: number): Outfit => {
  const o: Outfit = { jacket: COATS[v % 6], pants: "#3b3f52", boots: "#4a3426", skin: SK[v % 4] };
  return v % 2 ? { ...o, hat: "bonnet", dress: ["#d9a441", "#c25a7a", "#5a8fc2"][v % 3] } : { ...o, hat: "cavalier", cap: HATS[v % 4], moustache: v % 3 === 0 ? "#4a3020" : undefined };
};
const SAIL_COATS = ["#c0453a", "#3f6fb5", "#b58a3a", "#6b7f4a"];
const sailor = (v: number): Outfit => ({
  jacket: SAIL_COATS[v % 4], pants: "#7a6a52", boots: "#3a2a1e", skin: SK[v % 4], hat: "cap", cap: ["#c0453a", "#2f4a6a", "#e2d8b8"][v % 3], belt: "#c9a24a", buttons: "#e8c45a",
  moustache: v % 5 === 1 ? "#4a3426" : undefined,
});
const KING_O: Outfit = { jacket: "#2f5f9a", pants: "#f0e9d2", boots: "#3a2a1e", skin: SK[0], hat: "crown", build: "stout", moustache: "#c9a24a", sash: "#c0353a", buttons: "#f0c64a" };
const ADM_O: Outfit = { jacket: "#8c3b4a", pants: "#2c2c36", boots: "#2a2018", skin: SK[1], hat: "cavalier", cap: "#2b2a33", build: "stout", moustache: "#4a3020", sash: "#e8c45a", buttons: "#e8c45a" };
const COUNCIL: Outfit[] = [
  { jacket: "#2c2c36", pants: "#2c2c36", boots: "#2a2018", skin: SK[2], hat: "cavalier", cap: "#1d1b22", moustache: "#3a2a20", build: "stout" },
  { jacket: "#4a3a5a", pants: "#2c2c36", boots: "#2a2018", skin: SK[0], hat: "cavalier", cap: "#2a2630", moustache: "#6a5a4a" },
  { jacket: "#3a3a44", pants: "#2c2c36", boots: "#2a2018", skin: SK[3], hat: "cavalier", cap: "#1d1b22", build: "stout" },
];

const front0 = (cam: CamInfo, x: number, z: number) => viewOf(cam, x, z, 0, -1);
const stand = (cam: CamInfo, out: Stage, i: number, o: Outfit, okey: string, x: number, y: number, z: number, expr: Expr, t: number, extra: Partial<FrontOpts> = {}, scale = 1, shadow = true, roll = 0) => {
  const who: Who = { i, o, okey };
  const pl = person(cam, who, x, y, z, { side: false, mirror: false }, { mode: "stand", expr, blink: lidAt(t, i + 40), look: 0, ...extra }, {}, scale);
  pl.roll = roll;
  out.places.push(pl);
  if (shadow) blob(out, x, y, z, scale);
};

// ---- crowd of townsfolk on the quay ----
const quaySpot = (i: number, n: number): [number, number] => [-34 + (i / n) * 68 + (hh(i) - 0.5) * 3, -19.5 - hh(i, 2) * 8 - (i % 3) * 1.4];
const crowd = (cam: CamInfo, t: number, out: Stage, n: number, exprs: Expr[], wave: boolean, xr: [number, number] = [-34, 34]) => {
  for (let i = 0; i < n; i++) {
    const [px, z] = quaySpot(i, n), x = xr[0] + ((px + 34) / 68) * (xr[1] - xr[0]);
    const kid = i % 7 === 3, o = kid ? KID : folk(i);
    const hop = kid && wave ? Math.max(0, Math.sin(t * 7 + i)) * 0.18 : 0;
    stand(cam, out, i + 300, o, kid ? "kid" : `f${i % 6}${i % 2}`, x, D0 + hop, z, exprs[i % exprs.length], t,
      { wave: wave && i % 3 !== 1 ? q(Math.sin(t * 9 + i * 1.3), 30) : undefined }, kid ? 0.72 : 1);
  }
};

// ---- sailors on the deck (ship-local, so they ride the heel) ----
const deckSailors = (cam: CamInfo, t: number, out: Stage, s: Ship, n: number, expr: (i: number) => Expr, fall = 0) => {
  for (let i = 0; i < n; i++) {
    const lx = -14 + (i / Math.max(1, n - 1)) * 30 + (hh(i, 4) - 0.5) * 1.2, lz = ((i % 2) * 2 - 1) * (1.6 + hh(i, 5) * 2.2);
    const [x, y, z] = shipToWorld(s, [lx, DECK_Y + 0.05, lz]);
    stand(cam, out, i, sailor(i), `s${i % 4}${i % 3}`, x, y, z, expr(i), t, { tilt: fall ? (hh(i, 6) - 0.5) * 40 * fall : 0 }, 1, false);
  }
};

// ---- bubbles / sweat / hats ----
const bubble = (p: Pen) => { p.ell(100, 100, 70, 70, "#e8f6ff", 12); p.ell(78, 76, 16, 12, "#ffffff", 0); };
const sweat = (p: Pen) => { p.poly([[100, 20], [150, 120], [100, 190], [50, 120]], "#9fd8ff", 10); p.ell(82, 120, 10, 18, "#ffffff", 0); };
const hatAlone = (p: Pen) => {
  p.ell(100, 120, 90, 18, "#5a3b2a", 8, 0, 360);
  p.poly([[40, 118], [58, 52], [100, 36], [142, 52], [160, 118]], "#5a3b2a", 8);
  p.stroke([[130, 60], [160, 30], [186, 50]], 8, "#f3eedd");
};
const bubbles = (t: number, out: Stage, cx: number, cy: number, cz: number, n = 14) => {
  for (let i = 0; i < n; i++) {
    const u = ((t * 0.18 + hh(i, 9)) % 1), y = cy + u * 22;
    out.fx.push({ key: "bubble", cw: 200, ch: 200, draw: bubble, x: cx + (hh(i, 10) - 0.5) * 12 + Math.sin(t * 2 + i) * 0.4, y, z: cz + (hh(i, 11) - 0.5) * 8, w: 0.4 + hh(i, 12) * 0.5, h: 0.4 + hh(i, 12) * 0.5, soft: false });
  }
};
const splashAt = (t0: number, t: number, out: Stage, x: number, z: number, s = 1, dur = 1.1) => {
  const u = (t - t0) / dur;
  if (u < 0 || u >= 1) return;
  out.fx.push({ key: `splash${q(u, 30)}`, cw: 800, ch: 800, draw: (p) => fxSplash(p, q(u, 30)), x, y: 2.6 * s, z, w: 7 * s, h: 7 * s });
};
const ringAt = (t: number, out: Stage, x: number, z: number, s: number, ph = 0) => {
  const u = ((t * 0.45 + ph) % 1);
  out.fx.push({ key: `ring${q(u, 30)}`, cw: 600, ch: 600, draw: (p) => fxRing(p, q(u, 30)), x, y: 0.05, z, w: s, h: s, flat: true });
};

// ---- the canoe gag (shot 18) ----
const C0 = 37.1, TIP = 39.5;
export const canoeAt = (t: number) => {
  const amp = 0.05 + 0.1 * smooth((t - C0) / 2.2);
  const tipU = smooth((t - TIP) / 0.35);
  const roll = t < TIP ? amp * Math.sin(2 * Math.PI * 1.15 * (t - C0)) : (0.1 + 3.0 * tipU) * (CANOE_SIDE);
  return { roll, x: CANOE[0], y: 0.03 * Math.sin(t * 2), z: CANOE[2], tipped: t >= TIP };
};
const CANOE_SIDE = 1;

// ---- running across the deck (shot 20) ----
const deckRun = (cam: CamInfo, t: number, out: Stage, s: Ship) => {
  const T0 = 42.4, T1 = 45.9;
  for (let i = 0; i < 30; i++) {
    const row = i % 3, col = (i / 3) | 0;
    const lx = -12 + col * 2.4 + (hh(i, 3) - 0.5) * 0.8;
    const stopped = t >= T1;
    // triangle wave across the beam: 8 m in 1.6 s; the ones that start later wait a little
    const start = T0 + row * 0.25 + hh(i, 1) * 0.5, tt = Math.max(0, Math.min(t, T1) - start), per = 3.2;
    const ph = (tt % per) / per, go = ph < 0.5 ? 1 : -1, zz = (ph < 0.5 ? -4 + 16 * ph : 4 - 16 * (ph - 0.5)) * 0.95 - 0.0;
    const lz = stopped ? ((i % 2) * 2 - 1) * (1 + hh(i, 2) * 2.5) : t < start ? ((i % 2) * 2 - 1) * 2.5 : zz;
    const [x, y, z] = shipToWorld(s, [lx, DECK_Y + 0.05, lz]);
    const running = !stopped && t >= start;
    const phase = q((tt * 2.6 + hh(i, 7)) % 1, 120);
    const who: Who = { i, o: sailor(i), okey: `s${i % 4}${i % 3}` };
    const view = viewOf(cam, x, z, 0, go);
    const expr: Expr = stopped ? "nervous" : running ? (i % 3 ? "grin" : "laugh") : "neutral";
    const fo: FrontOpts = { phase: running ? phase : 0, expr, mode: running ? "march" : "stand", blink: lidAt(t, i), lift: 90, look: 0 };
    const so: SideOpts = { phase: running ? phase : 0, expr, mode: running ? "march" : "stand", blink: lidAt(t, i), stomp: 1.6, stride: 1.5 * view.fs };
    out.places.push(person(cam, who, x, y, z, view, fo, so));
  }
};

/** everything with a face in shot `id` at time t */
export const stage = (id: number, t: number, cam: CamInfo): Stage => {
  const out: Stage = { places: [], fx: [] };
  const s = SHOTS[id - 1], ship = shipFor(id, t);
  LNAME = s.light;
  findSun(cam, SUN);
  const cheer: Expr[] = ["grin", "laugh", "smile", "grin"], gasp: Expr[] = ["shock", "nervous", "shock", "pained"];
  const king = (expr: Expr, x = KING[0], z = KING[2], extra: Partial<FrontOpts> = {}) => stand(cam, out, 900, KING_O, "king", x, D0, z, expr, t, extra, 1.08);
  const adm = (expr: Expr, extra: Partial<FrontOpts> = {}) => stand(cam, out, 901, ADM_O, "adm", ADM[0], D0, ADM[2], expr, t, extra, 1.04);
  switch (id) {
    case 1: crowd(cam, t, out, 14, cheer, false); deckSailors(cam, t, out, ship, 9, (i) => (i % 3 ? "grin" : "smile"), 0); break;
    case 2: crowd(cam, t, out, 22, cheer, false); deckSailors(cam, t, out, ship, 10, () => "grin"); break;
    case 3: king(t < 7.9 ? "smile_closed" : "grin"); crowd(cam, t, out, 10, cheer, true, [-14, 4]); break;
    case 7: crowd(cam, t, out, 36, cheer, true, [-11, 11]); king("grin", -9, -22.4, { wave: q(Math.sin(t * 6), 30) }); adm("smile"); break;
    case 8: deckSailors(cam, t, out, ship, 12, (i) => (i % 2 ? "grin" : "neutral")); break;
    case 9: crowd(cam, t, out, 30, cheer, true); deckSailors(cam, t, out, ship, 12, () => "grin"); break;
    case 10: crowd(cam, t, out, 30, ["smile", "neutral", "grin"], false); deckSailors(cam, t, out, ship, 12, (i) => (t > 21 && i % 3 === 0 ? "nervous" : "grin")); break;
    case 11: crowd(cam, t, out, 28, gasp, false); deckSailors(cam, t, out, ship, 12, (i) => (i % 2 ? "shock" : "nervous"), 0.4); break;
    case 12: deckSailors(cam, t, out, ship, 10, (i) => (i % 2 ? "shock" : "pained"), 0.6); break;
    case 13: crowd(cam, t, out, 26, gasp, false); break;
    case 14: {
      // sailors bobbing in the water near the wreck, hats afloat
      for (let i = 0; i < 6; i++) {
        const x = SAIL_X - 9 + i * 3.1 + (hh(i, 8) - 0.5) * 2, z = -6 - (i % 3) * 2.2, bob = 0.03 * Math.sin(t * 2.2 + i);
        out.places.push(person(cam, { i: i + 50, o: sailor(i), okey: `s${i % 4}${i % 3}` }, x, -0.55 + bob, z, { side: false, mirror: false }, { mode: "sit", expr: i % 2 ? "dazed" : "pained", blink: lidAt(t, i), look: 0 }, {}));
        ringAt(t, out, x, z, 2.0, hh(i, 7));
        out.fx.push({ key: "hat", cw: 200, ch: 200, draw: hatAlone, x: x + 1 + hh(i, 3), y: 0.12 + 0.03 * Math.sin(t * 2 + i), z: z - 0.8, w: 0.62, h: 0.62, rot: -0.5 + hh(i, 6) });
      }
      ringAt(t, out, SAIL_X + 0.4, 1.5, 6, 0.2);
      break;
    }
    case 15: king(t < 32 ? "stern" : "pained", KING[0] + 5.5, KING[2] - 0.0); crowd(cam, t, out, 14, gasp, false, [-6, 20]); break;
    case 18: {
      const c = canoeAt(t);
      const x = c.x + 0.1, y = c.tipped ? -0.5 : 0.35 + c.y;
      out.places.push(person(cam, { i: 77, o: sailor(2), okey: "s2c" }, x, y, c.z, { side: false, mirror: false },
        { mode: c.tipped ? "sit" : "stand", expr: c.tipped ? "pained" : t > C0 + 1.3 ? "nervous" : "neutral", blink: lidAt(t, 77), look: 0, wave: !c.tipped && t > C0 + 0.8 ? q(Math.sin(t * 11), 30) : undefined, tilt: c.tipped ? 0 : -c.roll * 40 }, {}));
      if (c.tipped) ringAt(t, out, x, c.z, 2.2);
      splashAt(TIP + 0.1, t, out, x, c.z, 0.55, 0.9);
      break;
    }
    case 19: {
      for (let i = 0; i < 14; i++) stand(cam, out, 400 + i, sailor(i), `s${i % 4}${i % 3}`, -9 + i * 1.4, D0, -21.5 - (i % 2) * 1.2, i < 6 ? "neutral" : "smile_closed", t);
      adm("stern"); crowd(cam, t, out, 12, ["neutral", "smile"], false);
      break;
    }
    case 20: deckRun(cam, t, out, ship); break;
    case 21: adm(t < 47.4 ? "nervous" : "pained"); {
      for (let i = 0; i < 3; i++) {
        const u = ((t * 0.9 + i * 0.33) % 1);
        out.fx.push({ key: "sweat", cw: 200, ch: 200, draw: sweat, x: ADM[0] + 0.55 + i * 0.12, y: D0 + 3.25 - u * 1.2 + i * 0.1, z: ADM[2] - 0.5, w: 0.2, h: 0.2 * 0.95 * (1 - u * 0.2) });
      }
    }
      break;
    case 22: case 23: {
      const ex: Expr[] = id === 22 ? ["stern", "neutral", "stern"] : t < 51.8 ? ["smile_closed", "neutral", "smile_closed"] : ["grin", "smile", "grin"];
      COUNCIL.forEach((o, i) => stand(cam, out, 700 + i, o, `c${i}`, (i - 1) * 2.3, D0, -27.2, ex[i], t,
        id === 23 ? { wave: i === 1 ? q(Math.sin(t * 5), 30) : undefined, headTilt: i === 0 ? -6 : i === 2 ? 6 : 0 } : {}, 1.04));
      break;
    }
    case 26: crowd(cam, t, out, 10, ["smile", "smile_closed"], false, [-22, 4]); break;
    case 27: crowd(cam, t, out, 34, ["smile", "grin", "smile_closed"], false, [-14, 14]); break;
    case 24: bubbles(t, out, SAIL_X, -36, 1.5, 18); break;
    case 25: {
      const u = (t - 56.7) / 1.9;
      if (u > 0.05 && u < 1.15) for (const dx of [-12, -4, 4, 12]) { ringAt(t, out, SAIL_X + dx, 1.5 - (dx % 8 ? 4 : 5.5), 7, hh(dx, 3)); }
      break;
    }
    default: break;
  }
  // ---- one-off effects ----
  if (id === 6 && t > 13.6 && t < 15.6) {
    for (const [t0, dx] of [[13.8, 0], [14.25, 0.5], [14.7, -0.4]] as const) {
      const u = (t - t0) / 0.5;
      if (u >= 0 && u < 1) out.fx.push({ key: `glint${q(u, 20)}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, q(u, 20), "#fff6c8", 8, 40, 230), x: 24.5 + dx * 0.3, y: 5.6 + dx, z: -1.2, w: 3.2, h: 3.2 });
    }
  }
  if (id >= 11 && id <= 13 && ship.ports > 0.05) {
    // spray where the lower ports meet the water along the near side
    for (let k = 0; k < 5; k++) {
      const lx = -6 + k * 4.5, u = ((t * 0.9 + k * 0.23) % 1), wp = shipToWorld(ship, [lx, 1.3, -5.1]);
      out.fx.push({ key: `splash${q(u, 30)}`, cw: 800, ch: 800, draw: (p) => fxSplash(p, q(u, 30)), x: wp[0], y: 0.3 + 0.9 * ship.ports, z: wp[2] - 0.6, w: 2.6 * ship.ports + 0.6, h: 2.6 * ship.ports + 0.6 });
    }
  }
  if (id === 13) { splashAt(26.9, t, out, ship.x, ship.z - 4, 1.5, 1.2); splashAt(27.55, t, out, ship.x + 3, ship.z - 2, 1.8, 1.3); }
  if (id === 12) splashAt(25.1, t, out, ship.x, ship.z - 8, 1.1, 1.0);
  return out;
};
export const hasPuff = fxPuff;
void fxStars; void fxBlob; void fxNote; void clamp01; void INK; void SEA_Y;
export { FPS };
