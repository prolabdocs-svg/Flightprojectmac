import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import type { ControlPreset } from '../../input/mode2Store';
import type { AssistMode } from '../../input/mode2Store';
import './Screens.css';

// Spec 82.20 Settings: controls, accessibility (assist), audio placeholders.
export function SettingsScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const updateSettings = useProfileStore((s) => s.updateSettings);
  const resetProfile = useProfileStore((s) => s.resetProfile);

  const presets: ControlPreset[] = ['beginner', 'normal', 'sport'];
  const assistModes: AssistMode[] = ['assisted', 'standard', 'acro'];

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
    </div>
  );
}
