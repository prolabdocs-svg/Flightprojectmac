import { useEffect, useState } from 'react';
import './MobileControllerPanel.css';

export function MobileControllerPanel({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const [state, setState] = useState<{ port?: number; token?: string; addresses: string[]; status: string }>({ addresses: [], status: 'Iniciando host…' });
  const host = window.mobileController;
  const [devSession, setDevSession] = useState<{ url: string; token: string; relay: string } | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [devPhoneConnected, setDevPhoneConnected] = useState(false);
  const [flightReady, setFlightReady] = useState(false);
  const [devRelayPort, setDevRelayPort] = useState<number>();
  const start = async () => {
    if (!host && import.meta.env.DEV) {
      setState({ addresses: [], status: 'Renovando sesión…' });
      try {
        const response = await fetch('/__mobile/start?renew=1');
        const data = await response.json() as { token: string; relayPort: number; addresses: string[] };
        const address = data.addresses[0];
        if (!address) throw new Error('No LAN address');
        const url = new URL(`http://${address}:${data.relayPort}/controller`);
        url.searchParams.set('token', data.token);
        const relay = url.toString();
        setDevSession({ url: relay, relay, token: data.token });
        setDevRelayPort(data.relayPort);
        setDevPhoneConnected(false);
        setState({ addresses: [], status: 'Esperando que el teléfono se conecte' });
      } catch { setState({ addresses: [], status: 'No se pudo iniciar el host local' }); }
      return;
    }
    if (!host) { setState({ addresses: [], status: 'No disponible en navegador web. Inicia la versión de escritorio.' }); return; }
    setState({ addresses: [], status: 'Iniciando host…' });
    try { const result = await host.start(); setState({ ...result, status: result.addresses.length ? 'Esperando controlador' : 'Host activo; no se detectó una IP Wi-Fi' }); }
    catch { setState({ addresses: [], status: 'No se pudo iniciar el servidor local.' }); }
  };
  useEffect(() => {
    if (host) { void start(); return; }
    if (import.meta.env.DEV) {
      fetch('/__mobile/start').then((response) => response.json()).then((data: { token: string; relayPort: number; addresses: string[] }) => {
        const address = data.addresses?.[0];
        if (!address) throw new Error('No LAN address');
        const relay = new URL(`http://${address}:${data.relayPort}/controller`);
        relay.searchParams.set('token', data.token);
        setDevSession({ url: relay.toString(), token: data.token, relay: relay.toString() });
        setDevRelayPort(data.relayPort);
        setState({ addresses: [], status: 'Esperando controlador' });
      }).catch(() => setState({ addresses: [], status: 'No se pudo iniciar el host local' }));
    } else setState({ addresses: [], status: 'El control móvil requiere la app de escritorio o el servidor de desarrollo.' });
    return;
  }, []);
  useEffect(() => {
    if (!devRelayPort || host) return;
    let socket: WebSocket | undefined;
    let retryTimer = 0;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`ws://${window.location.hostname}:${devRelayPort}/__mobile/control`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'hello', version: 1, token: 'game-renderer' }));
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'axes') window.dispatchEvent(new CustomEvent('project-flight-mobile-axes', { detail: message.axes }));
        if (message.type === 'command') window.dispatchEvent(new CustomEvent('project-flight-mobile-command', { detail: message.command }));
        if (message.type === 'lost') { setDevPhoneConnected(false); window.dispatchEvent(new Event('project-flight-mobile-lost')); }
        if (message.type === 'connected') setDevPhoneConnected(true);
      };
      socket.onclose = () => { if (!stopped) retryTimer = window.setTimeout(connect, 500); };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { stopped = true; clearTimeout(retryTimer); socket?.close(); };
  }, [devRelayPort, host]);
  const address = state.addresses[0];
  const url = devSession?.url ?? (address && state.port && state.token ? `http://${address}:${state.port}/controller?token=${state.token}` : '');
  const qr = url ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}` : '';
  useEffect(() => {
    if (!host) return;
    const unsubscribe = host.onStatus((status) => setPhoneConnected(status.type === 'connected'));
    return unsubscribe;
  }, [host]);
  useEffect(() => {
    const onFlightReady = (event: Event) => setFlightReady(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('project-flight-mobile-flight-ready', onFlightReady);
    return () => window.removeEventListener('project-flight-mobile-flight-ready', onFlightReady);
  }, []);
  return <div className="mobile-controller-backdrop" role="presentation" style={{ display: open ? undefined : 'none' }}><section className="mobile-controller-panel paper" role="dialog" aria-modal="true" aria-labelledby="mobile-controller-title">
    <button className="mobile-controller-close" onClick={onClose} aria-label="Cerrar">×</button>
    <span className="kicker">Enlace RC · Mode 2</span><h2 id="mobile-controller-title">Control móvil</h2>
    <p className="mobile-controller-status"><i className={phoneConnected || devPhoneConnected ? 'is-connected' : ''} />{phoneConnected || devPhoneConnected ? (flightReady ? 'Control conectado · vuelo listo' : 'Control conectado · entra al vuelo para mover el avión') : state.status}</p>
    {url && <><p>Abre esta dirección en el teléfono (misma red Wi‑Fi):</p><a className="mobile-controller-url" href={url}>{url}</a><button className="secondary-btn" onClick={() => void navigator.clipboard?.writeText(url)}>Copiar URL</button><details><summary>Mostrar código QR</summary><img className="mobile-controller-qr" src={qr} alt="Código QR para enlazar el mando" /></details></>}
    {!url && <p>El mando móvil requiere la aplicación de escritorio o el servidor de desarrollo.</p>}
    <div className="mobile-controller-actions"><button className="primary-btn" onClick={() => void start()}>Renovar sesión</button><button className="secondary-btn" onClick={() => { void host?.stop(); void fetch('/__mobile/stop', { method: 'POST' }).catch(() => undefined); onClose(); }}>Desconectar</button></div>
  </section></div>;
}
