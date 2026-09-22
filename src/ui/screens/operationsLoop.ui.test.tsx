// @vitest-environment jsdom
// Slice 3: the REAL screens (Hangar, Map, Briefing planner, Results) driving the operations domain. The only
// piece replaced is the WebGL FlightScreen: the flight itself runs on the real physics through the very same
// seam FlightScreen uses (state/contractFlight: tickContractFlight / concludeContractFlight).
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { concludeContractFlight, tickContractFlight } from '../../state/contractFlight';
import { createDefaultProfile, migrateProfile } from '../../save/save';
import { installPart } from '../../content/assembly';
import { acceptContract, getOffers, prepareMission, reconcileAfterLoad, suggestedLoadout } from '../../mission/operations';
import { flyActiveContract } from '../../mission/testing/driver';
import { HangarScreen } from './HangarScreen';
import { MapScreen } from './MapScreen';
import { BriefingScreen } from './BriefingScreen';
import { ResultsScreen } from './ResultsScreen';
import { PauseOverlay } from '../components/PauseOverlay';

vi.setConfig({ testTimeout: 240_000 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { act(() => root?.unmount()); root = null; host?.remove(); });

function Shell() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  return <>{screen === 'hangar' && <HangarScreen />}{screen === 'map' && <MapScreen />}{screen === 'briefing' && <BriefingScreen />}{screen === 'results' && <ResultsScreen />}{paused && <PauseOverlay />}</>;
}

