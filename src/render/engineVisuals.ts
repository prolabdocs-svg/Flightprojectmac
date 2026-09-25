// Procedural engine models + live engine effects. Every upgrade engine is drawn from its EngineCharacter
// (content/engines.ts), so swapping a Rotax 447 for a 582 changes what sits on the mount: fan shroud vs blue
// heads and radiator, one carb vs two, tuned pipe vs twin Hirth stubs, a flat-four with its gearbox, or a
// turbojet can with no propeller at all. The same group is used by the flight scene and the hangar stage.
//
// Authoring space: metres, origin at the engine-mount centre, +Z toward the nose, +Y up, propeller behind (-Z).
// Airframe GLBs are authored at 1 unit = 6 m (FlightScene scales them by 6), so the group is scaled by 1/6
// when parented under a GLB root.

import * as THREE from 'three';
import { getEngineCharacter, type EngineCharacter } from '../content/engines';

export const GLB_UNITS_PER_METRE = 1 / 6;
/** Diameter of the A0's baked propeller (0.145 model units radius x 6 m). */
const A0_PROP_DIAMETER_M = 1.74;
/** Propeller shaft height below the mount centre (A0: 0.043 model units). */
const SHAFT_Y = -0.24;

type Mats = ReturnType<typeof makeMaterials>;

function makeMaterials(c: EngineCharacter) {
  const std = (color: string, roughness: number, metalness: number) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    cyl: std(c.cylinderColor, 0.42, 0.75),
    head: std(c.headColor, c.cooling === 'liquid' ? 0.35 : 0.4, c.cooling === 'liquid' ? 0.35 : 0.78),
    case: std(c.caseColor, 0.5, 0.7),
    accent: std(c.accentColor, 0.45, 0.3),
    black: std('#141617', 0.7, 0.2),
    rubber: std('#0d0e0f', 0.85, 0.02),
    pipe: std('#8a7f78', 0.35, 0.85),
    heat: std('#6a5572', 0.3, 0.85),
    steel: std('#c9cccd', 0.25, 0.9),
    plug: std('#e8e4dc', 0.4, 0.1),
    filter: std('#b3261e', 0.75, 0.05),
    radiator: std('#23272a', 0.55, 0.6),
    glow: new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  };
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** A cylinder whose axis runs along `axis` (unit), base at `from`. */
function barrel(parent: THREE.Object3D, from: THREE.Vector3, axis: THREE.Vector3, length: number, radius: number, mat: THREE.Material, finned: boolean, finMat?: THREE.Material) {
  const g = new THREE.Group();
  g.position.copy(from);
  g.quaternion.setFromUnitVectors(Y, axis.clone().normalize());
  parent.add(g);
  mesh(g, new THREE.CylinderGeometry(radius, radius, length, 16), mat, [0, length / 2, 0]);
  if (finned) {
    const n = Math.max(4, Math.round(length / 0.022));
    const finGeo = new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, 0.006, 18);
    for (let i = 1; i < n; i++) mesh(g, finGeo, finMat ?? mat, [0, (i / n) * length, 0]);
  }
  return g;
}

function tube(parent: THREE.Object3D, points: Array<[number, number, number]>, radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return mesh(parent, new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, 8, false), mat, [0, 0, 0]);
}

/** Two-stroke expansion chamber: header, fat belly, stinger. Lathe profile along its local +Y, laid along -Z. */
function tunedPipe(parent: THREE.Object3D, m: Mats, x: number, y: number, z0: number, length: number) {
  const r = [0.03, 0.035, 0.07, 0.085, 0.085, 0.05, 0.02, 0.018];
  const pts = r.map((ri, i) => new THREE.Vector2(ri, (i / (r.length - 1)) * length));
  const pipe = mesh(parent, new THREE.LatheGeometry(pts, 16), m.pipe, [x, y, z0]);
  pipe.quaternion.setFromUnitVectors(Y, new THREE.Vector3(0, 0, -1));
  return new THREE.Vector3(x, y, z0 - length);
}

