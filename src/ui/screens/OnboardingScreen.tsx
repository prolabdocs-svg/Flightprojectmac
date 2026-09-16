import { useGameStore } from '../../state/gameStore';
import './Screens.css';

// Spec 82.2 First-run onboarding: Mode 2 explanation, minimal steps to first mission.
export function OnboardingScreen() {
  const goTo = useGameStore((s) => s.goTo);

  const finish = () => {
    localStorage.setItem('project-flight/onboarded', '1');
    goTo('hangar');
  };

  return (
    <div className="screen onboarding-screen">
      <h2>Controles — Transmisor RC Mode 2</h2>
      <div className="mode2-diagram">
        <div className="mode2-col">
          <strong>Stick izquierdo</strong>
          <p>Vertical: Throttle (se queda donde lo sueltes)</p>
          <p>Horizontal: Rudder / Yaw</p>
        </div>
        <div className="mode2-col">
          <strong>Stick derecho</strong>
          <p>Vertical: Elevator / Pitch</p>
          <p>Horizontal: Aileron / Roll</p>
        </div>
      </div>
      <p className="onboarding-tip">
        Sugerencia: juega en horizontal (landscape) para más espacio de vuelo. Puedes ajustar el tamaño de los sticks
        en Ajustes.
      </p>
      <button className="primary-btn" onClick={finish}>
        Entrar al taller
      </button>
    </div>
  );
}