async function mount(profile = createDefaultProfile(), screen: 'hangar' | 'map' | 'briefing' | 'results' = 'hangar', selected: string | null = null) {
  useProfileStore.setState({ profile });
  useGameStore.setState({ screen, selectedMapRegionId: 'the_field', mapSelectionId: null, selectedMissionId: selected, mapViews: {}, lastOutcome: null, paused: false, flightTelemetry: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Shell />); });
}
const profile = () => useProfileStore.getState().profile;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const txt = (id: string) => q(id)?.textContent ?? '';
const click = (el: Element | null | undefined) => { if (!el) throw new Error('missing element'); act(() => { (el as HTMLElement).click(); }); };
const byText = (sel: string, re: RegExp) => [...host.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? ''));
const setRange = (id: string, v: number) => act(() => {
  const el = q(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const settle = async () => { await act(async () => {}); };
const num = (s: string) => Number(s.replace(/[^0-9.\-−]/g, '').replace('−', '-'));

/** Map -> pick a destination -> pick its contract -> PLANIFICAR. Lands on the briefing planner. */
async function planFlightTo(strip: RegExp, archetype?: RegExp) {
  await act(async () => { useGameStore.getState().goTo('map'); });
  click(byText('.wmap-sr button', strip));
  if (archetype) click([...host.querySelectorAll('[data-testid="offer"]')].find((e) => archetype.test(e.textContent ?? '')));
  click(host.querySelector('.wmap-plan'));
  await settle();
  expect(useGameStore.getState().screen).toBe('briefing');
}

/** START in the planner, fly on real physics through the FlightScreen seam, conclude, land on Results. */
async function startAndFly(opts: Parameters<typeof flyActiveContract>[1] = {}) {
  click(q('start'));
  await settle();
  expect(useGameStore.getState().screen).toBe('run');
  expect(profile().operations.active!.session.state).toBe('PREPARED');
  const f = await flyActiveContract(profile(), { ...opts, viaStore: true });
  await act(async () => { concludeContractFlight(f.final); });
  expect(useGameStore.getState().screen).toBe('results');
  return f;
}

describe('the loop, on the real screens', () => {
  it('Hangar -> Map -> planner -> flight -> Results -> Map from the new airfield, with a settlement paid once', async () => {
    await mount();
    expect(txt('hangar-location')).toBe('Taller de campo');
    expect(txt('hangar-fuel')).toContain('8.0');
    click(q('fly'));
    expect(useGameStore.getState().screen).toBe('map');

    await planFlightTo(/Franja Norte/, /Exploración/);
    expect(txt('planner-title')).toBe('Taller de campo → Franja Norte');
    expect(q('start')!.hasAttribute('disabled')).toBe(false);
    const cash0 = profile().cash;
    const f = await startAndFly();
    expect(f.events).toEqual(expect.arrayContaining(['ENGINE_STARTED', 'TAKEOFF_ROLL', 'AIRBORNE', 'DEPARTURE_EXITED', 'DESTINATION_PROXIMITY', 'GROUND_CONTACT', 'AIRCRAFT_STOPPED']));

    // Results: the ledger on screen adds up to the net that hit the wallet.
    expect(txt('results-title')).toBe('Contrato completado');
    const s = profile().operations.lastSettlement!;
    expect(num(txt('net'))).toBe(s.net);
    expect(profile().cash).toBe(cash0 + s.net);
    expect(txt('discovery')).toContain('Franja Norte');
    const shown = (id: string) => (q(id) ? Math.abs(num(txt(id))) : 0);
    const income = ['revenue-base', 'revenue-bonus', 'revenue-discovery'].reduce((t, id) => t + shown(id), 0);
    const outgo = ['cost-fuel', 'cost-damage', 'cost-recovery', 'cost-fees', 'pen-late', 'pen-abandon', 'pen-cargo', 'pen-hard'].reduce((t, id) => t + shown(id), 0);
    expect(income - outgo).toBe(s.net); // Revenue + Bonuses + Discovery - Fuel - Damage - Recovery - Fees - Penalties = Net, as displayed
    expect(num(txt('fuel-left'))).toBeCloseTo(profile().operations.fuelL, 0);

    // Re-mounting Results (back/forward, reload of the screen) shows the same thing and never pays again.
    const cashAfter = profile().cash;
    act(() => root!.unmount());
    root = createRoot(host);
    await act(async () => { root!.render(<Shell />); });
    expect(profile().cash).toBe(cashAfter);
    expect(txt('net')).toBe(`$${s.net}`);

    // Back to the map: the aircraft is at the new strip, the board is regenerated from there.
    click(q('back-to-map'));
    await settle();
    click(byText('.wmap-sr button', /Franja Norte/));
    expect(txt('ops-panel')).toContain('AERONAVE ESTACIONADA');
    expect(profile().operations.locationId).toBe('field_north_strip');
    click(byText('.wmap-sr button', /Taller de campo/));
    expect(host.querySelectorAll('[data-testid="offer"]').length).toBeGreaterThan(0);
  });

  it('a destination that is OUT OF RANGE becomes flyable after buying the 12 L tank, and the whole story completes', async () => {
    const start = { ...createDefaultProfile(), cash: 500 };
    await mount(start, 'map');
    click(byText('.wmap-sr button', /Cresta Lejana/));
    expect(q('reach')!.getAttribute('data-reach')).toBe('OUT_OF_RANGE');
    const usableBefore = num(txt('reach-detail').match(/rindes ([\d.]+) km/)![1]);
    expect(host.querySelector('.wmap-plan')!.hasAttribute('disabled')).toBe(true);
    expect(txt('locked-reason')).toMatch(/Autonomía insuficiente/);

    // Upgrade through the store (the workshop's own actions): the map and the planner follow at once.
    await act(async () => { useProfileStore.getState().buyPart('tank_12', 300); useProfileStore.getState().setBuild(installPart(profile().currentBuild, 'fuelTank', 'tank_12')); });
    expect(q('reach')!.getAttribute('data-reach')).toBe('MARGINAL');
    expect(num(txt('reach-detail').match(/rindes ([\d.]+) km/)![1])).toBeGreaterThan(usableBefore * 1.4);
    expect(host.querySelector('.wmap-plan')!.hasAttribute('disabled')).toBe(false);

    click(byText('[data-testid="offer"]', /Exploración/));
    click(host.querySelector('.wmap-plan'));
    await settle();
    expect(useGameStore.getState().screen).toBe('briefing');
    expect((q('fuel-slider') as HTMLInputElement).max).toBe('12'); // the 12 L tank is in the planner immediately
    // Too little fuel: blocked, explained, and START is disabled.
    setRange('fuel-slider', 4);
    expect(q('start')!.hasAttribute('disabled')).toBe(true);
    expect(txt('blockers')).toMatch(/Autonomía insuficiente/);
    expect(txt('start')).toBe('CONFIGURACIÓN NO APTA');
    const usableAt4 = num(txt('range-usable'));
    setRange('fuel-slider', 11);
    expect(num(txt('range-usable'))).toBeGreaterThan(usableAt4); // every slider move recomputes planMission
    expect(q('blockers')).toBeNull();
    expect(txt('fuel-value')).toContain('11.0 L');
    const cashBefore = profile().cash;
    const f = await startAndFly();
    expect(f.final.crashed).toBe(false);
    expect(txt('results-title')).toBe('Contrato completado');
    expect(txt('discovery')).toContain('Cresta Lejana');
    expect(txt('discovery')).toContain('Hondonada del Risco'); // what lies beyond is revealed
    expect(profile().cash).toBe(cashBefore + profile().operations.lastSettlement!.net);
    expect(profile().operations.locationId).toBe('field_far_ridge');
    expect(profile().operations.fuelL).toBeLessThan(11);
    expect(profile().operations.fuelL).toBeGreaterThan(0);

    // Persisted fuel carries into the next flight and the hangar shows the same litres.
    click(q('back-to-map'));
    await act(async () => { useGameStore.getState().goTo('hangar'); });
    expect(txt('hangar-location')).toBe('Cresta Lejana');
    expect(num(txt('hangar-fuel').split('/')[0])).toBeCloseTo(profile().operations.fuelL, 1);
    await act(async () => { useGameStore.getState().goTo('map'); });
    click(byText('.wmap-sr button', /Hondonada/));
    expect(host.querySelectorAll('[data-testid="offer"]').length).toBeGreaterThan(0); // new opportunities from the new place
  });
});

describe('briefing planner limits', () => {
  it('payload beyond the aircraft limit is blocked with the reason on screen', async () => {
    const p0 = createDefaultProfile();
    const offer = getOffers(p0).find((o) => o.contract.archetype === 'cargo' && o.contract.destinationId === 'field_north_strip') ?? getOffers(p0).find((o) => o.contract.archetype === 'cargo')!;
    const heavy = { ...offer.contract, payloadKg: 220, minPayloadKg: 200 };
    const withActive = acceptContractFixture(p0, heavy);
    await mount(withActive, 'briefing', heavy.id);
    expect(txt('blockers')).toMatch(/Sobrepeso/);
    expect(q('start')!.hasAttribute('disabled')).toBe(true);
    expect(profile().operations.active!.session.state).toBe('ACCEPTED');
  });

  it('START goes through accept -> prepare on the state machine; pressing it again does not duplicate events', async () => {
    await mount();
    await planFlightTo(/Franja Norte/);
    click(q('start'));
    await settle();
    const hist = profile().operations.active!.session.history.map((h) => h.event);
    expect(hist).toEqual(['ACCEPT', 'PREPARE']);
    // Back to the briefing and START again (back/forward navigation): same contract, no duplicated transitions.
    await act(async () => { useGameStore.getState().goTo('briefing'); });
    click(q('start'));
    await settle();
    expect(profile().operations.active!.session.history.map((h) => h.event)).toEqual(['ACCEPT', 'PREPARE']);
    expect(profile().operations.settledContractIds).toEqual([]);
  });

  it('with another contract already accepted the planner refuses to start and offers to cancel it', async () => {
    const p0 = createDefaultProfile();
    const [a, b] = getOffers(p0).filter((o) => o.available);
    const acc = acceptContract(p0, a.contract.id);
    if (!acc.ok) throw new Error(acc.error);
    await mount(acc.profile, 'briefing', b.contract.id);
    expect(q('other-active')).not.toBeNull();
    expect(q('start')!.hasAttribute('disabled')).toBe(true);
    click(byText('[data-testid="other-active"] button', /Cancelar/));
    await settle();
    expect(profile().operations.active).toBeNull();
    expect(q('start')!.hasAttribute('disabled')).toBe(false);
  });
});

function acceptContractFixture(p: ReturnType<typeof createDefaultProfile>, contract: ReturnType<typeof getOffers>[number]['contract']) {
  // A persisted ACCEPTED contract (the shape a save file holds): used where the generator never offers an impossible load.
  return { ...p, operations: { ...p.operations, active: { contract, session: { contractId: contract.id, state: 'ACCEPTED' as const, phase: null, airborne: false, taxiObserved: false, fuelExhausted: false, atDestination: false, history: [{ event: 'ACCEPT' as const, from: { state: 'AVAILABLE' as const, phase: null }, to: { state: 'ACCEPTED' as const, phase: null } }], lastEvent: 'ACCEPT' as const }, loadout: null, startFuelFraction: null, finalTelemetry: null } } };
}

describe('reload, settlement and failure branches through the screens', () => {
  it('reload while PREPARED: the dynamic contract resolves from the save and the planner keeps the loadout', async () => {
    const p0 = createDefaultProfile();
    const offer = getOffers(p0).find((o) => o.available && o.contract.destinationId === 'field_east_meadow')!;
    const acc = acceptContract(p0, offer.contract.id);
    if (!acc.ok) throw new Error(acc.error);
    const prep = prepareMission(acc.profile, suggestedLoadout(acc.profile)!);
    if (!prep.ok) throw new Error(prep.error);
    // What a reload does: JSON -> migrate -> reconcile (PREPARED resumes untouched).
    const reloaded = reconcileAfterLoad(migrateProfile(JSON.parse(JSON.stringify(prep.profile))));
    expect(reloaded).toEqual(prep.profile);
    await mount(reloaded, 'briefing', offer.contract.id);
    expect(txt('planner-title')).toContain('Prado del Este');
    expect(txt('fuel-value')).toContain(`${prep.plan.loadout.fuelL.toFixed(1)} L`);
    expect(q('start')!.hasAttribute('disabled')).toBe(false);
  });

  it('reload in the middle of a flight abandons it (with the penalty), recovers nothing twice, and the hangar says so', async () => {
    const p0 = createDefaultProfile();
    const offer = getOffers(p0).find((o) => o.available && o.contract.destinationId === 'field_east_meadow' && o.contract.archetype === 'cargo')!;
    const acc = acceptContract(p0, offer.contract.id);
    if (!acc.ok) throw new Error(acc.error);
    const prep = prepareMission(acc.profile, suggestedLoadout(acc.profile)!);
    if (!prep.ok) throw new Error(prep.error);
    await mount(prep.profile, 'hangar');
    await act(async () => { useProfileStore.setState({ profile: prep.profile }); });
    // Engine started + airborne through the seam, then the app is closed.
    const f = await flyActiveContract(prep.profile, { viaStore: true, stopWhen: (s) => s.altitudeM > 10 });
    expect(f.profile.operations.active!.session.state).toBe('ACTIVE');
    const reloaded = reconcileAfterLoad(migrateProfile(JSON.parse(JSON.stringify(f.profile))));
    const s = reloaded.operations.lastSettlement!;
    expect(s.outcome).toBe('ABORTED');
    expect(s.penalties.abandonment).toBeGreaterThan(0);
    expect(reloaded.operations.settledContractIds).toEqual([offer.contract.id]);
    expect(reconcileAfterLoad(reloaded)).toEqual(reloaded); // idempotent: reloading again changes nothing
    await act(async () => { useProfileStore.setState({ profile: reloaded }); });
    expect(txt('hangar-active')).toMatch(/abortado/i);
    click(byText('[data-testid="hangar-active"] button', /Recuperar/));
    await settle();
    expect(profile().operations.active).toBeNull();
  });

  it('settling twice (double tap, re-entering Results) pays once', async () => {
    await mount();
    await planFlightTo(/Franja Norte/);
    await startAndFly();
    const cash = profile().cash;
    const ledger = profile().operations.settledContractIds.length;
    expect(useProfileStore.getState().settleMission(null).ok).toBe(false);
    await act(async () => { concludeContractFlight(null); });
    await act(async () => { concludeContractFlight(null); });
    expect(profile().cash).toBe(cash);
    expect(profile().operations.settledContractIds.length).toBe(ledger);
  });

  it('a crash shows a failed contract, charges recovery, and the recover button frees the slot without soft-lock', async () => {
    await mount();
    await planFlightTo(/Prado del Este/, /Carga/);
    click(q('start'));
    await settle();
    const f = await flyActiveContract(profile(), {
      viaStore: true,
      control: (s) => (s && s.altitudeM > 12 ? { throttle: 1, pitch: Math.max(-1, Math.min(1, (-40 - s.pitchDeg) * 0.2)), assistMode: 'acro' } : { throttle: 1, pitch: s && s.airspeedMs > s.stallSpeedMs * 1.05 ? 0.6 : 0 }),
    });
    await act(async () => { concludeContractFlight(f.final); });
    expect(txt('results-title')).toBe('Contrato fallido');
    expect(q('cost-recovery')).not.toBeNull();
    expect(num(txt('net'))).toBeLessThan(0);
    expect(profile().cash).toBeGreaterThanOrEqual(0);
    expect(q('needs-recovery')).not.toBeNull();
    click(q('recover'));
    await settle();
    expect(profile().operations.active).toBeNull();
    expect(profile().operations.locationId).toBe('field_home');
    expect(useGameStore.getState().screen).toBe('map');
    click(byText('.wmap-sr button', /Franja Norte/));
    expect(host.querySelectorAll('[data-testid="offer"]').length).toBeGreaterThan(0);
  });

  it('landing at a different strip is a diversion: aborted, recoverable, and the aircraft is where it stopped', async () => {
    await mount();
    await planFlightTo(/Prado del Este/, /Carga/);
    const f = await startAndFly({ landAt: 'field_north_strip' });
    expect(f.events).toContain('AIRCRAFT_STOPPED');
    expect(txt('results-title')).toBe('Vuelo desviado');
    expect(profile().operations.active!.session.divertedTo).toBe('field_north_strip');
    click(q('recover'));
    await settle();
    expect(profile().operations.locationId).toBe('field_north_strip');
  });

  it('abandoning from the pause menu: free before the engine starts, penalised and shown in Results once it did', async () => {
    await mount();
    await planFlightTo(/Franja Norte/);
    click(q('start'));
    await settle();
    // Paused on the ground before starting the engine.
    await act(async () => { useGameStore.setState({ screen: 'map', paused: true }); });
    const cash = profile().cash;
    click(byText('.pause-panel button', /Abandonar/));
    await settle();
    expect(profile().cash).toBe(cash);
    expect(profile().operations.active).toBeNull();
    expect(useGameStore.getState().screen).toBe('map');

    // Now start the engine (telemetry through the seam), then abandon.
    await planFlightTo(/Franja Norte/);
    click(q('start'));
    await settle();
    const f = await flyActiveContract(profile(), { viaStore: true, stopWhen: (s) => s.altitudeM > 8 });
    useGameStore.setState({ flightTelemetry: f.final, screen: 'run', paused: true });
    await settle();
    click(byText('.pause-panel button', /Abandonar/));
    await settle();
    expect(useGameStore.getState().screen).toBe('results');
    expect(txt('results-title')).toBe('Contrato abortado');
    expect(q('pen-abandon')).not.toBeNull();
    expect(tickContractFlight(f.final)).toBe(true); // domain already ended: nothing further to feed
  });
});
