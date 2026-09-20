import { z } from 'zod';

/** Schema for ASSET_MANIFEST.json (PF-ASSET-003). Only third-party-derived or budgeted
 * assets need entries; the validator fails on anything listed but non-compliant. */
const nonEmpty = z.string().min(1).refine((s) => !/^(SET_AT_IMPORT|VERIFY_DOWNLOADED_ARCHIVE|YYYY-MM-DD)$/.test(s), 'placeholder value');

export const AssetEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, 'id must be dotted lowercase, e.g. field.tree.oak_a'),
  category: z.string().min(1),
  source: z.object({
    provider: nonEmpty,
    pack: z.string().optional(),
    url: z.string().url(),
    license: nonEmpty,
    downloadDate: nonEmpty,
    originalFile: nonEmpty,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  runtime: z.object({
    uri: z.string().regex(/^\/assets\/.+\.glb$/, 'runtime must be a /assets/*.glb'),
    preload: z.boolean().default(false),
    streamGroup: z.string().optional(),
    qualityMin: z.enum(['low', 'mid', 'high']).default('low'),
    castShadow: z.boolean().default(true),
    receiveShadow: z.boolean().default(true),
  }),
  geometry: z.object({ lodRequired: z.boolean().default(false), lodTriangles: z.array(z.number().int().nonnegative()).default([]) }).default({ lodRequired: false, lodTriangles: [] }),
  collision: z.object({ type: z.enum(['none', 'box', 'cylinder', 'mesh']), required: z.boolean().default(false) }).default({ type: 'none', required: false }),
  textures: z.object({ maxDimension: z.number().int().positive().default(1024), compression: z.enum(['ktx2', 'none']).default('none') }).default({ maxDimension: 1024, compression: 'none' }),
  tags: z.array(z.string()).default([]),
});

export const AssetManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  assets: z.array(AssetEntrySchema),
});

export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
