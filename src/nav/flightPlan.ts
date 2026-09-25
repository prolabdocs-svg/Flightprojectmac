// The single navigation model shared by missions, map, HUD, cockpit and world cues.
// Coordinates use the campaign streaming frame (x/z metres, y elevation).
import { bearingDeltaDeg, compassBearingDeg, headingToWorldDir } from '../world/compass';

export type GuidanceMode = 'assisted' | 'standard' | 'minimal' | 'off';
export type NavPointKind = 'origin' | 'waypoint' | 'destination' | 'approach' | 'final' | 'threshold';
export type GuidanceState = 'NONE' | 'PREFLIGHT' | 'DEPARTURE' | 'ENROUTE' | 'APPROACH' | 'FINAL' | 'LANDED' | 'GO_AROUND';

export interface NavPoint {
  id: string;
  kind: NavPointKind;
  x: number;
  z: number;
  label: string;
  known: boolean;
  minAltM?: number;
  headingDeg?: number;
  completionRadiusM?: number;
}
export interface RunwayPlan {
  id: string;
  label: string;
  /** Runway center, in the plan coordinate frame. */
  x: number;
  z: number;
  elevationM: number;
  headingDeg: number;
  lengthM: number;
  widthM: number;
  /** Preferred inbound course to the threshold. */
  approachHeadingDeg: number;
  /** End of runway from which landing is made (0 or 1). */
  landingEnd: 0 | 1;
  glideAngleDeg: number;
}
export interface FlightPlan {
  points: NavPoint[];
  active: number;
  origin: NavPoint;
  destination: NavPoint;
  runway?: RunwayPlan;
  state: GuidanceState;
  goAroundCount: number;
}
export interface PlanEndpoint { id: string; x: number; z: number; label: string; known: boolean }
export type ElevationAt = (x: number, z: number) => number;
// Long world routes need a coarse but terrain-aware profile. 250 m still catches
// meaningful ridge crossings while keeping a trans-island plan responsive.
const SAMPLE_STEP_M = 250;
const RIDGE_PROMINENCE_M = 80;
const TERRAIN_CLEARANCE_M = 150;
export const WAYPOINT_CAPTURE_M = 350;
export const APPROACH_M = 1500;
export const UNKNOWN_LABEL = 'Zona sin cartografiar';

function ridgeOnLeg(a: NavPoint, b: NavPoint, elevationAt: ElevationAt) {
  const len = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(2, Math.ceil(len / SAMPLE_STEP_M));
  let best = { t: 0, elev: -Infinity };
  for (let i = 1; i < steps; i++) {
    const t = i / steps, elev = elevationAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (elev > best.elev) best = { t, elev };
  }
  const ends = Math.max(elevationAt(a.x, a.z), elevationAt(b.x, b.z));
  return best.elev - ends >= RIDGE_PROMINENCE_M ? best : null;
}

export function buildFlightPlan(origin: PlanEndpoint, destination: PlanEndpoint, opts: {
  waypoints?: Array<Omit<NavPoint, 'kind'>>;
  elevationAt?: ElevationAt;
  runway?: Omit<RunwayPlan, 'headingDeg' | 'approachHeadingDeg' | 'landingEnd' | 'glideAngleDeg'> & { headingDeg?: number; approachHeadingDeg?: number; landingEnd?: 0 | 1; glideAngleDeg?: number };
} = {}): FlightPlan {
  const start: NavPoint = { ...origin, kind: 'origin' }, end: NavPoint = { ...destination, kind: 'destination' };
  const base: NavPoint[] = [start, ...(opts.waypoints ?? []).map((w) => ({ ...w, kind: 'waypoint' as const })), end];
  const points: NavPoint[] = [base[0]];
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1], b = base[i], ridge = opts.elevationAt ? ridgeOnLeg(a, b, opts.elevationAt) : null;
    if (ridge) points.push({ id: `${b.id}_ridge${i}`, kind: 'waypoint', label: 'Cruce de sierra', known: b.known,
      x: a.x + (b.x - a.x) * ridge.t, z: a.z + (b.z - a.z) * ridge.t, minAltM: Math.round(ridge.elev + TERRAIN_CLEARANCE_M) });
    points.push(b);
  }
  let runway: RunwayPlan | undefined;
  if (opts.runway) {
    const r = opts.runway;
    // Current authored strips run along +/-Z. Alternate ends select the safer/shorter terrain side.
    const landingEnd = r.landingEnd ?? (opts.elevationAt && (opts.elevationAt(r.x, r.z - r.lengthM) > opts.elevationAt(r.x, r.z + r.lengthM)) ? 1 : 0);
    const axisHeading = r.headingDeg ?? 0;
    const approachHeadingDeg = r.approachHeadingDeg ?? ((axisHeading + (landingEnd === 0 ? 0 : 180)) % 360);
    const inbound = headingToWorldDir(approachHeadingDeg);
    const thresholdDistance = r.lengthM / 2;
    const threshold = { x: r.x - inbound.x * thresholdDistance, z: r.z - inbound.z * thresholdDistance };
    runway = { ...r, headingDeg: axisHeading, landingEnd, approachHeadingDeg,
      glideAngleDeg: r.glideAngleDeg ?? (r.lengthM < 180 ? 2.7 : 3.0) };
    const routeWaypoints = points.slice(1, -1);
    points.splice(1, points.length - 1,
      ...routeWaypoints,
      { id: `${r.id}_approach`, kind: 'approach', label: 'Entrada al circuito', known: end.known, x: threshold.x - inbound.x * 3000, z: threshold.z - inbound.z * 3000, headingDeg: approachHeadingDeg, completionRadiusM: 700 },
      { id: `${r.id}_final`, kind: 'final', label: 'Final', known: end.known, x: threshold.x - inbound.x * 1200, z: threshold.z - inbound.z * 1200, headingDeg: approachHeadingDeg, completionRadiusM: 450 },
      { id: `${r.id}_threshold`, kind: 'threshold', label: end.known ? r.label : UNKNOWN_LABEL, known: end.known, x: threshold.x, z: threshold.z, headingDeg: approachHeadingDeg, completionRadiusM: Math.max(70, r.widthM * 4) }, end);
  }
  return { points, active: 1, origin: start, destination: end, runway, state: 'PREFLIGHT', goAroundCount: 0 };
}

