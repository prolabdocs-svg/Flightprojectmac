import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AircraftRig, A0_NODES, VISUAL_LIMIT_RAD, damp, hingeQuaternion, pivotAngles, propellerVisual } from './aircraftRig';
import { mixSurfaces, NEUTRAL_COMMAND } from '../flight/controls/flightControls';
import type { ControlDefinition } from '../flight/aircraft/aircraftDefinition';
import { DEG } from '../flight/core/constants';

// Same numbers as the Quicksilver-derived A0 definition (flight/aircraft/quicksilver.ts).
const CONTROLS: ControlDefinition = { elevatorMaxDeg: 22, aileronUpMaxDeg: 18, aileronDownRatio: 0.6, rudderMaxDeg: 22, surfaceRateDegS: 90 };
const surfaces = (cmd: Partial<typeof NEUTRAL_COMMAND>) => mixSurfaces({ ...NEUTRAL_COMMAND, ...cmd }, CONTROLS, { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0 });

describe('control mapping (flight-model mixer -> hinge pivots)', () => {
  it('neutral command gives neutral pivots', () => {
    expect(pivotAngles(surfaces({}))).toEqual({ aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flapL: 0, flapR: 0 });
  });

  it('roll drives the ailerons in opposite directions and reversing roll mirrors them', () => {
    const right = pivotAngles(surfaces({ roll: 1 }));
    const left = pivotAngles(surfaces({ roll: -1 }));
    expect(right.aileronL * right.aileronR).toBeLessThan(0);
    expect(left.aileronL).toBeCloseTo(right.aileronR, 10);
    expect(left.aileronR).toBeCloseTo(right.aileronL, 10);
    // differential travel: the up-going aileron moves further than the down-going one
    expect(Math.abs(right.aileronR)).toBeGreaterThan(Math.abs(right.aileronL));
  });

  it('never exceeds the mechanical limit, whatever the input', () => {
    const big = pivotAngles({ elevator: 2, aileronLeft: -2, aileronRight: 2, rudder: -2, flaps: -2 });
    for (const v of Object.values(big)) expect(Math.abs(v)).toBeLessThanOrEqual(VISUAL_LIMIT_RAD + 1e-12);
    expect(pivotAngles(surfaces({ pitch: 1 })).elevator).toBeCloseTo(22 * DEG, 10);
    expect(pivotAngles(surfaces({ yaw: -1 })).rudder).toBeCloseTo(-22 * DEG, 10);
  });

  // Build the same hinge frames the asset bakes (see tools/a0/split_a0.mjs) and check where the trailing edge goes.
  const trailingEdge = (baseRotZ: number, angle: number) => {
    const pivot = new THREE.Object3D();
    const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), baseRotZ);
    hingeQuaternion(base, angle, new THREE.Vector3(1, 0, 0), pivot.quaternion);
    pivot.updateMatrixWorld(true);
    // trailing edge = 0.1 behind the hinge, in body axes (+Z nose, +Y up, +X left wing)
    return new THREE.Vector3(0, 0, -0.1).applyMatrix4(pivot.matrixWorld);
  };

  it('pitch up (stick back) lifts the elevator trailing edge; pitch down lowers it', () => {
    expect(trailingEdge(0, pivotAngles(surfaces({ pitch: 1 })).elevator).y).toBeGreaterThan(0.03);
    expect(trailingEdge(0, pivotAngles(surfaces({ pitch: -1 })).elevator).y).toBeLessThan(-0.03);
  });

  it('roll right lifts the right aileron trailing edge and drops the left one', () => {
    const a = pivotAngles(surfaces({ roll: 1 }));
    expect(trailingEdge(0, a.aileronR).y).toBeGreaterThan(0.02); // right wing goes down: right aileron up
    expect(trailingEdge(0, a.aileronL).y).toBeLessThan(-0.01);
  });

  it('deploys both XL flaps down together', () => {
    const a = pivotAngles(mixSurfaces({ ...NEUTRAL_COMMAND, flaps: true }, CONTROLS, { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0 }));
    expect(a.flapL).toBeLessThan(0);
    expect(a.flapR).toBeLessThan(0);
  });

  it('nose-right yaw swings the rudder trailing edge toward the right (-X); nose-left toward the left', () => {
    expect(trailingEdge(Math.PI / 2, pivotAngles(surfaces({ yaw: 1 })).rudder).x).toBeLessThan(-0.03);
    expect(trailingEdge(Math.PI / 2, pivotAngles(surfaces({ yaw: -1 })).rudder).x).toBeGreaterThan(0.03);
  });
});

