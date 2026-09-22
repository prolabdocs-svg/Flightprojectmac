// Headless driver: flies the ACTIVE contract of a profile on the real flight model (Rapier + terrain +
// wind) with the scripted BotPilot, feeding every physics sample to advanceMission — exactly the path
// the flight screen will use. Test-only.

import * as THREE from 'three';
import type { PlayerProfile } from '../../core/types';
import type { ResolvedControls } from '../../flight/flightTypes';
import { getAirfield } from '../../world/airfields';
import { createHarness, type Sample } from '../../sim/flightHarness';
import { BotPilot, type BotOptions } from '../bot';
import { advanceMission } from '../operations';
import { tickContractFlight } from '../../state/contractFlight';
import { useProfileStore } from '../../state/profileStore';

const STOP_STATES = ['OBJECTIVE_MET', 'FAILED', 'ABORTED'];

export async function flyActiveContract(profile: PlayerProfile, opts: { maxSeconds?: number; bot?: BotOptions; stopWhen?: (s: Sample) => boolean; control?: (s: Sample | undefined) => Partial<ResolvedControls>; landAt?: string; viaStore?: boolean } = {}) {
  const active = profile.operations.active;
  if (!active || !active.loadout) throw new Error('flyActiveContract needs a PREPARED contract');
  const c = active.contract;
  const origin = getAirfield(c.originId)!;
  const dest = getAirfield(c.destinationId)!;
  const h = await createHarness({
    build: profile.currentBuild,
    spawn: new THREE.Vector3(origin.position[0], c.mission.spawnPoint[1], origin.position[2]),
    headingDeg: c.bearingDeg,
    wind: new THREE.Vector3(...c.weather.windMs),
    load: active.loadout,
  });
  const aim = opts.landAt ? getAirfield(opts.landAt)! : dest;
  const bot = new BotPilot({ x: aim.position[0], z: aim.position[2] }, opts.bot);
  let p = profile;
  let fed = 0;
  const events: string[] = [];
  const feed = () => {
    for (; fed < h.log.length; fed++) {
      if (opts.viaStore) {
        // The exact seam FlightScreen uses: telemetry -> store.advanceMission -> domain events.
        const before = useProfileStore.getState().profile.operations.active?.session.history.length ?? 0;
        tickContractFlight(h.log[fed]);
        p = useProfileStore.getState().profile;
        const hist = p.operations.active?.session.history ?? [];
        for (let i = before; i < hist.length; i++) events.push(hist[i].event);
        continue;
      }
      const r = advanceMission(p, h.log[fed]);
      p = r.profile;
      for (const e of r.events) events.push(e.type);
    }
  };
  while (h.t < (opts.maxSeconds ?? 900)) {
    h.run(0.25, opts.control ?? ((s) => bot.control(s)));
    feed();
    const st = p.operations.active?.session.state;
    if (st && STOP_STATES.includes(st)) break;
    if (opts.stopWhen?.(h.log[h.log.length - 1])) break;
  }
  return { profile: p, log: h.log, final: h.log[h.log.length - 1], events };
}