function carbs(parent: THREE.Object3D, m: Mats, count: number, side: number, y: number, zs: number[]) {
  for (let i = 0; i < count; i++) {
    const z = zs[i % zs.length];
    const body = barrel(parent, new THREE.Vector3(side * 0.16, y, z), new THREE.Vector3(side, 0, 0), 0.07, 0.03, m.case, false);
    void body;
    barrel(parent, new THREE.Vector3(side * 0.23, y, z), new THREE.Vector3(side, 0, 0), 0.09, 0.05, m.filter, false);
  }
}

function plugs(parent: THREE.Object3D, m: Mats, at: THREE.Vector3[], axis: THREE.Vector3) {
  for (const p of at) {
    barrel(parent, p, axis, 0.04, 0.009, m.plug, false);
    barrel(parent, p.clone().addScaledVector(axis, 0.04), axis, 0.035, 0.014, m.accent, false);
  }
}

function gearbox(parent: THREE.Object3D, m: Mats, zRear: number, width = 0.2) {
  mesh(parent, new THREE.BoxGeometry(width, 0.3, 0.12), m.case, [0, (SHAFT_Y + 0.05) / 2, zRear + 0.06]);
  barrel(parent, new THREE.Vector3(0, SHAFT_Y, zRear + 0.02), new THREE.Vector3(0, 0, -1), 0.1, 0.075, m.case, false);
  barrel(parent, new THREE.Vector3(0, SHAFT_Y, zRear - 0.08), new THREE.Vector3(0, 0, -1), 0.03, 0.09, m.steel, false);
}

function radiator(parent: THREE.Object3D, m: Mats, pos: [number, number, number], w: number, h: number) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.x = -0.35;
  parent.add(g);
  mesh(g, new THREE.BoxGeometry(w, h, 0.05), m.radiator, [0, 0, 0]);
  const bar = new THREE.BoxGeometry(w * 0.94, 0.006, 0.056);
  for (let i = 1; i < 10; i++) mesh(g, bar, m.steel, [0, -h / 2 + (i / 10) * h, 0]);
  mesh(g, new THREE.BoxGeometry(w + 0.03, 0.03, 0.06), m.black, [0, h / 2, 0]);
  mesh(g, new THREE.BoxGeometry(w + 0.03, 0.03, 0.06), m.black, [0, -h / 2, 0]);
  return g;
}

interface Built { root: THREE.Group; exhaust: THREE.Vector3; glow?: THREE.MeshBasicMaterial; hidesProp: boolean }

