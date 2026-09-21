# FLIGHT_SYSTEM_AUDIT — Phase 0

Fecha: 2026-09-20 · Base: `main` @ a2d1bca · Spec: MASTER FLIGHT PHYSICS REWRITE v1.0
Todo lo de este documento se verificó leyendo el repo; nada viene del spec.

## 1. Stack real (difiere del spec, que asume Unity)

| Tema | Hallazgo |
|---|---|
| Engine | **No es Unity.** TypeScript 6 + three.js 0.186 (render) + `@dimforge/rapier3d-compat` 0.20 (rigid body) + React 19 + zustand + Vite 8 + Vitest 5. Electron para desktop. |
| Build | `tsc -b && vite build`. Baseline: `tsc -b` limpio, `vitest run` 55 archivos / 388 tests en verde. |
| Rigid body | Un `RAPIER.RigidBody` dinámico por avión. Sin colliders de terreno: el suelo es `TerrainQueryService` analítico (`src/world/terrainQuery.ts`); contacto de tren y hard-points se resuelve a mano. Un cuboid a y=-500 es red de seguridad. |
| Timestep | `FixedStepClock` (`src/core/fixedStepClock.ts`) a **60 Hz**, máx 8 pasos/frame, render interpola con `alpha`. Correcto y desacoplado del render. |
| Determinismo | `weather.ts` sin estado aleatorio; harness headless reproducible. |
| "Quicksilver MX II" | **No existe en el repo.** Solo hay un comentario en `flightModel.ts:83` ("Quicksilver-class ultralight"). El avión de referencia real es `FRAME_ZERO` (`frame_zero`, cola convencional, ala 12 m² / 9 m, 95 kg + partes). Se usa `FRAME_ZERO` como vertical slice "Quicksilver-class". No se replica un MX II real. |

## 2. Arquitectura actual del vuelo

```
useMode2Store (zustand)  ──getResolvedControls()──▶  ResolvedControls
  ▲ VirtualStick / teclado / gamepad                       │  (expo + rate + invert)
                                                           ▼
FlightScreen.advanceSim ── getEnvironmentWind(region,t,pos) ─▶ FlightController.step(controls, wind)
                                                           │
                    ┌──────────────────────────────────────┤
                    ▼                                      ▼
   flightModel.deriveFlightModel(ResolvedAircraft)   Rapier body.addForce/addTorque + world.step()
   (FlightModelSpec, todo derivado de partes)              │
                                                           ▼
                             FlightTelemetry ─▶ HUD · economy · missionProgress · audio · ChaseCamera · FlightScene
```

Archivos de la simulación (`src/sim/`):

| Archivo | Rol | LOC |
|---|---|---|
| `flightController.ts` | dinámica + máquina de estados + crash + aterrizaje + telemetría, todo mezclado | 766 |
| `flightModel.ts` | `deriveFlightModel`: masa/inercia/coef. globales/handling desde partes | 242 |
| `aero.ts` | curvas CL/CD por superficie (**no usadas por FlightController**; solo `airDensityAtAltitude` y `groundEffectInducedDragFactor`) | 158 |
| `engine.ts` | RPM = idle + throttle·(redline−idle) (lineal, sin dinámica) | 10 |
| `weather.ts` | viento base + ráfagas sinusoidales + volúmenes | 41 |
| `damageSystem.ts` | integridad por superficie/tren; multiplicadores de eficacia | 174 |
| `performance.ts` | estimador analítico para Builder/briefing (usa `flightModel.ts`) | 85 |
| `physics.ts`, `flightHarness.ts`, `touchdownTelemetry.ts` | bootstrap Rapier, harness headless, helpers | — |

## 3. Mapa de dependencias (quién importa qué)

- `FlightController` ← `FlightScreen.tsx` (único consumidor real), `flightHarness.ts`.
- `FlightTelemetry` (tipo) ← `FlightHud.tsx`, `economy.ts`, `missionProgress.ts` (+ tests), `FlightScreen`.
- `ResolvedControls` ← `FlightScreen`, `flightHarness`.
- `flightModel.ts` ← `flightController.ts`, `performance.ts`.
- `performance.ts` ← `missionReadiness.ts` (Builder/Briefing).
- `damageSystem.ts` ← `flightController.ts`, `economy.ts`.
- `weather.getEnvironmentWind` ← `FlightScreen` (también alimenta `FlightScene.updateEnvironment`).
- Entrada: `input/mode2Store.ts` (expo/rate, `AssistMode = 'assisted'|'standard'|'acro'`), `input/gamepad.ts`, `ui/components/VirtualStick.tsx` (dual stick Mode 2).
- Cámara: `render/ChaseCamera.ts` (recibe pose interpolada + `{speedMs,onGround,gForce,stalled}`).
- Audio: `audio/flightAudioMappings.ts` (rpm, throttle, airspeed, stallWarning, eventos touchdown/crash/stall).
- Render del avión: `FlightScene.syncAircraft` copia pose interpolada; **no** escribe física.

