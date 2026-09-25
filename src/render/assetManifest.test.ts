import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../content/regions';
import { FRAMES } from '../content/parts';
import { ACTIVE_REGION_ASSETS, AIRFRAME_VISUALS, assetUrl, FRAME_ASSET_IDS } from './assetManifest';
import { A0_PLACEMENT, A0_WHEEL_RADIUS_M } from './aircraftRig';
import { buildAircraftDefinition } from '../flight/aircraft/quicksilver';
import { defaultBuild } from '../content/assembly';

const publicRoot = path.resolve(process.cwd(), 'public');
const shippedAssetPath = (url: string) => path.join(publicRoot, url.replace(/^\//, ''));

describe('ACTIVE_REGION_ASSETS', () => {
  it('gives every campaign region at least three authored visual anchors', () => {
    for (const region of REGIONS) {
      const placements = ACTIVE_REGION_ASSETS[region.id];
      expect(placements, `missing visual anchors for ${region.id}`).toBeDefined();
      expect(placements?.length ?? 0, `${region.id} needs >=3 anchors for a legible regional identity`).toBeGreaterThanOrEqual(3);
    }
  });

  it('points every anchor at a shipped world asset id', () => {
    for (const [regionId, placements] of Object.entries(ACTIVE_REGION_ASSETS)) {
      for (const { id, uri } of placements) {
        expect(existsSync(shippedAssetPath(uri ?? assetUrl('world', id))), `${regionId} anchor "${id}" has no shipped GLB`).toBe(true);
      }
    }
  });

  it('keeps all placements finite and within the streamed local world', () => {
    for (const [regionId, placements] of Object.entries(ACTIVE_REGION_ASSETS)) {
      for (const placement of placements) {
        expect(placement.id, `asset id in ${regionId}`).toBeTruthy();
        expect(placement.position.every(Number.isFinite), `position for ${placement.id}`).toBe(true);
        expect(Math.max(...placement.position.map(Math.abs)), `position for ${placement.id}`).toBeLessThan(2900);
        expect(placement.scale ?? 1, `scale for ${placement.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('derives stable, relative URLs for every streamed world asset', () => {
    for (const placements of Object.values(ACTIVE_REGION_ASSETS)) {
      for (const placement of placements) {
        expect(placement.uri ?? assetUrl('world', placement.id)).toMatch(/^\/assets\/(models\/world|regions)\/.+\.glb$/);
      }
    }
  });

  it('ships every referenced world model and the active airframe', () => {
    const worldUrls = new Set(Object.values(ACTIVE_REGION_ASSETS).flatMap((placements) => placements.map(({ id, uri }) => uri ?? assetUrl('world', id))));
    for (const url of worldUrls) {
      expect(existsSync(shippedAssetPath(url)), `missing shipped world asset: ${url}`).toBe(true);
    }
    for (const id of Object.values(FRAME_ASSET_IDS)) {
      const url = assetUrl('airframe', id);
      expect(existsSync(shippedAssetPath(url)), `missing shipped airframe: ${url}`).toBe(true);
    }
  });

  it('ships every distance level referenced by AIRFRAME_VISUALS', () => {
    for (const url of Object.values(AIRFRAME_VISUALS).flatMap((v) => v.lods ?? []).map(([uri]) => uri)) {
      const name = url;
      expect(existsSync(shippedAssetPath(url)), `${name} must be available to the runtime`).toBe(true);
      expect(readFileSync(shippedAssetPath(url)).length).toBeGreaterThan(1024);
    }
  });

  it('gives every campaign region a hero scene asset with a rendered collider', () => {
    for (const region of REGIONS) {
      const placements = ACTIVE_REGION_ASSETS[region.id] ?? [];
      const hero = placements.find(({ id }) => id.startsWith('pf_') || id.startsWith('field_hangar_hero') || id === 'field_village_cluster');
      expect(hero, `${region.id} has no hero scene anchor`).toBeDefined();
      expect(hero?.collision, `${region.id} hero anchor "${hero?.id}" needs a collider`).toBeDefined();
    }
  });

  it('gives every defined frame a bound, shipped airframe asset', () => {
    for (const frame of FRAMES) {
      const assetId = FRAME_ASSET_IDS[frame.id];
      expect(assetId, `no FRAME_ASSET_IDS entry for ${frame.id}`).toBeTruthy();
      expect(existsSync(shippedAssetPath(assetUrl('airframe', assetId))), `missing shipped airframe for ${frame.id}`).toBe(true);
    }
  });

  it('ships the CH 701 with animated controls, nose propeller and all three wheel pivots', () => {
    const bytes = readFileSync(shippedAssetPath(assetUrl('airframe', FRAME_ASSET_IDS.frame_zenith_ch701)));
    const jsonLength = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as { nodes: Array<{ name?: string }> };
    const nodes = new Set(doc.nodes.map((node) => node.name));
    for (const name of ['fixed leading-edge slat', 'aileron_L_pivot', 'aileron_R_pivot', 'elevator_pivot', 'rudder_pivot', 'propeller_pivot', 'wheel_nose_pivot', 'wheel_L_pivot', 'wheel_R_pivot']) {
      expect(nodes.has(name), `Zenith CH 701 is missing animated node ${name}`).toBe(true);
    }
  });

  it('binds the starter to the shipped Aerofox Kestrel 2 airframe with working controls and gear', () => {
    expect(FRAME_ASSET_IDS.frame_zero).toBe('aerofox_kestrel2');
    const bytes = readFileSync(shippedAssetPath(assetUrl('airframe', FRAME_ASSET_IDS.frame_zero)));
    const jsonLength = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as { nodes: Array<{ name?: string }> };
    const nodes = new Set(doc.nodes.map((node) => node.name));
    for (const name of ['aileron_L_pivot', 'aileron_R_pivot', 'elevator_pivot', 'rudder_pivot', 'propeller_pivot', 'wheel_nose_pivot', 'wheel_L_pivot', 'wheel_R_pivot', 'nose_steer', 'wheel_L_strut', 'wheel_R_strut']) {
      expect(nodes.has(name), `Kestrel 2 asset is missing animated node ${name}`).toBe(true);
    }
  });

  it('draws the Kestrel 2 tyres exactly on the physics wheel contact points', () => {
    const bytes = readFileSync(shippedAssetPath(assetUrl('airframe', FRAME_ASSET_IDS.frame_zero)));
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))) as { nodes: Array<{ name?: string; translation?: number[] }> };
    const axle = (name: string) => doc.nodes.find((n) => n.name === name)?.translation ?? [NaN, NaN, NaN];
    const gear = buildAircraftDefinition(defaultBuild()).gear.wheels;
    const drawn = { nose: ['nose_steer', A0_WHEEL_RADIUS_M.nose], mainL: ['wheel_L_strut', A0_WHEEL_RADIUS_M.main], mainR: ['wheel_R_strut', A0_WHEEL_RADIUS_M.main] } as const;
    for (const wheel of gear) {
      const [node, radius] = drawn[wheel.id as keyof typeof drawn];
      const [x, y, z] = axle(node).map((v, i) => v * A0_PLACEMENT.scale + A0_PLACEMENT.offset.getComponent(i));
      expect(x, `${wheel.id} x`).toBeCloseTo(wheel.position[0], 1);
      expect(y - radius, `${wheel.id} tyre bottom`).toBeCloseTo(wheel.position[1], 1);
      expect(z, `${wheel.id} z`).toBeCloseTo(wheel.position[2], 1);
    }
  });
});
