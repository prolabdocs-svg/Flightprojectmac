import { audioService, type UiToneKind } from './audioService';

/** Named UI sound events (spec §34). Screens emit intent, not tones; when final assets land only
 * this table changes. `hover` is intentionally silent until a real hover asset exists. */
export type UiSoundEvent =
  | 'hover' | 'click' | 'mapSelect' | 'missionAccepted' | 'purchase' | 'upgradeInstalled'
  | 'aircraftUnlock' | 'missionSuccess' | 'missionFailure' | 'warning' | 'discovery' | 'back';

const TONE: Record<UiSoundEvent, UiToneKind | null> = {
  hover: null, click: 'tap', mapSelect: 'tap', missionAccepted: 'confirm', purchase: 'confirm',
  upgradeInstalled: 'confirm', aircraftUnlock: 'success', missionSuccess: 'success', missionFailure: 'fail',
  warning: 'fail', discovery: 'success', back: 'back',
};

export function uiSound(event: UiSoundEvent): void {
  const tone = TONE[event];
  if (tone) audioService.playTone(tone);
}