Contrato de ejes actual (se conserva): cuerpo **+Z = morro, +Y = arriba, +X = ala izquierda** (three.js diestro). Rates: nose-up `q=-wx`, roll-derecha `p=+wz`, nose-right `r=-wy`.

## 4. Lista de hacks / anti-patterns (clasificada)

Búsqueda: `setTranslation|setRotation|setLinvel|setAngvel|addTorque|addForce|lerp|slerp|lookAt|clamp` en `src/` (excluye tests y mundo).

### 4.1 Ilegítimos frente al spec (se eliminan al migrar)

| # | Dónde | Qué hace | Regla del spec violada |
|---|---|---|---|
| H1 | `flightController.ts:439-448` | Pitch/roll/yaw = **aceleración angular directa** `authority·q·input − damping·rate − stability·error`. No hay momentos aerodinámicos por superficie. | §1, §13 pitch/roll/yaw deben emerger de momentos |
| H2 | `:415-417` | `min(1.25, qn)` recorta la autoridad de control: **no crece con q** por encima de 1.25 Q_ref (medido: roll 42°→44.5° entre 84 y 108 km/h). | §13 autoridad ∝ q |
| H3 | `:425-427` | "Turn assist": trim AoA extra en función del bank → mantiene altitud en viraje gratis. | §1 "fuerzas globales para mantener nivelado" |
| H4 | `:451-459` | Auto-level, límite de bank/pitch por torque `·30`/`·25`, mezclados **dentro de la física**. | §13 asistencia en capa separada |
| H5 | `:461-462` | "AoA protection": momento nose-down artificial `40·(α−αprot)`. | §1 stall override |
| H6 | `:464-469` | Stall = flag `alpha>aStall` + **torque sintético** de wing-drop y nose-drop. No hay asimetría aerodinámica. | §12, §1 |
| H7 | `:378-396` | Aerodinámica **agregada en el CG**: un ala, CL(α) global, sin ω×r por elemento, sin cola, sin ailerones/elevador/timón como superficies. | §6, §7 |
| H8 | `:394` | Side force = `−q·2.2·1.1·sin β` sin geometría; no hay fin vertical físico. | §15 |
| H9 | `:499-504` | Clamp `|ω|≤8 rad/s` y `|V|≤90 m/s` (velocidad máxima artificial). | §1 speed clamp, §26 |
| H10 | `:490-497` | Suelo: `setTranslation` al `floor`+0.2 y anula vy (no es contacto). Es red de seguridad, pero puede enmascarar penetración. | §21 |
| H11 | `:397-403` | Paracaídas = arrastre `−0.5ρV·18·1.3` global (HUD ya lo retiró; `chuteDeployed` sigue en el store). | — |
| H12 | `flightModel.ts:86-88,110-134` | Constantes mágicas: `THRUST_SCALE 1.6`, `AIRFRAME_DRAG_SCALE 0.5`, `STARTER_HANDLING`, `flapsClDelta 0.38`, `sideAreaM2 2.2`, `trimAlphaRad`. | §11 parámetros en datos con procedencia |
| H13 | `flightModel.ts:96-101` | Inercia = fórmulas de una línea, **sin usar el CG** de `assembly.ts` (`centerOfMass` se calcula y se ignora). | §18-19 |
| H14 | `flightModel.ts:143-146` | `thrustAt = T0·throttle^1.15·ρ^(1/3)/(1+V/3vi)`, empuje ∝ throttle. | §16 |
| H15 | `engine.ts` | RPM lineal en throttle, sin motor/hélice ni par de reacción/P-factor/propwash. | §16-17 |
| H16 | `aero.ts` | `liftDragCurve` (stall progresivo, Viterna) está bien escrito pero **muerto** en el vuelo real; `flightModel.liftCoefficient` (otro modelo) es el que vuela. Duplicado. | §40 no duplicar |
| H17 | `weather.ts` | Ráfaga uniforme en todo el avión (correcto en principio: modifica airflow, no posición) pero sin altitud/capas/turbulencia. | §23 |
| H18 | `performance.ts` | Estimador analítico paralelo, se desalinea del modelo real. | §34 |

### 4.2 Legítimos (se conservan)

- `FlightScreen.tsx:374-375` `lerp/slerp` de **solo render** entre dos poses de tick (interpolación con `alpha`). No entra en física.
- `ChaseCamera.ts` lerp/lookAt: cámara, fuera de la física. Se extenderá (look-ahead, G, bank) en Phase 10.
- `FlightController.placeAtSpawn` (`setTranslation/setRotation/setLinvel`): reset/spawn, una vez.
- Contacto de tren + hard-points + terreno analítico: idea válida (fuerzas en el punto de cada rueda); se rehace por rueda con estado propio.
- `FixedStepClock`, `damageSystem.ts`, `landingValidator`, `weather.getEnvironmentWind` (como fuente de viento base), `useMode2Store`/expo: se reutilizan.

## 5. Cobertura de tests actual

