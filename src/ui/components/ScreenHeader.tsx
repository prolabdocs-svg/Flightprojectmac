import type { ReactNode } from 'react';
import type { Screen } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { UiIcon } from './UiIcon';

export function ResourceBar() {
  const { cash, researchPoints, salvage } = useProfileStore((s) => s.profile);
  return (
    <div className="resource-cluster" aria-label="Recursos">
      <div className="resource-pill"><UiIcon name="cash" size={15} />${cash.toFixed(0)}</div>
      <div className="resource-pill"><UiIcon name="research" size={15} />{researchPoints} RP</div>
      <div className="resource-pill"><UiIcon name="salvage" size={15} />{salvage}</div>
    </div>
  );
}

/** Shared screen header: back to the hangar, title with kicker, and the resource bar. */
export function ScreenHeader({ title, kicker, goTo, back = 'hangar', backLabel = 'Hangar', right }: {
  title: string; kicker?: string; goTo: (s: Screen) => void; back?: Screen; backLabel?: string; right?: ReactNode;
}) {
  return (
    <header className="screen-header">
      <button className="back-btn" onClick={() => goTo(back)} aria-label={`Volver: ${backLabel}`}><UiIcon name="back" size={18} />{backLabel}</button>
      <div className="screen-title">{kicker && <span className="kicker">{kicker}</span>}<h2>{title}</h2></div>
      {right ?? <ResourceBar />}
    </header>
  );
}
