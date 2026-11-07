// The whole place as one three.js scene: sky, harbour water, the Stockholm quay and houses, and the Vasa herself
// (lofted hull painted with ports and gilding, deck, bulwarks, cannons, three masts, billowing sails, pennants, lion
// figurehead, carved stern) posed every frame from the story physics (moored, sailing, heeling, sinking, wreck,
// raising). update(id, f, camera) poses everything for shot `id` at frame f (pure function of id + f).
import * as THREE from "three";
import { Batch, Strand, boxGeo, V, lam, house, Kit } from "./build";
import { ctex, rep, rng, planksHD, beamHD, stoneHD, cobbleHD, grassHD, waterNear, waterFar, cloudHD, beam, bed } from "./paint";
import { Pen } from "./toon";
import { LIGHTS, LOOK, LightPreset } from "./lights";
import { TONE, CHAR, LFB, twoTone, untone } from "./shade";
import { NOINK } from "./ink";
import { Pool, Actor, Fx, stage, canoeAt, shipToWorld } from "./cast";
import { FPS, D0, SHOTS, camAt, V3, smooth, ShotDef, shipFor, HULL_L, DRAFT, DECK_Y, SAIL_X } from "./story";

/** no external models in the Vasa short: everything is built from primitives and paint */
export const loadKit = async (): Promise<Kit> => ({});