`src/sim/flightTest.test.ts` (16 tests, 60 Hz, harness real): reposo, despegue 40–100 m, ascenso 2–4 m/s, crucero 75–95 km/h, virajes 30°/60°, auto-level (H4), signos de control, stall+recuperación, picado, aterrizaje, crash por picado, caída, obstáculo, crosswind con rudder, comparativa tanque/motor, abuso aleatorio sin NaN. Bandas de sensación de juego. **No mide:** autoridad vs q, ground effect, glide ratio, coordinación, masa/CG, asimetría de stall.

## 6. Baseline telemetry (legacy, `docs/flight/baseline_legacy.json`)

| Métrica | Legacy | Nota |
|---|---|---|
| Stall 1g | 49.4 km/h | analítico |
| Despegue | 58.9 m, liftoff a 59.3 km/h, t=6.6 s | |
| Ascenso plena potencia | 2.63 m/s a 79 km/h | |
| Crucero 65 % | 82.1 km/h, vs +0.2 | |
| Planeo sin motor | 8.3:1 a 69 km/h (sink 2.3 m/s) | 7.5–8.3:1 según pitch |
| Roll en 0.6 s a fondo (acro) | 33° @73 km/h · 42° @84 · 44.6° @108 | satura: H2 |

Estos son los números "de sensación" objetivo que el modelo nuevo debe alcanzar **por emergencia** (tolerancias en Phase 9).

## 7. Decisiones de adaptación al repo

1. **Lenguaje/estructura**: TS bajo `src/flight/` (spec §40), sin dependencias nuevas. Se reutilizan Rapier (integrador y masa), `TerrainQueryService`, `FixedStepClock`, `damageSystem`, `landingValidator`, `weather`.
2. **Rapier como integrador 6-DOF**: fuerzas/momentos se acumulan en ejes cuerpo y se aplican con `addForce` + `addTorque` (equivalente exacto a `addForceAtPoint` por elemento, 2 llamadas WASM/tick). Rapier 0.20 **no integra el término giroscópico** ω×Iω; se añade como torque explícito.
3. **Feature flag** `flightModel: 'legacy' | 'new'` (default `legacy` hasta pasar gates). `NewFlightModel` expone la misma superficie que `FlightController` (`step`, `body`, `reset`, `getState`) y produce `FlightTelemetry` compatible (+ campos extendidos opcionales), de modo que HUD/economy/misiones/audio/cámara no cambian.
4. **Mapeo de `AssistMode`** (sin romper saves/UI): `acro`→Simulation, `standard`→Assisted, `assisted`→Arcade (default de jugadores nuevos).
5. **Aerodata**: cada parámetro lleva procedencia `MEASURED|DOCUMENTED|ESTIMATED|CALIBRATED|PLACEHOLDER`. Hoy solo hay datos `ESTIMATED`/`PLACEHOLDER` (el catálogo es "abstracción de gameplay", ver cabecera de `parts.ts`).
6. **Timestep**: se evaluará 60 vs 100 Hz por estabilidad/coste (spec §26); `world.timestep` y `FIXED_DT` de `FlightScreen` deben coincidir.
7. **Archivos ajenos en el working tree**: `src/world/*`, `package*.json` tienen cambios sin commitear de otro trabajo; los commits del vuelo usarán `git add` explícito por ruta.

## 8. Plan por dependencias (gates del spec §43)

P1 núcleo (ejes, atmósfera, elemento aero, telemetría) → P2 fuselaje Quicksilver-class (masa/CG/inercia/alas/cola) → P3 controles → P4 stall → P5 propulsión → P6 tren/suelo → P7 viento → P8 asistencia → P9 calibración → P10 integración (cámara/audio/VFX/daño) → retirada del legacy tras validar.

## 9. Post-migration (legacy retired)

Anti-pattern search (spec section 42) over `src/` after removing `sim/flightController.ts`, `sim/flightModel.ts`, `sim/aero.ts`, `sim/engine.ts`:

| Hit | Classification |
|---|---|
| `AircraftPhysics.place()` `setTranslation/setRotation/setLinvel/setAngvel` | kept: spawn/reset only |
| `AircraftPhysics.integrate()` `addForce/addTorque`, `resetForces/Torques` | kept: the physical integration path |
| `AircraftPhysics.guard()` 25 rad/s, 120 m/s, NaN | kept as numerical safety net; counters asserted 0 in all flight tests (legacy 8 rad/s / 90 m/s hacks H9 removed) |
| `FlightScreen` `lerp/slerp` of pose | kept: render interpolation between ticks, never fed back |
| `ChaseCamera` lerp/lookAt | kept: camera only |
| H1–H8, H10–H18 (angular-acceleration handling, q clamp, turn assist, auto-level in physics, AoA protection, scripted wing drop, CG-lumped aero, deep-floor teleport, magic constants, linear RPM, dead `aero.ts`, analytic estimator) | removed / replaced (assistance is a separate layer; estimator uses the flown model) |

Details, calibration log and acceptance numbers: `docs/flight/FLIGHT_PHYSICS.md`.
