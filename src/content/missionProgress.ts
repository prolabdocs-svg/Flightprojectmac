import type { MissionDefinition } from '../core/types';
import type { FlightTelemetry } from '../sim/flightController';

export type MissionObjectiveState = 'active' | 'readyToLand' | 'completed' | 'failed';

export interface MissionProgress {
  state: MissionObjectiveState;
  /** Compact, player-facing instructions for the in-flight HUD. */
  primaryLabel: string;
  secondaryLabel?: string;
  targetDistanceM?: number;
  /** Signed bearing to target: negative left, positive right, 0 straight ahead. */
  bearingDeltaDeg?: number;
}

function targetDistanceM(mission: MissionDefinition, telemetry: FlightTelemetry): number | undefined {
  if (!mission.targetPoint) return undefined;
  const [x, , z] = telemetry.position;
  const [targetX, , targetZ] = mission.targetPoint;
  return Math.hypot(x - targetX, z - targetZ);
}

/** The one authoritative objective check used by rewards, campaign unlocks and HUD.
 * A contract can contain both a travel and a precision requirement. */
export function isMissionCompleted(mission: MissionDefinition | null, telemetry: FlightTelemetry): boolean {
  if (!mission) return !telemetry.crashed && telemetry.landed;
  if (telemetry.crashed || !telemetry.landed) return false;
  const distanceToTarget = targetDistanceM(mission, telemetry);
  if (distanceToTarget !== undefined && distanceToTarget > (mission.targetRadiusM ?? 0)) return false;
  if (mission.minDistanceM !== undefined && telemetry.distanceM < mission.minDistanceM) return false;
  return true;
}

/** Readable live mission state. It never changes simulation; it makes the contract's
 * success conditions visible before the player commits to a landing. */
export function getMissionProgress(mission: MissionDefinition | null, telemetry: FlightTelemetry): MissionProgress | null {
  if (!mission) return null;
  if (telemetry.crashed) return { state: 'failed', primaryLabel: 'Contrato fallido' };
  if (isMissionCompleted(mission, telemetry)) return { state: 'completed', primaryLabel: 'Contrato completado' };

  const requirements: string[] = [];
  let targetDistance: number | undefined;
  let bearingDeltaDeg: number | undefined;
  if (mission.minDistanceM !== undefined) {
    const remaining = Math.max(0, mission.minDistanceM - telemetry.distanceM);
    requirements.push(remaining > 0 ? `Recorre ${remaining.toFixed(0)} m más` : 'Distancia cumplida');
  }
  if (mission.targetPoint) {
    targetDistance = targetDistanceM(mission, telemetry);
    const [x, , z] = telemetry.position;
    const [targetX, , targetZ] = mission.targetPoint;
    const worldBearing = (Math.atan2(targetX - x, targetZ - z) * 180 / Math.PI + 360) % 360;
    bearingDeltaDeg = ((worldBearing - telemetry.headingDeg + 540) % 360) - 180;
    const radius = mission.targetRadiusM ?? 0;
    requirements.push(targetDistance !== undefined && targetDistance <= radius
      ? `En zona de aterrizaje (${targetDistance.toFixed(0)} m)`
      : `Destino a ${(targetDistance ?? 0).toFixed(0)} m`);
  }

  const requirementsMet =
    (mission.minDistanceM === undefined || telemetry.distanceM >= mission.minDistanceM) &&
    (targetDistance === undefined || targetDistance <= (mission.targetRadiusM ?? 0));
  return {
    state: requirementsMet ? 'readyToLand' : 'active',
    primaryLabel: requirements[0] ?? 'Completa el vuelo',
    secondaryLabel: requirements.length > 1 ? requirements.slice(1).join(' · ') : undefined,
    targetDistanceM: targetDistance,
    bearingDeltaDeg,
  };
}