function buildInlineTwin(c: EngineCharacter, m: Mats, root: THREE.Group): Built {
  const liquid = c.cooling === 'liquid';
  mesh(root, new THREE.BoxGeometry(0.3, 0.2, 0.42), m.case, [0, -0.02, 0]);
  gearbox(root, m, -0.24);
  const zs = [0.1, -0.08];
  const heads: THREE.Vector3[] = [];
  for (const z of zs) {
    barrel(root, new THREE.Vector3(0, 0.08, z), Y, 0.2, 0.068, m.cyl, !liquid, m.cyl);
    if (liquid) {
      // Blue Head: water-jacketed head, domed, bright blue.
      mesh(root, new THREE.CylinderGeometry(0.08, 0.085, 0.07, 18), m.head, [0, 0.315, z]);
      mesh(root, new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.head, [0, 0.35, z]);
    } else {
      barrel(root, new THREE.Vector3(0, 0.28, z), Y, 0.07, 0.072, m.head, true, m.head);
    }
    heads.push(new THREE.Vector3(0, 0.36, z));
  }
  plugs(root, m, heads, Y);
  if (c.fanShroud) {
    // Fan-cooled Rotax: black shroud over the barrels, fan housing up front with its belt pulley.
    mesh(root, new THREE.BoxGeometry(0.24, 0.26, 0.42), m.black, [0, 0.23, 0.01]);
    barrel(root, new THREE.Vector3(0, 0.2, 0.22), Z, 0.08, 0.15, m.black, false);
    barrel(root, new THREE.Vector3(0, 0.2, 0.3), Z, 0.02, 0.06, m.steel, false);
    barrel(root, new THREE.Vector3(0, -0.02, 0.21), Z, 0.03, 0.05, m.steel, false);
    tube(root, [[0, 0.14, 0.31], [0, 0.05, 0.3], [0, -0.03, 0.24]], 0.01, m.rubber);
  }
  if (c.radiator) {
    radiator(root, m, [0, 0.5, 0.18], 0.42, 0.28);
    tube(root, [[0.05, 0.34, 0.1], [0.12, 0.45, 0.14], [0.16, 0.5, 0.2]], 0.018, m.rubber);
    tube(root, [[-0.05, 0.34, -0.08], [-0.14, 0.44, 0.05], [-0.18, 0.48, 0.2]], 0.018, m.rubber);
    tube(root, [[0.1, -0.08, 0.16], [0.2, 0.1, 0.25], [0.2, 0.38, 0.22]], 0.015, m.rubber);
  }
  // Rotary-valve 582 and fan-cooled 447/503 carry the carbs on one side; the tuned pipe on the other.
  carbs(root, m, c.carbs, 1, 0.12, c.carbs > 1 ? zs : [0.01]);
  let exhaust: THREE.Vector3;
  if (c.exhaust === 'tunedPipe') {
    for (const z of zs) tube(root, [[-0.07, 0.2, z], [-0.17, 0.17, z], [-0.2, 0.0, z * 0.5], [-0.2, -0.16, 0.12]], 0.024, m.pipe);
    exhaust = tunedPipe(root, m, -0.2, -0.16, 0.12, 0.62);
  } else {
    exhaust = new THREE.Vector3();
    zs.forEach((z, i) => {
      const side = i === 0 ? -1 : 1;
      tube(root, [[side * 0.07, 0.22, z], [side * 0.18, 0.18, z], [side * 0.22, 0.02, z - 0.08], [side * 0.22, -0.1, -0.25]], 0.028, m.heat);
      mesh(root, new THREE.CylinderGeometry(0.05, 0.05, 0.22, 14), m.pipe, [side * 0.22, -0.1, -0.33], [Math.PI / 2, 0, 0]);
      exhaust.add(new THREE.Vector3(side * 0.22, -0.1, -0.45).multiplyScalar(0.5));
    });
  }
  return { root, exhaust, hidesProp: false };
}

function buildSingle(m: Mats, root: THREE.Group): Built {
  mesh(root, new THREE.BoxGeometry(0.22, 0.18, 0.26), m.case, [0, -0.02, 0]);
  mesh(root, new THREE.CylinderGeometry(0.1, 0.1, 0.24, 20), m.case, [0, -0.03, 0.02], [0, 0, Math.PI / 2]);
  gearbox(root, m, -0.15, 0.16);
  barrel(root, new THREE.Vector3(0, 0.07, 0.01), Y, 0.2, 0.07, m.cyl, true, m.cyl);
  barrel(root, new THREE.Vector3(0, 0.27, 0.01), Y, 0.07, 0.075, m.head, true, m.head);
  plugs(root, m, [new THREE.Vector3(0, 0.35, 0.01)], Y);
  carbs(root, m, 1, 1, 0.12, [0.01]);
  // Pull-start reel on the front: the F-33 is the one you still start by hand.
  barrel(root, new THREE.Vector3(0, -0.03, 0.15), Z, 0.06, 0.08, m.black, false);
  tube(root, [[-0.07, 0.2, 0.01], [-0.16, 0.14, 0.0], [-0.17, -0.02, -0.1], [-0.17, -0.1, -0.2]], 0.024, m.heat);
  mesh(root, new THREE.CylinderGeometry(0.055, 0.055, 0.2, 14), m.pipe, [-0.17, -0.1, -0.28], [Math.PI / 2, 0, 0]);
  return { root, exhaust: new THREE.Vector3(-0.17, -0.1, -0.4), hidesProp: false };
}

