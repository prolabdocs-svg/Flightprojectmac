// Aerofox Kestrel 2 instrument pod: a painted glass-fibre nacelle hung on two tubes in front of the
// pilot's knees, MX II style, drawn as real low-poly geometry: chamfered shell -> recessed panel
// plate with cut-outs -> instrument cans -> printed dial faces -> 3D needles -> glass.
// Faces are printed once into a static atlas; only needles, the compass card, the slip ball, lamps
// and the flap toggle move. Data flows telemetry -> cockpit/instrumentModel -> these transforms.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FlightTelemetry } from '../flight/flightTypes';
import { Needle, dialAngle, readInstruments, unwrapDeg, type EngineLimits } from './cockpit/instrumentModel';

const C = { ivory: '#eee6d2', ink: '#23272b', face: '#17191b', accent: '#f06a2a', green: '#5fb56a', yellow: '#e9b844', red: '#e2472f', cyan: '#6fd3f0' };
const FONT = "'DIN Condensed', 'Bahnschrift SemiCondensed', 'Arial Narrow', 'Roboto Condensed', sans-serif";
const CELL = 512;

// Panel layout, pod-local metres (+X = pilot's right, +Y up, +Z toward the pilot).
const W = 0.44, H = 0.25, LIP = 0.018, POD_SCALE = 0.72;
const R_BIG = 0.046, R_SMALL = 0.026, ROW1 = 0.03, ROW2 = -0.072;
const PLATE_Z = -0.006, FACE_Z = -0.021, GLASS_Z = -0.003;
type DialId = 'asi' | 'alt' | 'rpm' | 'vsi' | 'fuel' | 'cht';
const DIALS: Record<DialId, { x: number; y: number; r: number; cell: number }> = {
  asi: { x: -0.118, y: ROW1, r: R_BIG, cell: 0 },
  alt: { x: 0, y: ROW1, r: R_BIG, cell: 1 },
  rpm: { x: 0.118, y: ROW1, r: R_BIG, cell: 2 },
  vsi: { x: -0.103, y: ROW2, r: R_SMALL, cell: 3 },
  fuel: { x: 0.066, y: ROW2, r: R_SMALL, cell: 4 },
  cht: { x: 0.14, y: ROW2, r: R_SMALL, cell: 5 },
};
const LABEL_CELL = 6; // eight 512x64 strips
const LABELS = ['AEROFOX  ·  KESTREL 2', 'STALL', 'FUEL', 'RUN', 'FLAP', 'DN', 'UP'] as const;
const SLIP = { x: -0.017, y: ROW2 + 0.004, w: 0.074, h: 0.03, R: 0.12, arc: 0.66 };
const FLAP = { x: -0.166, y: ROW2 - 0.01 };
const LAMPS = { stall: [-0.059, ROW1 + 0.047], fuel: [0.059, ROW1 + 0.047], run: [-0.166, ROW2 + 0.03] } as const;
const COMPASS = { y: H / 2 + 0.032, r: 0.034, h: 0.046 };

const cellUv = (geo: THREE.BufferGeometry, cell: number, u0 = 0, v0 = 0, us = 1, vs = 1) => {
  const uv = geo.attributes.uv as THREE.BufferAttribute, col = cell % 4, row = Math.floor(cell / 4);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + u0 + uv.getX(i) * us) / 4, 1 - (row + 1 - (v0 + uv.getY(i) * vs)) / 2);
  return geo;
};
const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
const merge = (geos: THREE.BufferGeometry[]) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;

export interface CockpitSeat {
  /** Hand anchors in aircraft-local space at neutral stick / mid throttle, and the avatar scale. */
  stick: THREE.Vector3;
  throttle: THREE.Vector3;
  scale: number;
}
export interface CockpitDrive { pitch: number; roll: number; throttle: number }

export class InstrumentPod {
  /** The pod, aimed at the eye. */
  readonly group = new THREE.Group();
  /** Airframe-fixed hardware: mounting tubes, stick, throttle quadrant (FlightScene parents both). */
  readonly controls = new THREE.Group();
  /** Turn to the active route point (deg, − left); null = no course bug (no plan, or Minimal guidance). */
  navDeltaDeg: number | null = null;
  /** Flap actuator position 0..1 (drives the panel toggle). */
  flaps = 0;