export function redirectPlan(here: { x: number; z: number }, destination: PlanEndpoint, elevationAt?: ElevationAt): FlightPlan {
  return buildFlightPlan({ id: 'present_position', label: 'Posición actual', known: true, ...here }, destination, { elevationAt });
}

function pointCaptureRadius(p: NavPoint) { return p.completionRadiusM ?? WAYPOINT_CAPTURE_M; }
/** Advances flown points and skips points behind the aircraft on a dynamic rejoin. */
export function advancePlan(plan: FlightPlan, x: number, z: number, headingDeg?: number): FlightPlan {
  let active = plan.active;
  while (active < plan.points.length - 1) {
    const p = plan.points[active];
    if (Math.hypot(p.x - x, p.z - z) > pointCaptureRadius(p)) break;
    active++;
  }
  // Rejoin directly when the aircraft has moved past a useful fix. This is a route intercept,
  // not a teleport: points behind are marked flown and guidance points at the next remaining leg.
  if (active === plan.active && active < plan.points.length - 1) {
    for (let i = plan.points.length - 2; i > active; i--) {
      const point = plan.points[i], next = plan.points[i + 1];
      const vx = next.x - point.x, vz = next.z - point.z, wx = x - point.x, wz = z - point.z;
      const len2 = vx * vx + vz * vz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2)) : 0;
      const nearestX = point.x + vx * t, nearestZ = point.z + vz * t;
      const d = Math.hypot(x - nearestX, z - nearestZ);
      const passedFix = Math.hypot(x - point.x, z - point.z) > pointCaptureRadius(point) * 1.5;
      if (passedFix && d < 900) { active = i + 1; break; }
    }
  }
  // A completed plan keeps pointing at its destination; there is no outbound leg after it.
  // Guard before reading next because final capture sets active to the last array index.
  if (active === plan.active && headingDeg !== undefined && active < plan.points.length - 1) {
    const target = plan.points[active], next = plan.points[active + 1];
    const inbound = headingToWorldDir(headingDeg), toX = next.x - target.x, toZ = next.z - target.z;
    const along = (x - target.x) * toX + (z - target.z) * toZ;
    const lateral = Math.abs((x - target.x) * toZ - (z - target.z) * toX) / Math.max(1, Math.hypot(toX, toZ));
    const direction = (x - target.x) * inbound.x + (z - target.z) * inbound.z;
    if ((active < plan.points.length - 1 && direction > 0 && along > 0 && lateral < Math.max(1200, Math.hypot(toX, toZ) * 0.75)) ||
        (active === plan.points.length - 2 && target.kind === 'threshold' && Math.hypot(x - target.x, z - target.z) < 500)) active++;
  }
  if (active === plan.active) return plan;
  const lastLeg = active >= plan.points.length - 3;
  return { ...plan, active, state: plan.state === 'PREFLIGHT' ? 'DEPARTURE' : lastLeg ? 'APPROACH' : 'ENROUTE' };
}

export function activateFlightPlan(plan: FlightPlan): FlightPlan {
  return plan.state === 'PREFLIGHT' ? { ...plan, state: 'DEPARTURE' } : plan;
}

export interface Guidance {
  target: NavPoint; targetLabel: string; distanceM: number; remainingM: number; bearingDeg: number; deltaDeg: number;
  targetAltM?: number; climbNeededM?: number; phase: 'enroute' | 'approach' | 'final' | 'landed' | 'go-around';
  state: GuidanceState; legIndex: number; legCount: number;
  runway?: RunwayPlan;
  lateralDeviationM?: number; verticalDeviationM?: number; alignmentErrorDeg?: number; thresholdDistanceM?: number;
  glideAngleDeg?: number; goAroundRecommended?: boolean;
}

