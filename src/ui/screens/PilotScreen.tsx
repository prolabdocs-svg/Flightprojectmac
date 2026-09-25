import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { MenuNavigation } from '../components/MenuNavigation';
import { AvatarPreview } from '../components/AvatarPreview';
import * as A from '../../avatar/appearance';
import type { AvatarAppearance } from '../../avatar/appearance';
import { CLOTHING_CATALOG } from '../../avatar/appearance';
import './Screens.css';
import { useState } from 'react';

type Slot = keyof AvatarAppearance;
const SHAPES: Array<{ label: string; slot: Slot; options: readonly { id: string; name: string }[]; color?: { slot: Slot; swatches: readonly string[] } }> = [
  { label: 'Rostro', slot: 'face', options: A.FACES, color: { slot: 'skinTone', swatches: A.SKIN_TONES } },
  { label: 'Pelo', slot: 'hair', options: A.HAIR_STYLES, color: { slot: 'hairColor', swatches: A.HAIR_COLORS } },
  { label: 'Parte de arriba', slot: 'top', options: A.TOPS, color: { slot: 'topColor', swatches: A.CLOTH_COLORS } },
  { label: 'Pantalones', slot: 'bottoms', options: A.BOTTOMS, color: { slot: 'bottomsColor', swatches: A.CLOTH_COLORS } },
  { label: 'Calzado', slot: 'shoes', options: A.SHOES },
  { label: 'Cabeza', slot: 'headwear', options: A.HEADWEAR, color: { slot: 'headwearColor', swatches: A.CLOTH_COLORS } },
  { label: 'Accesorio', slot: 'accessory', options: A.ACCESSORIES },
];

// Pilot customisation: every slot writes straight to the profile (persisted), the flight scene reads it on entry.
export function PilotScreen() {
  const [rotation, setRotation] = useState(0);
  const goTo = useGameStore((s) => s.goTo);
  const avatar = useProfileStore((s) => s.profile.avatar);
  const setAvatar = useProfileStore((s) => s.setAvatar);

  return (
    <div className="screen settings-screen pilot-screen">
      <ScreenHeader title="Vestidor" kicker="Tu piloto · identidad y equipo" goTo={goTo} right={<span />} />
      <main className="settings-layout">
        <div className="pilot-display panel">
          <div className="pilot-display-label"><span className="kicker">VISTA DE HANGAR</span><strong>Tu piloto</strong></div>
          <AvatarPreview appearance={avatar} rotation={rotation} />
          <div className="pilot-turn-controls" aria-label="Girar piloto">
            <button className="secondary-btn" aria-label="Girar a la izquierda" onClick={() => setRotation((v) => v - 0.5)}>↶</button>
            <span>ARRASTRA PARA GIRAR</span>
            <button className="secondary-btn" aria-label="Girar a la derecha" onClick={() => setRotation((v) => v + 0.5)}>↷</button>
          </div>
        </div>
        <div className="settings-pane">
          <section className="panel">
            <h3>Aspecto</h3>
            {SHAPES.map(({ label, slot, options, color }) => (
              <div className="setting" key={slot}>
                <span className="setting-label">{label}</span>
                <div className="segmented">
                  {options.map((o) => <button key={o.id} className={avatar[slot] === o.id ? 'active' : ''} onClick={() => setAvatar({ [slot]: o.id })}>{o.name}</button>)}
                </div>
                {color && (
                  <div className="swatches" role="radiogroup" aria-label={`Color: ${label}`}>
                    {color.swatches.map((c) => <button key={c} role="radio" aria-checked={avatar[color.slot] === c} aria-label={c} className="swatch" style={{ background: c }} onClick={() => setAvatar({ [color.slot]: c })} />)}
                  </div>
                )}
              </div>
            ))}
            <h3>Guardarropa</h3>
            <p className="pilot-closet-note">Cosméticos de inicio · Solo identidad visual</p>
            <div className="pilot-outfits">
              {CLOTHING_CATALOG.map((item) => <button key={item.id} className={`secondary-btn ${avatar.top === item.mesh ? 'active' : ''}`} onClick={() => setAvatar({ top: item.mesh as AvatarAppearance['top'], topColor: item.colorVariants[0] })}>
                <span className="outfit-swatch" style={{ background: item.colorVariants[0] }} />{item.name}<small>{item.tags.slice(0, 2).join(' · ')}</small>
              </button>)}
            </div>
            <button className="secondary-btn" onClick={() => setAvatar({ ...A.DEFAULT_APPEARANCE })}>Restablecer conjunto</button>
          </section>
        </div>
      </main>
      <MenuNavigation goTo={goTo} />
    </div>
  );
}
