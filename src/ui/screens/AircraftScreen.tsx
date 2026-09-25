import { useMemo, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { FRAMES } from '../../content/parts';
import { TECH_NODES, canUnlockTech } from '../../content/techtree';
import { estimatePerformance } from '../../sim/performance';
import { PAINT_PRESETS } from '../../content/paint';
import { ScreenHeader } from '../components/ScreenHeader';
import { MenuNavigation } from '../components/MenuNavigation';
import { HangarStage } from '../components/HangarStage';
import { UiIcon } from '../components/UiIcon';
import { PurchaseBox, StatCompare, usd } from '../components/kit';
import { uiSound } from '../../audio/uiSound';
import './Screens.css';

// Aircraft collection (UI spec §16–17): "What machine do I want to earn next?" Large 3D preview; locked frames
// show as a silhouette with exactly what stands between the player and them.
export function AircraftScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const buyFrame = useProfileStore((s) => s.buyFrame);
  const selectFrame = useProfileStore((s) => s.selectFrame);
  const [viewId, setViewId] = useState(profile.currentBuild.frameId);
  const frame = FRAMES.find((f) => f.id === viewId) ?? FRAMES[0];

  const owned = profile.ownedFrameIds.includes(frame.id);
  const active = profile.currentBuild.frameId === frame.id;
  const tech = frame.requiresTechId ? TECH_NODES.find((n) => n.id === frame.requiresTechId) : undefined;
  const techMet = !tech || profile.unlockedTech.includes(tech.id);
  const locked = !owned && !techMet;
  const current = useMemo(() => estimatePerformance(profile.currentBuild), [profile.currentBuild]);
  const candidate = useMemo(() => estimatePerformance({ frameId: frame.id, installed: frame.defaultLoadout }), [frame]);
  const paint = PAINT_PRESETS.find((x) => x.id === profile.selectedPaintId);
  const price = frame.priceCash ?? 0;

  const requirements = tech ? [
    ...tech.requires.map((id) => { const n = TECH_NODES.find((x) => x.id === id); return { label: `I+D previo: ${n?.name ?? id}`, value: '', met: profile.unlockedTech.includes(id) }; }),
    { label: `Investigar ${tech.name}`, value: `${tech.costRp} RP`, met: techMet },
    { label: 'Puntos de investigación', value: `${profile.researchPoints} / ${tech.costRp}`, met: techMet || profile.researchPoints >= tech.costRp },
  ] : [];
  if (price > 0) requirements.push({ label: 'Precio de compra', value: usd(price), met: owned || profile.cash >= price });

  const fly = () => { selectFrame(frame.id); uiSound('upgradeInstalled'); };
  const buy = () => { if (buyFrame(frame.id, price)) { selectFrame(frame.id); uiSound('aircraftUnlock'); } };

  return (
    <div className="screen aircraft-screen">
      <ScreenHeader title="Aeronaves" kicker={`Colección · ${profile.ownedFrameIds.length} de ${FRAMES.length}`} goTo={goTo} />
      <main className="screen-body">
        <div className="collection-layout">
          <section className={`collection-stage${locked ? ' is-locked' : ''}`}>
            <div className="hub-backdrop" />
            <HangarStage frameId={frame.id} paint={active ? paint : undefined} focus="hero" silhouette={locked} />
            <div className="collection-plate">
              <span className="kicker">Tier {frame.tier} · {owned ? (active ? 'En uso' : 'En tu hangar') : locked ? 'Bloqueada' : 'Disponible'}</span>
              <h2>{frame.name}</h2>
            </div>
          </section>

          <aside className="panel paper" data-testid="aircraft-detail">
            <span className="panel-kicker">{active ? 'Tu aeronave' : 'Comparada con tu aeronave actual'}</span>
            <p className="card-desc">{frame.description}</p>
            <StatCompare before={current} after={active ? undefined : candidate} />
            {!owned && requirements.length > 0 && (
              <>
                <span className="panel-kicker">Qué te falta</span>
                <ul className="requirement-list">
                  {requirements.map((r) => (
                    <li key={r.label} className={r.met ? 'is-met' : ''}><UiIcon name={r.met ? 'check' : 'lock'} size={16} /><span>{r.label}</span><b>{r.value}</b></li>
                  ))}
                </ul>
              </>
            )}
            {owned ? (
              <button className="primary-btn" disabled={active} onClick={fly}>{active ? 'En uso' : 'Pilotar esta aeronave'}</button>
            ) : locked ? (
              <button className="secondary-btn" onClick={() => goTo('techtree')}>
                <UiIcon name="research" size={16} />{tech && canUnlockTech(profile.unlockedTech, tech.id) && profile.researchPoints >= tech.costRp ? 'Investigar ahora en I+D' : 'Ver árbol de I+D'}
              </button>
            ) : (
              <PurchaseBox price={price} balance={profile.cash} label={`Comprar ${frame.name}`} onBuy={buy} testId="buy-frame" />
            )}
          </aside>

          <div className="collection-strip" role="tablist" aria-label="Aeronaves">
            {FRAMES.map((f) => {
              const o = profile.ownedFrameIds.includes(f.id);
              const l = !o && !!f.requiresTechId && !profile.unlockedTech.includes(f.requiresTechId);
              return (
                <button key={f.id} role="tab" aria-selected={f.id === frame.id} className={`frame-slot${f.id === frame.id ? ' is-active' : ''}${l ? ' is-locked' : ''}`} onClick={() => { setViewId(f.id); uiSound('click'); }}>
                  <small>Tier {f.tier} · {o ? (profile.currentBuild.frameId === f.id ? 'En uso' : 'Propia') : l ? '🔒 Bloqueada' : usd(f.priceCash ?? 0)}</small>
                  <b>{f.name}</b>
                </button>
              );
            })}
          </div>
        </div>
      </main>
      <MenuNavigation active="aircraft" goTo={goTo} />
    </div>
  );
}