function buildFlatTwin(m: Mats, root: THREE.Group): Built {
  mesh(root, new THREE.BoxGeometry(0.2, 0.2, 0.3), m.case, [0, 0, 0]);
  gearbox(root, m, -0.18, 0.18);
  const heads: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const axis = new THREE.Vector3(side, 0, 0);
    barrel(root, new THREE.Vector3(side * 0.09, 0.05, side * 0.02), axis, 0.18, 0.068, m.cyl, true, m.cyl);
    barrel(root, new THREE.Vector3(side * 0.27, 0.05, side * 0.02), axis, 0.07, 0.074, m.head, true, m.head);
    heads.push(new THREE.Vector3(side * 0.34, 0.05, side * 0.02));
    tube(root, [[side * 0.22, -0.02, side * 0.02], [side * 0.2, -0.12, -0.05], [side * 0.12, -0.16, -0.22]], 0.026, m.heat);
    mesh(root, new THREE.CylinderGeometry(0.05, 0.05, 0.2, 14), m.pipe, [side * 0.1, -0.17, -0.3], [Math.PI / 2, 0, 0]);
  }
  plugs(root, m, heads, new THREE.Vector3(1, 0, 0));
  carbs(root, m, 1, 1, 0.16, [0.12]);
  mesh(root, new THREE.BoxGeometry(0.12, 0.05, 0.1), m.accent, [0, 0.13, 0.05]);
  return { root, exhaust: new THREE.Vector3(0, -0.17, -0.42), hidesProp: false };
}

function buildFlatFour(c: EngineCharacter, m: Mats, root: THREE.Group): Built {
  mesh(root, new THREE.BoxGeometry(0.28, 0.24, 0.52), m.case, [0, 0, 0.02]);
  // 912 reduction gearbox at the prop end, big and round.
  mesh(root, new THREE.CylinderGeometry(0.13, 0.13, 0.14, 24), m.case, [0, SHAFT_Y + 0.1, -0.29], [Math.PI / 2, 0, 0]);
  barrel(root, new THREE.Vector3(0, SHAFT_Y, -0.36), new THREE.Vector3(0, 0, -1), 0.06, 0.1, m.steel, false);
  const heads: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    for (const z of [0.15, -0.1]) {
      const zz = z + side * 0.03;
      const axis = new THREE.Vector3(side, 0, 0);
      barrel(root, new THREE.Vector3(side * 0.14, 0.02, zz), axis, 0.14, 0.062, m.cyl, true, m.cyl);
      // Liquid-cooled heads: smooth, with the black valve cover on top.
      mesh(root, new THREE.BoxGeometry(0.09, 0.14, 0.13), m.head, [side * 0.33, 0.02, zz]);
      mesh(root, new THREE.BoxGeometry(0.07, 0.03, 0.11), m.black, [side * 0.33, 0.105, zz]);
      heads.push(new THREE.Vector3(side * 0.38, -0.02, zz));
      tube(root, [[side * 0.33, -0.05, zz], [side * 0.3, -0.16, zz - 0.05], [side * 0.1, -0.22, -0.1]], 0.02, m.heat);
    }
    tube(root, [[side * 0.33, 0.08, 0.15], [side * 0.25, 0.26, 0.2], [side * 0.18, 0.4, 0.26]], 0.014, m.rubber);
  }
  plugs(root, m, heads, new THREE.Vector3(0, -1, 0));
  // Airbox / intake plenum on top, carbs on the manifolds.
  mesh(root, new THREE.BoxGeometry(0.36, 0.08, 0.3), c.turbo ? m.accent : m.black, [0, 0.19, 0.02]);
  for (const side of [-1, 1]) barrel(root, new THREE.Vector3(side * 0.2, 0.17, 0.02), new THREE.Vector3(0, 1, 0), 0.1, 0.035, m.case, false);
  // Muffler under the gearbox, oil tank and coolant radiator.
  mesh(root, new THREE.CylinderGeometry(0.075, 0.075, 0.3, 16), m.pipe, [0, -0.25, -0.05], [Math.PI / 2, 0, 0]);
  mesh(root, new THREE.CylinderGeometry(0.06, 0.06, 0.2, 14), m.steel, [0.26, 0.2, -0.2]);
  radiator(root, m, [0, 0.46, 0.28], 0.4, 0.22);
  if (c.turbo) {
    // Turbocharger snail on the left, fed by the exhaust, with the wastegate pipe and intercooler duct.
    mesh(root, new THREE.TorusGeometry(0.06, 0.035, 10, 20), m.steel, [-0.3, -0.18, -0.2], [0, Math.PI / 2, 0]);
    mesh(root, new THREE.CylinderGeometry(0.045, 0.045, 0.1, 14), m.heat, [-0.3, -0.18, -0.2], [0, 0, Math.PI / 2]);
    tube(root, [[-0.3, -0.12, -0.2], [-0.3, 0.1, -0.1], [-0.18, 0.2, 0.0]], 0.03, m.steel);
    return { root, exhaust: new THREE.Vector3(-0.38, -0.2, -0.25), hidesProp: false };
  }
  return { root, exhaust: new THREE.Vector3(0, -0.25, -0.22), hidesProp: false };
}

