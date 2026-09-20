import { useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { FRAME_ZERO, FRAMES, PARTS, getFrame } from '../../content/parts';
import { installPart, resolveAircraft } from '../../content/assembly';
import { TECH_NODES } from '../../content/techtree';
import type { PartCategory } from '../../core/types';
import { MenuNavigation } from '../components/MenuNavigation';
import './Screens.css';

// Assumed reference airspeed (m/s) used only for the Builder's static thrust-to-weight
// estimate. Not used by the actual flight sim (see sim/flightController.ts).
const REFERENCE_SPEED_MS = 15;
const G = 9.81;

// Spec 82.6 Builder: hardpoint-based part swapping with mass/CoM + stat comparison.
// Free-form CAD is out of scope for V1 per spec 11.3.
export function BuilderScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const setBuild = useProfileStore((s) => s.setBuild);
  const buyPart = useProfileStore((s) => s.buyPart);
  const buyFrame = useProfileStore((s) => s.buyFrame);
  const selectFrame = useProfileStore((s) => s.selectFrame);
  const [category, setCategory] = useState<PartCategory>('engine');

  const frame = getFrame(profile.currentBuild.frameId) ?? FRAME_ZERO;
  const aircraft = resolveAircraft(profile.currentBuild);
  const hardpoint = frame.hardpoints.find((h) => h.category === category);
  const options = hardpoint ? PARTS.filter((p) => hardpoint.accepts.includes(p.id)) : [];
  const installedId = profile.currentBuild.installed[category];

  // Live stat readout: static thrust estimate at a reference speed, and thrust/weight.
  const thrustN = aircraft.engine
    ? (aircraft.engine.maxPowerKw * 1000 * aircraft.engine.propEfficiency) / REFERENCE_SPEED_MS
    : 0;
  const weightN = aircraft.totalMassKg * G;
  const thrustToWeight = weightN > 0 ? thrustN / weightN : 0;
  const dragEstimateN =
    0.5 * 1.2 * REFERENCE_SPEED_MS * REFERENCE_SPEED_MS * aircraft.totalDragArea * aircraft.totalDragCoefficient;

  const isPartLocked = (techId?: string) => !!techId && !profile.unlockedTech.includes(techId);

  const handleSelect = (partId: string, priceCash: number, requiresTechId?: string) => {
    if (isPartLocked(requiresTechId)) return;
    const owned = profile.ownedParts.includes(partId);
    if (!owned) {
      const ok = buyPart(partId, priceCash);
      if (!ok) return;
    }
    setBuild(installPart(profile.currentBuild, category, partId));
  };

  const handleSelectFrame = (frameId: string, priceCash: number, requiresTechId?: string) => {
    if (isPartLocked(requiresTechId)) return;
    const owned = profile.ownedFrameIds.includes(frameId);
    if (!owned) {
      const ok = buyFrame(frameId, priceCash);
      if (!ok) return;
    }
    selectFrame(frameId);
    const nextFrame = getFrame(frameId);
    if (nextFrame && !nextFrame.hardpoints.some((h) => h.category === category)) {
      setCategory(nextFrame.hardpoints[0].category);
    }
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
        <span>Drag estimado ({REFERENCE_SPEED_MS} m/s): {dragEstimateN.toFixed(0)} N</span>
        <span>Empuje estimado: {thrustN.toFixed(0)} N</span>
        <span>Empuje/Peso: {thrustToWeight.toFixed(2)}</span>
        <span>Combustible: {aircraft.fuelCapacityL} L</span>
      </div>

      <div className="part-options">
        {FRAMES.map((f) => {
          const owned = profile.ownedFrameIds.includes(f.id);
          const isSelected = frame.id === f.id;
          const locked = isPartLocked(f.requiresTechId);
          const techNode = f.requiresTechId ? TECH_NODES.find((n) => n.id === f.requiresTechId) : undefined;
          return (
            <button
              key={f.id}
              className={`part-card ${isSelected ? 'installed' : ''} ${locked ? 'locked' : ''}`}
              disabled={locked}
              onClick={() => handleSelectFrame(f.id, f.priceCash ?? 0, f.requiresTechId)}
            >
              <div className="part-card-name">{f.name}</div>
              <div className="part-card-desc">{f.description}</div>
              <div className="part-card-meta">
                Tier {f.tier} · {owned ? 'En inventario' : `$${f.priceCash ?? 0}`}
              </div>
              {locked && <div className="part-card-meta">Requiere tech: {techNode?.name ?? f.requiresTechId}</div>}
              {isSelected && <div className="part-card-badge">SELECCIONADO</div>}
              {locked && <div className="part-card-badge part-card-badge-locked">BLOQUEADO</div>}
            </button>
          );
        })}
      </div>

      <div className="category-tabs">
        {frame.hardpoints.map((h) => (
          <button key={h.id} className={h.category === category ? 'active' : ''} onClick={() => setCategory(h.category)}>
            {h.category}
          </button>
        ))}
      </div>

      <div className="part-options">
        {options.map((p) => {
          const owned = profile.ownedParts.includes(p.id);
          const isInstalled = installedId === p.id;
          const locked = isPartLocked(p.requiresTechId);
          const techNode = p.requiresTechId ? TECH_NODES.find((n) => n.id === p.requiresTechId) : undefined;
          return (
            <button
              key={p.id}
              className={`part-card ${isInstalled ? 'installed' : ''} ${locked ? 'locked' : ''}`}
              disabled={locked}
              onClick={() => handleSelect(p.id, p.priceCash, p.requiresTechId)}
            >
              <div className="part-card-name">{p.name}</div>
              <div className="part-card-desc">{p.description}</div>
              <div className="part-card-meta">
                {p.physics.massKg} kg · Tier {p.tier} · {owned ? 'En inventario' : `$${p.priceCash}`}
              </div>
              {locked && <div className="part-card-meta">Requiere tech: {techNode?.name ?? p.requiresTechId}</div>}
              {isInstalled && <div className="part-card-badge">INSTALADO</div>}
              {locked && <div className="part-card-badge part-card-badge-locked">BLOQUEADO</div>}
            </button>
          );
        })}
      </div>

      <p className="builder-note">
        Nota: el editor de montaje solo permite piezas compatibles con el hardpoint del frame actual (sin CAD libre),
        siguiendo la sección 11.3 del documento de diseño.
      </p>
      <MenuNavigation active="builder" goTo={goTo} />
    </div>
  );
}
