import * as THREE from 'three';
import { getRegion } from '../content/regions';
import { Atmosphere } from '../render/atmosphere';
import { CloudLayer } from '../render/clouds';
import { PostProcessing } from '../render/postProcessing';
import { WorldEnvironment } from '../render/WorldEnvironment';
import { FieldWorld } from '../render/fieldWorld';
import { getRegionComposition } from '../world/regionCompositions';
import { buildRegionLayout } from '../world/regionPlacement';

/**
 * Dev-only region viewer (see scripts/regions/viewer.html and scripts/regions/shots.md).
 * Reproducible world-art screenshots without booting the game's menu/mission flow: it builds
 * the SAME `WorldEnvironment` + composed `FieldWorld` the flight scene builds, then parks a
 * free camera at a URL-specified position.
 *
 *   /scripts/regions/viewer.html?region=red_canyon&x=60&y=150&z=120&yaw=0&pitch=-20
 *
 * Never imported by the game; it is not part of the production bundle.
 */

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const regionId = params.get('region') ?? 'the_field';
const region = getRegion(regionId);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
const atmosphere = new Atmosphere(scene, renderer, region);
const env = new WorldEnvironment(region);
scene.add(env.root);
const clouds = new CloudLayer(atmosphere.look, { baseY: env.terrainQuery.getElevation(0, 0) + 1050, seed: region.id });
scene.add(clouds.mesh);

const composition = getRegionComposition(region.id);
let world: FieldWorld | undefined;
const stats = { lots: 0, props: 0, trees: 0, rocks: 0, patches: 0, roads: 0, lodChunks: 0 };
if (composition && env.fieldGrid) {
  const layout = buildRegionLayout(composition, { grid: env.fieldGrid, terrain: env.terrainQuery });
  world = new FieldWorld(env.fieldGrid, layout, { seed: composition.seed, terrain: composition.terrain });
  scene.add(world.root);
  Object.assign(stats, {
    lots: layout.lots.length, props: layout.props.length, trees: layout.trees.length,
    rocks: layout.rocks.length, patches: layout.patches.length, roads: layout.roads.length,
  });
  void world.hydrate().then(() => { (window as unknown as Record<string, unknown>).__hydrated = true; });
}

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 30000);
const x = num('x', 0), z = num('z', 0);
const agl = num('agl', NaN);
const y = Number.isNaN(agl) ? num('y', 200) : env.terrainQuery.getElevation(x, z) + agl;
camera.position.set(x, y, z);
const yaw = (num('yaw', 0) * Math.PI) / 180, pitch = (num('pitch', -20) * Math.PI) / 180;
camera.rotation.order = 'YXZ';
camera.rotation.set(pitch, yaw, 0);

world?.update(camera.position);
atmosphere.update(camera.position);
clouds.update(0, new THREE.Vector3(), camera.position);
const post = new PostProcessing(renderer, scene, camera);
// Count every pass of the frame (autoReset would leave only the final post-processing quad).
renderer.info.autoReset = false;
renderer.info.reset();
post.render();
stats.lodChunks = world?.lodCount ?? 0;

const info = {
  region: region.id, camera: { x, y: Math.round(y), z, yaw: num('yaw', 0), pitch: num('pitch', -20) },
  groundY: Math.round(env.terrainQuery.getElevation(x, z)),
  layout: stats,
  render: renderer.info.render,
  memory: renderer.info.memory,
};
(window as unknown as Record<string, unknown>).__regionViewer = info;
(window as unknown as Record<string, unknown>).__ready = true;
document.getElementById('hud')!.textContent =
  `${region.id} @ ${x},${Math.round(y)},${z} (ground ${info.groundY}m) · tris ${renderer.info.render.triangles} · calls ${renderer.info.render.calls} · lots ${stats.lots} props ${stats.props} trees ${stats.trees} rocks ${stats.rocks}`;

// Keep re-rendering so async GLB hydration (buildings, hero trees, rocks) shows up.
let frames = 0;
const tick = () => {
  if (frames++ > 600) return;
  world?.update(camera.position);
  renderer.info.reset();
  post.render();
  document.getElementById('hud')!.textContent = document.getElementById('hud')!.textContent!.replace(/tris \d+ · calls \d+/, `tris ${renderer.info.render.triangles} · calls ${renderer.info.render.calls}`);
  (window as unknown as Record<string, unknown>).__regionViewer = { ...info, render: { ...renderer.info.render } };
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
