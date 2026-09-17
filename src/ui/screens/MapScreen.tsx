import { useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { getRegionMissions } from '../../content/missions';
import { REGIONS, isRegionUnlocked } from '../../content/regions';
import { getRegionAirfields } from '../../world/airfields';
import type { PlayerProfile } from '../../core/types';
import './Screens.css';

/** A mission is unlocked once it's the first mission of its region, or once the
 * previous mission in that region's campaign order has been completed at least once
 * (spec 12.1's progressive-region structure, applied within a region's own mission
 * list too). */
function isMissionUnlocked(regionId: string, missionId: string, profile: PlayerProfile): boolean {
  const regionMissions = getRegionMissions(regionId);
  const idx = regionMissions.findIndex((m) => m.id === missionId);
  if (idx <= 0) return true;
  const prevMission = regionMissions[idx - 1];
  return Boolean(profile.completedMissions[prevMission.id]);
}

// Spec 82.4 Map: region selector + mission cards with best score / rewards preview.
export function MapScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const profile = useProfileStore((s) => s.profile);
  const [selectedRegionId, setSelectedRegionId] = useState(REGIONS[0].id);

  const region = REGIONS.find((r) => r.id === selectedRegionId) ?? REGIONS[0];
  const missions = getRegionMissions(region.id);
  const airfields = getRegionAirfields(region.id);

  return (
    <div className="screen map-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>{region.name}</h2>
      </header>

      {REGIONS.length > 1 && (
        <div className="region-tabs">
          {REGIONS.map((r) => {
            const unlocked = isRegionUnlocked(r, profile);
            return (
              <button
                key={r.id}
                className={`region-tab${r.id === selectedRegionId ? ' region-tab-active' : ''}`}
                disabled={!unlocked}
                onClick={() => setSelectedRegionId(r.id)}
              >
                {r.name}
                {!unlocked && ' 🔒'}
              </button>
            );
          })}
        </div>
      )}

      <p className="region-desc">{region.description}</p>

      {airfields.length > 0 && (
        <div className="airfield-list">
          {airfields.map((a) => (
            <div key={a.id} className="airfield-chip" title={`${a.runwayLengthM}m · ${a.surface}`}>
              {a.discoveryState === 'known' ? a.name : a.discoveryState === 'hidden' ? '¿ Pista sin descubrir ?' : '¿ Rumor de pista ?'}
            </div>
          ))}
        </div>
      )}

      <div className="mission-list">
        {missions.length === 0 && (
          <p className="region-desc">Contratos de esta región en preparación. Completa las regiones anteriores para desbloquear su paquete de vuelo.</p>
        )}
        {missions.map((m) => {
          const best = profile.completedMissions[m.id]?.bestScore;
          const locked = !isMissionUnlocked(region.id, m.id, profile);
          return (
            <button
              key={m.id}
              className="mission-card"
              disabled={locked}
              onClick={() => {
                selectMission(m.id);
                goTo('briefing');
              }}
            >
              <div className="mission-card-title">{m.name}</div>
              <div className="mission-card-family">{m.family}</div>
              <div className="mission-card-reward">${m.rewardBaseCash} · {m.rewardBaseRp} RP</div>
              {best !== undefined && <div className="mission-card-best">Mejor: {best.toFixed(0)} m</div>}
              {locked && <div className="mission-card-locked">Bloqueada</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
