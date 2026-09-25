# Mobile RC controller

## Architecture and current targets

The desktop Electron main process serves `public/controller.html`, CSS and JavaScript over a dedicated ephemeral HTTP port and accepts a dedicated WebSocket endpoint. The renderer receives only typed axes/loss/discrete-command IPC events through `electron/preload.cjs`; the flight simulation remains the authority. A random 192-bit session token is issued per session. Pairing is exclusive, protocol versioned, payload capped at 2 KiB, axes range-checked, and packets have increasing sequence numbers. A 500 ms watchdog releases pitch, roll, yaw and brake on silence while retaining throttle.

The Vite development server starts a separate LAN HTTP/WebSocket relay, and the app keeps one game receiver connected while the panel is open or hidden. The Electron packaged target uses the same protocol through its Node main process. The pairing session survives menu-to-flight screen changes; closing the panel only hides it, while **Desconectar** revokes the session. HTTP is unencrypted and intended only for a trusted local Wi-Fi network. Anyone possessing the QR/session URL can control the one active session; regenerate the session to revoke the previous token. Do not expose the port to the public internet.

## Use

1. Start with `npm run desktop:run` (or launch the packaged desktop app).
2. Start a flight, pause, and choose **Control móvil**.
3. Join the phone and computer to the same non-isolated Wi-Fi. Scan the displayed QR or open the displayed local URL.
4. Use landscape orientation where possible. Left stick is sticky throttle plus spring yaw; right stick is spring pitch/roll. Hold FRENO for braking. FLAPS and MOTOR send one-shot commands.
5. Use **Renovar sesión** to replace the pairing token, or **Desconectar** to stop the host.

If no LAN address appears, check that Wi-Fi is connected and allow the app through the OS firewall. Guest Wi-Fi client isolation prevents phone-to-computer connections. The QR image is fetched from an external QR rendering service; the URL is also shown as text.

## Known limitations

This implementation targets Electron desktop and the Vite development host; a production web-only build has no LAN backend. It does not implement TLS, multi-controller arbitration UI, persistent telemetry, or automatic fallback that arbitrates simultaneous keyboard/gamepad/mobile use. As in existing local input behavior, the latest input writer controls the shared Mode 2 store. Auxiliary commands are limited to existing engine and flap toggles. Hardware tests on iOS/Android and packaged Windows/Linux were not performed in this environment.
