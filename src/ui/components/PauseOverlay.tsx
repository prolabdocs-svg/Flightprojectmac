import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { useState } from 'react';
import { UiIcon } from './UiIcon';
import { ControlsReference } from './ControlsReference';
import '../screens/Screens.css';
import './PauseOverlay.css';

// Spec 82.13 Pause: resume / restart / exit mission.
export function PauseOverlay() {
  const setPaused = useGameStore((s) => s.setPaused);
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const selectedMissionId = useGameStore((s) => s.selectedMissionId);
  const contractActive = useProfileStore((s) => s.profile.operations.active?.contract.id === selectedMissionId);
  // Contracts can only relaunch from PREPARED (before engine start); after that, abandoning is the only exit.
  const canRestart = useProfileStore((s) => !contractActive || s.profile.operations.active?.session.state === 'PREPARED');

  const [showControls, setShowControls] = useState(false);

  return (
    <div className="pause-overlay">
      <div className={`pause-panel paper${showControls ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label="Pausa">
        <span className="kicker">Vuelo en pausa</span>
        <h2>Pausa</h2>
        {showControls && <ControlsReference />}
        <button className="primary-btn" onClick={() => setPaused(false)}>
          <UiIcon name="flight" size={18} />Reanudar
        </button>
        {canRestart && (
          <button
            className="secondary-btn"
            onClick={() => {
              setPaused(false);
              goTo('run');
            }}
          >
            <UiIcon name="retry" size={18} />Reiniciar vuelo
          </button>
        )}
        <button className="secondary-btn" aria-expanded={showControls} onClick={() => setShowControls((v) => !v)}>
          <UiIcon name="settings" size={18} />{showControls ? 'Ocultar controles' : 'Controles'}
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            setPaused(false);
            if (contractActive) {
              // Abandon through the state machine: free before the engine starts, penalised (and costed) in the air.
              const r = useProfileStore.getState().abandonMission(useGameStore.getState().flightTelemetry ?? undefined);
              useGameStore.getState().setLastOutcome(r.ok && r.settlement ? 'contract' : null);
              selectMission(null);
              goTo(r.ok && r.settlement ? 'results' : 'map');
              return;
            }
            selectMission(null);
            goTo('map');
          }}
        >
          <UiIcon name="map" size={18} />{selectedMissionId ? 'Abandonar contrato' : 'Salir al mapa'}
        </button>
        {!contractActive && (
          <button
            className="secondary-btn"
            onClick={() => {
              setPaused(false);
              goTo('hangar');
            }}
          >
            <UiIcon name="home" size={18} />Volver al hangar
          </button>
        )}
      </div>
    </div>
  );
}
