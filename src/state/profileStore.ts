import { create } from 'zustand';
import type { AircraftBuild, FlightResult, PlayerProfile } from '../core/types';
import { createDefaultProfile, saveRepository } from '../save/save';

interface ProfileState {
  profile: PlayerProfile;
  load: () => void;
  persist: () => void;
  setBuild: (build: AircraftBuild) => void;
  buyPart: (partId: string, priceCash: number) => boolean;
  applyFlightResult: (result: FlightResult) => void;
  updateSettings: (patch: Partial<PlayerProfile['settings']>) => void;
  resetProfile: () => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: createDefaultProfile(),

  load: () => {
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

  applyFlightResult: (result) => {
    const { profile } = get();
    const next: PlayerProfile = {
      ...profile,
      cash: profile.cash + result.rewardCash,
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
