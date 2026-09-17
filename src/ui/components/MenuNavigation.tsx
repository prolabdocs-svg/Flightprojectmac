import type { Screen } from '../../state/gameStore';
import { UiIcon } from './UiIcon';

const items: Array<{ screen: Extract<Screen, 'map' | 'builder' | 'techtree' | 'paint' | 'settings'>; label: string; icon: 'map' | 'wrench' | 'tree' | 'paint' | 'settings' }> = [
  { screen: 'map', label: 'Mapa', icon: 'map' },
  { screen: 'builder', label: 'Taller', icon: 'wrench' },
  { screen: 'techtree', label: 'I+D', icon: 'tree' },
  { screen: 'paint', label: 'Pintura', icon: 'paint' },
  { screen: 'settings', label: 'Ajustes', icon: 'settings' },
];

export function MenuNavigation({ active, goTo }: { active?: Screen; goTo: (screen: Screen) => void }) {
  return <nav className="menu-navigation" aria-label="Navegación principal">
    {items.map((item) => <button key={item.screen} className={active === item.screen ? 'is-active' : ''} onClick={() => goTo(item.screen)} aria-current={active === item.screen ? 'page' : undefined}><UiIcon name={item.icon}/><span>{item.label}</span></button>)}
  </nav>;
}
