(() => {
  const status = document.querySelector('#status');
  const sticks = { left: { throttle: 0, yaw: 0 }, right: { pitch: 0, roll: 0 } };
  const active = new Map(); let brake = false; let sequence = 0; let socket;
  const setStatus = (text) => { status.textContent = text; };
  const draw = (id, x, y) => { const el = document.querySelector(`#${id} .knob`); el.style.left = `${50 + x * 38}%`; el.style.top = `${50 + y * 38}%`; };
  const release = (id, pointerId) => { if (active.get(id) !== pointerId) return; active.delete(id); if (id === 'left') sticks.left.yaw = 0; else { sticks.right.pitch = 0; sticks.right.roll = 0; } draw(id, 0, 0); };
  for (const id of ['left', 'right']) {
    const well = document.querySelector(`#${id} .well`);
    const move = (event) => {
      if (active.get(id) !== event.pointerId) return;
      const rect = well.getBoundingClientRect(); let x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * .38); let y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * .38);
      const mag = Math.hypot(x, y); if (mag > 1) { x /= mag; y /= mag; }
      draw(id, x, y);
      if (id === 'left') { sticks.left.throttle = Math.max(0, Math.min(1, (1 - y) / 2)); sticks.left.yaw = x; document.querySelector('#throttle-value').textContent = `${Math.round(sticks.left.throttle * 100)}%`; }
      else { sticks.right.roll = x; sticks.right.pitch = -y; document.querySelector('#pitch-value').textContent = `${Math.round(sticks.right.pitch * 100)}%`; }
    };
    well.addEventListener('pointerdown', (event) => { if (active.has(id)) return; active.set(id, event.pointerId); well.setPointerCapture(event.pointerId); move(event); });
    well.addEventListener('pointermove', move);
    well.addEventListener('pointerup', (event) => release(id, event.pointerId)); well.addEventListener('pointercancel', (event) => release(id, event.pointerId)); well.addEventListener('lostpointercapture', (event) => release(id, event.pointerId));
  }
  const send = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'axes', seq: ++sequence, throttle: sticks.left.throttle, yaw: sticks.left.yaw, pitch: sticks.right.pitch, roll: sticks.right.roll, brake })); };
  document.querySelector('#brake').addEventListener('pointerdown', (e) => { brake = true; e.currentTarget.classList.add('active'); });
  const releaseBrake = (e) => { brake = false; e.currentTarget.classList.remove('active'); };
  document.querySelector('#brake').addEventListener('pointerup', releaseBrake); document.querySelector('#brake').addEventListener('pointercancel', releaseBrake); document.querySelector('#brake').addEventListener('lostpointercapture', releaseBrake);
  for (const command of ['flaps', 'engine']) document.querySelector(`#${command}`).addEventListener('click', () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'command', seq: ++sequence, command })); });
  const connect = () => { const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'; socket = new WebSocket(`${scheme}//${location.host}/__mobile/control`); socket.onopen = () => { setStatus('Autenticando…'); socket.send(JSON.stringify({ type: 'hello', version: 1, token: window.CONTROLLER_TOKEN || new URLSearchParams(location.search).get('token') })); }; socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'ready') setStatus('ENLAZADO · esperando trama'); else if (m.type === 'connected') setStatus('TELÉFONO ENLAZADO'); else if (m.type === 'busy') setStatus('Ya hay otro mando conectado'); else if (m.type === 'ack') setStatus(`ENLAZADO · trama ${m.seq} recibida`); else if (m.type === 'pong') setStatus(`ENLAZADO · ${Math.round(performance.now() - m.sentAt)} ms`); }; socket.onerror = () => setStatus('Error de conexión'); socket.onclose = () => { setStatus('Conexión perdida · reconectando'); brake = false; sticks.left.yaw = sticks.right.pitch = sticks.right.roll = 0; draw('left', 0, 0); draw('right', 0, 0); setTimeout(connect, 1000); }; };
  connect(); setInterval(send, 1000 / 30); setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', sentAt: performance.now() })); }, 1000); window.addEventListener('pagehide', () => { brake = false; });
})();
