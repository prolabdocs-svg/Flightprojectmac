import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { TECH_NODES, TECH_CATEGORY_LABELS, canUnlockTech } from '../../content/techtree';
import { FRAMES, getPart } from '../../content/parts';
import type { TechCategory } from '../../core/types';
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
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>Árbol tecnológico</h2>
      </header>

      <div className="engineering-overlay">
        <span>{profile.researchPoints} RP disponibles</span>
        <span>{profile.unlockedTech.length} / {TECH_NODES.length} nodos desbloqueados</span>
      </div>

      {categories.map((cat) => (
        <section key={cat} className="tech-branch">
          <h3>{TECH_CATEGORY_LABELS[cat] ?? cat}</h3>
          <div className="tech-node-list">
            {TECH_NODES.filter((n) => n.category === cat).map((node) => {
              const unlocked = profile.unlockedTech.includes(node.id);
              const canUnlock = canUnlockTech(profile.unlockedTech, node.id) && profile.researchPoints >= node.costRp;
              const missingPrereqs = node.requires.filter((r) => !profile.unlockedTech.includes(r));
              return (
                <div key={node.id} className={`tech-node ${unlocked ? 'unlocked' : ''}`}>
                  <div className="tech-node-name">{node.name}</div>
                  <div className="tech-node-desc">{node.description}</div>
                  {node.unlocksPartIds.length > 0 && (
                    <div className="tech-node-unlocks">
                      Desbloquea: {node.unlocksPartIds.map((id) => getPart(id)?.name ?? id).join(', ')}
                    </div>
                  )}
                  {(node.unlocksFrameIds?.length ?? 0) > 0 && (
                    <div className="tech-node-unlocks">
                      Desbloquea fuselaje: {node.unlocksFrameIds!.map((id) => FRAMES.find((frame) => frame.id === id)?.name ?? id).join(', ')}
                    </div>
                  )}
                  {missingPrereqs.length > 0 && !unlocked && (
                    <div className="tech-node-locked-reason">
                      Requiere: {missingPrereqs.map((id) => TECH_NODES.find((n) => n.id === id)?.name ?? id).join(', ')}
                    </div>
                  )}
                  <div className="tech-node-footer">
                    <span>{node.costRp} RP</span>
                    {unlocked ? (
                      <span className="tech-node-badge">DESBLOQUEADO</span>
                    ) : (
                      <button
                        className="secondary-btn"
                        disabled={!canUnlock}
                        onClick={() => unlockTech(node.id, node.costRp)}
                      >
                        Desbloquear
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <MenuNavigation active="techtree" goTo={goTo} />
    </div>
  );
}