const rad = (d: number) => (d * Math.PI) / 180;
const HX = HULL_L / 2;
// ---------------- hull loft ----------------
const CASTLE_X = -9, CASTLE_Y = 12.4;
/** deck height along the ship (x from -23 to 23): sheer rising to the bow, a tall stern castle behind x = -9 */
export const deckAt = (x: number) => {
  const u = x / HX, castle = 1 - smooth((x - CASTLE_X) / 1.4);
  return DECK_Y + 1.8 * Math.max(0, u) ** 2 + 0.6 * Math.max(0, -u) ** 2 + (CASTLE_Y - DECK_Y - 0.6) * castle;
};
/** half beam at height y (m) and station x */
export const halfW = (x: number, y: number) => {
  const u = x / HX, plan = u >= 0 ? 1 - Math.pow(u, 2.3) : 1 - 0.36 * Math.pow(-u, 3);
  const v = Math.max(0, Math.min(1, (y + DRAFT) / (DECK_Y + DRAFT)));
  const tumble = 1 - 0.1 * Math.max(0, (v - 0.75) / 0.25);
  return (5.5 * plan + 0.22) * (0.1 + 0.9 * Math.pow(v, 0.5)) * tumble;
};
const NS = 64, NV = 16;
const TEX_H = DECK_Y + 8.4 + DRAFT + 0.2; // texture covers y = -DRAFT .. 12.6
const hullGeo = (side: number) => {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const x = -HX + (i / NS) * HULL_L, top = deckAt(x);
    for (let j = 0; j <= NV; j++) {
      const y = -DRAFT + (j / NV) * (top + DRAFT), w = halfW(x, Math.min(y, DECK_Y + 0.0));
      const wy = y <= DECK_Y ? halfW(x, y) : halfW(x, DECK_Y) * (1 - 0.0);
      pos.push(x, y, side * wy);
      uv.push((x + HX) / HULL_L, (y + DRAFT) / TEX_H);
      void w;
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = (i + 1) * (NV + 1) + j, c = (i + 1) * (NV + 1) + j + 1, d = i * (NV + 1) + j + 1;
    if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
};
const PORT_X = Array.from({ length: 10 }, (_, k) => -7.5 + k * 2.75);
const PORT_LOW = 1.35, PORT_UP = 3.2;
const hullTex = () => ctex("vasaHull", 4096, 1536, (g, r) => {
  const W = 4096, H = 1536, X = (x: number) => ((x + HX) / HULL_L) * W, Y = (y: number) => H - ((y + DRAFT) / TEX_H) * H, m = W / HULL_L;
  // tarred lower hull, red topsides
  g.fillStyle = "#3f2c22"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#9c3b2b"; g.fillRect(0, 0, W, Y(0.2));
  // castle: deep blue between the gold bands
  g.fillStyle = "#274d82"; g.fillRect(X(-HX), Y(CASTLE_Y), X(CASTLE_X) - X(-HX), Y(DECK_Y + 0.4) - Y(CASTLE_Y));
  // planking
  g.strokeStyle = "rgba(30,15,10,0.35)"; g.lineWidth = 2;
  for (let y = -DRAFT; y < CASTLE_Y; y += 0.34) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); }
  for (let k = 0; k < 420; k++) { const x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 0.34 * (H / TEX_H)); g.stroke(); }
  // gold wales
  const band = (y: number, h: number, col = "#e8b63a") => { g.fillStyle = col; g.fillRect(0, Y(y + h / 2), W, h * (H / TEX_H)); g.strokeStyle = "#3a2410"; g.lineWidth = 5; g.strokeRect(-4, Y(y + h / 2), W + 8, h * (H / TEX_H)); };
  band(0.35, 0.34); band(2.28, 0.3); band(DECK_Y - 0.12, 0.3);
  band(7.4, 0.28); band(DECK_Y + 0.4, 0.26);
  // upper deck ports (2 rows), gold frames, dark openings, red lids; lower row opens with cannon muzzles in 3D
  const port = (cx: number, cy: number, w: number, h: number, lid = true) => {
    const x = X(cx), y = Y(cy);
    g.fillStyle = "#e8b63a"; g.fillRect(x - (w / 2 + 0.16) * m, y - (h / 2 + 0.16) * (H / TEX_H), (w + 0.32) * m, (h + 0.32) * (H / TEX_H));
    g.fillStyle = "#17100c"; g.fillRect(x - (w / 2) * m, y - (h / 2) * (H / TEX_H), w * m, h * (H / TEX_H));
    g.strokeStyle = "#2a1608"; g.lineWidth = 5; g.strokeRect(x - (w / 2 + 0.16) * m, y - (h / 2 + 0.16) * (H / TEX_H), (w + 0.32) * m, (h + 0.32) * (H / TEX_H));
    if (lid) { g.fillStyle = "#b24a34"; g.fillRect(x - (w / 2) * m, y - (h / 2 + 0.45) * (H / TEX_H), w * m, 0.38 * (H / TEX_H)); g.strokeStyle = "#3a1608"; g.lineWidth = 4; g.strokeRect(x - (w / 2) * m, y - (h / 2 + 0.45) * (H / TEX_H), w * m, 0.38 * (H / TEX_H)); }
  };
  for (const px of PORT_X) { port(px, PORT_UP, 1.0, 0.95); port(px, PORT_LOW, 1.0, 0.95); }
  for (const px of [-10.9, 1.2 + 14.5]) { void px; }
  // stern castle: two rows of gold-framed windows and carved panels
  for (const [x0, x1] of [[-21.5, -18.5], [-17.2, -14.2], [-12.9, -10.2]]) {
    for (const yy of [8.9, 11.1]) { port((x0 + x1) / 2, yy, 1.2, 1.3, false); g.fillStyle = "#25406a"; g.fillRect(X((x0 + x1) / 2) - 0.5 * m, Y(yy) - 0.55 * (H / TEX_H), 1.0 * m, 1.1 * (H / TEX_H)); }
  }
  // gold scrollwork / lions along the castle side
  g.fillStyle = "#e8b63a"; g.strokeStyle = "#3a2410"; g.lineWidth = 4;
  for (let k = 0; k < 9; k++) { const x = X(-22 + k * 1.45), y = Y(CASTLE_Y - 0.6); g.beginPath(); g.arc(x, y, 0.45 * m, 0, Math.PI * 2); g.fill(); g.stroke(); }
  for (let k = 0; k < 12; k++) { const x = X(-22 + k * 1.1), y = Y(7.0); g.beginPath(); g.arc(x, y, 0.3 * m, 0, Math.PI * 2); g.fill(); g.stroke(); }
  // bow: gilded cheek scroll
  g.beginPath(); g.moveTo(X(18), Y(1.0)); g.quadraticCurveTo(X(21), Y(4.4), X(HX - 0.3), Y(5.2)); g.lineTo(X(HX - 0.3), Y(3.8)); g.quadraticCurveTo(X(20.5), Y(3.4), X(18), Y(1.0)); g.fill(); g.stroke();
});
const sternTex = () => ctex("vasaStern", 1024, 1536, (g) => {
  const W = 1024, H = 1536;
  g.fillStyle = "#274d82"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#e8b63a"; g.strokeStyle = "#3a2410"; g.lineWidth = 6;
  g.fillRect(0, 0, W, 90); g.strokeRect(0, 0, W, 90);
  g.fillRect(0, H - 150, W, 150); g.strokeRect(0, H - 150, W, 150);
  // crowned arms in a gold cartouche
  g.beginPath(); g.ellipse(W / 2, 520, 250, 300, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#9c3b2b"; g.beginPath(); g.ellipse(W / 2, 540, 190, 235, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#f0c64a"; g.beginPath(); g.moveTo(W / 2 - 110, 400); g.lineTo(W / 2 - 110, 300); g.lineTo(W / 2 - 55, 350); g.lineTo(W / 2, 270); g.lineTo(W / 2 + 55, 350); g.lineTo(W / 2 + 110, 300); g.lineTo(W / 2 + 110, 400); g.closePath(); g.fill(); g.stroke();
  for (const dx of [-95, 0, 95]) { g.fillStyle = "#f0c64a"; g.beginPath(); g.arc(W / 2 + dx, 560, 52, 0, Math.PI * 2); g.fill(); g.stroke(); }
  // stern windows
  for (const y of [940, 1110]) for (const x of [190, 512, 834]) { g.fillStyle = "#e8b63a"; g.fillRect(x - 100, y - 90, 200, 180); g.strokeRect(x - 100, y - 90, 200, 180); g.fillStyle = "#17100c"; g.fillRect(x - 78, y - 68, 156, 136); }
  // gold sea-monsters at the sides
  for (const sx of [100, W - 100]) { g.fillStyle = "#e8b63a"; g.beginPath(); g.arc(sx, 330, 70, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.arc(sx, 690, 70, 0, Math.PI * 2); g.fill(); g.stroke(); }
});
const sailTex = () => ctex("vasaSail", 1024, 1024, (g, r) => {
  g.fillStyle = "#efe3c4"; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = "rgba(150,125,85,0.55)"; g.lineWidth = 3;
  for (let x = 0; x <= 1024; x += 68) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
  g.lineWidth = 6; for (const y of [30, 330, 650]) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(120,95,60,${0.04 + r() * 0.05})`; g.beginPath(); g.ellipse(r() * 1024, r() * 1024, 30 + r() * 90, 20 + r() * 50, r() * 3, 0, 7); g.fill(); }
});
const pennantTex = () => ctex("vasaPennant", 256, 64, (g) => { g.fillStyle = "#2f5f9a"; g.fillRect(0, 0, 256, 32); g.fillStyle = "#f0c64a"; g.fillRect(0, 32, 256, 32); });

const beamBetween = (a: THREE.Vector3, b: THREE.Vector3, th: number) => {
  const g = new THREE.BoxGeometry(th, a.distanceTo(b), th);
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1));
  return g.applyMatrix4(m);
};
/** sun disc (solid, soft rim) and the flat golden halo (lighting.md 6 / depth.md 6.4: r50 13-26 % of the frame width) */
const discTex = () => ctex("sunDisc", 128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 58, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const haloTex = () => ctex("sunHalo", 256, 256, (g) => {
  const im = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = Math.hypot(x - 127.5, y - 127.5) / 128;
    const a = (0.55 * Math.exp(-((u / 0.25) ** 2)) + 0.35 * Math.exp(-((u / 0.6) ** 2))) * (1 - Math.min(1, Math.max(0, (u - 0.8) / 0.2)));
    const i = (y * 256 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.round(255 * Math.min(1, a));
  }
  g.putImageData(im, 0, 0);
});

const SUN_SHOT: Record<number, { az?: number; el?: number }> = {};
const smokeTex = () => ctex("smoke", 256, 256, (g) => {
  const p = new Pen(g);
  for (const [x, y, r, c] of [[90, 150, 60, "#8f8d96"], [150, 120, 70, "#a3a1aa"], [170, 165, 55, "#8f8d96"], [120, 100, 50, "#b4b2ba"]] as const) p.ell(x, y, r, r * 0.85, c, 0);
});

type Mats = Record<string, THREE.Material>;
type SailD = { geo: THREE.BufferGeometry; x: number; yTop: number; w: number; drop: number };
const MASTS = [{ x: 12, h: 36, r: 0.5 }, { x: 0.5, h: 41, r: 0.58 }, { x: -13, h: 30, r: 0.42 }];
const SAILS = [
  { m: 0, yTop: 22, w: 14, drop: 10.5 }, { m: 0, yTop: 33.4, w: 10.4, drop: 8 }, { m: 1, yTop: 24, w: 16.5, drop: 12 }, { m: 1, yTop: 36.8, w: 11.5, drop: 8.4 },
  { m: 2, yTop: 22.4, w: 11, drop: 8.6 },
];
const NSU = 14, NSV = 8;

export class World {
  root = new THREE.Group();
  private pool = new Pool();
  private actors: Actor[] = [];
  private fxs: Fx[] = [];
  private hemi: THREE.HemisphereLight; private sun: THREE.DirectionalLight; private fill: THREE.DirectionalLight;
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial;
  private fog = new THREE.Fog("#bccbec", 25, 420);
  private WU: Record<string, THREE.IUniform>;
  private sunDisc: THREE.Sprite; private sunHalo: THREE.Sprite;
  private sunCache = new Map<number, THREE.Vector3>();
  private cloudMaps: Record<"day" | "golden", THREE.Texture[]>;
  private clouds: THREE.Mesh[] = [];
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4(); private v = new THREE.Vector3(); private sph = new THREE.Sphere();
  private ship = new THREE.Group();
  private waterMesh!: THREE.Mesh; private seabed!: THREE.Mesh; private table = new THREE.Group();
  private canoe = new THREE.Mesh();
  private sails: SailD[] = [];
  private pennants: THREE.Mesh[] = [];
  private underBg = new THREE.Color("#1f6f8c");

  constructor(_kit: Kit) {
    const R = this.root, M: Mats = {};
    // ---- sky + light ----
    // sky: 5 colour stops by elevation (textures.md 5.2 #5 + depth.md 2/6.5), written as tone-map-inverted linear values
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() },
        c3: { value: new THREE.Color() }, c4: { value: new THREE.Color() }, e: { value: new THREE.Vector4() } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 c0, c1, c2, c3, c4; uniform vec4 e; varying vec3 vP;
        void main(){ float el = asin(clamp(normalize(vP).y, -1.0, 1.0));
          vec3 c = mix(c0, c1, smoothstep(0.0, e.x, el));
          c = mix(c, c2, smoothstep(e.x, e.y, el));
          c = mix(c, c3, smoothstep(e.y, e.z, el));
          c = mix(c, c4, smoothstep(e.z, e.w, el));
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 48, 24), this.skyMat);
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.layers.set(NOINK);
    R.add(this.sky);
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex(), color: new THREE.Color(6.0, 4.4, 2.4), fog: false, depthWrite: false }));
    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(1, 1, 1), fog: false, depthWrite: false, depthTest: true,
      transparent: true, blending: THREE.AdditiveBlending }));
    this.sunDisc.renderOrder = -0.5; this.sunHalo.renderOrder = 5;
    for (const m of [this.sunDisc, this.sunHalo]) { m.frustumCulled = false; m.layers.set(NOINK); R.add(m); }
    this.hemi = new THREE.HemisphereLight("#cfe6ff", "#6c5c8c", 1.1);
    this.sun = new THREE.DirectionalLight("#fff0d6", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.fill = new THREE.DirectionalLight("#9fb8ff", 0.35);
    R.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
    this.cloudMaps = { day: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.day.cloud)), golden: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.golden.cloud)) };
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3, d = 620 + (i % 3) * 60;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.cloudMaps.day[i % 4], color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, depthWrite: false, fog: false }));
      const w = 130 + (i % 4) * 30;
      m.position.set(Math.cos(a) * d, 120 + (i % 4) * 38, Math.sin(a) * d); m.scale.set(w, w / 2, 1);
      m.layers.set(NOINK);
      this.clouds.push(m); R.add(m);
    }


    // ---- materials ----
    M.cobble = lam("cobbleHD", () => ({ map: cobbleHD() }));
    M.wall = lam("wallHD", () => ({ map: stoneHD("wallHD", ["#c9bcaa", "#bfb19f", "#d1c5b4", "#b8aa97"], "#958776") }));
    M.tower = lam("towerHD", () => ({ map: stoneHD("towerHD") }));
    M.cope = lam("copeHD", () => ({ map: stoneHD("copeHD", ["#e6dccd", "#ddd3c3", "#ece4d6", "#d6cbba"], "#aea293") }));
    M.grass = lam("grassHD", () => ({ map: grassHD() }));
    M.wood = lam("wood", () => ({ map: beam() }));
    M.bed = lam("bed", () => ({ map: bed() }));
    M.iron = twoTone(new THREE.MeshPhongMaterial({ color: "#3d414c", specular: "#8a8a8a", shininess: 60 }), 0.15);
    M.gold = twoTone(new THREE.MeshPhongMaterial({ color: "#e0a82c", specular: "#fff0b0", shininess: 70 }), 0.15);
    M.green = lam("copper", () => ({ color: "#4f9a82" }));
    M.hill = lam("hillG", () => ({ color: "#6a9a4a" }));
    M.rope = lam("rope", () => ({ color: "#b79a62" }));
    // ---- harbour (static): quay, wall, seabed, houses, castle, spire, props ----
    const b = new Batch();
    b.add(quadUp(-1600, 1600, -400, -14, 700, 150, 0), M.cobble);
    // quay wall facing the water, from the seabed to the quay top
    {
      const g = new THREE.BufferGeometry(), y0 = -38, y1 = D0, x0 = -1600, x1 = 1600, z = -14;
      g.setAttribute("position", new THREE.Float32BufferAttribute([x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z], 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(Array(6).fill([0, 0, 1]).flat(), 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 800, 0, 800, 10, 0, 0, 800, 10, 0, 10], 2));
      b.add(g, M.wall);
    }
    b.add(boxGeo(V(-1600, D0 - 0.05, -14.9), V(1600, D0 + 0.06, -14), 2), M.cope);
    // houses along the quay (fronts face the water) in three staggered rows
    const rr = rng(23), pick = <T,>(a: T[]) => a[Math.floor(rr() * a.length) % a.length];
    for (const [zf, x0] of [[-46, -240], [-62, -230], [-80, -250]] as const) {
      let x = x0;
      while (x < 240) {
        const w = pick([7, 9]), h = pick([7, 8.4, 9.8, 11.2]);
        if (!(zf === -46 && Math.abs(x + w / 2) < 14 && false)) house(b, x + w / 2, zf, 0, w, 8, h, Math.floor(rr() * 8));
        x += w + (rr() < 0.25 ? 2.5 : 0.3);
      }
    }
    // the royal palace (Tre Kronor): a stone block with corner towers and copper spires
    const castle = (cx: number, cz: number) => {
      b.add(boxGeo(V(cx - 22, D0, cz - 16), V(cx + 22, D0 + 20, cz + 16), 3), M.tower);
      b.add(boxGeo(V(cx - 23, D0 + 20, cz - 17), V(cx + 23, D0 + 21.2, cz + 17), 2, true), M.cope);
      for (const [dx, dz] of [[-22, -16], [22, -16], [-22, 16], [22, 16]] as const) {
        const tw = new THREE.CylinderGeometry(4.2, 4.6, 26, 16); b.add(tw, M.tower, new THREE.Matrix4().makeTranslation(cx + dx, D0 + 13, cz + dz));
        const sp = new THREE.ConeGeometry(5.0, 11, 16); b.add(sp, M.green, new THREE.Matrix4().makeTranslation(cx + dx, D0 + 31.5, cz + dz));
      }
      b.add(boxGeo(V(cx - 7, D0 + 21, cz - 6), V(cx + 7, D0 + 40, cz + 6), 3), M.tower);
      b.add(new THREE.ConeGeometry(9, 16, 4).rotateY(Math.PI / 4), M.green, new THREE.Matrix4().makeTranslation(cx, D0 + 48, cz));
    };
    castle(-92, -128);
    // church spire
    b.add(boxGeo(V(112, D0, -118), V(126, D0 + 30, -104), 3), M.tower);
    b.add(new THREE.ConeGeometry(9.8, 36, 4).rotateY(Math.PI / 4), M.green, new THREE.Matrix4().makeTranslation(119, D0 + 48, -111));
    // sea bed + distant green islands
    b.add(quadUp(-1600, 1600, -14, 1600, 300, 300, -37.5 - D0), M.bed);
    for (const [hx, hz, hr, hh_] of [[-420, 520, 160, 40], [90, 700, 220, 55], [520, 560, 150, 34], [-760, 760, 200, 48]] as const) {
      b.add(new THREE.ConeGeometry(hr, hh_, 24, 1), M.hill, new THREE.Matrix4().makeTranslation(hx, hh_ / 2 - 1, hz));
    }
    // bollards, barrels, crates on the quay (only far left of the ship, so no camera ends up inside one)
    for (let k = 0; k < 7; k++) {
      const x = -130 + k * 10.5 + (k % 3) * 1.1;
      b.add(new THREE.CylinderGeometry(0.28, 0.34, 0.85, 10), M.iron, new THREE.Matrix4().makeTranslation(x, D0 + 0.42, -15.6));
      if (k % 2 === 0) b.add(new THREE.CylinderGeometry(0.55, 0.6, 1.2, 14), M.wood, new THREE.Matrix4().makeTranslation(x + 2.2, D0 + 0.6, -16.4));
      if (k % 3 === 1) b.add(boxGeo(V(x + 4, D0, -17.2), V(x + 5.3, D0 + 1.1, -16.0), 2), M.wood);
    }
    b.build(R);
    // water: its own mesh so the ripples can drift
    // river: depression-angle gradient + sparse marks (textures.md 5.2 #4), sun visibility captured for the bridge shadow
    const wNear = waterNear(), wFar = waterFar();
    for (const t of [wNear, wFar]) { t.colorSpace = THREE.NoColorSpace; t.anisotropy = 16; t.needsUpdate = true; }
    this.WU = {
      wNearC: { value: new THREE.Color() }, wMidC: { value: new THREE.Color() }, wFarC: { value: new THREE.Color() },
      wCrest: { value: new THREE.Color() }, wTrough: { value: new THREE.Color() }, wGlint: { value: new THREE.Color() },
      wShade: { value: new THREE.Vector3(0.5, 0.56, 0.72) }, wNearTex: { value: wNear }, wFarTex: { value: wFar }, wTime: { value: 0 },
    };
    const waterM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    waterM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.WU);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", WATER_DECL)
        .replace("#include <map_fragment>", WATER_COL)
        .replace("#include <lights_fragment_begin>", "float sunVis = 1.0;\n" + LFB)
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n  reflectedLight.directDiffuse = diffuseColor.rgb * mix(wShade, vec3(1.0), sunVis);\n  reflectedLight.indirectDiffuse = vec3(0.0);");
    };
    waterM.customProgramCacheKey = () => "river1";
    const wm = new THREE.Mesh(quadUp(-1600, 1600, -14, 1600, 1, 1, -D0), waterM);
    wm.receiveShadow = true;
    R.add(wm);


    this.waterMesh = wm;
    // ---- the Vasa ----
    this.buildShip(R, M);
    // ---- court table (shots 22-23) ----
    {
      const cloth = lam("tableCloth", () => ({ color: "#8c2b34" }));
      const top = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 1.9), cloth); top.position.set(0, D0 + 1.0, -25.3);
      const sk = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.5, 2.0), cloth); sk.position.set(0, D0 + 0.82, -25.3);
      this.table.add(top, sk);
      for (const sx of [-3.3, 3.3]) for (const sz of [-0.8, 0.8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.16), M.wood); l.position.set(sx, D0 + 0.5, -25.3 + sz); this.table.add(l); }
      this.table.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      R.add(this.table);
    }
    // ---- canoe (shot 18) ----
    {
      const hull = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1.9, 0.62, 0.62);
      this.canoe = new THREE.Mesh(hull, lam("canoe", () => ({ color: "#b0743c", side: THREE.DoubleSide })));
      this.canoe.castShadow = true; this.canoe.receiveShadow = true; R.add(this.canoe);
      // rowing boats near the quay
      for (const [bx, bz, br] of [[-28, -9.5, 0.2], [18, -10.5, -0.15], [-46, -8, 0.4]] as const) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(2.2, 0.7, 0.95), lam("rowboat", () => ({ color: "#8a5a34", side: THREE.DoubleSide })));
        m.position.set(bx, 0.45, bz); m.rotation.y = br; m.castShadow = true; m.receiveShadow = true; R.add(m);
      }
    }
  }

  private buildShip(R: THREE.Object3D, M: Mats) {
    const S = this.ship; S.rotation.order = "ZXY"; R.add(S);
    const hm = lam("vasaHull", () => ({ map: hullTex(), side: THREE.DoubleSide }));
    if (hm.map) { hm.map.anisotropy = 16; hm.map.needsUpdate = true; }
    for (const side of [-1, 1]) { const m = new THREE.Mesh(hullGeo(side), hm); m.castShadow = true; m.receiveShadow = true; S.add(m); }
    // deck planks following the sheer
    {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [], nor: number[] = [];
      for (let i = 0; i <= NS; i++) {
        const x = -HX + (i / NS) * HULL_L, y = deckAt(x), w = halfW(x, DECK_Y) - 0.05;
        pos.push(x, y, -w, x, y, w); uv.push(x / 2, -w / 2, x / 2, w / 2); nor.push(0, 1, 0, 0, 1, 0);
      }
      for (let i = 0; i < NS; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
      const dm = lam("planksHD", () => ({ map: planksHD(), side: THREE.DoubleSide }));
      if (dm.map) { dm.map.anisotropy = 16; dm.map.needsUpdate = true; }
      const m = new THREE.Mesh(g, dm); m.castShadow = true; m.receiveShadow = true; S.add(m);
    }
    // bulwarks: a plank wall + a gilded rail along both sides
    for (const side of [-1, 1]) {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= NS; i++) {
        const x = -HX + 0.2 + (i / NS) * (HULL_L - 0.5), y = deckAt(x), w = halfW(x, DECK_Y) - 0.02;
        pos.push(x, y, side * w, x, y + 1.0, side * w); uv.push(x / 3, 0, x / 3, 1);
      }
      for (let i = 0; i < NS; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const bm = lam("bulwark", () => ({ map: beamHD(), side: THREE.DoubleSide }));
      const m = new THREE.Mesh(g, bm); m.castShadow = true; m.receiveShadow = true; S.add(m);
      const rail = new Strand(NS + 1, 0.22, 0.22, M.gold, 3);
      rail.set(Array.from({ length: NS + 1 }, (_, i) => { const x = -HX + 0.2 + (i / NS) * (HULL_L - 0.5); return V(x, deckAt(x) + 1.05, side * (halfW(x, DECK_Y) - 0.02)); }));
      S.add(rail.mesh);
    }
    // cannon barrels poking out of the lower row
    {
      const cg = new THREE.CylinderGeometry(0.27, 0.34, 1.9, 12).rotateX(Math.PI / 2);
      const inst = new THREE.InstancedMesh(cg, M.iron, PORT_X.length * 2); inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
      const m4 = new THREE.Matrix4(); let k = 0;
      for (const side of [-1, 1]) for (const px of PORT_X) inst.setMatrixAt(k++, m4.makeTranslation(px, PORT_LOW - 0.05, side * (halfW(px, PORT_LOW) + 0.45)));
      S.add(inst);
    }
    // stern transom with the royal carving
    {
      const sm = lam("vasaStern", () => ({ map: sternTex(), side: THREE.DoubleSide }));
      const w = halfW(-HX, DECK_Y) * 2 + 0.2, g = new THREE.PlaneGeometry(w, CASTLE_Y + 1.6);
      const m = new THREE.Mesh(g, sm); m.rotation.y = -Math.PI / 2; m.position.set(-HX - 0.02, (CASTLE_Y - 1.6) / 2 + 0.2, 0); m.castShadow = true; S.add(m);
      for (const dz of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), M.gold); l.position.set(-HX - 0.25, CASTLE_Y + 0.2, dz * 2.4); S.add(l); }
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 1.6, 10), M.gold); lantern.position.set(-HX + 1.2, CASTLE_Y + 1.5, 0); S.add(lantern);
    }
    // the step up to the stern castle: a blue planked wall with a gold cap
    {
      const wl = halfW(CASTLE_X, DECK_Y) * 2;
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, CASTLE_Y - DECK_Y, wl), lam("stepWall", () => ({ color: "#274d82" }))); w1.position.set(CASTLE_X + 0.2, (CASTLE_Y + DECK_Y) / 2, 0);
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, wl + 0.2), M.gold); w2.position.set(CASTLE_X + 0.2, CASTLE_Y + 0.1, 0);
      const w3 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, wl + 0.2), M.gold); w3.position.set(CASTLE_X + 0.2, DECK_Y + 2.0, 0);
      for (const m of [w1, w2, w3]) { m.castShadow = true; m.receiveShadow = true; S.add(m); }
    }
    // bowsprit + the gilded lion
    {
      const sp = beamBetween(V(HX - 3, 5.2, 0), V(HX + 8.5, 9.6, 0), 0.5); const spm = new THREE.Mesh(sp, M.wood); spm.castShadow = true; S.add(spm);
      const lion = new THREE.Group();
      const dark = lam("mane", () => ({ color: "#c47f1a" })), white = lam("lionW", () => ({ color: "#fffaf0" })), black = lam("lionEye", () => ({ color: "#17100c" })), red = lam("jaw", () => ({ color: "#b02a2a" }));
      const body = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 14).scale(1.9, 1.0, 0.95), M.gold); body.position.set(-0.8, -0.3, 0);
      const H = V(1.7, 0.7, 0);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), M.gold); head.position.copy(H);
      lion.add(body, head);
      // mane: flame cones all round the head except the face
      for (let k = 0; k < 16; k++) for (const dz of [-0.35, 0.35]) {
        const a = (k / 16) * Math.PI * 2, dir = V(Math.cos(a), Math.sin(a), 0);
        if (Math.cos(a) > 0.55) continue;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.25, 7), dark);
        c.position.copy(H).addScaledVector(dir, 1.0).add(V(0, 0, dz)); c.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
        lion.add(c);
      }
      const snout = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.8), M.gold); snout.position.copy(H).add(V(0.95, -0.2, 0));
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), black); nose.position.copy(H).add(V(1.5, -0.02, 0));
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.25, 0.7), red); jaw.position.copy(H).add(V(0.9, -0.62, 0)); jaw.rotation.z = -0.2;
      lion.add(snout, nose, jaw);
      for (const dz of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), white); eye.position.copy(H).add(V(0.65, 0.42, dz * 0.45));
        const pup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), black); pup.position.copy(H).add(V(0.82, 0.42, dz * 0.47));
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.18), dark); brow.position.copy(H).add(V(0.7, 0.72, dz * 0.45)); brow.rotation.z = -0.3 * dz * 0;
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), M.gold); ear.position.copy(H).add(V(0.0, 1.0, dz * 0.65));
        const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 1.4, 8), M.gold); fl.position.set(0.5, -1.2, dz * 0.55);
        const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 1.4, 8), M.gold); bl.position.set(-1.8, -1.2, dz * 0.55);
        lion.add(eye, pup, brow, ear, fl, bl);
      }
      const tail = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.14, 8, 18, Math.PI * 1.3), M.gold); tail.position.set(-3.1, 0.2, 0); tail.rotation.z = 0.5;
      lion.add(tail);
      lion.scale.setScalar(1.25);
      lion.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      S.add(lion);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.12, 5.4), M.wood); fore.visible = false; S.add(fore);
      lion.position.set(HX - 1.6, 5.4, 0); lion.rotation.z = rad(8);
    }
    // masts, yards, rigging, pennants
    const flagM = lam("pennant", () => ({ map: pennantTex(), side: THREE.DoubleSide }));
    MASTS.forEach((mt, mi) => {
      const mg = new THREE.CylinderGeometry(mt.r * 0.7, mt.r, mt.h, 12); mg.translate(0, mt.h / 2, 0);
      const mm = new THREE.Mesh(mg, M.wood); mm.position.set(mt.x, DECK_Y - 0.4 + (mi === 2 ? 5.5 : 0), 0); mm.castShadow = true; S.add(mm);
      const top = DECK_Y - 0.4 + (mi === 2 ? 5.5 : 0) + mt.h;
      const pen = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.3, 14, 1), flagM); pen.position.set(mt.x, top + 0.8, 0); pen.frustumCulled = false; pen.castShadow = true;
      this.pennants.push(pen); S.add(pen);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), M.gold); ball.position.set(mt.x, top + 0.1, 0); S.add(ball);
    });
    const sm = lam("vasaSail", () => ({ map: sailTex(), side: THREE.DoubleSide }));
    SAILS.forEach((sl) => {
      const mt = MASTS[sl.m], x = mt.x;
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, sl.w + 1.6, 8).rotateX(Math.PI / 2), M.wood);
      yard.position.set(x, sl.yTop, 0); yard.castShadow = true; S.add(yard);
      const g = new THREE.PlaneGeometry(1, 1, NSU, NSV);
      this.sails.push({ geo: g, x: x + 0.7, yTop: sl.yTop, w: sl.w, drop: sl.drop });
      const m = new THREE.Mesh(g, sm); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; S.add(m);
    });
    // shrouds: thin ropes from each mast to the rails
    for (const mt of MASTS) for (const side of [-1, 1]) for (const dx of [-1.6, 0, 1.6]) {
      const st = new Strand(2, 0.07, 0.07, M.rope, 3, false);
      st.set([V(mt.x, DECK_Y + 16, side * 0.35), V(mt.x + dx, deckAt(mt.x + dx) + 1.0, side * (halfW(mt.x + dx, DECK_Y) - 0.1))]);
      S.add(st.mesh);
    }
  }

  /** camera-relative sun, frozen per shot: the shot's mean view direction turned by az toward screen right, lifted by el */
  private shotSun(id: number, s: ShotDef, L: LightPreset) {
    let v = this.sunCache.get(id);
    if (v) return v;
    let fx = 0, fz = 0;
    for (let f = s.a; f < s.b; f += 3) {
      const c = camAt(id, f), x = c.look[0] - c.pos[0], z = c.look[2] - c.pos[2], n = Math.hypot(x, z) || 1;
      fx += x / n; fz += z / n;
    }
    const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
    const ss = s as ShotDef & { sunAz?: number; sunEl?: number };
    const az = THREE.MathUtils.degToRad(ss.sunAz ?? SUN_SHOT[id]?.az ?? L.az), el = THREE.MathUtils.degToRad(ss.sunEl ?? SUN_SHOT[id]?.el ?? L.el);
    const hx = fx * Math.cos(az) - fz * Math.sin(az), hz = fz * Math.cos(az) + fx * Math.sin(az); // screen right = (-fz, fx)
    v = new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize();
    this.sunCache.set(id, v);
    return v;
  }


  private actor(i: number) { while (this.actors.length <= i) this.actors.push(new Actor(this.root)); return this.actors[i]; }
  private fx(i: number) { while (this.fxs.length <= i) this.fxs.push(new Fx(this.root)); return this.fxs[i]; }

  update(id: number, f: number, cam: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const t = f / FPS, s = SHOTS[id - 1], L = LIGHTS[s.light];
    // ---- camera ----
    const c = camAt(id, f);
    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(...c.look); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.near = 0.2; cam.far = 1500; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const focus = V(...c.look), dist = cam.position.distanceTo(focus);
    cam.layers.enable(NOINK); // sky, clouds, smoke and sun sprites live on the no-ink layer but are still rendered
    // ---- light rig (lighting.md 9.4): camera-relative sun frozen per shot, two-tone uniforms, shadow fit ----
    const K = LOOK[s.light], sunDir = this.shotSun(id, s, L);
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sunCol); this.sun.intensity = L.sunI;
    let Rr = THREE.MathUtils.clamp(dist * 1.15 + 7, 12, 95);
    if (s.light === "golden") Rr = Math.max(Rr, 30); // el 7: 2 m cards throw ~16 m shadows, houses much longer
    this.sun.position.copy(focus).addScaledVector(sunDir, 220); this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 20; sc.far = 480; sc.updateProjectionMatrix();
    this.sun.shadow.bias = L.bias; this.sun.shadow.normalBias = L.normalBias * (Rr / 12);
    this.fill.intensity = 0; // not used by the two-tone shading
    TONE.uLitCol.value.set(...L.lit); TONE.uShadeCol.value.set(...L.shade); TONE.uShadeLift.value.set(...L.lift);
    TONE.uLambert.value = L.lambert; TONE.uSideK.value = L.sideK; TONE.uTerm.value = L.term; TONE.uBounce.value.set(...LOOK[s.light].bounce); TONE.uSat.value = LOOK[s.light].sat;
    CHAR.uCharTint.value.set(...L.charTint); CHAR.uCharShade.value = L.charShade; CHAR.uGrad.value = L.charGrad;
    CHAR.uBodyGrad.value = L.bodyGrad; CHAR.uSideTint.value.set(...L.sideTint);
    // ---- sky, fog (colour = horizon colour, linear fogNear -> fogFar), sun disc + halo, clouds ----
    const su = this.skyMat.uniforms;
    K.sky.c.forEach((h, i) => untone(h, su["c" + i].value));
    const e = K.sky.e.map((deg) => THREE.MathUtils.degToRad(deg));
    su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(cam.position);
    untone(L.fog, this.fog.color); this.fog.near = L.fogNear; this.fog.far = L.fogFar;
    scene.fog = this.fog; scene.background = null;
    const showSun = s.light === "golden";
    this.sunDisc.visible = this.sunHalo.visible = showSun;
    if (showSun) {
      this.sunDisc.position.copy(cam.position).addScaledVector(sunDir, 900);
      this.sunDisc.scale.setScalar(2 * 900 * Math.tan(THREE.MathUtils.degToRad(1.7)));
      this.sunHalo.position.copy(this.sunDisc.position); this.sunHalo.scale.setScalar(2 * 900 * Math.tan(THREE.MathUtils.degToRad(24)));
      (this.sunHalo.material as THREE.SpriteMaterial).color.set(L.sunDisc).multiplyScalar(1.3);
    }
    for (let i = 0; i < this.clouds.length; i++) {
      const m = this.clouds[i], mat = m.material as THREE.MeshBasicMaterial;
      m.lookAt(cam.position.x, m.position.y, cam.position.z);
      mat.map = this.cloudMaps[s.light][i % 4];
    }
    // ---- river colours (on-screen targets, tone-map-inverted) ----
    const W = this.WU, wc = K.water;
    untone(wc.near, W.wNearC.value); untone(wc.mid, W.wMidC.value); untone(wc.far, W.wFarC.value);
    untone(wc.crest, W.wCrest.value); untone(wc.trough, W.wTrough.value); untone(wc.glint, W.wGlint.value);
    W.wShade.value.set(...wc.shade); W.wTime.value = t;

    // ---- underwater look (shot 24): deep teal fog, no sky, no surface ----
    const under = !!s.under;
    this.waterMesh.visible = !under;
    this.sky.visible = !under;
    for (const c of this.clouds) c.visible = !under;
    if (under) {
      scene.background = this.underBg; this.fog.color.copy(this.underBg); this.fog.near = 6; this.fog.far = 70; scene.fog = this.fog;
      this.sunDisc.visible = this.sunHalo.visible = false;
    }
    // ---- ship pose ----
    const sh = shipFor(id, t);
    this.ship.position.set(sh.x, sh.y, sh.z);
    this.ship.rotation.set(-rad(sh.heel), 0, rad(sh.pitch));
    this.table.visible = id === 22 || id === 23;
    {
      const cs = canoeAt(t), show = id === 18;
      this.canoe.visible = show;
      if (show) {
        this.canoe.position.set(cs.x, 0.1 + cs.y, cs.z);
        this.canoe.rotation.set(cs.roll, 0, 0, "XYZ");
      }
    }
    // sails: hang from the yards, unfurl with sh.sails, billow downwind (+x) with sh.wind
    for (const sd of this.sails) {
      const p = sd.geo.attributes.position as THREE.BufferAttribute, drop = sd.drop * (0.08 + 0.92 * sh.sails);
      for (let j = 0; j <= NSV; j++) for (let i = 0; i <= NSU; i++) {
        const u = i / NSU, v = j / NSV;
        const belly = sh.wind * (1.1 + 0.9 * sd.w / 12) * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * v)) * sh.sails;
        const flut = 0.12 * sh.wind * Math.sin(t * 3.1 + u * 5 + v * 3);
        p.setXYZ(j * (NSU + 1) + i, sd.x + belly + flut, sd.yTop - v * drop, (u - 0.5) * sd.w * (1 - 0.1 * v));
      }
      p.needsUpdate = true; sd.geo.computeVertexNormals();
    }
    for (const pn of this.pennants) {
      const p = pn.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const u = (i % 15) / 14, y = i < 15 ? 0.65 : -0.65;
        p.setXYZ(i, -u * 4.2 + 0.4 * 0, y * (1 - 0.6 * u), 0.5 * u * Math.sin(t * 5 - u * 5) * (0.4 + sh.wind));
      }
      p.needsUpdate = true;
    }
    // ---- cast + effects ----
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const st = stage(id, t, { pos: cam.position, right });
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const tint = s.light === "golden" ? "#ffcf9e" : "#ffffff";
    let ai = 0;
    const used: Actor[] = [];
    for (const p of st.places) {
      const sc2 = p.scale ?? 1;
      if (!this.frustum.intersectsSphere(this.sph.set(this.v.set(p.x, p.y + 1.1 * sc2, p.z), 3.5))) continue;
      const a = this.actor(ai++);
      const [w, h, k] = p.size ?? [300, 500, 0.5];
      a.r = this.pool.req(p.key, w, h, k, p.draw);
      a.mesh.visible = true;
      a.mesh.position.set(p.x, p.y, p.z);
      a.mesh.rotation.set(0, p.yaw ?? Math.atan2(cam.position.x - p.x, cam.position.z - p.z), p.roll ?? 0);
      a.mesh.scale.set(p.mirror ? -sc2 : sc2, sc2, sc2);
      if (a.mat.emissiveMap) a.mat.emissive.set(tint);
      a.mesh.castShadow = L.actorShadow;
      used.push(a);
    }
    for (let i = ai; i < this.actors.length; i++) this.actors[i].mesh.visible = false;
    let fi = 0;
    const fused: Fx[] = [];
    for (const p of st.fx) {
      if (!this.frustum.intersectsSphere(this.sph.set(this.v.set(p.x, p.y, p.z), Math.max(p.w, p.h)))) continue;
      const e = this.fx(fi++);
      e.r = this.pool.req(p.key, p.cw, p.ch, 1, p.draw);
      e.use(!!p.soft);
      e.mesh.visible = true;
      e.mesh.position.set(p.x, p.y, p.z);
      if (p.flat) e.mesh.rotation.set(-Math.PI / 2, 0, p.rot ?? 0);
      else { e.mesh.quaternion.copy(cam.quaternion); e.mesh.rotateZ(p.rot ?? 0); }
      e.mesh.scale.set(p.w, p.h, 1);
      fused.push(e);
    }
    for (let i = fi; i < this.fxs.length; i++) this.fxs[i].mesh.visible = false;
    this.pool.flush();
    for (const a of used) a.bind();
    for (const e of fused) e.bind();
    return focus;
  }
}

const WATER_DECL = `#include <common>
varying vec3 vWP;
uniform vec3 wNearC, wMidC, wFarC, wCrest, wTrough, wGlint, wShade;
uniform sampler2D wNearTex, wFarTex;
uniform float wTime;`;
const WATER_COL = `
  vec3 wV = vWP - cameraPosition;
  float wd = length(wV);
  float wDep = asin(clamp(-wV.y / wd, 0.0, 1.0));       // depression angle of the view ray
  float wf = 1.0 - smoothstep(0.0, 0.42, wDep);         // 1 at the horizon .. 0 at 24 deg down
  vec3 wc = mix(mix(wNearC, wMidC, smoothstep(0.0, 0.55, wf)), wFarC, smoothstep(0.55, 1.0, wf));
  vec2 wp = vWP.xz + vec2(0.35 * wTime, 0.0);           // slow river along +x
  vec4 mk = mix(texture2D(wNearTex, wp / 8.0), texture2D(wFarTex, wp / 40.0 + 0.37), smoothstep(25.0, 90.0, wd));
  wc = mix(wc, wTrough, mk.g * 0.6);
  wc = mix(wc, wCrest, mk.r * 0.7);
  wc = mix(wc, wGlint, mk.b * (0.3 + 0.5 * wf));
  diffuseColor.rgb = wc;`;


/** horizontal quad facing up at height D0 + dy covering x0..x1, z0..z1 (z0 < z1) */
function quadUp(x0: number, x1: number, z0: number, z1: number, u: number, v: number, dy = 0) {
  const y = D0 + dy, g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2));
  return g;
}

void SAIL_X; void shipToWorld; void rep; void smokeTex; void camAt; void FPS; void SHOTS; void SUN_SHOT; void CHAR; void LFB; void TONE; void untone; void waterNear; void waterFar; void cloudHD; void NOINK; void LIGHTS; void LOOK; void ctex;