describe('damping', () => {
  it('is frame-rate independent and does not overshoot', () => {
    const run = (dt: number) => { let v = 0; for (let t = 0; t < 0.2 - 1e-9; t += dt) v = damp(v, 1, 28, dt); return v; };
    expect(run(1 / 30)).toBeCloseTo(run(1 / 240), 9);
    expect(run(1 / 60)).toBeLessThanOrEqual(1);
    expect(run(1 / 60)).toBeGreaterThan(0.95); // reaches the command quickly: no slow "hydraulic" feel
  });
});

describe('AircraftRig', () => {
  const fakeAircraft = (skip?: string | string[]) => {
    const root = new THREE.Group();
    for (const name of Object.values(A0_NODES)) {
      if (Array.isArray(skip) ? skip.includes(name) : name === skip) continue;
      const node = new THREE.Object3D(); node.name = name;
      if (name === A0_NODES.propeller) node.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
      root.add(node);
    }
    return root;
  };

  it('fails loudly when a control-surface pivot is missing', () => {
    expect(() => AircraftRig.attach(fakeAircraft(A0_NODES.rudder))).toThrow(/rudder_pivot/);
  });

  it('moves pivots toward the mixer target and returns them exactly to rest', () => {
    const root = fakeAircraft();
    const rig = AircraftRig.attach(root);
    const elevator = root.getObjectByName(A0_NODES.elevator)!;
    for (let i = 0; i < 30; i++) rig.update(surfaces({ pitch: 1 }), 0, 1 / 60);
    expect(elevator.quaternion.x).toBeGreaterThan(0.15);
    for (let i = 0; i < 600; i++) rig.update(surfaces({}), 0, 1 / 60);
    expect(elevator.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  it('attaches and animates the Nightjar pivots on aircraft body axes', () => {
    const root = new THREE.Group();
    const names = ['aileron_L_pivot', 'aileron_R_pivot', 'elevator_pivot', 'rudder_pivot', 'propeller_pivot', 'nose_steer_pivot', 'wheel_nose_pivot', 'wheel_L_pivot', 'wheel_R_pivot', 'engine_mount'];
    for (const name of names) { const node = new THREE.Object3D(); node.name = name; root.add(node); }
    const rig = AircraftRig.attach(root, 'nightjar');
    const rudder = root.getObjectByName('rudder_pivot')!;
    const prop = root.getObjectByName('propeller_pivot')!;
    for (let i = 0; i < 30; i++) rig.update(surfaces({ yaw: 1 }), 5000, 1 / 60);
    const rudderAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(rudder.quaternion);
    expect(rudderAxis.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
    expect(Math.abs(rudder.quaternion.y)).toBeGreaterThan(0.05);
    expect(Math.abs(prop.quaternion.z)).toBeGreaterThan(0.05);
    expect(Math.abs(prop.quaternion.y)).toBeLessThan(1e-9);
  });

  it('attaches to the exported Nightjar GLB node names (all LODs)', async () => {
    for (const path of ['nightjar_rw12.glb', 'nightjar_rw12_lod1.glb', 'nightjar_rw12_lod2.glb']) {
      const bytes = readFileSync(`public/assets/models/airframes/${path}`);
      // GLB may include extension/compression chunks before its JSON or after it. Read
      // chunks by their declared headers instead of assuming a JSON chunk at byte 12.
      let offset = 12;
      let gltf: { nodes: Array<{ name?: string }> } | undefined;
      while (offset + 8 <= bytes.length) {
        const chunkLength = bytes.readUInt32LE(offset);
        const chunkType = bytes.readUInt32LE(offset + 4);
        offset += 8;
        if (chunkType === 0x4e4f534a) gltf = JSON.parse(bytes.toString('utf8', offset, offset + chunkLength)) as typeof gltf;
        offset += chunkLength;
      }
      expect(gltf?.nodes).toBeDefined();
      const root = new THREE.Group();
      for (const name of gltf!.nodes.map((node) => node.name).filter((name): name is string => Boolean(name))) {
        const node = new THREE.Object3D(); node.name = name; root.add(node);
      }
      expect(() => AircraftRig.attach(root, 'nightjar'), path).not.toThrow();
    }
  });

  it('attaches the Zenith high-wing control surfaces and tractor propeller', () => {
    const root = fakeAircraft([A0_NODES.engineMount, A0_NODES.cablesLeft, A0_NODES.cablesRight]);
    const rig = AircraftRig.attach(root, 'zenith');
    const aileron = root.getObjectByName(A0_NODES.aileronL)!;
    const prop = root.getObjectByName(A0_NODES.propeller)!;
    for (let i = 0; i < 30; i++) rig.update(surfaces({ roll: 1 }), 4800, 1 / 60);
    expect(Math.abs(aileron.quaternion.x)).toBeGreaterThan(0.05);
    expect(Math.abs(prop.quaternion.z)).toBeGreaterThan(0.05);
    expect(root.getObjectByName('engine_mount')).toBeTruthy(); // Rig supplies optional vibration anchors.
  });
});

describe('propeller states follow rpm', () => {
  it('stopped: no spin, blades fully drawn, no disc', () => {
    expect(propellerVisual(0)).toEqual({ omegaRadS: 0, bladeOpacity: 1, discOpacity: 0 });
  });
  it('low rpm turns fully drawn blades; high rpm fades them into the disc; spin stays capped', () => {
    const low = propellerVisual(1200), high = propellerVisual(5000);
    expect(low.omegaRadS).toBeGreaterThan(0);
    expect(low.bladeOpacity).toBe(1);
    expect(low.discOpacity).toBe(0);
    expect(high.bladeOpacity).toBeLessThan(0.2);
    expect(high.discOpacity).toBeGreaterThan(0.25);
    expect(propellerVisual(9000).omegaRadS).toBeLessThanOrEqual(55);
  });
});

describe('architecture', () => {
  it('the animation layer consumes resolved surface targets, never raw input devices', () => {
    const src = readFileSync(join(process.cwd(), 'src/render/aircraftRig.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]\.\.\/input/);
    expect(src).not.toMatch(/mode2Store|addEventListener/);
  });
});

describe('pf_aircraft_ultralight.glb (A0)', () => {
  const glb = readFileSync(join(process.cwd(), 'public/assets/models/pf_aircraft_ultralight.glb'));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const nodes = json.nodes as Array<{ name: string; translation?: number[]; mesh?: number }>;
  const node = (n: string) => nodes.find((x) => x.name === n);

  it('ships every hinge pivot with its surface mesh, plus body, propeller and pilot', () => {
    for (const n of ['a0_body', 'aileron_L', 'aileron_R', 'elevator', 'rudder', 'propeller', 'pilot']) expect(node(n)?.mesh, n).toBeDefined();
    for (const n of Object.values(A0_NODES).filter((name) => name !== A0_NODES.flapL && name !== A0_NODES.flapR)) expect(node(n), n).toBeDefined();
  });

  it('puts the left aileron on the +X (left) wing and the right one on -X', () => {
    expect(node(A0_NODES.aileronL)!.translation![0]).toBeGreaterThan(0.5);
    expect(node(A0_NODES.aileronR)!.translation![0]).toBeLessThan(-0.5);
  });

  it('keeps a small shared material family and a single 1024px livery atlas', () => {
    const names = (json.materials as Array<{ name: string }>).map((m) => m.name).sort();
    expect(names).toEqual(['A0_CONTROL_CABLE', 'A0_ENGINE_DARK', 'A0_EXHAUST', 'A0_FABRIC', 'A0_FRAME', 'A0_MECHANICAL', 'A0_PILOT', 'A0_PROP', 'A0_RUBBER', 'A0_SEAT']);
    expect(json.images).toHaveLength(1);
    const binStart = 20 + glb.readUInt32LE(12) + 8;
    const view = json.bufferViews[json.images[0].bufferView];
    const png = glb.subarray(binStart + (view.byteOffset ?? 0), binStart + (view.byteOffset ?? 0) + 24);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024]);
  });
});
