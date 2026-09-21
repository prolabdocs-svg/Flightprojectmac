import { useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { FRAME_ZERO, FRAMES, PARTS, getFrame } from '../../content/parts';
import { installPart, resolveAircraft } from '../../content/assembly';
import { TECH_NODES } from '../../content/techtree';
import type { PartCategory } from '../../core/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { UiIcon } from '../components/UiIcon';
import { MenuNavigation } from '../components/MenuNavigation';
import './Screens.css';

// Assumed reference airspeed (m/s) used only for the Builder's static thrust-to-weight
// estimate. Not used by the actual flight sim (see flight/flightModel.ts).
const REFERENCE_SPEED_MS = 15;
const G = 9.81;
const CATEGORY_LABELS: Partial<Record<PartCategory, string>> = {
  frame: 'Fuselaje', wingSet: 'Alas', tailAssembly: 'Cola', engine: 'Motor',
  propeller: 'Hélice', fuelTank: 'Tanque', landingGear: 'Tren', wheels: 'Ruedas',
};

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

  const tw = Math.min(thrustToWeight, 1);
  const twClass = thrustToWeight >= 0.5 ? 'tile-good' : thrustToWeight >= 0.3 ? 'tile-warn' : 'tile-bad';
  const tags = (locked: boolean, selected: boolean, selectedLabel: string) => (
    <>
      {selected && <span className="chip chip-accent">{selectedLabel}</span>}
      {locked && <span className="chip chip-lock"><UiIcon name="lock" size={11} />Bloqueado</span>}
    </>
  );

  return (
    <div className="screen builder-screen">
      <ScreenHeader title="Taller" kicker="EDITOR DE MONTAJE" goTo={goTo} />

      <main className="screen-body">
        <div className="builder-layout">
          <aside className="panel builder-side">
            <span className="panel-kicker">TELEMETRÍA DE INGENIERÍA</span>
            <div className="tile-row">
              <div className="tile"><b>{aircraft.totalMassKg.toFixed(0)}<small>kg</small></b><span>Masa total</span></div>
              <div className={`tile ${twClass}`}><b>{thrustToWeight.toFixed(2)}</b><span>Empuje / peso</span></div>
            </div>
            <div className="meter" aria-hidden="true"><i style={{ width: `${tw * 100}%` }} /></div>
            <div className="stat-line">
              <div>Empuje estimado<b>{thrustN.toFixed(0)} N</b></div>
              <div>Drag ({REFERENCE_SPEED_MS} m/s)<b>{dragEstimateN.toFixed(0)} N</b></div>
              <div>Área de drag<b>{aircraft.totalDragArea.toFixed(2)} m²</b></div>
              <div>Combustible<b>{aircraft.fuelCapacityL} L</b></div>
              <div>CoM<b>{aircraft.centerOfMass.map((v) => v.toFixed(2)).join(' · ')}</b></div>
            </div>
          </aside>

          <div className="builder-main">
            <h3 className="section-title">Fuselaje</h3>
            <div className="card-grid">
              {FRAMES.map((f) => {
                const owned = profile.ownedFrameIds.includes(f.id);
                const isSelected = frame.id === f.id;
                const locked = isPartLocked(f.requiresTechId);
                const techNode = f.requiresTechId ? TECH_NODES.find((n) => n.id === f.requiresTechId) : undefined;
                return (
                  <button
                    key={f.id}
                    className={`card ${isSelected ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`}
                    disabled={locked}
                    onClick={() => handleSelectFrame(f.id, f.priceCash ?? 0, f.requiresTechId)}
                  >
                    <div className="card-head"><span className="card-name">{f.name}</span><span className="chip-row">{tags(locked, isSelected, 'Seleccionado')}</span></div>
                    <p className="card-desc">{f.description}</p>
                    {locked && <p className="card-desc">Requiere: {techNode?.name ?? f.requiresTechId}</p>}
                    <div className="card-foot"><span className="chip">Tier {f.tier}</span><span className="card-price">{owned ? 'En inventario' : `$${f.priceCash ?? 0}`}</span></div>
                  </button>
                );
              })}
            </div>

            <h3 className="section-title">Componentes</h3>
            <div className="segmented" role="tablist">
              {frame.hardpoints.map((h) => (
                <button key={h.id} role="tab" aria-selected={h.category === category} className={h.category === category ? 'active' : ''} onClick={() => setCategory(h.category)}>
                  {CATEGORY_LABELS[h.category] ?? h.category}
                </button>
              ))}
            </div>
            <div className="card-grid">
              {options.map((p) => {
                const owned = profile.ownedParts.includes(p.id);
                const isInstalled = installedId === p.id;
                const locked = isPartLocked(p.requiresTechId);
                const techNode = p.requiresTechId ? TECH_NODES.find((n) => n.id === p.requiresTechId) : undefined;
                return (
                  <button
                    key={p.id}
                    className={`card ${isInstalled ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`}
                    disabled={locked}
                    onClick={() => handleSelect(p.id, p.priceCash, p.requiresTechId)}
                  >
                    <div className="card-head"><span className="card-name">{p.name}</span><span className="chip-row">{tags(locked, isInstalled, 'Instalado')}</span></div>
                    <p className="card-desc">{p.description}</p>
                    {locked && <p className="card-desc">Requiere: {techNode?.name ?? p.requiresTechId}</p>}
                    <div className="card-foot"><span className="chip">{p.physics.massKg} kg · Tier {p.tier}</span><span className="card-price">{owned ? 'En inventario' : `$${p.priceCash}`}</span></div>
                  </button>
                );
              })}
            </div>
            <p className="builder-note">Solo se muestran piezas compatibles con los hardpoints del fuselaje actual (sin CAD libre, sección 11.3 del documento de diseño).</p>
          </div>
        </div>
      </main>
      <MenuNavigation active="builder" goTo={goTo} />
    </div>
  );
}