function buildTurbojet(c: EngineCharacter, m: Mats, root: THREE.Group): Built {
  const R = c.accentColor ? 0.15 : 0.15;
  const len = 0.78;
  // Intake bell, compressor face, casing with fuel manifold ring, nozzle and tail cone.
  mesh(root, new THREE.TorusGeometry(R * 0.95, 0.025, 10, 28), m.steel, [0, 0, len / 2]);
  mesh(root, new THREE.CircleGeometry(R * 0.9, 24), m.black, [0, 0, len / 2 - 0.02]);
  mesh(root, new THREE.ConeGeometry(0.05, 0.08, 14), m.steel, [0, 0, len / 2 + 0.01], [Math.PI / 2, 0, 0]);
  mesh(root, new THREE.CylinderGeometry(R, R, len * 0.62, 28), m.cyl, [0, 0, len * 0.08], [Math.PI / 2, 0, 0]);
  mesh(root, new THREE.TorusGeometry(R * 1.02, 0.012, 8, 28), m.accent, [0, 0, 0.05]);
  const nozzle = new THREE.CylinderGeometry(R, R * 0.72, len * 0.3, 28, 1, true);
  mesh(root, nozzle, m.heat, [0, 0, -len * 0.38], [-Math.PI / 2, 0, 0]);
  mesh(root, new THREE.ConeGeometry(R * 0.4, 0.14, 16), m.black, [0, 0, -len * 0.4], [-Math.PI / 2, 0, 0]);
  const glow = mesh(root, new THREE.CircleGeometry(R * 0.7, 24), m.glow, [0, 0, -len * 0.5]);
  glow.rotation.y = Math.PI;
  glow.castShadow = false;
  // Mounting straps to the keel and the ECU/fuel pump box.
  for (const z of [0.12, -0.12]) mesh(root, new THREE.TorusGeometry(R * 1.04, 0.012, 6, 24, Math.PI), m.black, [0, 0, z], [0, 0, 0]);
  mesh(root, new THREE.BoxGeometry(0.12, 0.07, 0.16), m.black, [0, R + 0.06, 0.05]);
  tube(root, [[0.05, R + 0.04, 0.0], [0.12, R * 0.8, 0.05], [R * 0.95, 0.02, 0.05]], 0.008, m.accent);
  // Sit the can on the prop axis: turbines mount where the prop shaft was.
  root.children.forEach((ch) => { ch.position.y += SHAFT_Y + 0.06; });
  return { root, exhaust: new THREE.Vector3(0, SHAFT_Y + 0.06, -len * 0.52), glow: m.glow, hidesProp: true };
}

/** Builds the engine group (metres). Returns null for the salvage Field Twins, which keep the baked engine. */
export function buildEngineModel(engineId: string | undefined): (Built & { character: EngineCharacter; dispose: () => void }) | null {
  const c = getEngineCharacter(engineId);
  if (c.layout === 'stock') return null;
  const m = makeMaterials(c);
  const root = new THREE.Group();
  root.name = `engine_${engineId}`;
  const built = c.layout === 'inlineTwin' ? buildInlineTwin(c, m, root)
    : c.layout === 'single' ? buildSingle(m, root)
      : c.layout === 'flatTwin' ? buildFlatTwin(m, root)
        : c.layout === 'flatFour' ? buildFlatFour(c, m, root)
          : buildTurbojet(c, m, root);
  const dispose = () => {
    root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.geometry.dispose(); });
    for (const mat of Object.values(m)) mat.dispose();
  };
  return { ...built, character: c, dispose };
}

// ---- Attaching to an airframe -------------------------------------------------------------------

