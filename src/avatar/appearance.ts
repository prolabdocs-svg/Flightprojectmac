// Player avatar appearance: pure data, persisted in the profile (save.ts). Every slot is a catalogue
// id; adding an option = one entry here + (for a new shape) one builder case in render/pilotAvatar.ts.
// Colours are stored as #rrggbb so the UI can offer swatches now and a free picker later.

export const FACES = [
  { id: 'calm', name: 'Sereno' },
  { id: 'smile', name: 'Sonriente' },
  { id: 'focused', name: 'Concentrado' },
  { id: 'beard', name: 'Barba' },
] as const;
export const SKIN_TONES = ['#f3d2b3', '#e2b08a', '#c68a5f', '#9c6440', '#6e4329', '#4a2c1b'] as const;
export const HAIR_STYLES = [
  { id: 'short', name: 'Corto' },
  { id: 'buzz', name: 'Rapado' },
  { id: 'long', name: 'Largo' },
  { id: 'ponytail', name: 'Coleta' },
  { id: 'curly', name: 'Rizado' },
  { id: 'bald', name: 'Sin pelo' },
] as const;
export const HAIR_COLORS = ['#1f1a17', '#4a3021', '#8a5a33', '#c89a58', '#b8452c', '#9aa0a3'] as const;
export const TOPS = [
  { id: 'tshirt', name: 'Camiseta' },
  { id: 'shirt', name: 'Camisa' },
  { id: 'polo', name: 'Polo' },
  { id: 'jacket', name: 'Chaqueta de vuelo' },
  { id: 'bomber', name: 'Bomber' },
  { id: 'hoodie', name: 'Sudadera' },
  { id: 'overalls', name: 'Mono de trabajo' },
] as const;
export const BOTTOMS = [
  { id: 'jeans', name: 'Vaqueros' },
  { id: 'cargo', name: 'Cargo' },
  { id: 'flight', name: 'Pantalón de vuelo' },
  { id: 'work', name: 'Trabajo' },
  { id: 'shorts', name: 'Cortos' },
] as const;
export const SHOES = [
  { id: 'boots', name: 'Botas' },
  { id: 'work_boots', name: 'Botas de trabajo' },
  { id: 'aviation', name: 'Aviación' },
  { id: 'sneakers', name: 'Zapatillas' },
] as const;
export const ACCESSORIES = [
  { id: 'none', name: 'Ninguno' },
  { id: 'glasses', name: 'Gafas' },
  { id: 'sunglasses', name: 'Gafas de sol' },
  { id: 'scarf', name: 'Bufanda' },
  { id: 'headset', name: 'Cascos de radio' },
] as const;
export const HEADWEAR = [
  { id: 'none', name: 'Nada' },
  { id: 'cap', name: 'Gorra' },
  { id: 'leather_helmet', name: 'Casco de cuero' },
  { id: 'beanie', name: 'Gorro' },
] as const;
/** Shared clothing palette (tops, bottoms, headwear). */
export const CLOTH_COLORS = ['#2f7aa3', '#25506b', '#c4552d', '#e0b34a', '#4f7a3a', '#e9e4d8', '#2b2b2e', '#8c3a4f'] as const;

/** Reusable, data-driven closet entries. Cosmetic unlocks never participate in aircraft performance. */
export const CLOTHING_CATALOG = [
  { id: 'field-flight-jacket', name: 'Chaqueta de campo', category: 'upper', mesh: 'jacket', colorVariants: ['#4f7a3a', '#6b4428', '#2b2b2e', '#e9e4d8'], unlockCondition: 'starter', price: 0, compatibleBodyTypes: ['standard'], tags: ['bush-pilot', 'vintage-aviation'] },
  { id: 'hangar-overalls', name: 'Mono de mecánico', category: 'upper', mesh: 'overalls', colorVariants: ['#25506b', '#4f7a3a', '#c4552d'], unlockCondition: 'starter', price: 0, compatibleBodyTypes: ['standard'], tags: ['mechanic', 'utility-pilot'] },
  { id: 'weekend-hoodie', name: 'Sudadera de viaje', category: 'upper', mesh: 'hoodie', colorVariants: ['#8c3a4f', '#2f7aa3', '#e0b34a'], unlockCondition: 'starter', price: 0, compatibleBodyTypes: ['standard'], tags: ['casual-pilot', 'explorer'] },
] as const;

type Ids<T extends readonly { id: string }[]> = T[number]['id'];
export interface AvatarAppearance {
  face: Ids<typeof FACES>;
  skinTone: string;
  hair: Ids<typeof HAIR_STYLES>;
  hairColor: string;
  top: Ids<typeof TOPS>;
  topColor: string;
  bottoms: Ids<typeof BOTTOMS>;
  bottomsColor: string;
  shoes: Ids<typeof SHOES>;
  accessory: Ids<typeof ACCESSORIES>;
  headwear: Ids<typeof HEADWEAR>;
  headwearColor: string;
}

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  face: 'calm', skinTone: SKIN_TONES[1], hair: 'short', hairColor: HAIR_COLORS[1],
  top: 'jacket', topColor: CLOTH_COLORS[0], bottoms: 'cargo', bottomsColor: CLOTH_COLORS[1],
  shoes: 'boots', accessory: 'headset', headwear: 'none', headwearColor: CLOTH_COLORS[2],
};

const HEX = /^#[0-9a-f]{6}$/i;
const pick = <T extends string>(options: readonly { id: string }[], v: unknown, fallback: T): T =>
  (options.some((o) => o.id === v) ? v : fallback) as T;
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

/** Save data is untrusted: unknown ids / malformed colours fall back per slot, never the whole avatar. */
export function sanitizeAppearance(raw: unknown): AvatarAppearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  return {
    face: pick(FACES, r.face, d.face),
    skinTone: color(r.skinTone, d.skinTone),
    hair: pick(HAIR_STYLES, r.hair, d.hair),
    hairColor: color(r.hairColor, d.hairColor),
    top: pick(TOPS, r.top, d.top),
    topColor: color(r.topColor, d.topColor),
    bottoms: pick(BOTTOMS, r.bottoms, d.bottoms),
    bottomsColor: color(r.bottomsColor, d.bottomsColor),
    shoes: pick(SHOES, r.shoes, d.shoes),
    accessory: pick(ACCESSORIES, r.accessory, d.accessory),
    headwear: pick(HEADWEAR, r.headwear, d.headwear),
    headwearColor: color(r.headwearColor, d.headwearColor),
  };
}
