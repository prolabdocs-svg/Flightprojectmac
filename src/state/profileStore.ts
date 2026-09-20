import { create } from 'zustand';
import type { AircraftBuild, FlightResult, PlayerProfile } from '../core/types';
import { createDefaultProfile, saveRepository, whenSaveRepositoryReady } from '../save/save';
import { canUnlockTech } from '../content/techtree';
import { MAX_HOME_BASE_LEVEL } from '../content/homeBase';
import { getFrame } from '../content/parts';
import { buildForFrame } from '../content/assembly';

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
  upgradeHomeBase: (facility: 'runway' | 'hangar', costCash: number) => boolean;
  applyFlightResult: (result: FlightResult) => void;
  updateSettings: (patch: Partial<PlayerProfile['settings']>) => void;
  resetProfile: () => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: createDefaultProfile(),

  load: async () => {
    await whenSaveRepositoryReady();
    const loaded = saveRepository.load();
    set({ profile: loaded ?? createDefaultProfile() });
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
    set({ profile: { ...profile, cash: profile.cash - priceCash, ownedParts: [...profile.ownedParts, partId] } });
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

  updateSettings: (patch) => {
    set((s) => ({ profile: { ...s.profile, settings: { ...s.profile.settings, ...patch } } }));
    get().persist();
  },

  resetProfile: () => {
    saveRepository.clear();
    set({ profile: createDefaultProfile() });
  },
}));
