import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { TECH_NODES, TECH_CATEGORY_LABELS, canUnlockTech } from '../../content/techtree';
import { FRAMES, getPart } from '../../content/parts';
import type { TechCategory } from '../../core/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { UiIcon } from '../components/UiIcon';
import { MenuNavigation } from '../components/MenuNavigation';
import './Screens.css';

// Spec 15 "Árbol tecnológico" + 82.9 "Tech Tree": branch graph gated by RP, with
// prerequisites and a preview of what each node unlocks.
export function TechTreeScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const unlockTech = useProfileStore((s) => s.unlockTech);

  const categories = Array.from(new Set(TECH_NODES.map((n) => n.category))) as TechCategory[];

  return (
    <div className="screen techtree-screen">
      <ScreenHeader title="I+D" kicker="ÁRBOL TECNOLÓGICO" goTo={goTo} />

      <main className="screen-body">
        <div className="tile-row">
          <div className="tile"><b>{profile.researchPoints}<small>RP</small></b><span>Disponibles</span></div>
          <div className="tile"><b>{profile.unlockedTech.length}<small>/ {TECH_NODES.length}</small></b><span>Nodos desbloqueados</span></div>
        </div>

        {categories.map((cat) => (
          <section key={cat} className="tech-branch">
            <h3 className="section-title">{TECH_CATEGORY_LABELS[cat] ?? cat}</h3>
            <div className="tech-node-list">
              {TECH_NODES.filter((n) => n.category === cat).map((node) => {
                const unlocked = profile.unlockedTech.includes(node.id);
                const canUnlock = canUnlockTech(profile.unlockedTech, node.id) && profile.researchPoints >= node.costRp;
                const missingPrereqs = node.requires.filter((r) => !profile.unlockedTech.includes(r));
                return (
                  <div key={node.id} className={`card tech-node ${unlocked ? 'is-selected' : ''}`}>
                    <div className="card-head">
                      <span className="card-name">{node.name}</span>
                      {unlocked && <span className="chip chip-good"><UiIcon name="check" size={11} />Desbloqueado</span>}
                    </div>
                    <p className="card-desc">{node.description}</p>
                    {node.unlocksPartIds.length > 0 && (
                      <div className="tech-node-unlocks">Desbloquea: {node.unlocksPartIds.map((id) => getPart(id)?.name ?? id).join(', ')}</div>
                    )}
                    {(node.unlocksFrameIds?.length ?? 0) > 0 && (
                      <div className="tech-node-unlocks">Desbloquea fuselaje: {node.unlocksFrameIds!.map((id) => FRAMES.find((frame) => frame.id === id)?.name ?? id).join(', ')}</div>
                    )}
                    {missingPrereqs.length > 0 && !unlocked && (
                      <div className="tech-node-locked-reason"><UiIcon name="lock" size={11} /> Requiere: {missingPrereqs.map((id) => TECH_NODES.find((n) => n.id === id)?.name ?? id).join(', ')}</div>
                    )}
                    <div className="card-foot">
                      <span className="card-price">{node.costRp} RP</span>
                      {!unlocked && (
                        <button className="secondary-btn" disabled={!canUnlock} onClick={() => unlockTech(node.id, node.costRp)}>Desbloquear</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>
      <MenuNavigation active="techtree" goTo={goTo} />
    </div>
  );
}