/** Anchors of the engine on an airframe GLB root (in root-local units). */
function findEngineAnchor(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const baked: THREE.Object3D[] = [];
  root.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    const mats = Array.isArray(me.material) ? me.material : [me.material];
    if (mats.some((x) => x.name === 'A0_ENGINE_DARK') || /^engine_mount/.test(me.name)) baked.push(me);
  });
  const props: THREE.Object3D[] = [];
  const pivot = root.getObjectByName('propeller_pivot');
  if (pivot) props.push(pivot);
  else root.traverse((o) => { if (/^prop_(blade|hub)/.test(o.name)) props.push(o); });
  const box = new THREE.Box3();
  for (const b of baked) box.union(new THREE.Box3().setFromObject(b));
  if (box.isEmpty()) return null;
  box.applyMatrix4(inv);
  const center = box.getCenter(new THREE.Vector3());
  const propBox = new THREE.Box3();
  for (const p of props) propBox.union(new THREE.Box3().setFromObject(p));
  const propZ = propBox.isEmpty() ? center.z - 1 : propBox.applyMatrix4(inv).getCenter(new THREE.Vector3()).z;
  return { baked, props, pivot, center, tractor: propZ > center.z };
}

/**
 * Live engine on an airframe: the procedural model on the mount (baked engine hidden), exhaust smoke,
 * turbine glow, vibration and the propeller hidden/resized to the engine's prop.
 */
export class EngineVisual {
  readonly character: EngineCharacter;
  readonly exhaustAnchor = new THREE.Object3D();
  private readonly model: ReturnType<typeof buildEngineModel>;
  private readonly group: THREE.Group;
  private readonly hidden: THREE.Object3D[] = [];
  private readonly props: THREE.Object3D[] = [];
  private readonly propBaseScale: THREE.Vector3[] = [];
  private readonly base = new THREE.Vector3();
  private t = 0;

  private constructor(root: THREE.Object3D, engineId: string | undefined, propDiameterM: number | undefined) {
    this.character = getEngineCharacter(engineId);
    this.model = buildEngineModel(engineId);
    this.group = new THREE.Group();
    this.group.name = 'engine_visual';
    const anchor = findEngineAnchor(root);
    const center = anchor?.center ?? new THREE.Vector3();
    this.group.position.copy(center);
    this.group.scale.setScalar(GLB_UNITS_PER_METRE);
    if (anchor?.tractor) this.group.rotation.y = Math.PI;
    this.base.copy(this.group.position);
    root.add(this.group);
    this.group.add(this.exhaustAnchor);
    if (this.model) {
      this.group.add(this.model.root);
      this.exhaustAnchor.position.copy(this.model.exhaust);
      for (const b of anchor?.baked ?? []) { b.visible = false; this.hidden.push(b); }
    } else {
      this.exhaustAnchor.position.set(-0.2, -0.1, -0.3);
    }
    for (const p of anchor?.props ?? []) {
      this.props.push(p);
      this.propBaseScale.push(p.scale.clone());
      if (this.model?.hidesProp) { p.visible = false; this.hidden.push(p); }
      else if (anchor?.pivot && propDiameterM) p.scale.multiplyScalar(propDiameterM / A0_PROP_DIAMETER_M);
    }
  }

  static attach(root: THREE.Object3D, engineId: string | undefined, propDiameterM?: number): EngineVisual {
    return new EngineVisual(root, engineId, propDiameterM);
  }

  get isTurbine() { return this.character.layout === 'turbojet'; }

  /** rpmFrac 0..1 idle->redline, throttle applied 0..1. */
  update(rpmFrac: number, running: boolean, dtS: number): void {
    this.t += dtS;
    const c = this.character;
    const amp = running ? c.vibration * 0.012 * (0.35 + 0.65 * rpmFrac) : 0;
    const w = 90 + rpmFrac * 120;
    this.group.position.set(
      this.base.x + Math.sin(this.t * w) * amp * GLB_UNITS_PER_METRE,
      this.base.y + Math.sin(this.t * w * 1.31 + 1.7) * amp * GLB_UNITS_PER_METRE,
      this.base.z,
    );
    const glow = this.model?.glow;
    if (glow) {
      const flicker = 0.9 + 0.1 * Math.sin(this.t * 37) * Math.sin(this.t * 23);
      glow.opacity = running ? Math.min(1, 0.15 + rpmFrac * 0.85) * flicker : 0;
      glow.color.setHSL(0.07 - rpmFrac * 0.03, 1, 0.45 + rpmFrac * 0.15);
    }
  }

