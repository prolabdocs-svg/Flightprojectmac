import { useMemo, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { FRAME_ZERO, PARTS, getFrame } from '../../content/parts';
import { installPart, resolveAircraft } from '../../content/assembly';
import { TECH_NODES } from '../../content/techtree';
import { PAINT_PRESETS } from '../../content/paint';
import { estimatePerformance } from '../../sim/performance';
import type { PartCategory } from '../../core/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { MenuNavigation } from '../components/MenuNavigation';
import { HangarStage, type StageFocus } from '../components/HangarStage';
import { PurchaseBox, StatCompare, usd } from '../components/kit';
import { uiSound } from '../../audio/uiSound';
import './Screens.css';

const CATEGORY_LABELS: Partial<Record<PartCategory, string>> = {
  frame: 'Fuselaje', wingSet: 'Alas', tailAssembly: 'Cola', engine: 'Motor',
  propeller: 'Hélice', fuelTank: 'Combustible', landingGear: 'Tren', wheels: 'Ruedas',
};
/** Selecting a component flies the camera to it (UI spec §12). */
const CATEGORY_FOCUS: Partial<Record<PartCategory, StageFocus>> = {
  engine: 'engine', propeller: 'engine', wingSet: 'wings', tailAssembly: 'tail', landingGear: 'gear', wheels: 'gear', fuelTank: 'cockpit',
};
/** Livery families (UI spec §18); rarer families get the louder tag. */
const LIVERY_FAMILY: Record<string, { label: string; tone: string }> = {
  paint_default: { label: 'Estándar', tone: '' },
  paint_barnstormer: { label: 'Vintage', tone: 'tag-bad' },
  paint_field_green: { label: 'Expedición', tone: 'tag-good' },
  paint_sky_blue: { label: 'Estándar', tone: '' },
  paint_racer_yellow: { label: 'Carreras', tone: 'tag-warn' },
  paint_night_ops: { label: 'Especial', tone: 'tag-dark' },
};

type Tab = PartCategory | 'livery';

// Workshop (UI spec §12–15): an automotive-style garage. The aircraft stays on the floor; the panel on the right is
// the parts catalogue for one component with a before → after comparison and the money it leaves you with.
export function BuilderScreen({ initialTab }: { initialTab?: Tab } = {}) {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const setBuild = useProfileStore((s) => s.setBuild);
  const buyPart = useProfileStore((s) => s.buyPart);
  const buyPaint = useProfileStore((s) => s.buyPaint);
  const selectPaint = useProfileStore((s) => s.selectPaint);

  const frame = getFrame(profile.currentBuild.frameId) ?? FRAME_ZERO;
  const [tab, setTab] = useState<Tab>(initialTab ?? 'engine');
  const category: PartCategory | null = tab === 'livery' ? null : frame.hardpoints.some((h) => h.category === tab) ? tab : frame.hardpoints[0].category;
  const hardpoint = category ? frame.hardpoints.find((h) => h.category === category) : undefined;
  const options = hardpoint ? PARTS.filter((p) => hardpoint.accepts.includes(p.id)) : [];
  const installedId = category ? profile.currentBuild.installed[category] : undefined;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = options.find((p) => p.id === pickedId) ?? options.find((p) => p.id === installedId) ?? options[0];
  const [pickedPaintId, setPickedPaintId] = useState(profile.selectedPaintId);
  const pickedPaint = PAINT_PRESETS.find((x) => x.id === pickedPaintId) ?? PAINT_PRESETS[0];
  const [toast, setToast] = useState<string | null>(null);

  const aircraft = resolveAircraft(profile.currentBuild);
  const before = useMemo(() => estimatePerformance(profile.currentBuild), [profile.currentBuild]);
  const candidateBuild = category && picked ? installPart(profile.currentBuild, category, picked.id) : profile.currentBuild;
  const after = useMemo(() => estimatePerformance(candidateBuild), [candidateBuild]);

  const isLocked = (techId?: string) => !!techId && !profile.unlockedTech.includes(techId);
  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 1600); };

  const install = () => {
    if (!category || !picked || isLocked(picked.requiresTechId)) return;
    const owned = profile.ownedParts.includes(picked.id);
    if (!owned && !buyPart(picked.id, picked.priceCash)) return;
    setBuild(installPart(profile.currentBuild, category, picked.id));
    uiSound(owned ? 'upgradeInstalled' : 'purchase');
    flash(`${picked.name} instalado`);
    setPickedId(null);
  };
  const applyPaint = () => {
    const owned = profile.ownedPaintIds.includes(pickedPaint.id);
    if (!owned && !buyPaint(pickedPaint.id, pickedPaint.priceCash)) return;
    selectPaint(pickedPaint.id);
    uiSound(owned ? 'upgradeInstalled' : 'purchase');
    flash(`Librea ${pickedPaint.name}`);
  };

  const pickTab = (t: Tab) => { setTab(t); setPickedId(null); uiSound('click'); };
  const stagePaint = tab === 'livery' ? pickedPaint : PAINT_PRESETS.find((x) => x.id === profile.selectedPaintId);
  const pickedInstalled = !!picked && picked.id === installedId;
  const pickedOwned = !!picked && profile.ownedParts.includes(picked.id);
  const pickedTech = picked?.requiresTechId ? TECH_NODES.find((n) => n.id === picked.requiresTechId) : undefined;

  return (
    <div className="screen workshop-screen builder-screen">
      <div className="hub-backdrop" />
      <HangarStage frameId={frame.id} paint={stagePaint} focus={category ? CATEGORY_FOCUS[category] ?? 'overview' : 'hero'} autoRotate={false} offsetX={-0.12} />
      {toast && <div className="workshop-toast" role="status">{toast}</div>}

      <div className="workshop-chrome">
        <ScreenHeader title="Taller" kicker={`${frame.name} · ${aircraft.totalMassKg.toFixed(0)} kg`} goTo={goTo} />

        <nav className="workshop-rail" aria-label="Componentes">
          <span className="rail-label">Componentes</span>
          {frame.hardpoints.map((h) => {
            const part = PARTS.find((p) => p.id === profile.currentBuild.installed[h.category]);
            return (
              <button key={h.id} role="tab" aria-selected={tab === h.category} className={tab === h.category ? 'is-active' : ''} onClick={() => pickTab(h.category)}>
                {CATEGORY_LABELS[h.category] ?? h.category}<small>{part?.name ?? '—'}</small>
              </button>
            );
          })}
          <span className="rail-label">Apariencia</span>
          <button role="tab" aria-selected={tab === 'livery'} className={tab === 'livery' ? 'is-active' : ''} onClick={() => pickTab('livery')}>
            Librea<small>{PAINT_PRESETS.find((x) => x.id === profile.selectedPaintId)?.name}</small>
          </button>
        </nav>

        <section className="workshop-panel paper">
          {category ? (
            <>
              <div className="workshop-panel-head">
                <div><span className="panel-kicker">Catálogo</span><h3>{CATEGORY_LABELS[category] ?? category}</h3></div>
                <span className="chip">{options.length} piezas</span>
              </div>
              <div className="workshop-list">
                {options.map((p) => {
                  const owned = profile.ownedParts.includes(p.id);
                  const installed = installedId === p.id;
                  const locked = isLocked(p.requiresTechId);
                  return (
                    <button key={p.id} className={`upgrade-card${picked?.id === p.id ? ' is-selected' : ''}${installed ? ' is-installed' : ''}${locked ? ' is-locked' : ''}`} onClick={() => { setPickedId(p.id); uiSound('click'); }}>
                      <b>{p.name}</b>
                      <span className="upgrade-price">{installed ? 'Instalado' : owned ? 'En inventario' : locked ? '🔒' : usd(p.priceCash)}</span>
                      <div className="chip-row"><span className="chip">Tier {p.tier}</span><span className="chip">{p.physics.massKg} kg</span></div>
                    </button>
                  );
                })}
              </div>
              {picked && (
                <>
                  <p className="card-desc">{picked.description}</p>
                  <StatCompare before={before} after={pickedInstalled ? undefined : after} />
                  {pickedInstalled ? (
                    <button className="primary-btn" disabled>Instalado</button>
                  ) : isLocked(picked.requiresTechId) ? (
                    <button className="secondary-btn" onClick={() => goTo('techtree')}>Requiere I+D: {pickedTech?.name ?? picked.requiresTechId}</button>
                  ) : (
                    <PurchaseBox price={pickedOwned ? 0 : picked.priceCash} balance={profile.cash} label={pickedOwned ? 'Instalar' : 'Comprar e instalar'} onBuy={install} testId="install-part" />
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="workshop-panel-head">
                <div><span className="panel-kicker">Pintura</span><h3>Librea</h3></div>
                <span className="chip">{profile.ownedPaintIds.length}/{PAINT_PRESETS.length}</span>
              </div>
              <div className="workshop-list">
                {PAINT_PRESETS.map((paint) => {
                  const owned = profile.ownedPaintIds.includes(paint.id);
                  const equipped = profile.selectedPaintId === paint.id;
                  const fam = LIVERY_FAMILY[paint.id] ?? { label: 'Estándar', tone: '' };
                  return (
                    <button key={paint.id} className={`upgrade-card${pickedPaint.id === paint.id ? ' is-selected' : ''}${equipped ? ' is-installed' : ''}`} onClick={() => { setPickedPaintId(paint.id); uiSound('click'); }}>
                      <b>{paint.name}</b>
                      <span className="upgrade-price">{equipped ? 'Equipada' : owned ? 'Tuya' : usd(paint.priceCash)}</span>
                      <div className="chip-row" style={{ alignItems: 'center' }}>
                        <span className="paint-swatch-row"><span className="paint-swatch" style={{ background: paint.fabricColor }} /><span className="paint-swatch" style={{ background: paint.tubeColor }} /></span>
                        <span className={`tag ${fam.tone}`}>{fam.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {frame.id === FRAME_ZERO.id && <p className="livery-note">La A0 sale de fábrica con su librea pintada: los colores se aplican a las demás aeronaves.</p>}
              {profile.selectedPaintId === pickedPaint.id
                ? <button className="primary-btn" disabled>Equipada</button>
                : <PurchaseBox price={profile.ownedPaintIds.includes(pickedPaint.id) ? 0 : pickedPaint.priceCash} balance={profile.cash} label={profile.ownedPaintIds.includes(pickedPaint.id) ? 'Equipar' : 'Comprar y equipar'} onBuy={applyPaint} testId="apply-paint" />}
            </>
          )}
        </section>

        <MenuNavigation active="builder" goTo={goTo} />
      </div>
    </div>
  );
}
