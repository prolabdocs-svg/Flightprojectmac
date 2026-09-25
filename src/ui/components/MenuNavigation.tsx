import type { Screen } from '../../state/gameStore';
import { UiIcon, type IconName } from './UiIcon';

// Target IA (docs/ui/PROJECT_FLIGHT_UI_UX_MASTER_SPEC.md §5): the hangar is the hub; everything else is one hop away.
const items: Array<{ screen: Screen; label: string; icon: IconName }> = [
  { screen: 'hangar', label: 'Hangar', icon: 'home' },
  { screen: 'map', label: 'Mapa', icon: 'map' },
  { screen: 'builder', label: 'Taller', icon: 'wrench' },
  { screen: 'aircraft', label: 'Aeronaves', icon: 'flight' },
  { screen: 'career', label: 'Bitácora', icon: 'logbook' },
  { screen: 'settings', label: 'Ajustes', icon: 'settings' },
];

export function MenuNavigation({ active, goTo }: { active?: Screen; goTo: (screen: Screen) => void }) {
  return <nav className="menu-navigation" aria-label="Navegación principal">
    {items.map((item) => <button key={item.screen} className={active === item.screen ? 'is-active' : ''} onClick={() => goTo(item.screen)} aria-current={active === item.screen ? 'page' : undefined}><UiIcon name={item.icon}/><span>{item.label}</span></button>)}
  </nav>;
}
