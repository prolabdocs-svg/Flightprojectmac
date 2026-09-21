import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import type { ControlPreset } from '../../input/mode2Store';
import type { AssistMode } from '../../input/mode2Store';
import { ScreenHeader } from '../components/ScreenHeader';
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

  const set = updateSettings;
  const st = profile.settings;
  const seg = <T extends string>(label: string, options: T[], value: T, onPick: (v: T) => void, names?: Partial<Record<T, string>>) => (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="segmented">
        {options.map((o) => <button key={o} className={value === o ? 'active' : ''} onClick={() => onPick(o)}>{names?.[o] ?? o}</button>)}
      </div>
    </div>
  );
  const toggle = (label: string, hint: string, on: boolean, onPick: (v: boolean) => void) => (
    <div className="setting-row">
      <div><span className="setting-label">{label}</span><small>{hint}</small></div>
      <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onPick(!on)} />
    </div>
  );
  const slider = (id: string, label: string, value: number, min: number, max: number, onPick: (v: number) => void) => (
    <div className="setting">
      <label htmlFor={id}>{label} <span className="setting-value">{Math.round(value * 100)}%</span></label>
      <input id={id} type="range" min={min} max={max} step={0.05} value={value} onChange={(e) => onPick(Number(e.target.value))} />
    </div>
  );

  return (
    <div className="screen settings-screen">
      <ScreenHeader title="Ajustes" kicker="CONTROLES · AUDIO · ACCESIBILIDAD" goTo={goTo} right={<span />} />

      <main className="screen-body">
        <div className="settings-grid">
          <section className="panel">
            <h3>Controles</h3>
            {seg('Preset de control', presets, st.controlPreset, (v) => set({ controlPreset: v }))}
            {seg('Modo de asistencia', assistModes, st.assistMode, (v) => set({ assistMode: v }))}
            {toggle('Invertir pitch', 'Desactivado = Mode 2 RC estándar', st.invertPitch, (v) => set({ invertPitch: v }))}
            {slider('stick-size', 'Tamaño de sticks', st.stickSize, 0.75, 1.5, (v) => set({ stickSize: v }))}
            {seg('Layout de mano', ['right', 'left'] as const, st.handedness, (v) => set({ handedness: v }), { right: 'Diestro', left: 'Zurdo' })}
            <p className="settings-hint">No altera los ejes Mode 2, solo la disposición visual de botones secundarios.</p>
          </section>

          <section className="panel">
            <h3>Audio</h3>
            {slider('music-volume', 'Música', st.musicVolume, 0, 1, (v) => set({ musicVolume: v }))}
            {slider('sfx-volume', 'Efectos', st.sfxVolume, 0, 1, (v) => set({ sfxVolume: v }))}
          </section>

          <section className="panel">
            <h3>Accesibilidad</h3>
            {toggle('HUD daltónico', 'Paleta azul / naranja', st.colorblindMode, (v) => set({ colorblindMode: v }))}
            {toggle('Reducir movimiento', 'Menos animaciones y transiciones', st.reduceMotion, (v) => set({ reduceMotion: v }))}
            {seg('Tamaño de texto', textSizes, st.textSize, (v) => set({ textSize: v }))}
          </section>

          <section className="panel">
            <h3>Datos</h3>
            <button
              className="secondary-btn"
              onClick={() => {
                localStorage.removeItem('project-flight/onboarded');
                set({ hasSeenOnboarding: false });
                goTo('onboarding');
              }}
            >
              Repetir tutorial
            </button>
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
        <p className="build-info" aria-label={`Versión instalada ${GAME_VERSION}`}>PROJECT FLIGHT · versión {GAME_VERSION}</p>
      </main>
      <MenuNavigation active="settings" goTo={goTo} />
    </div>
  );
}
