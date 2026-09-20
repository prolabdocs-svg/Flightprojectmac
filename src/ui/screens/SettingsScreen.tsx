import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import type { ControlPreset } from '../../input/mode2Store';
import type { AssistMode } from '../../input/mode2Store';
import { MenuNavigation } from '../components/MenuNavigation';
import { GAME_VERSION } from '../../buildInfo';
import './Screens.css';

// Spec 82.20 Settings: controls, accessibility (assist), audio placeholders.
// Spec 55.1/55.2/170.1/170.2: accessibility controls (colorblind, motion, text size,
// handedness, stick calibration) added additively alongside the existing control settings.
export function SettingsScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const updateSettings = useProfileStore((s) => s.updateSettings);
  const resetProfile = useProfileStore((s) => s.resetProfile);

  const presets: ControlPreset[] = ['beginner', 'normal', 'sport'];
  const assistModes: AssistMode[] = ['assisted', 'standard', 'acro'];
  const textSizes: Array<'small' | 'normal' | 'large'> = ['small', 'normal', 'large'];

  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>Ajustes</h2>
      </header>

      <section>
        <h3>Preset de control</h3>
        <div className="option-row">
          {presets.map((p) => (
            <button key={p} className={profile.settings.controlPreset === p ? 'active' : ''} onClick={() => updateSettings({ controlPreset: p })}>
              {p}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Modo de asistencia</h3>
        <div className="option-row">
          {assistModes.map((m) => (
            <button key={m} className={profile.settings.assistMode === m ? 'active' : ''} onClick={() => updateSettings({ assistMode: m })}>
              {m}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Invertir pitch</h3>
        <button className={profile.settings.invertPitch ? 'active' : ''} onClick={() => updateSettings({ invertPitch: !profile.settings.invertPitch })}>
          {profile.settings.invertPitch ? 'Activado' : 'Desactivado (Mode 2 RC estándar)'}
        </button>
      </section>

      <section>
        <h3>Audio</h3>
        <div className="option-row option-row-slider">
          <label htmlFor="music-volume">Música {Math.round(profile.settings.musicVolume * 100)}%</label>
          <input
            id="music-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={profile.settings.musicVolume}
            onChange={(e) => updateSettings({ musicVolume: Number(e.target.value) })}
          />
        </div>
        <div className="option-row option-row-slider">
          <label htmlFor="sfx-volume">Efectos {Math.round(profile.settings.sfxVolume * 100)}%</label>
          <input
            id="sfx-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={profile.settings.sfxVolume}
            onChange={(e) => updateSettings({ sfxVolume: Number(e.target.value) })}
          />
        </div>
      </section>

      <section>
        <h3>Tamaño de sticks</h3>
        <div className="option-row option-row-slider">
          <label htmlFor="stick-size">{Math.round(profile.settings.stickSize * 100)}%</label>
          <input
            id="stick-size"
            type="range"
            min={0.75}
            max={1.5}
            step={0.05}
            value={profile.settings.stickSize}
            onChange={(e) => updateSettings({ stickSize: Number(e.target.value) })}
          />
        </div>
      </section>

      <section>
        <h3>Layout de mano</h3>
        <div className="option-row">
          <button
            className={profile.settings.handedness === 'right' ? 'active' : ''}
            onClick={() => updateSettings({ handedness: 'right' })}
          >
            Diestro
          </button>
          <button
            className={profile.settings.handedness === 'left' ? 'active' : ''}
            onClick={() => updateSettings({ handedness: 'left' })}
          >
            Zurdo
          </button>
        </div>
        <p className="settings-hint">No altera los ejes Mode 2, solo la disposición visual de botones secundarios.</p>
      </section>

      <section>
        <h3>Accesibilidad</h3>
        <div className="option-row">
          <button
            className={profile.settings.colorblindMode ? 'active' : ''}
            onClick={() => updateSettings({ colorblindMode: !profile.settings.colorblindMode })}
          >
            HUD daltónico {profile.settings.colorblindMode ? 'activado' : 'desactivado'}
          </button>
        </div>
        <div className="option-row">
          <button
            className={profile.settings.reduceMotion ? 'active' : ''}
            onClick={() => updateSettings({ reduceMotion: !profile.settings.reduceMotion })}
          >
            Reducir movimiento {profile.settings.reduceMotion ? 'activado' : 'desactivado'}
          </button>
        </div>
        <h3>Tamaño de texto</h3>
        <div className="option-row">
          {textSizes.map((t) => (
            <button key={t} className={profile.settings.textSize === t ? 'active' : ''} onClick={() => updateSettings({ textSize: t })}>
              {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Tutorial</h3>
        <button
          className="secondary-btn"
          onClick={() => {
            localStorage.removeItem('project-flight/onboarded');
            updateSettings({ hasSeenOnboarding: false });
            goTo('onboarding');
          }}
        >
          Repetir tutorial
        </button>
      </section>

      <section>
        <h3>Datos</h3>
        <button
          className="danger-btn"
          onClick={() => {
            if (confirm('¿Borrar todo el progreso guardado?')) {
              resetProfile();
              goTo('hangar');
            }
          }}
        >
          Reiniciar progreso
        </button>
      </section>
      <p className="build-info" aria-label={`Versión instalada ${GAME_VERSION}`}>
        PROJECT FLIGHT · versión {GAME_VERSION}
      </p>
      <MenuNavigation active="settings" goTo={goTo} />
    </div>
  );
}
