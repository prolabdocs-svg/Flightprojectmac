import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { PAINT_PRESETS } from '../../content/paint';
import { ScreenHeader } from '../components/ScreenHeader';
import { HangarAircraft } from '../components/HangarAircraft';
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

  const current = PAINT_PRESETS.find((x) => x.id === profile.selectedPaintId);

  return (
    <div className="screen paint-screen">
      <ScreenHeader title="Pintura" kicker="PERSONALIZACIÓN" goTo={goTo} />

      <main className="screen-body">
        <div className="paint-layout">
          <section className="panel paint-preview" aria-label="Vista previa">
            <HangarAircraft fabric={current?.fabricColor} tube={current?.tubeColor} />
            <span className="panel-kicker">{current?.name ?? 'Sin pintura'}</span>
          </section>
          <div className="card-grid">
            {PAINT_PRESETS.map((paint) => {
              const owned = profile.ownedPaintIds.includes(paint.id);
              const selected = profile.selectedPaintId === paint.id;
              return (
                <button key={paint.id} className={`card ${selected ? 'is-selected' : ''}`} onClick={() => handleSelect(paint.id, paint.priceCash)}>
                  <div className="card-head">
                    <div className="paint-swatch-row">
                      <span className="paint-swatch" style={{ background: paint.fabricColor }} />
                      <span className="paint-swatch" style={{ background: paint.tubeColor }} />
                    </div>
                    {selected && <span className="chip chip-accent">Equipado</span>}
                  </div>
                  <span className="card-name">{paint.name}</span>
                  <div className="card-foot"><span className="chip">Tier {paint.tier}</span><span className="card-price">{owned ? 'En inventario' : `$${paint.priceCash}`}</span></div>
                </button>
              );
            })}
          </div>
        </div>
        <p className="builder-note">La pintura se aplica a la tela y estructura del avión (sección 82.11 del documento de diseño).</p>
      </main>
      <MenuNavigation active="paint" goTo={goTo} />
    </div>
  );
}
