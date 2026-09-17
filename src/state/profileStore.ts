import { create } from 'zustand';
import type { AircraftBuild, FlightResult, PlayerProfile } from '../core/types';
import { createDefaultProfile, saveRepository, whenSaveRepositoryReady } from '../save/save';
import { canUnlockTech } from '../content/techtree';

interface ProfileState {
  profile: PlayerProfile;
  load: () => Promise<void>;
  persist: () => void;
  setBuild: (build: AircraftBuild) => void;
  buyPart: (partId: string, priceCash: number) => boolean;
  unlockTech: (nodeId: string, costRp: number) => boolean;
  buyPaint: (paintId: string, priceCash: number) => boolean;
  selectPaint: (paintId: string) => void;
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
      reputation: profile.reputation + (result.crashed ? 0.5 : 1.5),
    };
    if (result.missionId) {
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
