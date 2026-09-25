import { create } from 'zustand';
import type { AircraftBuild, FlightResult, PlayerProfile } from '../core/types';
import { createDefaultProfile, saveRepository, whenSaveRepositoryReady } from '../save/save';
import { canUnlockTech } from '../content/techtree';
import { MAX_HOME_BASE_LEVEL } from '../content/homeBase';
import { getFrame } from '../content/parts';
import { buildForFrame, resolveAircraft } from '../content/assembly';
import { useGameStore } from './gameStore';
import * as ops from '../mission/operations';
import type { Loadout } from '../mission/types';
import type { FlightTelemetry } from '../flight/flightTypes';
import { sanitizeAppearance } from '../avatar/appearance';
import { applyExploration, type ExplorationEvent, type ExploreInput } from '../world/exploration';

interface ProfileState {
  profile: PlayerProfile;
  load: () => Promise<void>;
  persist: () => void;
  setBuild: (build: AircraftBuild) => void;
  buyPart: (partId: string, priceCash: number) => boolean;
  buyFrame: (frameId: string, priceCash: number) => boolean;
  selectFrame: (frameId: string) => boolean;
  unlockTech: (nodeId: string, costRp: number) => boolean;
  buyPaint: (paintId: string, priceCash: number) => boolean;
  selectPaint: (paintId: string) => void;
  setAvatar: (patch: Partial<PlayerProfile['avatar']>) => void;
  upgradeHomeBase: (facility: 'runway' | 'hangar', costCash: number) => boolean;
  applyFlightResult: (result: FlightResult) => void;
  parkAtAirfield: (airfieldId: string, fuelL: number) => void;
  refuel: () => boolean;
  updateSettings: (patch: Partial<PlayerProfile['settings']>) => void;
  resetProfile: () => void;
  // Contract loop (src/mission). Thin wrappers: the domain functions are pure, this only commits + persists.
  acceptContract: (contractId: string) => ReturnType<typeof ops.acceptContract>;
  prepareMission: (loadout: Loadout) => ReturnType<typeof ops.prepareMission>;
  advanceMission: (telemetry: FlightTelemetry) => void;
  settleMission: (telemetry?: FlightTelemetry | null) => ReturnType<typeof ops.settleActive>;
  abandonMission: (telemetry?: FlightTelemetry) => ReturnType<typeof ops.abandonMission>;
  recoverAircraft: () => ReturnType<typeof ops.recoverAircraft>;
  // Maintenance & repair (Slice 4A).
  startRepair: (componentIds?: import('../mission/aircraftCondition').ComponentId[]) => ReturnType<typeof ops.startRepair>;
  collectRepair: () => ReturnType<typeof ops.collectRepair>;
  /** Fog of Discovery: one observation of the aircraft's real world position. */
  recordExploration: (p: ExploreInput) => ExplorationEvent[];
}

