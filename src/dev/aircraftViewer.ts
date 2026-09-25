import * as THREE from 'three';
import { defaultBuild } from '../content/assembly';
import { buildAircraftDefinition } from '../flight/aircraft/quicksilver';
import { assetLibrary } from '../render/assetLibrary';
import { FRAME_ASSET_IDS } from '../render/assetManifest';
import { A0_PLACEMENT, AircraftRig } from '../render/aircraftRig';

/**
 * Dev-only starter-aircraft viewer: the A0 GLB placed exactly as FlightScene places it, on a ground
 * plane at the physics rest height, with the physics wheel contact points drawn as red dots.
 *
 *   /scripts/aircraft/viewer.html?az=90&el=10&dist=9&ty=-0.5&tz=0&rudder=0.3&rpm=0
 *
 * az/el in degrees around the body datum, ty/tz look-at offset (m), rudder/elevator/aileron in rad.
 * Never imported by the game.
 */
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9c4dc');
scene.add(new THREE.HemisphereLight('#dfeaf5', '#6b6a4f', 1.4));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(6, 10, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun);

const def = buildAircraftDefinition(defaultBuild());
const lowest = Math.min(...def.gear.wheels.map((w) => w.position[1]));
const groundY = lowest + def.gear.staticCompressionM; // datum sits at rest height above this plane
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 40, 40), new THREE.MeshStandardMaterial({ color: '#7d9a5a', wireframe: params.has('wire') }));
ground.rotation.x = -Math.PI / 2; ground.position.y = groundY; ground.receiveShadow = true;
scene.add(ground);
for (const w of def.gear.wheels) {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 'red', depthTest: false }));
  dot.position.set(...w.position); dot.renderOrder = 9; scene.add(dot);
}

const cam = new THREE.PerspectiveCamera(num('fov', 40), window.innerWidth / window.innerHeight, 0.05, 200);
const az = num('az', 135) * Math.PI / 180, el = num('el', 12) * Math.PI / 180, dist = num('dist', 10);
const target = new THREE.Vector3(num('tx', 0), num('ty', -0.3), num('tz', 0));
cam.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
cam.lookAt(target);

const model = await assetLibrary.load('airframe', FRAME_ASSET_IDS.frame_zero);
model.scale.setScalar(A0_PLACEMENT.scale);
model.position.copy(A0_PLACEMENT.offset);
model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
scene.add(model);
const rig = AircraftRig.attach(model);
const comp = def.gear.staticCompressionM;
for (let i = 0; i < 60; i++) {
  rig.update({ elevator: num('elevator', 0), aileronLeft: num('aileron', 0), aileronRight: -num('aileron', 0), rudder: num('rudder', 0), flaps: 0 } as never,
    num('rpm', 0), 1 / 60, 0, true, 2.3, { compressionM: [comp, comp, comp], steerRad: num('steer', 0) });
}
renderer.render(scene, cam);
(window as unknown as Record<string, unknown>).__ready = true;
