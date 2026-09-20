import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../content/regions';
import { FRAMES } from '../content/parts';
import { ACTIVE_REGION_ASSETS, assetUrl, FRAME_ASSET_IDS } from './assetManifest';

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
});
