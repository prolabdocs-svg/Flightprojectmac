// Feature flag for the flight model (spec section 41): LegacyFlightModel | NewFlightModel.
// Resolution order: ?flightModel=new|legacy in the URL, localStorage 'pf.flightModel', then the
// build default. Never throws (private mode / non-browser).

export type FlightModelKind = 'legacy' | 'new';

export const DEFAULT_FLIGHT_MODEL: FlightModelKind = 'legacy';

const parse = (v: string | null | undefined): FlightModelKind | null => (v === 'new' || v === 'legacy' ? v : null);

export function getFlightModelKind(): FlightModelKind {
  try {
    const fromUrl = parse(new URLSearchParams(globalThis.location?.search ?? '').get('flightModel'));
    if (fromUrl) return fromUrl;
  } catch { /* ignore */ }
  try {
    const stored = parse(globalThis.localStorage?.getItem('pf.flightModel'));
    if (stored) return stored;
  } catch { /* ignore */ }
  return DEFAULT_FLIGHT_MODEL;
}

/** Debug overlay switch: ?flightDebug=1 or localStorage 'pf.flightDebug' = '1'. */
export function isFlightDebugEnabled(): boolean {
  try {
    if (new URLSearchParams(globalThis.location?.search ?? '').get('flightDebug') === '1') return true;
  } catch { /* ignore */ }
  try {
    return globalThis.localStorage?.getItem('pf.flightDebug') === '1';
  } catch {
    return false;
  }
}