let lastExplorationPersist = 0;

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: createDefaultProfile(),

  load: async () => {
    await whenSaveRepositoryReady();
    const loaded = saveRepository.load();
    const profile = loaded ?? createDefaultProfile();
    // A save can be loaded mid-contract: resolve it through the state machine before any screen sees it.
    const reconciled = ops.reconcileAfterLoad(profile);
    set({ profile: reconciled });
    if (reconciled !== profile) get().persist();
  },

  persist: () => {
    saveRepository.save(get().profile);
  },

  setBuild: (build) => {
    set((s) => ({ profile: { ...s.profile, currentBuild: build } }));
    get().persist();
  },

  buyPart: (partId, priceCash) => {
    const { profile } = get();
    if (profile.ownedParts.includes(partId)) return true;
    if (profile.cash < priceCash) return false;
    set({ profile: ops.recordUpgrade({ ...profile, cash: profile.cash - priceCash, ownedParts: [...profile.ownedParts, partId] }, partId) });
    get().persist();
    return true;
  },

  buyFrame: (frameId, priceCash) => {
    const { profile } = get();
    if (profile.ownedFrameIds.includes(frameId)) return true;
    if (profile.cash < priceCash) return false;
    set({ profile: { ...profile, cash: profile.cash - priceCash, ownedFrameIds: [...profile.ownedFrameIds, frameId] } });
    get().persist();
    return true;
  },

  // Atomic frame switch: only an owned, known frame may become currentBuild, and the
  // resulting loadout is repaired to that frame's hardpoints (assembly.ts#buildForFrame)
  // so an unowned/unknown id or an incompatible carried-over part can never land in state.
  selectFrame: (frameId) => {
    const { profile } = get();
    if (!profile.ownedFrameIds.includes(frameId)) return false;
    const frame = getFrame(frameId);
    if (!frame) return false;
    set({ profile: { ...profile, currentBuild: buildForFrame(frame, profile.currentBuild) } });
    get().persist();
    return true;
  },

  unlockTech: (nodeId, costRp) => {
    const { profile } = get();
    if (!canUnlockTech(profile.unlockedTech, nodeId)) return false;
    if (profile.researchPoints < costRp) return false;
    set({
      profile: {
        ...profile,
        researchPoints: profile.researchPoints - costRp,
        unlockedTech: [...profile.unlockedTech, nodeId],
      },
    });
    get().persist();
    return true;
  },

  buyPaint: (paintId, priceCash) => {
    const { profile } = get();
    if (profile.ownedPaintIds.includes(paintId)) return true;
    if (profile.cash < priceCash) return false;
    set({
      profile: {
        ...profile,
        cash: profile.cash - priceCash,
        ownedPaintIds: [...profile.ownedPaintIds, paintId],
      },
    });
    get().persist();
    return true;
  },

  selectPaint: (paintId) => {
    set((s) => ({ profile: { ...s.profile, selectedPaintId: paintId } }));
    get().persist();
  },

  setAvatar: (patch) => {
    set((s) => ({ profile: { ...s.profile, avatar: sanitizeAppearance({ ...s.profile.avatar, ...patch }) } }));
    get().persist();
  },

  upgradeHomeBase: (facility, costCash) => {
    const { profile } = get();
    if (profile.cash < costCash) return false;
    const levelKey = facility === 'runway' ? 'runwayLevel' : 'hangarLevel';
    if (profile.homeBase[levelKey] >= MAX_HOME_BASE_LEVEL) return false;
    set({
      profile: {
        ...profile,
        cash: profile.cash - costCash,
        homeBase: { ...profile.homeBase, [levelKey]: profile.homeBase[levelKey] + 1 },
      },
    });
    get().persist();
    return true;
  },

  applyFlightResult: (result) => {
    const { profile } = get();
    // netCash (reward minus fuel/repair operating costs, economy.ts#computeFlightResult)
    // is what should actually land in the player's wallet. Older results that predate
    // operating costs won't have it set, so fall back to the old reward-only behavior.
    const cashDelta = result.netCash ?? result.rewardCash;
    const next: PlayerProfile = {
      ...profile,
      cash: profile.cash + cashDelta,
      researchPoints: profile.researchPoints + result.rewardRp,
      reputation: profile.reputation + (result.reputationGain ?? (result.crashed ? 0.5 : 1.5)),
    };
    // Failed contracts still pay a small flight reward, but only a successful
    // objective may advance campaign unlock gates.
    // Undefined is retained as success for saves/results produced before the
    // missionCompleted field existed; new results always carry an explicit value.
    if (result.missionId && result.missionCompleted !== false) {
      const prior = profile.completedMissions[result.missionId];
      const score = result.distanceM;
      next.completedMissions = {
        ...profile.completedMissions,
        [result.missionId]: {
          bestScore: Math.max(prior?.bestScore ?? 0, score),
          attempts: (prior?.attempts ?? 0) + 1,
        },
      };
    }
    set({ profile: next });
    get().persist();
  },

  parkAtAirfield: (airfieldId, fuelL) => {
    const { profile } = get();
    const ops = profile.operations;
    const next = {
      ...profile,
      operations: {
        ...ops,
        locationId: airfieldId,
        fuelL: Math.max(0, Math.min(resolveAircraft(profile.currentBuild).fuelCapacityL, fuelL)),
        knownAirfieldIds: ops.knownAirfieldIds.includes(airfieldId) ? ops.knownAirfieldIds : [...ops.knownAirfieldIds, airfieldId],
        visitedAirfieldIds: ops.visitedAirfieldIds.includes(airfieldId) ? ops.visitedAirfieldIds : [...ops.visitedAirfieldIds, airfieldId],
      },
    };
    set({ profile: next });
    get().persist();
  },

  refuel: () => {
    const { profile } = get();
    const capacity = resolveAircraft(profile.currentBuild).fuelCapacityL;
    const liters = Math.max(0, capacity - profile.operations.fuelL);
    const unitCost = 4;
    const cost = Math.ceil(liters * unitCost);
    if (!liters || profile.cash < cost) return false;
    set({ profile: { ...profile, cash: profile.cash - cost, operations: { ...profile.operations, fuelL: capacity } } });
    get().persist();
    return true;
  },

  updateSettings: (patch) => {
    set((s) => ({ profile: { ...s.profile, settings: { ...s.profile.settings, ...patch } } }));
    get().persist();
  },

  // Reset Progress, not factory reset: user settings survive. The fresh profile is written
  // straight back (a put queued after clear's delete) so the store and IndexedDB never disagree
  // and a reload can't resurrect the old record; runtime caches built from the old profile go too.
  resetProfile: () => {
    const settings = get().profile.settings;
    saveRepository.clear();
    lastExplorationPersist = 0;
    set({ profile: { ...createDefaultProfile(), settings } });
    get().persist();
    useGameStore.getState().resetRuntime();
  },

  acceptContract: (contractId) => commit(ops.acceptContract(get().profile, contractId)),
  prepareMission: (loadout) => commit(ops.prepareMission(get().profile, loadout)),
  advanceMission: (telemetry) => {
    const before = get().profile;
    const r = ops.advanceMission(before, telemetry);
    // advanceMission returns the same profile reference when neither a mission event nor a
    // checkpoint interval fired, so this also throttles the periodic-checkpoint persist to the
    // same cadence (spec item 11) without a separate timer here.
    if (r.profile === before) return;
    set({ profile: r.profile });
    get().persist();
  },
  settleMission: (telemetry) => commit(ops.settleActive(get().profile, telemetry)),
  abandonMission: (telemetry) => commit(ops.abandonMission(get().profile, telemetry)),
  recoverAircraft: () => commit(ops.recoverAircraft(get().profile)),
  startRepair: (componentIds) => commit(ops.startRepair(get().profile, componentIds)),
  collectRepair: () => commit(ops.collectRepair(get().profile)),
  recordExploration: (p) => {
    const r = applyExploration(get().profile, p);
    if (r.profile === get().profile) return r.events;
    set({ profile: r.profile });
    // Fog cells change every few hundred metres: persist finds at once, bare fog at most every 5 s.
    const now = Date.now();
    if (r.events.length || now - lastExplorationPersist > 5000) { lastExplorationPersist = now; get().persist(); }
    return r.events;
  },
}));

function commit<T extends ops.OpResult<object>>(r: T): T {
  if (r.ok) {
    useProfileStore.setState({ profile: r.profile });
    useProfileStore.getState().persist();
  }
  return r;
}
