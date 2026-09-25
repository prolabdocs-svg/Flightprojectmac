// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { createDefaultProfile } from '../../save/save';
import { MapScreen } from './MapScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null, host: HTMLElement;
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { act(() => root?.unmount()); root = null; host?.remove(); });

async function mount() {
  useProfileStore.setState({ profile: createDefaultProfile() });
  useGameStore.setState({ screen: 'map', selectedMapRegionId: 'master', mapSelectionId: null, selectedMissionId: null, mapViews: {} });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MapScreen />); });
}
const click = (el: Element | undefined | null) => { if (!el) throw new Error('missing element'); act(() => { (el as HTMLElement).click(); }); };
const byText = (sel: string, re: RegExp) => [...host.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? ''));

describe('MapScreen continuous world chart', () => {
  it('shows the world chart, free flight and bottom navigation without region-level tabs', async () => {
    await mount();
    expect(host.querySelector('.map-stage canvas')).toBeTruthy();
    expect(host.querySelector('.map-title h2')?.textContent).toBe('Mapa mundial');
    expect(host.querySelectorAll('.region-tab')).toHaveLength(0);
    expect(byText('nav button', /Taller/)).toBeTruthy();
    expect(host.querySelector('.mission-card')).toBeNull();
  }, 60_000);

  it('selects a discovered airport and starts a route from the parked home base', async () => {
    await mount();
    click(byText('.wmap-sr button', /Franja Norte/));
    const panel = host.querySelector('.wmap-panel')!;
    expect(panel.textContent).toContain('620 m');
    expect(host.querySelectorAll('.wmap-panel')).toHaveLength(1);
    click(byText('.wmap-panel .primary-btn', /Trazar ruta a Franja Norte/));
    expect(useGameStore.getState().screen).toBe('run');
    expect(useGameStore.getState().selectedMissionId).toBeNull();
    expect(useGameStore.getState().selectedFreeFlightRegionId).toBe('the_field');
    expect(useGameStore.getState().selectedWorldDestinationId).toBe('field_north_strip');
    expect(useGameStore.getState().selectedWorldStartId).toBeNull();
  }, 60_000);

  it('keeps the parked aerodrome as the free-flight spawn and suppresses a route to itself', async () => {
    await mount();
    click(byText('.wmap-sr button', /Taller de campo/));
    expect(host.querySelector('.wmap-panel')?.textContent).toContain('220 m');
    expect(byText('.wmap-panel .primary-btn', /Trazar ruta/)).toBeUndefined();
    click(host.querySelector('.map-free-flight'));
    expect(useGameStore.getState().screen).toBe('run');
    expect(useGameStore.getState().selectedWorldDestinationId).toBeNull();
    expect(useGameStore.getState().selectedWorldStartId).toBe('field_home');
  }, 60_000);
});
