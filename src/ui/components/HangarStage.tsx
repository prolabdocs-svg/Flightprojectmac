import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { assetLibrary } from '../../render/assetLibrary';
import { FRAME_ASSET_IDS, UNPAINTED_MATERIAL } from '../../render/assetManifest';

export type StageFocus = 'overview' | 'engine' | 'wings' | 'gear' | 'cockpit' | 'tail' | 'hero';

/** Named A0 nodes used as focus anchors; other airframes fall back to bounding-box fractions. */
const FOCUS_NODES: Partial<Record<StageFocus, string>> = { engine: 'propeller_pivot', cockpit: 'pilot', wings: 'wingtip_L', tail: 'rudder_pivot' };
/** Box-relative (0..1 on x,y,z) fallback anchors and camera distance as a fraction of the model radius. */
const FOCUS_FALLBACK: Record<StageFocus, { at: [number, number, number]; dist: number }> = {
  overview: { at: [0.5, 0.4, 0.5], dist: 3.8 },
  hero: { at: [0.5, 0.4, 0.5], dist: 3.4 },
  engine: { at: [0.5, 0.6, 0.15], dist: 1.45 },
  wings: { at: [0.12, 0.8, 0.5], dist: 2.25 },
  gear: { at: [0.5, 0.12, 0.45], dist: 1.35 },
  cockpit: { at: [0.5, 0.6, 0.45], dist: 1.3 },
  tail: { at: [0.5, 0.6, 0.92], dist: 1.5 },
};
/** Preferred viewing direction per focus (azimuth rad, elevation rad). */
const FOCUS_VIEW: Record<StageFocus, [number, number]> = {
  overview: [0.9, 0.28], hero: [0.72, 0.34], engine: [0.5, 0.18], wings: [1.2, 0.55], gear: [0.9, 0.05], cockpit: [1.45, 0.42], tail: [2.4, 0.3],
};

interface Props {
  frameId: string;
  paint?: { fabricColor: string; tubeColor: string };
  focus?: StageFocus;
  /** Slow turntable when idle. Disabled automatically under reduced motion. */
  autoRotate?: boolean;
  /** Screen-space shift of the look-at target (fraction of width) so HUD panels never cover the aircraft. */
  offsetX?: number;
  dim?: boolean;
  /** Locked aircraft: flat ink silhouette — enough shape to want it, no detail until it's earned. */
  silhouette?: boolean;
}

/**
 * The hangar floor with the player's actual aircraft (the same GLB the flight scene flies).
 * One WebGL context, mounted by whichever hub screen is visible; everything it creates is
 * disposed on unmount. Drag to orbit; focus changes glide the camera to a component.
 */
