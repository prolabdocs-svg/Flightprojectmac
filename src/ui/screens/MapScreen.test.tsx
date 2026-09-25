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
  }, 60_000);
  it('opens the worldwide chart and follows an airfield into its local campaign chart', async () => {
    await mount();
    click(byText('.region-tab', /^Mundo$/));
    expect(useGameStore.getState().selectedMapRegionId).toBe('master');
    expect(host.querySelector('.map-title h2')?.textContent).toBe('Mapa mundial');
    click(byText('.wmap-sr button', /Franja Norte/));
    expect(host.querySelector('.wmap-panel')?.textContent).toContain('Abrir carta de');
    click(byText('.wmap-panel .primary-btn', /Abrir carta de/));
    expect(useGameStore.getState().selectedMapRegionId).toBe('the_field');
    expect(useGameStore.getState().mapSelectionId).toBe('field_north_strip');
  }, 600_000); // builds the master map on first use
  it('selecting the parked-at airfield shows the aircraft state from the save (fuel in litres), not contracts', async () => {
    await mount();
    click(byText('.wmap-sr button', /Taller de campo/));
    const panel = host.querySelector('.wmap-panel')!;
    expect(panel.textContent).toContain('220 m'); // runway length, labelled separately from distance
    expect(panel.textContent).toContain('AERONAVE ESTACIONADA');
    expect(host.querySelector('[data-testid="fuel-onboard"]')!.textContent).toContain('8.0 / 8 L');
    expect(useGameStore.getState().mapSelectionId).toBe('field_home');
  });
  it('a neighbour strip lists GENERATED contracts (domain offers); PLANIFICAR opens the briefing for that contract', async () => {
    await mount();
    click(byText('.wmap-sr button', /Franja Norte/));
    const offers = [...host.querySelectorAll('[data-testid="offer"]')];
    expect(offers.length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain('Primer salto'); // static campaign contracts are gone from this region
    click(byText('.wmap-plan', /PLANIFICAR/));
    expect(useGameStore.getState().screen).toBe('briefing');
    expect(useGameStore.getState().selectedMissionId).toMatch(/_field_home_field_north_strip_/);
    expect(useProfileStore.getState().profile.operations.active).toBeNull(); // nothing is accepted until the briefing STARTs
  });
  it('the neighbour strip shows real distance and the planner verdict with its limiting factor', async () => {
    await mount();
    click(byText('.wmap-sr button', /Franja Norte/));
    const panel = host.querySelector('.wmap-panel')!;
    expect(panel.textContent).toContain('620 m');
    expect(host.querySelector('[data-testid="reach"]')!.getAttribute('data-reach')).toBe('REACHABLE');
    expect(host.querySelector('[data-testid="reach-detail"]')!.textContent).toMatch(/Limita: /);
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
  it('switching region clears the selection; unexplored regions are uncharted territory, not padlocks', async () => {
    await mount();
    useGameStore.setState({ mapSelectionId: 'field_home' });
    expect(byText('.region-tab', /Red Canyon/)).toBeUndefined(); // name not revealed before flying there
    const unknown = byText('.region-tab', /Sin cartografiar/) as HTMLButtonElement;
    expect(unknown.disabled).toBe(true);
    expect(host.textContent).not.toContain('🔒');
    useGameStore.getState().selectMapRegion('scrap_valley');
    expect(useGameStore.getState().mapSelectionId).toBeNull();
  });
});
