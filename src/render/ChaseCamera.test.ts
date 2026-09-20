import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChaseCamera } from './ChaseCamera';

const fwd = new THREE.Quaternion(); // aircraft facing +Z
const input = { speedMs: 22, onGround: false, gForce: 1, stalled: false };

function settle(cam: ChaseCamera, vel: THREE.Vector3, g = 1, frames = 240) {
  const p = new THREE.Vector3(0, 100, 0);
  for (let i = 0; i < frames; i++) {
    p.addScaledVector(vel, 1 / 60);
    cam.update(p, fwd, 1 / 60, { ...input, gForce: g, speedMs: vel.length() });
  }
  return { p, dir: cam.camera.getWorldDirection(new THREE.Vector3()) };
}

describe('ChaseCamera flight-path awareness', () => {
  it('a sideslipping aircraft (velocity 20 deg off the nose) pulls the view toward the flight path', () => {
    const straight = settle(new ChaseCamera(), new THREE.Vector3(0, 0, 22));
    const slip = settle(new ChaseCamera(), new THREE.Vector3(-8, 0, 20)); // moving toward -X (right)
    // The default chase view is offset to one side; the flight-path bias moves the view further toward -X.
    expect(slip.dir.x).toBeLessThan(straight.dir.x - 0.02);
  });

  it('positive G sinks the camera, negative G lifts it', () => {
    const level = settle(new ChaseCamera(), new THREE.Vector3(0, 0, 22), 1);
    const pull = settle(new ChaseCamera(), new THREE.Vector3(0, 0, 22), 3);
    const push = settle(new ChaseCamera(), new THREE.Vector3(0, 0, 22), -0.5);
    // camera height relative to the aircraft
    const rel = (r: { p: THREE.Vector3 }, cam: ChaseCamera) => cam.camera.position.y - r.p.y;
    const camL = new ChaseCamera(); const camP = new ChaseCamera(); const camN = new ChaseCamera();
    const a = rel(settle(camL, new THREE.Vector3(0, 0, 22), 1), camL);
    const b = rel(settle(camP, new THREE.Vector3(0, 0, 22), 3), camP);
    const c = rel(settle(camN, new THREE.Vector3(0, 0, 22), -0.5), camN);
    expect(b).toBeLessThan(a);
    expect(c).toBeGreaterThan(a);
    void level; void pull; void push;
  });
});