  private readonly atlas: THREE.CanvasTexture;
  private readonly cardTex: THREE.CanvasTexture;
  private readonly needles: Record<'asi' | 'altLong' | 'altShort' | 'rpm' | 'vsi' | 'fuel' | 'cht', THREE.Object3D> = {} as never;
  private readonly stallBug: THREE.Object3D;
  private readonly card: THREE.Mesh;
  private readonly courseBug: THREE.Mesh;
  private readonly ball: THREE.Mesh;
  private readonly flapLever: THREE.Object3D;
  private readonly flapSwitch = new THREE.Group();
  private readonly lamps: Record<'stall' | 'fuel' | 'run', THREE.MeshStandardMaterial> = {} as never;
  private readonly faceMat: THREE.MeshStandardMaterial;
  private limits: EngineLimits = { idleRpm: 1600, redlineRpm: 6200 };
  private rpmMax = 7000;
  private readonly n = {
    asi: new Needle(9), alt: new Needle(7), rpm: new Needle(14), vsi: new Needle(3.2, 0.9), fuel: new Needle(1.5),
    cht: new Needle(1.2), slip: new Needle(6, 0.55), hdg: new Needle(2.6, 0.45), stall: new Needle(4), flap: new Needle(10),
    pitch: new Needle(12), roll: new Needle(12), thr: new Needle(12),
  };
  private primed = false;
  private seat: CockpitSeat | null = null;
  private readonly stick = new THREE.Group();
  private readonly throttle = new THREE.Group();
  private readonly stickBase = new THREE.Vector3();
  private readonly throttleBase = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    const m = {
      shell: new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.55, flatShading: true }),
      plate: new THREE.MeshStandardMaterial({ color: C.ink, roughness: 0.82, flatShading: true }),
      bezel: new THREE.MeshStandardMaterial({ color: '#2c3034', roughness: 0.42, metalness: 0.55, flatShading: true }),
      can: new THREE.MeshStandardMaterial({ color: '#0c0d0e', roughness: 0.9, side: THREE.DoubleSide }),
      alu: new THREE.MeshStandardMaterial({ color: '#a7adb2', roughness: 0.38, metalness: 0.75, flatShading: true }),
      screw: new THREE.MeshStandardMaterial({ color: '#c9ccce', roughness: 0.3, metalness: 0.85, flatShading: true }),
      rubber: new THREE.MeshStandardMaterial({ color: '#1d1f21', roughness: 0.95, flatShading: true }),
      accent: new THREE.MeshStandardMaterial({ color: C.accent, roughness: 0.5, flatShading: true }),
      needle: new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.5, emissive: C.ivory, emissiveIntensity: 0.22 }),
      glass: new THREE.MeshStandardMaterial({ color: '#dfeaf0', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }),
      ball: new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.2 }),
    };

    this.atlas = this.texture(CELL * 4, CELL * 2);
    // Faces take a little emissive from their own print so they stay readable in the wing's shadow;
    // raise emissiveIntensity for panel lighting at night.
    this.faceMat = new THREE.MeshStandardMaterial({ map: this.atlas, emissiveMap: this.atlas, emissive: '#ffffff', emissiveIntensity: 0.32, roughness: 0.7 });
    this.cardTex = this.texture(1024, 128);
    this.cardTex.wrapS = THREE.RepeatWrapping;
    this.drawFaces();
    this.drawCard();

    // --- Shell: chamfered trapezoid ring, lip proud of the recessed plate.
    const outline = (inset: number) => {
      const s = new THREE.Shape(), w = W / 2 - inset, h = H / 2 - inset, taper = 0.018, ch = 0.03 - inset * 0.5;
      s.moveTo(-w + taper + ch, -h); s.lineTo(w - taper - ch, -h); s.lineTo(w - taper, -h + ch);
      s.lineTo(w, h - ch); s.lineTo(w - ch, h); s.lineTo(-w + ch, h); s.lineTo(-w, h - ch); s.lineTo(-w + taper, -h + ch); s.closePath();
      return s;
    };
    const ring = outline(0);
    ring.holes.push(outline(LIP) as unknown as THREE.Path);
    const shellGeo = at(new THREE.ExtrudeGeometry(ring, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 1, curveSegments: 1 }), 0, 0, -0.1);
    const back = at(new THREE.ExtrudeGeometry(outline(LIP), { depth: 0.012, bevelEnabled: false, curveSegments: 1 }), 0, 0, -0.1);
    const shell = new THREE.Mesh(merge([shellGeo, back]), m.shell);

    // Glare shield: a brow over the top that shades the faces, with the Aerofox orange stripe.
    const brow = new THREE.Mesh(at(new THREE.BoxGeometry(W + 0.01, 0.012, 0.075), 0, H / 2 + 0.004, -0.012, -0.22), m.shell);
    const stripe = new THREE.Mesh(merge([
      at(new THREE.BoxGeometry(W - 0.07, 0.008, 0.004), 0, -H / 2 + 0.012, 0.011),
      at(new THREE.BoxGeometry(W + 0.012, 0.004, 0.077), 0, H / 2 + 0.012, -0.013, -0.22),
    ]), m.accent);

    // --- Plate with real cut-outs for every can and the slip window.
    const plateShape = outline(LIP);
    for (const d of Object.values(DIALS)) { const p = new THREE.Path(); p.absarc(d.x, d.y, d.r + 0.001, 0, Math.PI * 2, true); plateShape.holes.push(p); }
    const sw = new THREE.Path(); { const { x, y, w, h } = SLIP; sw.moveTo(x - w / 2, y - h / 2); sw.lineTo(x - w / 2, y + h / 2); sw.lineTo(x + w / 2, y + h / 2); sw.lineTo(x + w / 2, y - h / 2); sw.closePath(); }
    plateShape.holes.push(sw);
    const plate = new THREE.Mesh(at(new THREE.ExtrudeGeometry(plateShape, { depth: 0.012, bevelEnabled: false, curveSegments: 22 }), 0, 0, PLATE_Z - 0.012), m.plate);

    // --- Instruments: bezels, cans, faces, glass (merged per material), needles (live).
    const bezels: THREE.BufferGeometry[] = [], cans: THREE.BufferGeometry[] = [], faces: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    const screws: THREE.Vector3[] = [];
    for (const [id, d] of Object.entries(DIALS) as [DialId, typeof DIALS[DialId]][]) {
      const r = d.r, seg = r > 0.04 ? 22 : 16;
      const prof = [[r - 0.0005, -0.002], [r - 0.002, 0.006], [r + 0.004, 0.0085], [r + 0.0095, 0.0045], [r + 0.011, -0.001]].map(([a, b]) => new THREE.Vector2(a, b));
      bezels.push(at(new THREE.LatheGeometry(prof, seg), d.x, d.y, PLATE_Z, Math.PI / 2));
      cans.push(at(new THREE.CylinderGeometry(r, r, PLATE_Z - FACE_Z, seg, 1, true), d.x, d.y, (PLATE_Z + FACE_Z) / 2, Math.PI / 2));
      faces.push(at(cellUv(new THREE.CircleGeometry(r, seg + 6), d.cell), d.x, d.y, FACE_Z));
      glass.push(at(new THREE.CircleGeometry(r + 0.001, seg), d.x, d.y, GLASS_Z));
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; screws.push(new THREE.Vector3(d.x + Math.cos(a) * (r + 0.0075), d.y + Math.sin(a) * (r + 0.0075), PLATE_Z + 0.0065)); }
      if (id === 'alt') {
        this.needles.altShort = this.needle(r, 0.55, 0.07, m.needle, d);
        this.needles.altLong = this.needle(r, 0.86, 0.034, m.needle, d, 0.0016);
      } else this.needles[id] = this.needle(r, r > 0.04 ? 0.84 : 0.78, r > 0.04 ? 0.036 : 0.06, m.needle, d);
    }
    // Stall-speed bug on the ASI bezel ring: an orange index riding at the live 1g stall speed.
    this.stallBug = new THREE.Group();
    this.stallBug.position.set(DIALS.asi.x, DIALS.asi.y, PLATE_Z + 0.009);
    const bug = new THREE.Mesh(at(new THREE.ConeGeometry(0.0045, 0.008, 3), 0, DIALS.asi.r + 0.0035, 0, 0, 0, Math.PI), m.accent);
    this.stallBug.add(bug);

    // Slip indicator: glass tube arc with a black ball, two wire marks, dark backing card.
    const slipBack = new THREE.Mesh(at(new THREE.PlaneGeometry(SLIP.w, SLIP.h), SLIP.x, SLIP.y, FACE_Z), new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.8, emissive: C.ivory, emissiveIntensity: 0.18 }));
    const tubeC = new THREE.Vector3(SLIP.x, SLIP.y - SLIP.h / 2 + 0.009 + SLIP.R, FACE_Z + 0.008);
    const tube = new THREE.Mesh(at(new THREE.TorusGeometry(SLIP.R, 0.0068, 6, 14, SLIP.arc), tubeC.x, tubeC.y, tubeC.z, 0, 0, -Math.PI / 2 - SLIP.arc / 2), m.glass);
    const wires = new THREE.Mesh(merge([-1, 1].map((s) => at(new THREE.BoxGeometry(0.0014, 0.024, 0.001), SLIP.x + s * 0.0078, tubeC.y - SLIP.R, tubeC.z + 0.008))), m.ball);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.0056, 8, 6), m.ball);
    this.ball.userData.c = tubeC;

    // Flap toggle: escutcheon + bat-handle lever pivoting about X, with UP/DN legends.
    const esc = new THREE.Mesh(at(new THREE.CylinderGeometry(0.0085, 0.0095, 0.004, 8), FLAP.x, FLAP.y, PLATE_Z + 0.002, Math.PI / 2), m.screw);
    this.flapLever = new THREE.Group();
    this.flapLever.position.set(FLAP.x, FLAP.y, PLATE_Z + 0.004);
    this.flapLever.add(new THREE.Mesh(at(new THREE.CylinderGeometry(0.0022, 0.0032, 0.022, 6), 0, 0, 0.011, Math.PI / 2), m.screw));

    // Warning lamps: faceted domes in chrome rings; they only glow when their condition is real.
    const lampRing: THREE.BufferGeometry[] = [];
    const lampGroup = new THREE.Group();
    for (const [id, color] of [['stall', C.red], ['fuel', C.yellow], ['run', C.green]] as const) {
      const [x, y] = LAMPS[id];
      lampRing.push(at(new THREE.CylinderGeometry(0.0078, 0.0085, 0.004, 8, 1, true), x, y, PLATE_Z + 0.002, Math.PI / 2));
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.22), emissive: color, emissiveIntensity: 0, roughness: 0.3, flatShading: true });
      this.lamps[id] = mat;
      lampGroup.add(new THREE.Mesh(at(new THREE.SphereGeometry(0.0062, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), x, y, PLATE_Z + 0.001, Math.PI / 2), mat));
    }

    // Legends (same atlas as the faces): printed straight onto the plate and the shell lip.
    const legend = (i: number, cx: number, cy: number, w: number, z = PLATE_Z + 0.0004) => {
      const len = LABELS[i].length * 0.105 + 0.1, u = Math.min(1, len / 2.4);
      return at(cellUv(new THREE.PlaneGeometry(w, w * 0.125 / u), LABEL_CELL, 0.5 - u / 2, 1 - (i + 1) / 8, u, 1 / 8), cx, cy, z);
    };
    const legends = new THREE.Mesh(merge([
      legend(0, SLIP.x, -H / 2 + LIP + 0.009, 0.1),
      legend(1, LAMPS.stall[0], LAMPS.stall[1] + 0.0125, 0.032), legend(2, LAMPS.fuel[0], LAMPS.fuel[1] + 0.0125, 0.026),
      legend(3, LAMPS.run[0] + 0.02, LAMPS.run[1], 0.02),
    ]), Object.assign(this.faceMat.clone(), { alphaTest: 0.5 }));
    // Flap toggle only on airframes whose wing really has flaps (configure() decides).
    this.flapSwitch.add(esc, this.flapLever, new THREE.Mesh(merge([
      legend(4, FLAP.x, FLAP.y + 0.021, 0.024),
      legend(6, FLAP.x + 0.017, FLAP.y + 0.009, 0.011), legend(5, FLAP.x + 0.017, FLAP.y - 0.009, 0.011),
    ]), legends.material));
    this.flapSwitch.visible = false;

    const screwMesh = new THREE.InstancedMesh(at(new THREE.CylinderGeometry(0.0021, 0.0021, 0.0014, 6), 0, 0, 0, Math.PI / 2), m.screw, screws.length + 6);
    const plateScrews = [[-W / 2 + 0.03, H / 2 - 0.03], [W / 2 - 0.03, H / 2 - 0.03], [-W / 2 + 0.05, -H / 2 + 0.03], [W / 2 - 0.05, -H / 2 + 0.03], [-0.05, -H / 2 + 0.03], [0.05, -H / 2 + 0.03]];
    [...screws, ...plateScrews.map(([x, y]) => new THREE.Vector3(x, y, PLATE_Z + 0.0007))].forEach((p, i) => screwMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));

    // Whiskey compass on the brow: open-fronted pot, floating card, lubber line, route bug.
    const cy = COMPASS.y;
    const pot = new THREE.Mesh(merge([
      at(new THREE.CylinderGeometry(COMPASS.r, COMPASS.r, COMPASS.h, 12, 1, true, Math.PI / 3, Math.PI * 4 / 3), 0, cy, 0),
      at(new THREE.CylinderGeometry(COMPASS.r + 0.003, COMPASS.r + 0.003, 0.006, 12), 0, cy + COMPASS.h / 2, 0),
      at(new THREE.CylinderGeometry(COMPASS.r + 0.003, COMPASS.r + 0.006, 0.008, 12), 0, cy - COMPASS.h / 2, 0),
      at(new THREE.BoxGeometry(0.03, 0.016, 0.03), 0, cy - COMPASS.h / 2 - 0.009, -0.006),
    ]), m.bezel);
    this.card = new THREE.Mesh(new THREE.CylinderGeometry(COMPASS.r - 0.005, COMPASS.r - 0.005, 0.022, 24, 1, true), new THREE.MeshStandardMaterial({ map: this.cardTex, emissiveMap: this.cardTex, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.7 }));
    this.card.position.y = cy;
    const lubber = new THREE.Mesh(at(new THREE.BoxGeometry(0.0016, 0.03, 0.001), 0, cy, COMPASS.r - 0.001), m.accent);
    const potGlass = new THREE.Mesh(at(new THREE.CylinderGeometry(COMPASS.r, COMPASS.r, COMPASS.h - 0.004, 8, 1, true, -Math.PI / 3, Math.PI * 2 / 3), 0, cy, 0), m.glass);
    this.courseBug = new THREE.Mesh(at(new THREE.ConeGeometry(0.004, 0.008, 3), 0, 0, 0, 0, 0, Math.PI), new THREE.MeshStandardMaterial({ color: C.cyan, emissive: C.cyan, emissiveIntensity: 0.6 }));
    this.courseBug.position.set(0, cy + COMPASS.h / 2 + 0.007, COMPASS.r);

    this.group.add(shell, brow, stripe, plate, new THREE.Mesh(merge(bezels), m.bezel), new THREE.Mesh(merge(cans), m.can),
      new THREE.Mesh(merge(faces), this.faceMat), legends, new THREE.Mesh(merge(glass), m.glass), screwMesh, this.stallBug,
      slipBack, tube, wires, this.ball, this.flapSwitch, new THREE.Mesh(merge(lampRing), m.screw), lampGroup,
      pot, this.card, lubber, potGlass, this.courseBug);
    for (const o of Object.values(this.needles)) this.group.add(o);
    this.group.traverse((o) => { o.castShadow = o !== this.group && (o as THREE.Mesh).material !== m.glass; o.receiveShadow = true; });
    this.group.name = 'instrument_pod';

    // --- Airframe-fixed hardware (positions filled in mount()).
    this.controls.name = 'cockpit_controls';
    const stickTube = new THREE.Mesh(at(new THREE.CylinderGeometry(0.011, 0.013, 1, 8), 0, 0.5, 0), m.alu);
    stickTube.name = 'tube';
    const grip = new THREE.Mesh(merge([at(new THREE.CylinderGeometry(0.017, 0.015, 0.1, 8), 0, 0, 0), at(new THREE.CylinderGeometry(0.019, 0.017, 0.012, 8), 0, 0.055, 0)]), m.rubber);
    grip.name = 'grip';
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.07, 8), m.rubber);
    this.stick.add(stickTube, grip, boot);
    const quadrant = new THREE.Mesh(merge([at(new THREE.BoxGeometry(0.03, 0.035, 0.16), 0, 0, 0), at(new THREE.BoxGeometry(0.036, 0.008, 0.17), 0, 0.02, 0)]), m.bezel);
    quadrant.name = 'quadrant';
    const lever = new THREE.Mesh(at(new THREE.BoxGeometry(0.009, 1, 0.014), 0, 0.5, 0), m.alu);
    lever.name = 'tube';
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 6), m.accent);
    knob.name = 'grip';
    this.throttle.add(quadrant, lever, knob);
    this.controls.add(this.stick, this.throttle);
    this.controls.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    this.controls.userData.tubeMat = m.alu;
  }

  /** Airframe fit: engine limits for the tach arcs (reprints the faces when they change) and
   * whether the wing has flaps (shows the flap toggle). */
  configure(limits: EngineLimits | null, hasFlaps: boolean) {
    this.flapSwitch.visible = hasFlaps;
    if (!limits || (limits.idleRpm === this.limits.idleRpm && limits.redlineRpm === this.limits.redlineRpm)) return;
    this.limits = { ...limits };
    this.drawFaces();
  }

  /** Mounts the pod ahead of the eye (aircraft-local) and lines the stick/throttle up with the avatar's hands. */
  mount(eye: THREE.Vector3, seat?: CockpitSeat) {
    // Knee height, ~0.3 m out, in front of the side-by-side frame's centre post and clamp (which it
    // hides), so the primaries sit ~28° below the eye line, clear of the horizon. Nudged 3.5 cm to the
    // pilot's left, away from that post; scaled to fit the seat bay.
    this.group.position.set(eye.x + 0.035, eye.y - 0.17, eye.z + 0.31);
    this.group.scale.setScalar(POD_SCALE);
    // Matrix4.lookAt(a, b) aims +Z from b toward a, all in aircraft-local space (parent pose ignored).
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, this.group.position, THREE.Object3D.DEFAULT_UP));
    this.group.updateMatrix();
    // Two drop tubes from the pod's lower corners to the keel, plus a cross brace.
    for (const o of [...this.controls.children]) if (o.name === 'mount') { this.controls.remove(o); (o as THREE.Mesh).geometry.dispose(); }
    const tubeMat = this.controls.userData.tubeMat as THREE.Material;
    const tubes: THREE.BufferGeometry[] = [];
    const ends: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(s * 0.12, -H / 2 + 0.01, -0.07).applyMatrix4(this.group.matrix);
      const b = new THREE.Vector3(a.x + s * 0.03, eye.y - 0.85, a.z + 0.12);
      tubes.push(this.tube(a, b, 0.011));
      ends.push(a);
    }
    tubes.push(this.tube(ends[0], ends[1], 0.009));
    const mountMesh = new THREE.Mesh(merge(tubes), tubeMat);
    mountMesh.name = 'mount';
    mountMesh.castShadow = mountMesh.receiveShadow = true;
    this.controls.add(mountMesh);

    this.seat = seat ?? null;
    this.stick.visible = this.throttle.visible = !!seat;
    if (seat) {
      this.stickBase.copy(seat.stick).add(this.tmp.set(0, -0.36 * seat.scale - 0.12, 0.02));
      this.throttleBase.copy(seat.throttle).add(this.tmp.set(0.01, -0.17 * seat.scale, 0));
      this.stick.children[2].position.copy(this.stickBase).add(this.tmp.set(0, 0.03, 0));
      this.throttle.children[0].position.copy(this.throttleBase);
      this.pose(0, 0, 0);
    }
  }

  /** Pilot command for the stick and throttle lever (same values and smoothing the avatar's hands use). */
  setControls(d: CockpitDrive, dtS: number) {
    this.pose(this.n.pitch.update(d.pitch, dtS), this.n.roll.update(d.roll, dtS), this.n.thr.update(d.throttle, dtS));
  }

  update(t: FlightTelemetry, dtS: number) {
    const dt = Math.min(0.1, Math.max(0, dtS));
    const r = readInstruments(t), n = this.n;
    if (!this.primed) {
      this.primed = true;
      n.hdg.snap(r.headingDeg); n.fuel.snap(r.fuel); n.cht.snap(r.cht); n.alt.snap(r.altFt); n.stall.snap(r.stallKmh);
    }
    const set = (o: THREE.Object3D, a: number) => { o.rotation.z = -a; };
    set(this.needles.asi, dialAngle(n.asi.update(r.asiKmh, dt), 0, 140, -145, 145));
    const ft = n.alt.update(r.altFt, dt);
    set(this.needles.altLong, (ft / 1000) * Math.PI * 2);
    set(this.needles.altShort, (ft / 10000) * Math.PI * 2);
    set(this.needles.rpm, dialAngle(n.rpm.update(r.rpm, dt), 0, this.rpmMax, -135, 135));
    set(this.needles.vsi, dialAngle(n.vsi.update(r.vsiFpm, dt), -1000, 1000, -255, 75));
    set(this.needles.fuel, dialAngle(n.fuel.update(r.fuel, dt), 0, 1, -60, 60));
    set(this.needles.cht, dialAngle(n.cht.update(r.cht, dt), 0, 1.25, -60, 60));
    set(this.stallBug, dialAngle(n.stall.update(r.stallKmh, dt), 0, 140, -145, 145));
    const slip = n.slip.update(r.slip, dt), th = -Math.PI / 2 + slip * (SLIP.arc / 2 - 0.07), c = this.ball.userData.c as THREE.Vector3;
    this.ball.position.set(c.x + Math.cos(th) * SLIP.R, c.y + Math.sin(th) * SLIP.R, c.z);
    this.card.rotation.y = n.hdg.update(unwrapDeg(n.hdg.value, r.headingDeg), dt) * Math.PI / 180;
    this.courseBug.visible = this.navDeltaDeg !== null;
    if (this.navDeltaDeg !== null) this.courseBug.position.x = THREE.MathUtils.clamp(this.navDeltaDeg, -60, 60) / 60 * (COMPASS.r * 0.8);
    this.flapLever.rotation.x = THREE.MathUtils.lerp(-0.45, 0.45, n.flap.update(THREE.MathUtils.clamp(this.flaps, 0, 1), dt));
    const glow = (mat: THREE.MeshStandardMaterial, on: boolean, flash = false) => { mat.emissiveIntensity = on && (!flash || (performance.now() % 500) < 300) ? 2.2 : 0; };
    glow(this.lamps.stall, r.stallLamp, true);
    glow(this.lamps.fuel, r.fuelLamp);
    glow(this.lamps.run, r.runLamp);
  }

  private pose(pitch: number, roll: number, throttle: number) {
    const s = this.seat;
    if (!s) return;
    // Same hand offsets as PilotAvatar.update, so the grip stays in the glove.
    const grip = this.tmp.copy(s.stick).add(new THREE.Vector3(-roll * 0.07, -pitch * 0.03, -pitch * 0.07).multiplyScalar(s.scale));
    this.aim(this.stick, this.stickBase, grip);
    const knob = this.tmp.copy(s.throttle).add(new THREE.Vector3(0, 0, (throttle * 0.1 - 0.05) * s.scale));
    this.aim(this.throttle, this.throttleBase, knob);
  }

  /** Points a control's 'tube' from base to tip and parks its 'grip' on the tip. */
  private aim(ctrl: THREE.Group, base: THREE.Vector3, tip: THREE.Vector3) {
    const tube = ctrl.getObjectByName('tube')!, grip = ctrl.getObjectByName('grip')!;
    const dir = new THREE.Vector3().subVectors(tip, base), len = dir.length();
    tube.position.copy(base);
    tube.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir.divideScalar(len || 1));
    tube.scale.set(1, len, 1);
    grip.position.copy(tip);
    grip.quaternion.copy(tube.quaternion);
  }

  private tube(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), 7);
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d.normalize()), new THREE.Vector3(1, 1, 1)));
    return g;
  }

  private needle(r: number, len: number, width: number, mat: THREE.Material, d: { x: number; y: number }, z = 0) {
    const s = new THREE.Shape(), w = width * r, L = len * r, t = 0.24 * r;
    s.moveTo(-w * 0.9, -t); s.lineTo(w * 0.9, -t); s.lineTo(w * 0.55, 0); s.lineTo(w * 0.22, L); s.lineTo(0, L + w * 0.4); s.lineTo(-w * 0.22, L); s.lineTo(-w * 0.55, 0); s.closePath();
    const g = new THREE.Group();
    g.position.set(d.x, d.y, FACE_Z + 0.003 + z);
    g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.0012, bevelEnabled: false }), mat));
    const hub = new THREE.Mesh(at(new THREE.CylinderGeometry(r * 0.11, r * 0.13, 0.004, 8), 0, 0, 0.002, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.4, metalness: 0.6, flatShading: true }));
    g.add(hub);
    return g;
  }

  private texture(w: number, h: number) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  // ---------- Printed faces (Canvas2D, once) ----------

  private drawFaces() {
    const cv = this.atlas.image as HTMLCanvasElement, c = cv.getContext('2d')!;
    c.clearRect(0, 0, cv.width, cv.height);
    const { idleRpm, redlineRpm } = this.limits;
    this.rpmMax = Math.ceil((redlineRpm * 1.12) / 1000) * 1000;
    const cell = (i: number, fn: () => void) => {
      c.save(); c.translate((i % 4) * CELL + CELL / 2, Math.floor(i / 4) * CELL + CELL / 2); c.scale(CELL / 200, CELL / 200);
      const g = c.createRadialGradient(0, -20, 10, 0, 0, 100);
      g.addColorStop(0, '#24282b'); g.addColorStop(1, C.face);
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 100, 0, Math.PI * 2); c.fill();
      fn(); c.restore();
    };
    const P = (a: number, R: number) => [Math.sin(a) * R, -Math.cos(a) * R] as const;
    const tick = (a: number, r0: number, r1: number, w: number, col = C.ivory) => {
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt'; c.beginPath(); c.moveTo(...P(a, r0)); c.lineTo(...P(a, r1)); c.stroke();
    };
    const arc = (a0: number, a1: number, R: number, w: number, col: string) => {
      c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(0, 0, R, a0 - Math.PI / 2, a1 - Math.PI / 2); c.stroke();
    };
    const text = (s: string, x: number, y: number, size: number, col = C.ivory, weight = 700) => {
      c.fillStyle = col; c.font = `${weight} ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, x, y);
    };
    const scale = (min: number, max: number, from: number, to: number, major: number, minor: number, label: (v: number) => string | null, R = 88, size = 22) => {
      for (let v = min; v <= max + 1e-6; v += minor) {
        const a = dialAngle(v, min, max, from, to), isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        tick(a, isMajor ? R - 15 : R - 8, R, isMajor ? 3.6 : 1.8);
        const l = isMajor ? label(v) : null;
        if (l) text(l, ...P(a, R - 30), size);
      }
    };
    const redline = (a: number, R = 88) => tick(a, R - 17, R + 2, 5, C.red);

    cell(DIALS.asi.cell, () => {
      scale(0, 140, -145, 145, 20, 5, (v) => String(v), 88, 25);
      text('KM/H', 0, 30, 17); text('AIRSPEED', 0, 47, 12, '#b9b2a2');
      c.fillStyle = C.accent; c.fillRect(-16, -48, 32, 3); // Aerofox tick under the scale
    });
    cell(DIALS.alt.cell, () => {
      for (let i = 0; i < 50; i++) tick(i / 50 * Math.PI * 2, i % 5 ? 80 : 72, 88, i % 5 ? 1.8 : 3.6);
      for (let i = 0; i < 10; i++) text(String(i), ...P(i / 10 * Math.PI * 2, 56), 26);
      text('ALT', 0, -30, 15, '#b9b2a2'); text('100 FT', 0, 21, 12, '#b9b2a2');
      text('QFE', 0, 33, 11, C.accent);
    });
    cell(DIALS.rpm.cell, () => {
      const A = (v: number) => dialAngle(v, 0, this.rpmMax, -135, 135), rated = Math.min(redlineRpm * 0.94, redlineRpm - 200);
      arc(A(idleRpm), A(rated), 92, 7, C.green); arc(A(rated), A(redlineRpm), 92, 7, C.yellow);
      scale(0, this.rpmMax, -135, 135, 1000, 250, (v) => String(v / 1000), 86, 25);
      redline(A(redlineRpm), 92);
      text('RPM', 0, 30, 15, '#b9b2a2'); text('× 1000', 0, 46, 13, '#b9b2a2');
    });
    cell(DIALS.vsi.cell, () => {
      scale(-1000, 1000, -255, 75, 500, 100, (v) => String(Math.abs(v / 100)), 88, 26);
      text('UP', 34, -30, 16, '#b9b2a2'); text('DN', 34, 30, 16, '#b9b2a2'); text('VSI', -8, 44, 15, '#b9b2a2');
    });
    cell(DIALS.fuel.cell, () => {
      arc(dialAngle(0, 0, 1, -60, 60), dialAngle(0.15, 0, 1, -60, 60), 88, 10, C.red);
      scale(0, 1, -60, 60, 0.5, 0.125, (v) => (v === 0 ? 'E' : v === 1 ? 'F' : '½'), 88, 26);
      text('FUEL', 0, 34, 20, '#b9b2a2');
    });
    cell(DIALS.cht.cell, () => {
      const A = (v: number) => dialAngle(v, 0, 1.25, -60, 60);
      arc(A(0.3), A(0.85), 88, 10, C.green); arc(A(0.85), A(1), 88, 10, C.yellow); arc(A(1), A(1.25), 88, 10, C.red);
      scale(0, 1.25, -60, 60, 0.25, 0.125, () => null);
      text('C', ...P(A(0), 56), 22); text('H', ...P(A(1.25), 56), 22);
      text('ENG TEMP', 0, 34, 17, '#b9b2a2');
    });
    // Legend strips: ivory print on transparent, one per 64 px row.
    c.save();
    c.translate((LABEL_CELL % 4) * CELL, Math.floor(LABEL_CELL / 4) * CELL);
    LABELS.forEach((s, i) => text(s, CELL / 2, i * 64 + 34, i === 0 ? 40 : 46, i === 0 ? C.accent : C.ivory, 700));
    c.restore();
    this.atlas.needsUpdate = true;
  }

  private drawCard() {
    const cv = this.cardTex.image as HTMLCanvasElement, c = cv.getContext('2d')!, w = cv.width, h = cv.height;
    c.fillStyle = '#1b1d1f'; c.fillRect(0, 0, w, h);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = C.ivory; c.strokeStyle = C.ivory;
    // Printed so the pilot reads the current heading under the lubber line (u = 0 faces aft);
    // headings run right-to-left, the classic whiskey-compass reversal.
    for (let hdg = 0; hdg < 360; hdg += 5) {
      const x = ((360 - hdg) % 360) / 360 * w;
      c.lineWidth = hdg % 30 === 0 ? 5 : 2.5;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hdg % 10 === 0 ? 34 : 20); c.stroke();
      if (hdg % 30 === 0) {
        const cardinal = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[hdg];
        c.fillStyle = cardinal === 'N' ? C.accent : C.ivory;
        c.font = `700 ${cardinal ? 70 : 52}px ${FONT}`;
        c.fillText(cardinal ?? String(hdg / 10), x, 84);
        if (x === 0) c.fillText(cardinal ?? String(hdg / 10), w, 84); // wrap seam
      }
    }
    this.cardTex.needsUpdate = true;
  }

  dispose() {
    this.atlas.dispose();
    this.cardTex.dispose();
    for (const root of [this.group, this.controls]) root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mat) => mat.dispose());
    });
  }
}
