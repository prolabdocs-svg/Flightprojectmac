import { describe, expect, it } from 'vitest';
import { advancePlan, buildFlightPlan, guidance, guidanceVisibility, redirectPlan, goAroundPlan, UNKNOWN_LABEL, WAYPOINT_CAPTURE_M } from './flightPlan';
import { routeContext, routeFlightPlan } from '../mission/route';
import { AIRFIELDS } from '../world/airfields';

const A = { id: 'a', label: 'Base', known: true, x: 0, z: 0 };
const B = { id: 'b', label: 'Granja', known: true, x: 0, z: 3000 };
const flat = () => 100;
const at = (x: number, z: number, y = 300, headingDeg = 0) => ({ position: [x, y, z] as const, headingDeg });

describe('FlightPlan', () => {
  it('short route: one leg straight to the destination', () => {
    const plan = buildFlightPlan(A, B, { elevationAt: flat });
    expect(plan.points.map((p) => p.kind)).toEqual(['origin', 'destination']);
    const g = guidance(plan, at(0, 0));
    expect(g.distanceM).toBeCloseTo(3000);
    expect(g.bearingDeg).toBeCloseTo(0);
    expect(g.deltaDeg).toBeCloseTo(0);
    expect(g.phase).toBe('enroute');
    // heading east (90) → target is 90° to the left
    expect(guidance(plan, at(0, 0, 300, 90)).deltaDeg).toBeCloseTo(-90);
  });

  it('multiple waypoints sequence in order and never skip the destination', () => {
    let plan = buildFlightPlan(A, B, { waypoints: [
      { id: 'w1', label: 'Silo', known: true, x: 1000, z: 1000 },
      { id: 'w2', label: 'Puente', known: true, x: 1000, z: 2000 },
    ] });
    expect(plan.points).toHaveLength(4);
    expect(guidance(plan, at(0, 0)).remainingM).toBeCloseTo(Math.hypot(1000, 1000) + 1000 + Math.hypot(1000, 1000));
    plan = advancePlan(plan, 1000, 1000 + WAYPOINT_CAPTURE_M - 1);
    expect(plan.points[plan.active].id).toBe('w2');
    plan = advancePlan(plan, 1000, 2000);
    expect(plan.points[plan.active].id).toBe('b');
    plan = advancePlan(plan, 0, 3000);
    expect(plan.points[plan.active].id).toBe('b');
  });

  it('intermediate mountain adds a crossing waypoint with a minimum altitude', () => {
    const ridge = (_x: number, z: number) => 100 + Math.max(0, 600 - Math.abs(z - 1500));
    const plan = buildFlightPlan(A, B, { elevationAt: ridge });
    const wp = plan.points[1];
    expect(wp.kind).toBe('waypoint');
    expect(wp.z).toBeCloseTo(1500, -2);
    expect(wp.minAltM).toBeGreaterThanOrEqual(700 + 100);
    const g = guidance(plan, at(0, 0, 300));
    expect(g.targetAltM).toBe(wp.minAltM);
    expect(g.climbNeededM).toBeGreaterThan(0);
  });

  it('change of destination and abort re-plan from the present position', () => {
    const plan = buildFlightPlan(A, B);
    const diverted = redirectPlan({ x: 0, z: 1500 }, { id: 'c', label: 'Lago', known: true, x: 2000, z: 1500 });
    expect(diverted.points[0].id).toBe('present_position');
    expect(guidance(diverted, at(0, 1500)).target.id).toBe('c');
    const abort = redirectPlan({ x: 0, z: 1500 }, plan.points[0]);
    const g = guidance(abort, at(0, 1500, 300, 0));
    expect(g.target.id).toBe('a');
    expect(Math.abs(g.deltaDeg)).toBeCloseTo(180);
  });

  it('approach and landing phases near the destination', () => {
    const plan = buildFlightPlan(A, B);
    expect(guidance(plan, at(0, 2000)).phase).toBe('approach');
    expect(guidance(plan, { ...at(0, 2990, 100), landed: true }).phase).toBe('landed');
  });

  it('builds an aligned runway final, reports lateral and vertical deviation and recommends go-around', () => {
    const plan = buildFlightPlan(A, B, { runway: { id: 'b', label: 'Granja', x: 0, z: 3000, elevationM: 100, lengthM: 220, widthM: 24 } });
    expect(plan.points.map((p) => p.kind)).toEqual(['origin', 'approach', 'final', 'threshold', 'destination']);
    expect(plan.runway?.approachHeadingDeg).toBe(0);
    const g = guidance({ ...plan, active: 2 }, { position: [-500, 500, 1700], headingDeg: 60, airspeedMs: 55 });
    expect(g.lateralDeviationM).toBeGreaterThan(0);
    expect(g.verticalDeviationM).toBeGreaterThan(0);
    expect(g.alignmentErrorDeg).toBeCloseTo(-60);
    expect(g.goAroundRecommended).toBe(true);
    const ga = goAroundPlan(plan, { x: 20, z: 1600 }, 0);
    expect(ga.state).toBe('GO_AROUND');
    expect(ga.points[ga.active].minAltM).toBeGreaterThan(100);
  });

  it('rejoins by intercepting a useful later leg after the player passes a waypoint', () => {
    const plan = buildFlightPlan(A, B, { waypoints: [
      { id: 'w1', label: 'Uno', known: true, x: 1000, z: 1000 },
      { id: 'w2', label: 'Dos', known: true, x: 1000, z: 2000 },
    ] });
    const rejoined = advancePlan(plan, 1500, 2500, 0);
    expect(rejoined.active).toBe(3);
    expect(rejoined.points[rejoined.active].id).toBe('b');
  });

  it('undiscovered destination: route is flyable but its name stays hidden', () => {
    const plan = buildFlightPlan(A, { ...B, known: false, label: 'Pista secreta' }, { elevationAt: (_x, z) => 100 + Math.max(0, 600 - Math.abs(z - 1500)) });
    const g = guidance(plan, at(0, 0));
    expect(g.targetLabel).toBe(UNKNOWN_LABEL);
    expect(JSON.stringify(g.targetLabel)).not.toContain('secreta');
  });

  it('minimal mode hides the heading cue and world markers', () => {
    expect(guidanceVisibility('minimal')).toMatchObject({ hudArrow: false, worldMarker: false, worldDestination: false });
    expect(guidanceVisibility('assisted').worldMarker).toBe(true);
    expect(guidanceVisibility('standard')).toMatchObject({ hudArrow: true, worldMarker: false });
    expect(guidanceVisibility('off')).toMatchObject({ hudArrow: false, worldMarker: false, hudName: false });
  });

  it('contract routes are built by the same model', () => {
    const [o, d] = AIRFIELDS.filter((a) => a.regionId === AIRFIELDS[0].regionId);
    const route = routeContext(o.id, d.id);
    const plan = routeFlightPlan(route, []);
    expect(plan.points[0].id).toBe(o.id);
    expect(plan.points.at(-1)!.x).toBe(route.destinationPoint[0]);
    expect(plan.points.at(-1)!.known).toBe(false);
    expect(routeFlightPlan(route, [d.id]).points.at(-1)!.known).toBe(true);
  });
});