  /** Puts the airframe back the way it was (baked engine and prop visible, prop scale restored). */
  detach(): void {
    for (const h of this.hidden) h.visible = true;
    this.props.forEach((p, i) => p.scale.copy(this.propBaseScale[i]));
    this.group.removeFromParent();
    this.model?.dispose();
  }
}

// ---- Exhaust smoke ------------------------------------------------------------------------------

const SMOKE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (600.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const SMOKE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r) * vAlpha;
    gl_FragColor = vec4(uColor, a);
  }`;

/**
 * World-space exhaust haze. Puffs are left in the air where they were emitted, so a two-stroke draws a
 * faint blue trail, a four-stroke almost nothing, an overheating engine a darker plume.
 */
export class ExhaustSmoke {
  readonly points: THREE.Points;
  private readonly max = 160;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly baseSize: Float32Array;
  private next = 0;
  private carry = 0;
  private wasRunning = false;
  private readonly tmp = new THREE.Vector3();
  private readonly color: THREE.Color;
  private readonly baseColor: THREE.Color;
  private readonly character: EngineCharacter;

  constructor(character: EngineCharacter) {
    this.character = character;
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.baseColor = new THREE.Color(character.smoke.color);
    this.color = this.baseColor.clone();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color } }, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  private emit(at: THREE.Vector3, size: number, life: number, alpha: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([at.x + (Math.random() - 0.5) * 0.1, at.y + (Math.random() - 0.5) * 0.1, at.z + (Math.random() - 0.5) * 0.1], i * 3);
    this.vel.set([(Math.random() - 0.5) * 0.6, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.baseSize[i] = size;
    this.alpha[i] = alpha;
  }

  /** @param at exhaust outlet, world. tempFrac > 1 = overheating (heavier, darker or steamier plume). */
  update(dtS: number, at: THREE.Vector3, running: boolean, throttle: number, tempFrac: number, wind: THREE.Vector3): void {
    const c = this.character;
    const hot = Math.max(0, Math.min(1, (tempFrac - 0.95) * 4));
    if (running && !this.wasRunning) for (let k = 0; k < 14; k++) this.emit(at, c.smoke.size * 1.6, 2.2, 0.55); // start-up puff
    this.wasRunning = running;
    if (running) {
      const rate = c.smoke.rate * (0.25 + 0.75 * throttle) + hot * 18;
      this.carry += rate * dtS;
      while (this.carry >= 1) {
        this.carry -= 1;
        this.emit(at, c.smoke.size * (1 + hot * 0.8), 1.4 + hot, 0.28 + 0.25 * hot);
      }
    }
    // Liquid-cooled boil-over steams white; air-cooled overheat smokes dark.
    const target = hot > 0 ? (c.cooling === 'liquid' || c.cooling === 'liquid-heads' ? '#eef1f3' : '#4a4d52') : null;
    this.color.copy(this.baseColor);
    if (target) this.color.lerp(this.tmp.set(0, 0, 0) && new THREE.Color(target), hot);
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i];
      if (a > this.life[i]) { this.size[i] = 0; this.alpha[i] = 0; continue; }
      this.age[i] = a + dtS;
      const k = a / this.life[i];
      const j = i * 3;
      this.pos[j] += (this.vel[j] + wind.x * 0.8) * dtS;
      this.pos[j + 1] += this.vel[j + 1] * dtS;
      this.pos[j + 2] += (this.vel[j + 2] + wind.z * 0.8) * dtS;
      this.size[i] = this.baseSize[i] * (1 + k * 4);
      this.alpha[i] *= 1 - Math.min(1, dtS / Math.max(0.05, this.life[i] - a));
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  /** Floating-origin rebase. */
  shift(dx: number, dz: number): void {
    for (let i = 0; i < this.max; i++) { this.pos[i * 3] -= dx; this.pos[i * 3 + 2] -= dz; }
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
