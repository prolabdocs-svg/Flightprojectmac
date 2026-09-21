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
  // jsdom has no ResizeObserver / canvas; the screen must still mount and drive the store.
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { act(() => root?.unmount()); root = null; host?.remove(); });

async function mount() {
  useProfileStore.setState({ profile: createDefaultProfile() });
  useGameStore.setState({ screen: 'map', selectedMapRegionId: 'the_field', mapSelectionId: null, selectedMissionId: null, mapViews: {} });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MapScreen />); });
}
const click = (el: Element | undefined | null) => { if (!el) throw new Error('missing element'); act(() => { (el as HTMLElement).click(); }); };
const byText = (sel: string, re: RegExp) => [...host.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? ''));

describe('MapScreen', () => {
  it('shows the map, region filters, free flight and keeps the bottom navigation', async () => {
    await mount();
    expect(host.querySelector('.map-stage canvas')).toBeTruthy();
    expect(host.querySelectorAll('.region-tab').length).toBeGreaterThan(1);
    expect(byText('nav button', /Taller/)).toBeTruthy();
    expect(host.querySelector('.mission-card')).toBeNull(); // no permanent mission stack
  });
  it('selecting an airfield opens a compact panel with runway data and its contracts; PLAN launches the briefing', async () => {
    await mount();
    click(byText('.wmap-sr button', /Taller de campo/));
    const panel = host.querySelector('.wmap-panel')!;
    expect(panel.textContent).toContain('220 m'); // runway length, labelled separately from distance
    expect(panel.textContent).toContain('Primer salto');
    expect(useGameStore.getState().mapSelectionId).toBe('field_home');
    click(byText('.wmap-plan', /PLANIFICAR/));
    expect(useGameStore.getState().screen).toBe('briefing');
    expect(useGameStore.getState().selectedMissionId).toBe('field_distance_01');
  });
  it('the neighbour strip shows real distance and a comfortable range verdict', async () => {
    await mount();
    click(byText('.wmap-sr button', /Franja Norte/));
    const panel = host.querySelector('.wmap-panel')!;
    expect(panel.textContent).toContain('620 m');
    expect(panel.textContent).toContain('ALCANCE CÓMODO');
  });
  it('an out-of-range reference stays selectable and explains itself (no hard lock)', async () => {
    await mount();
    useGameStore.setState({ mapSelectionId: 'poi_northPass' });
    await act(async () => {});
    const panel = host.querySelector('.wmap-panel')!;
    expect(panel.textContent).toContain('FUERA DE ALCANCE');
    expect(byText('.wmap-workshop', /Taller/)).toBeTruthy();
  });
  it('free flight still enters the flight for the current region', async () => {
    await mount();
    click(host.querySelector('.map-free-flight'));
    expect(useGameStore.getState().screen).toBe('run');
    expect(useGameStore.getState().selectedMissionId).toBeNull();
    expect(useGameStore.getState().selectedFreeFlightRegionId).toBe('the_field');
  });
  it('switching region clears the selection; locked regions cannot be entered', async () => {
    await mount();
    useGameStore.setState({ mapSelectionId: 'field_home' });
    const locked = byText('.region-tab', /Red Canyon/) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    useGameStore.getState().selectMapRegion('scrap_valley');
    expect(useGameStore.getState().mapSelectionId).toBeNull();
  });
});
