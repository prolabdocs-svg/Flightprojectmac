/** Mode-2 stick diagram + keyboard map (UI spec §31): diagrams first, words second. Same content as onboarding. */
function Stick({ v, h }: { v: [string, string]; h: [string, string] }) {
  return (
    <svg viewBox="0 0 132 132" aria-hidden="true">
      <rect x="6" y="6" width="120" height="120" rx="6" fill="rgba(0,0,0,.25)" stroke="currentColor" strokeOpacity=".4" strokeWidth="2" />
      <path d="M66 20v92M20 66h92" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" />
      <path d="m66 14-7 10h14ZM66 118l-7-10h14ZM14 66l10-7v14ZM118 66l-10-7v14Z" fill="var(--accent)" />
      <circle cx="66" cy="66" r="15" fill="var(--accent)" stroke="var(--ink)" strokeWidth="2.5" />
      <g fill="currentColor" fontSize="9" fontWeight="700" fontFamily="var(--font-technical)" textAnchor="middle">
        <text x="66" y="38">{v[0]}</text><text x="66" y="101">{v[1]}</text>
        <text x="36" y="93">{h[0]}</text><text x="96" y="93">{h[1]}</text>
      </g>
    </svg>
  );
}

export function ControlsReference() {
  return (
    <div className="controls-reference">
      <div className="controls-diagram">
        <figure><Stick v={['POTENCIA +', 'POTENCIA −']} h={['TIMÓN ←', 'TIMÓN →']} /><figcaption>Stick izquierdo<small>Acelerador y timón (guiñada)</small></figcaption></figure>
        <figure><Stick v={['PICAR', 'ENCABRITAR']} h={['ALABEO ←', 'ALABEO →']} /><figcaption>Stick derecho<small>Cabeceo y alabeo — Mode 2 RC</small></figcaption></figure>
      </div>
      <div className="keymap">
        <kbd>W / S</kbd><span>Potencia gradual (Mayús = fino)</span>
        <kbd>↑ / ↓</kbd><span>Cabeceo</span>
        <kbd>← / →</kbd><span>Alabeo</span>
        <kbd>A / D</kbd><span>Timón</span>
        <kbd>E</kbd><span>Motor</span>
        <kbd>F</kbd><span>Flaps</span>
        <kbd>Espacio</kbd><span>Freno</span>
        <kbd>Esc</kbd><span>Pausa (mando: Menu)</span>
      </div>
    </div>
  );
}
