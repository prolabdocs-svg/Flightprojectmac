import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { PAINT_PRESETS } from '../../content/paint';
import { MenuNavigation } from '../components/MenuNavigation';
import './Screens.css';

// Spec 82.11 "Paint/Customization": V1 scope covers fabric/tube color presets,
// reusing shared masks (no per-player textures) per spec section 15.
export function PaintScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const buyPaint = useProfileStore((s) => s.buyPaint);
  const selectPaint = useProfileStore((s) => s.selectPaint);

  const handleSelect = (paintId: string, priceCash: number) => {
    const owned = profile.ownedPaintIds.includes(paintId);
    if (!owned) {
      const ok = buyPaint(paintId, priceCash);
      if (!ok) return;
    }
    selectPaint(paintId);
  };

  return (
    <div className="screen paint-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>Pintura</h2>
      </header>

      <div className="engineering-overlay">
        <span>${profile.cash.toFixed(0)}</span>
      </div>

      <div className="paint-options">
        {PAINT_PRESETS.map((paint) => {
          const owned = profile.ownedPaintIds.includes(paint.id);
          const selected = profile.selectedPaintId === paint.id;
          return (
            <button
              key={paint.id}
              className={`paint-card ${selected ? 'selected' : ''}`}
              onClick={() => handleSelect(paint.id, paint.priceCash)}
            >
              <div className="paint-swatch-row">
                <span className="paint-swatch" style={{ background: paint.fabricColor }} />
                <span className="paint-swatch" style={{ background: paint.tubeColor }} />
              </div>
              <div className="paint-card-name">{paint.name}</div>
              <div className="part-card-meta">
                Tier {paint.tier} · {owned ? 'En inventario' : `$${paint.priceCash}`}
              </div>
              {selected && <div className="part-card-badge">EQUIPADO</div>}
            </button>
          );
        })}
      </div>

      <p className="builder-note">
        La pintura seleccionada se aplica a la tela y estructura del avión (sección 82.11 del documento de diseño).
      </p>
      <MenuNavigation active="paint" goTo={goTo} />
    </div>
  );
}