export function HangarStage({ frameId, paint, focus = 'overview', autoRotate = true, offsetX = 0, dim = false, silhouette = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setFocus: (f: StageFocus) => void; setOffset: (x: number) => void; setAuto: (a: boolean) => void } | null>(null);
  const fabric = paint?.fabricColor;
  const tube = paint?.tubeColor;

  useEffect(() => {
    const el = host.current!;
    const reduce = document.documentElement.dataset.reduceMotion === 'true' || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      el.dataset.stage = 'unavailable';
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Fog matches the CSS back wall's floor band so the concrete fades out instead of ending at a disc edge.
    const fog = new THREE.Fog('#1a1e20', 4, 9);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);

    // Lighting: warm hangar-lamp key from above, cool daylight from the open door, soft bounce.
    scene.add(new THREE.HemisphereLight('#cfe3ee', '#3a3128', 1.1));
    const key = new THREE.DirectionalLight('#ffe2bf', 2.4);
    key.position.set(4, 9, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#9fd3ff', 1.3);
    rim.position.set(-6, 4, -5);
    scene.add(rim);

    // Floor: sealed concrete with a painted parking box; everything is unit-scaled to the aircraft below.
    const floorMat = new THREE.MeshStandardMaterial({ color: '#3d3b37', roughness: 0.92 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const lineMat = new THREE.MeshBasicMaterial({ color: '#e8b52a' });
    const lines = new THREE.Group();
    for (const [w, d, x, z] of [[1.6, 0.012, 0, 0.62], [1.6, 0.012, 0, -0.62], [0.012, 1.24, 0.8, 0], [0.012, 1.24, -0.8, 0]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.002, z);
      lines.add(m);
    }
    scene.add(lines);

    const aircraftRoot = new THREE.Group();
    scene.add(aircraftRoot);

    let radius = 1;
    let box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const anchors = new Map<StageFocus, THREE.Vector3>();
    let focusKey: StageFocus = focus;
    let offset = offsetX;
    let auto = autoRotate && !reduce;

    // Orbit state (spherical around the current focus anchor).
    const view = { az: FOCUS_VIEW[focus][0], el: FOCUS_VIEW[focus][1], dist: 4 };
    const goal = { az: view.az, el: view.el, dist: 4, target: new THREE.Vector3() };
    const target = new THREE.Vector3();

    const anchorFor = (f: StageFocus) => anchors.get(f) ?? box.getCenter(new THREE.Vector3());
    const aim = (f: StageFocus, snap = false) => {
      focusKey = f;
      goal.target.copy(anchorFor(f));
      const isRans = frameId === 'frame_nightjar'; // wide-span two-seater: pull the camera in, three-quarter view
      goal.dist = radius * FOCUS_FALLBACK[f].dist * (isRans ? 0.56 : 1);
      goal.az = isRans && (f === 'overview' || f === 'hero' || f === 'engine') ? 2.35 : FOCUS_VIEW[f][0];
      goal.el = FOCUS_VIEW[f][1];
      if (snap || reduce) { target.copy(goal.target); view.az = goal.az; view.el = goal.el; view.dist = goal.dist; }
    };

    let disposed = false;
    // Only what the stage creates is disposed: aircraft geometry/materials are shared with the cached GLB template.
    const owned: Array<{ dispose(): void }> = [];
    const assetId = FRAME_ASSET_IDS[frameId] ?? FRAME_ASSET_IDS.frame_zero;
    void assetLibrary.load('airframe', assetId).then((model) => {
      if (disposed) return;
      const isA0 = assetId === FRAME_ASSET_IDS.frame_zero;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        // Mirrors FlightScene#hydrateAircraft: the A0 ships a finished livery; other frames take the name-based tint.
        const color = isA0 ? undefined
          : /wing|aileron|stabilizer|^elevator$|^rudder$/.test(mesh.name) ? fabric
            : /longeron|strut|brace|cross/.test(mesh.name) ? tube : undefined;
        if (color && !Array.isArray(mesh.material) && !UNPAINTED_MATERIAL.test(mesh.material.name)) {
          const tinted = (mesh.material as THREE.MeshStandardMaterial).clone();
          tinted.color?.set(color);
          mesh.material = tinted;
          owned.push(tinted);
        }
      });
      if (silhouette) {
        const ink = new THREE.MeshBasicMaterial({ color: '#0e1011' });
        owned.push(ink);
        model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = ink; });
      }
      // Some roster GLBs arrive Z-up (standing on their tail). Height is always an aircraft's smallest dimension.
      let size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (size.y > size.z) {
        model.rotation.x = -Math.PI / 2;
        model.updateMatrixWorld(true);
        size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      }
      // Fit both the length and the wingspan into the turntable's safe frame.
      // Many ultralights are substantially wider than they are long, so using
      // only the longest side here pushes both wing tips outside the default view.
      const s = Math.min(2 / Math.max(size.x, size.y, size.z), 1.3 / Math.max(size.x, 1e-6));
      model.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(model);
      const c2 = b2.getCenter(new THREE.Vector3());
      model.position.set(-c2.x, -b2.min.y, -c2.z);
      aircraftRoot.add(model);
      aircraftRoot.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(aircraftRoot);
      radius = box.getBoundingSphere(new THREE.Sphere()).radius;
      floor.scale.setScalar(radius * 8);
      fog.near = radius * 2.2;
      fog.far = radius * 6;
      lines.scale.setScalar(radius * 1.35);
      key.shadow.camera.left = key.shadow.camera.bottom = -radius * 1.5;
      key.shadow.camera.right = key.shadow.camera.top = radius * 1.5;
      key.shadow.camera.updateProjectionMatrix();
      const size2 = box.getSize(new THREE.Vector3());
      for (const f of Object.keys(FOCUS_FALLBACK) as StageFocus[]) {
        const node = FOCUS_NODES[f] ? model.getObjectByName(FOCUS_NODES[f]!) : undefined;
        const at = FOCUS_FALLBACK[f].at;
        anchors.set(f, node ? node.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(box.min.x + size2.x * at[0], box.min.y + size2.y * at[1], box.min.z + size2.z * at[2]));
      }
      aim(focusKey, true);
      el.dataset.stage = 'ready';
    }).catch(() => { el.dataset.stage = 'error'; });

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Drag to orbit (pointer events cover mouse, touch and pen).
    let drag: { x: number; y: number } | null = null;
    let idleAt = 0;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      goal.az -= (e.clientX - drag.x) * 0.008;
      goal.el = THREE.MathUtils.clamp(goal.el + (e.clientY - drag.y) * 0.005, 0.02, 1.2);
      drag = { x: e.clientX, y: e.clientY };
      idleAt = performance.now();
    };
    const up = () => { drag = null; idleAt = performance.now(); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); goal.dist = THREE.MathUtils.clamp(goal.dist * (1 + Math.sign(e.deltaY) * 0.08), radius * 0.6, radius * 3.5); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });

    const clock = new THREE.Clock();
    const pos = new THREE.Vector3();
    const right = new THREE.Vector3();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (auto && !drag && focusKey === 'overview' && performance.now() - idleAt > 2500) goal.az += dt * 0.12;
      const k = 1 - Math.exp(-dt * 4.5); // ~220 ms settle
      view.az += (goal.az - view.az) * k;
      view.el += (goal.el - view.el) * k;
      view.dist += (goal.dist - view.dist) * k;
      target.lerp(goal.target, k);
      pos.set(Math.sin(view.az) * Math.cos(view.el), Math.sin(view.el), Math.cos(view.az) * Math.cos(view.el)).multiplyScalar(view.dist).add(target);
      camera.position.copy(pos);
      camera.lookAt(target);
      // Shift the framing sideways so side panels never sit on top of the aircraft.
      if (offset) {
        right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-offset * view.dist * 0.9);
        camera.position.add(right);
        camera.lookAt(right.add(target));
      }
      renderer.render(scene, camera);
    };
    frame();

    api.current = { setFocus: (f) => aim(f), setOffset: (x) => { offset = x; }, setAuto: (a) => { auto = a && !reduce; } };

    return () => {
      disposed = true;
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      scene.remove(aircraftRoot);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      });
      for (const o of owned) o.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // The scene is rebuilt only when the airframe or its livery changes; focus/offset go through `api`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId, fabric, tube, silhouette]);

  useEffect(() => { api.current?.setFocus(focus); }, [focus]);
  useEffect(() => { api.current?.setOffset(offsetX); }, [offsetX]);
  useEffect(() => { api.current?.setAuto(autoRotate); }, [autoRotate]);

  return <div ref={host} className={`hangar-stage${dim ? ' is-dim' : ''}`} data-focus={focus} aria-hidden="true" />;
}
