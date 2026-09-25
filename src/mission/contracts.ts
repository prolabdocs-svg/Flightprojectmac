// Data-driven contract generator (master spec 6-7):
//   route + aircraft + weather + world state (known/visited airfields, reputation) + archetype -> Contract
// A Contract carries a plain MissionDefinition, so the existing flight/HUD/economy layer can play it
// without contract-specific logic. Difficulty is never stored on the contract: it is assessed
// against the aircraft the player has NOW (planning.assessContract), so an upgrade re-rates every offer.

import type { AircraftBuild, HomeBaseState, MissionDefinition } from '../core/types';
import { createSeededRandom, deriveSeed } from '../core/seededRandom';
import { getRegion } from '../content/regions';
import type { MissionAirfieldLinks } from '../content/missions';
import { estimatePerformance } from '../sim/performance';
import { getAirfield } from '../world/airfields';
import { RouteGraph } from '../world/routePlanner';
import { ARCHETYPES, contractRevenueCash, type ArchetypeDef } from './archetypes';
import { assessContract, emptyMassKg, mtowKg, type Assessment, type Blocker } from './planning';
import { routeContext } from './route';
import type { ArchetypeId, Contract, MissionWeather } from './types';

const OFFERS_PER_DESTINATION = 2;

export interface GenerationContext {
  build: AircraftBuild;
  homeBase?: HomeBaseState;
  reputation: number;
  originId: string;
  knownAirfieldIds: string[];
  visitedAirfieldIds: string[];
  onboardFuelL: number;
  /** Advances when the player needs a fresh board. Same seed + same world = same contracts. */
  seed: number;
}

export interface ContractOffer {
  contract: Contract;
  assessment: Assessment;
  available: boolean;
  lockedReason?: Blocker | 'REPUTATION';
}

export function weatherFor(regionId: string, seed: number, routeKey: string, windScale = 1): MissionWeather {
  const region = getRegion(regionId);
  const rng = createSeededRandom(seed, regionId, routeKey, 'weather');
  const scale = rng.range(0.6, 1.4) * windScale;
  const rot = (rng.range(-25, 25) * Math.PI) / 180;
  const [wx, wy, wz] = region.windBaseMs;
  return {
    windMs: [scale * (wx * Math.cos(rot) - wz * Math.sin(rot)), wy, scale * (wx * Math.sin(rot) + wz * Math.cos(rot))],
    gustMs: region.environment.gustStrengthMs * scale,
  };
}

function buildContract(a: ArchetypeDef, ctx: GenerationContext, destinationId: string, slot: number): Contract {
  const route = routeContext(ctx.originId, destinationId);
  const rng = createSeededRandom(ctx.seed, ctx.originId, destinationId, a.id, slot);
  const usefulKg = mtowKg(ctx.build) - emptyMassKg(ctx.build);

  let payloadKg = 0;
  let minPayloadKg = 0;
  let passengers = 0;
  if (a.payload.kind === 'cargo') {
    payloadKg = Math.round(usefulKg * rng.range(...a.payload.usefulLoadFraction));
    minPayloadKg = Math.round(payloadKg * a.payload.minShare);
  } else if (a.payload.kind === 'passengers') {
    passengers = a.payload.count;
    payloadKg = minPayloadKg = a.payload.count * a.payload.kgEach;
  }

  const revenueCash = contractRevenueCash(a, route.distanceM, payloadKg);
  const cruiseMs = estimatePerformance(ctx.build).cruiseSpeedKmh / 3.6;
  const timeLimitS = a.timeLimit ? Math.round(a.timeLimit.slack * (route.distanceM / cruiseMs) + a.timeLimit.graceS) : undefined;
  const id = `c${deriveSeed(ctx.seed, ctx.originId, destinationId, a.id, slot).toString(36)}_${ctx.originId}_${destinationId}_${a.id}`;
  const dest = route.destination;

  const mission: MissionDefinition & MissionAirfieldLinks = {
    id,
    originAirfieldId: route.origin.id,
    destinationAirfieldId: dest.id,
    regionId: route.origin.regionId,
    family: 'precisionLanding',
    name: `${a.title}: ${route.origin.name} → ${dest.name}`,
    description: `${a.title} de ${route.origin.name} a ${dest.name}.`,
    spawnPoint: [route.origin.position[0], route.originElevM + 1.2, route.origin.position[2]],
    spawnHeadingDeg: route.bearingDeg,
    targetPoint: [...route.destinationPoint],
    targetRadiusM: dest.runwayLengthM / 2 + 15,
    minDistanceM: Math.round(route.distanceM * 0.8),
    rewardBaseCash: revenueCash,
    rewardBaseRp: 5 + Math.round((route.distanceM / 1000) * 3),
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 15, rewardRp: 0 },
      { id: 'landing_quality', label: 'Aterrizaje suave', check: 'landingQuality', value: a.landingBonus?.quality ?? 0.7, rewardCash: a.landingBonus?.cash ?? 20, rewardRp: 3 },
    ],
  };

  return {
    id, archetype: a.id, title: mission.name, originId: route.origin.id, destinationId: dest.id, regionId: route.origin.regionId,
    distanceM: route.distanceM, bearingDeg: route.bearingDeg, payloadKg, minPayloadKg, passengers,
    weather: weatherFor(route.origin.regionId, ctx.seed, `${route.origin.id}>${dest.id}`, a.windScale),
    revenueCash, timeLimitS, reputationRequired: a.reputationRequired, mission,
  };
}

export function generateContracts(ctx: GenerationContext): ContractOffer[] {
  const home = getAirfield(ctx.originId);
  const graph = new RouteGraph();
  const destinations = home
    ? graph.neighbors(ctx.originId).map((edge) => getAirfield(edge.toId)).filter((field): field is NonNullable<typeof field> => Boolean(field))
    : [];
  const offers: ContractOffer[] = [];
  for (const dest of destinations) {
    const unvisited = !ctx.visitedAirfieldIds.includes(dest.id);
    const discovered = ctx.knownAirfieldIds.includes(dest.id);
    const eligible: ArchetypeId[] = ARCHETYPES
      .filter((a) => (discovered || a.id === 'exploration') && (!a.onlyUnvisitedDestination || unvisited) && ctx.reputation >= a.reputationRequired)
      .map((a) => a.id);
    const rng = createSeededRandom(ctx.seed, ctx.originId, dest.id, 'archetypes');
    // Exploration is always offered when there is something to discover; the other slot rotates with the seed.
    const picks: ArchetypeId[] = eligible.includes('exploration') ? ['exploration'] : [];
    const pool = eligible.filter((id) => id !== 'exploration');
    while (picks.length < OFFERS_PER_DESTINATION && pool.length > 0) picks.push(pool.splice(rng.intRange(0, pool.length), 1)[0]);
    picks.forEach((archetypeId, slot) => {
      const contract = buildContract(ARCHETYPES.find((a) => a.id === archetypeId)!, ctx, dest.id, slot);
      const assessment = assessContract(ctx.build, routeContext(ctx.originId, dest.id), contract, ctx.onboardFuelL, ctx.homeBase);
      const repOk = ctx.reputation >= contract.reputationRequired;
      offers.push({
        contract, assessment, available: repOk && assessment.available,
        lockedReason: !repOk ? 'REPUTATION' : assessment.plan.blockers[0],
      });
    });
  }
  return offers;
}
