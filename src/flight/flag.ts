// Development switches for the flight model.

/** Debug overlay switch: ?flightDebug=1, localStorage 'pf.flightDebug' = '1', or F3 in flight. */
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