export function guidance(plan: FlightPlan, t: { position: readonly [number, number, number]; headingDeg: number; landed?: boolean; airspeedMs?: number; verticalSpeedMs?: number }): Guidance {
  const [x, y, z] = t.position, target = plan.points[plan.active];
  const dx = target.x - x, dz = target.z - z, distanceM = Math.hypot(dx, dz);
  let remainingM = distanceM;
  for (let i = plan.active + 1; i < plan.points.length; i++) remainingM += Math.hypot(plan.points[i].x - plan.points[i - 1].x, plan.points[i].z - plan.points[i - 1].z);
  const bearingDeg = compassBearingDeg(dx, dz), constraint = plan.points.slice(plan.active).find((p) => p.minAltM !== undefined)?.minAltM;
  const runway = plan.runway;
  let lateralDeviationM: number | undefined, verticalDeviationM: number | undefined, alignmentErrorDeg: number | undefined, thresholdDistanceM: number | undefined, goAroundRecommended = false;
  if (runway) {
    const threshold = plan.points.find((p) => p.kind === 'threshold')!;
    const inbound = headingToWorldDir(runway.approachHeadingDeg), rightX = -inbound.z, rightZ = inbound.x;
    const relX = x - threshold.x, relZ = z - threshold.z;
    const along = relX * inbound.x + relZ * inbound.z;
    lateralDeviationM = relX * rightX + relZ * rightZ;
    thresholdDistanceM = Math.hypot(relX, relZ);
    alignmentErrorDeg = bearingDeltaDeg(runway.approachHeadingDeg, t.headingDeg);
    const desiredHeight = Math.max(0, along) * Math.tan(runway.glideAngleDeg * Math.PI / 180);
    verticalDeviationM = (y - runway.elevationM) - desiredHeight;
    const finalActive = target.kind === 'final' || target.kind === 'threshold' || target.kind === 'destination';
    goAroundRecommended = finalActive && ((along < 0 && thresholdDistanceM < 180) || (Math.abs(lateralDeviationM) > Math.max(220, thresholdDistanceM * 0.18) && thresholdDistanceM < 1800) || (verticalDeviationM > Math.max(130, thresholdDistanceM * 0.12) && thresholdDistanceM < 1800) || (Math.abs(alignmentErrorDeg) > 35 && thresholdDistanceM < 1800) || (t.airspeedMs !== undefined && t.airspeedMs > 48 && thresholdDistanceM < 900));
  }
  const final = target.kind === 'final' || target.kind === 'threshold' || (Boolean(runway) && target.kind === 'destination' && distanceM < 450);
  const landed = Boolean(t.landed && (target.kind === 'destination' || target.kind === 'threshold'));
  const nearDestinationApproach = !runway && target.kind === 'destination' && distanceM < APPROACH_M;
  const state: GuidanceState = landed ? 'LANDED' : plan.state === 'GO_AROUND' ? 'GO_AROUND' : final ? 'FINAL' : target.kind === 'approach' || nearDestinationApproach ? 'APPROACH' : plan.state === 'PREFLIGHT' ? 'DEPARTURE' : 'ENROUTE';
  return { target, targetLabel: target.known ? target.label : UNKNOWN_LABEL, distanceM, remainingM, bearingDeg, deltaDeg: bearingDeltaDeg(bearingDeg, t.headingDeg),
    targetAltM: constraint, climbNeededM: constraint === undefined ? undefined : constraint - y,
    phase: landed ? 'landed' : state === 'FINAL' ? 'final' : state === 'APPROACH' ? 'approach' : state === 'GO_AROUND' ? 'go-around' : 'enroute',
    state, legIndex: plan.active, legCount: plan.points.length - 1, runway, lateralDeviationM, verticalDeviationM, alignmentErrorDeg, thresholdDistanceM,
    glideAngleDeg: runway?.glideAngleDeg, goAroundRecommended };
}

export function goAroundPlan(plan: FlightPlan, here: { x: number; z: number }, headingDeg: number): FlightPlan {
  if (!plan.runway) return { ...redirectPlan(here, plan.destination), state: 'GO_AROUND', goAroundCount: plan.goAroundCount + 1 };
  const dir = headingToWorldDir(headingDeg), offset = 1200;
  const climb = { ...plan.points[plan.active], id: `go_around_${plan.goAroundCount + 1}`, kind: 'approach' as const, label: 'GO AROUND · Ascenso', x: here.x + dir.x * offset, z: here.z + dir.z * offset, minAltM: plan.runway.elevationM + 350 };
  return { ...plan, points: [plan.origin, climb, ...plan.points.slice(-4)], active: 1, state: 'GO_AROUND', goAroundCount: plan.goAroundCount + 1 };
}

export function guidanceVisibility(mode: GuidanceMode) {
  return { hudArrow: mode !== 'minimal' && mode !== 'off', hudAltitude: mode !== 'minimal' && mode !== 'off', hudName: mode !== 'off',
    worldMarker: mode === 'assisted', worldCorridor: mode === 'assisted', worldDestination: mode === 'assisted' || mode === 'standard', approachGates: mode === 'assisted', approachReadout: mode !== 'minimal' && mode !== 'off' };
}
