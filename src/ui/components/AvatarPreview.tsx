import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AvatarAppearance } from '../../avatar/appearance';
import { PilotAvatar, PILOT_HEAD_LAYER } from '../../render/pilotAvatar';

/** Standing turntable of the player's avatar; rebuilt whenever the appearance changes. */
export function AvatarPreview({ appearance, pose = 'standing', rotation = 0 }: { appearance: AvatarAppearance; pose?: 'standing' | 'seated'; rotation?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const setAvatar = useRef<((a: AvatarAppearance) => void) | null>(null);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    camera.layers.enable(PILOT_HEAD_LAYER);
    scene.add(new THREE.HemisphereLight('#dfeef5', '#4a3c30', 1.3));
    const key = new THREE.DirectionalLight('#fff0dc', 2.2);
    key.position.set(2, 4, 3); key.castShadow = true; key.shadow.mapSize.set(512, 512);
    key.shadow.camera.layers.enable(PILOT_HEAD_LAYER);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), new THREE.MeshStandardMaterial({ color: '#2a2f31', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const turn = new THREE.Group(); scene.add(turn);
    let avatar: PilotAvatar | null = null;
    setAvatar.current = (a) => {
      avatar?.dispose();
      avatar = new PilotAvatar(a);
      avatar.setPose(pose);
      avatar.root.position.y = pose === 'standing' ? 0.9 : 0.5;
      turn.add(avatar.root);
    };
    const reduce = document.documentElement.dataset.reduceMotion === 'true';
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      // Fit ~2.1 m tall x 1.1 m wide whatever the panel's aspect.
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const dist = Math.max(1.05 / t, 0.55 / (t * camera.aspect));
      camera.position.set(0, 1.15, dist); camera.lookAt(0, 0.92, 0); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let last = performance.now(), raf = 0, drag = 0, dragging = false;
    const onDown = () => { dragging = true; }, onUp = () => { dragging = false; };
    const onMove = (e: PointerEvent) => { if (dragging) drag += e.movementX * 0.01; };
    el.addEventListener('pointerdown', onDown); window.addEventListener('pointerup', onUp); el.addEventListener('pointermove', onMove);
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      turn.rotation.y = rotationRef.current + (reduce ? 0 : now * 0.00008) + drag;
      avatar?.update(null, dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('pointerup', onUp);
      avatar?.dispose(); floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      renderer.dispose(); renderer.domElement.remove();
      setAvatar.current = null;
    };
  }, [pose]);

  useEffect(() => { setAvatar.current?.(appearance); }, [appearance, pose]);

  return <div ref={host} className="avatar-preview" aria-label="Vista previa del piloto" role="img" />;
}
