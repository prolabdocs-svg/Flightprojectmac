import { useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { FRAME_ZERO, PARTS, getPart } from '../../content/parts';
import { installPart, resolveAircraft } from '../../content/assembly';
import type { PartCategory } from '../../core/types';
import './Screens.css';

// Spec 82.6 Builder: hardpoint-based part swapping with mass/CoM + stat comparison.
// Free-form CAD is out of scope for V1 per spec 11.3.
export function BuilderScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const setBuild = useProfileStore((s) => s.setBuild);
  const buyPart = useProfileStore((s) => s.buyPart);
  const [category, setCategory] = useState<PartCategory>('engine');

  const aircraft = resolveAircraft(profile.currentBuild);
  const hardpoint = FRAME_ZERO.hardpoints.find((h) => h.category === category);
  const options = hardpoint ? PARTS.filter((p) => hardpoint.accepts.includes(p.id)) : [];
  const installedId = profile.currentBuild.installed[category];

  const handleSelect = (partId: string, priceCash: number) => {
    const owned = profile.ownedParts.includes(partId);
    if (!owned) {
      const ok = buyPart(partId, priceCash);
      if (!ok) return;
    }
    setBuild(installPart(profile.currentBuild, category, partId));
  };

  return (
    <div className="screen builder-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>Editor de montaje</h2>
      </header>

      <div className="engineering-overlay">
        <span>Masa total: {aircraft.totalMassKg.toFixed(0)} kg</span>
        <span>
          CoM: ({aircraft.centerOfMass[0].toFixed(2)}, {aircraft.centerOfMass[1].toFixed(2)}, {aircraft.centerOfMass[2].toFixed(2)})
        </span>
        <span>Drag area: {aircraft.totalDragArea.toFixed(2)} m²</span>
        <span>Combustible: {aircraft.fuelCapacityL} L</span>
      </div>

      <div className="category-tabs">
        {FRAME_ZERO.hardpoints.map((h) => (
          <button key={h.id} className={h.category === category ? 'active' : ''} onClick={() => setCategory(h.category)}>
            {h.category}
          </button>
        ))}
      </div>

      <div className="part-options">
        {options.map((p) => {
          const owned = profile.ownedParts.includes(p.id);
          const isInstalled = installedId === p.id;
          return (
            <button key={p.id} className={`part-card ${isInstalled ? 'installed' : ''}`} onClick={() => handleSelect(p.id, p.priceCash)}>
              <div className="part-card-name">{p.name}</div>
              <div className="part-card-desc">{p.description}</div>
              <div className="part-card-meta">
                {p.physics.massKg} kg · Tier {p.tier} · {owned ? 'En inventario' : `$${p.priceCash}`}
              </div>
              {isInstalled && <div className="part-card-badge">INSTALADO</div>}
            </button>
          );
        })}
      </div>

      <p className="builder-note">
        Nota: el editor de montaje solo permite piezas compatibles con el hardpoint del frame actual (sin CAD libre),
        siguiendo la sección 11.3 del documento de diseño.
      </p>
    </div>
  );
}

// Re-exported for potential future use by tests / other screens.
export function partLabel(id: string): string {
  return getPart(id)?.name ?? id;
}
