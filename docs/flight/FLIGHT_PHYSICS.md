# Flight physics — architecture, calibration and evidence

Replaces the legacy `sim/flightController.ts` (retired, baseline kept in `baseline_legacy.json`).
Spec: MASTER FLIGHT PHYSICS REWRITE v1.0. Audit of the old system: `/FLIGHT_SYSTEM_AUDIT.md`.
Reference aircraft: the starter ultralight (`FRAME_ZERO` + default loadout, "Quicksilver-class").
The repo has **no** real Quicksilver MX II data, so nothing here claims to replicate one.

## 1. Architecture (`src/flight/`)

```
input (VirtualStick/keyboard/gamepad → dead zone → expo → rate)      input/mode2Store.ts
  → FlightAssistance   simulation | assisted | arcade (edits PilotCommand only)   controls/flightAssistance.ts
  → ControlMixer + SurfaceActuators (differential ailerons, rate limits, travel)  controls/flightControls.ts
  → AircraftSimulation  (one fixed step; PHYSICS_HZ = 100)                        core/aircraftSimulation.ts
       ├ Propulsion = EngineModel (rpm from torque balance) + PropellerModel (Ct/Cp)  propulsion/
       │     → thrust at the hub (P-factor), reaction torque, prop angular momentum, slipstream
       ├ AeroModel: 8 wing sections, 2 tailplane halves + elevator, fin + rudder, 3 bluff bodies   aero/
       │     per element: v = v_cg + w x r − wind − slipstream → alpha, q, CL/CD/CM (stall), control effect, ground effect, downwash
       ├ LandingGear: 3 independent wheels (strut spring/damper, tyre friction circle, brakes, steering) + StructuralContacts   ground/
       └ AircraftPhysics: sums to ONE force + ONE torque about the CG, adds −w×(Iw), Rapier integrates          core/aircraftPhysics.ts
  → FlightModel (rules: state machine, crash, landing score, damage, obstacles, water) → FlightTelemetry     flightModel.ts
  → HUD · economy · missions · audio · ChaseCamera · FlightScene · debug overlay/gizmos · recorder
```

* **Conventions** (`core/coordinates.ts`): body +Z nose, +Y up, +X *left* wing; world +Y up, +Z north. alpha = atan2(−vy, vz);
  beta > 0 = velocity toward the right wing; p = +wz (right wing down), q = −wx (nose up), r = −wy (nose right).
  Control deflection sign: δ > 0 increases lift along the element normal. Every sign is unit-tested.
* **Nothing steers the body**: the only writers to Rapier are `place()` (spawn/reset), `addForce/addTorque` (integration) and a numerical
  guard (25 rad/s, 120 m/s; counters asserted 0 in every flight test).
* **Assistance is a separate layer** (a test greps its source for rigid-body calls). Legacy mode names map: `acro→simulation`, `standard→assisted`, `assisted→arcade` (default).
* **Timestep**: 100 Hz. Convergence study (`testing/timestep.test.ts`): composite error vs 200 Hz — 100 Hz 0.36 %, 60 Hz 0.87 %, 50 Hz 1.15 %.

## 2. Parameters and provenance

Every numeric parameter of an `AircraftDefinition` has a provenance tag (`MEASURED | DOCUMENTED | ESTIMATED | CALIBRATED | PLACEHOLDER`),
enforced by `quicksilver.test.ts` (`missingProvenance`). The catalogue (`content/parts.ts`) is documented as gameplay abstraction, so:

| Group | Source | Tag |
|---|---|---|
| Masses, part CoM positions, wing/tail areas, spans, chords, stall angle, control travel, gear tolerance | `parts.ts` | DOCUMENTED |
| Pilot 70 kg @ z = −0.55 m | this rewrite | PLACEHOLDER |
| Section split (4/side), incidence 3° (+ washout 0/−0.35/−0.7/−1°), dihedral 5°, right-wing rigging +0.04°, downwash factor 1.0, tail AR 3.5, fin AR 2.2, propwash immersion | this rewrite | ESTIMATED |
| Airfoil: alpha0 −4°, separation width 1.4°, stall centre = catalogue stall + 1.5°, cmAc −0.06, cd0 = 0.8 × catalogue | this rewrite | ESTIMATED |
| `enginePowerScale` = 2.4, `bodyDragScale` = 0.5, `HTAIL_INCIDENCE_DEG` = −3.5° | `quicksilver.ts` | CALIBRATED |
| Gearbox 2.3:1, J0 0.65, prop `ct0/cp0` (derived from the engine part's power and efficiency), idle throttle (derived from the idle balance) | `quicksilver.ts` | ESTIMATED / derived |

### Calibration log (order of spec section 33; one family at a time, measured, then kept or reverted)

1. Geometry, mass, CG, inertia — from parts; inertia from box + parallel-axis (`massModel.ts`).
2. CL curve + CD — first flight: L/D 8.7 at 93 km/h, phugoid present, stable.
3. Longitudinal stability — CM_alpha −1.66/rad was too stable (full back stick could not reach the stall). Tail effective AR 3.5, downwash 1.0, pilot seat aft → −1.0/rad.
4. Tail incidence (`glideTrim`, static, matches the simulation to 1 %): −2° → −3.5° gives hands-off trim 75 km/h.
5. Lateral: spiral mode diverged (doubling ≈ 16 s) at 2.5° dihedral; 5° makes it stable/slow.
6. Stall: separation width 2.2° → 1.4° and centre 4° → 1.5° above the catalogue value so the stall breaks (wing drop, nose drop) instead of plateauing.
7. Engine/prop: first flight climbed 0.86 m/s with the catalogue kW; `enginePowerScale` 1.6 → 2.4 gives 2.3 m/s (a real Quicksilver-class engine is ~28 hp; the "12 hp" catalogue name is a label).
8. Ground: gear springs sized from the static load split (3×3 solve); takeoff roll 75 m, liftoff 59 km/h.
9. Assistance gains (coordination 2.5/4, dampers, level, limits) tuned against `assistance.test.ts`.

Re-run any time: `npx vitest run src/flight`; regenerate the table below with `WRITE_REPORT=1 npx vitest run src/flight/testing/acceptance.test.ts`.

## 3. Acceptance (spec section 32 tests A–H) — `docs/flight/acceptance_report.json`

| Metric | Measured | Band | Note |
|---|---|---|---|
| A.cruiseSpeed@65% | 94.018 km/h | 78 .. 102 | legacy 82; band widened for an honest aircraft with a pilot |
| A.verticalSpeed | 0.018 m/s | 0 .. 0.8 | level flight |
| A.speedOscillation(last10s) | 0.496 km/h | 0 .. 6 | must not grow |
| B.glideRatio | 9.358 :1 | 8 .. 11 | legacy 8.3 |
| B.trimSpeed | 75.222 km/h | 68 .. 90 | hands-off power-off trim |
| B.sinkRate | 2.233 m/s | 1.9 .. 3 | legacy 2.3-2.9 |
| B.dynamicSink | 2.277 m/s | 1.6746813646545287 .. 2.9027810320678498 | simulated glide within 25% of the static analysis |
| C.stallSpeed(1g) | 66.23 km/h | 52 .. 68 | legacy 49 (no pilot); +70 kg pilot raises it |
| C.CLmax | 1.275 - | 1.15 .. 1.6 | fabric ultralight wing |
| C.alphaAtStall | 10.843 deg body | 8 .. 16 | body AoA at CLmax |
| D.bank | 28.216 deg | 26 .. 34 | commanded 30 |
| D.turnRate/expected | 1.019 - | 0.8 .. 1.2 | physics identity for a coordinated level turn |
| D.sideslip | 1.503 deg | 0 .. 3 | coordinated |
| D.altitudeChange(10s) | 1.78 m | -25 .. 25 | assisted turn holds altitude |
| D.G | 1.142 g | 1.05 .. 1.3 | 1/cos(30)=1.155 |
| E.groundRoll | 75.399 m | 45 .. 110 | legacy 59 |
| E.rotateSpeed | 52.048 km/h | 45 .. 62 | scripted 52 |
| E.liftoffSpeed | 59.443 km/h | 50 .. 72 | legacy 59 |
| E.climbAfterLiftoff | 1.45 m/s | 1 .. 4 | legacy 2.6 (best-climb, higher wing loading here) |
| E.bestClimb | 2.332 m/s | 1.8 .. 3.5 | legacy 2.6 |
| E.bestClimbSpeed | 72 km/h | 60 .. 85 |  |
| E.topSpeed | 104.4 km/h | 95 .. 118 | legacy ~100 |
| F.approachSpeed | 83.591 km/h | 62 .. 88 |  |
| F.touchdownSink | 0.537 m/s | 0 .. 3.5 | within gear tolerance |
| F.flarePitch | -0.915 deg | -2 .. 12 | nose comes up in the flare |
| F.rollout | 56.514 m | 5 .. 250 | brakes on |
| G.touchdownOffset | 16.292 m | 0 .. 20 | lateral error at touchdown |
| G.finalOffset | 11.95 m | 0 .. 30 |  |
| G.maxSideForce | 435.154 N | 50 .. 4000 | tyres carry a real side load, within limits |
| G.structuralStrike | 0 - | 0 .. 0 | no wing/belly strike |
| H.rollAuthority(30/15 m/s) | 3.214 - | 2.5 .. 4.6 | ideal (30/15)^2 = 4; damping trims it |
| H.pitchAuthority(30/15 m/s) | 4.24 - | 2.5 .. 4.6 | ideal (30/15)^2 = 4; damping trims it |
| H.yawAuthority(30/15 m/s) | 3.904 - | 2.5 .. 4.6 | ideal (30/15)^2 = 4; damping trims it |

Physics cross-checks that are *identities*, not tuned: coordinated 30° turn rate / (g·tan φ / V) = 1.02; authority ratio (30/15 m/s) ≈ 3.2–4.2 (ideal 4);
torque-free tumbling conserves energy and |L| within 2 %; adverse yaw, weathercocking, roll damping and Dutch-roll-like behaviour emerge from element geometry.

## 4. Mobile / performance (spec section 38)

Measured (`testing/profile.test.ts`, node; `FlightDebugOverlay` in the browser):

| Case | Cost | GC |
|---|---|---|
| AircraftSimulation.step (core) | ~12–15 µs | 5–7 per 400 s of flight (Rapier binding objects) |
| FlightModel.step, cruise, real terrain | ~21–29 µs | ~40 per 400 s (≈ 8 KB per `TerrainQueryService.getElevation` call — outside the flight model) |
| FlightModel.step, on ground, real terrain | ~12–17 µs | 5 |
| Browser (Chrome pane, desktop) overlay | 0.10 ms/step (~10 000 Hz capacity) | — |

At 100 Hz that is ~0.2 % of a 16.7 ms frame in node. Optimisations already in: one force + one torque per tick, sampled airfoil tables (no trig in the stall model),
one terrain query per tick in flight, wheel normal/surface cached per 0.5 m of travel, structural points rejected without a terrain query, damage lists rebuilt only on change.
**Not measured**: a physical mobile device (none available here). Before shipping, run the overlay (`?flightDebug=1`) on the target phone and check `physics ms/step`; the model
degrades by lowering element count / recorder rate, never by replacing physics with kinematics.

## 5. Debugging

* F3 or `?flightDebug=1` in flight: IAS/TAS/GS/AGL/MSL/VS, alpha/beta, attitude, P/Q/R, G, mass/CG, rpm/thrust, CL/CD/L/D, surface deflections, wind, physics ms, per-element table, gizmos
  (CG, per-element lift/drag, thrust, relative airflow, wind, wheel forces, ground normals) and CSV/JSON export of the flight recorder.
* `__pf.recorder` / `__pf.controller` in the dev build; `testing/trim.ts` (static trim), `analysis/performance.ts` (level performance, same model) for calibration.

## 6. Definition of done — status

| Item | Evidence |
|---|---|
| No control via transform; 6-DOF rigid body; distributed forces; airspeed vs wind; alpha per element; beta | `core/aircraftPhysics.ts`, `aero/aeroElement.ts`, `core.test.ts`, anti-pattern search in the audit |
| CL/CD curves, progressive stall, authority ∝ q, elevator/aileron/rudder, adverse yaw, tail stability | `aeroElement.test.ts`, `stall.test.ts`, `controls.test.ts`, acceptance C/H |
| Engine, propeller thrust, reaction torque, propwash (+ P-factor, gyroscopic) | `propulsion.test.ts`, `propulsionFlight.test.ts` |
| Ground effect, mass & CG, differentiated inertia | `aeroElement.test.ts`, `ground.test.ts`, `massModel.test.ts`, `airframe.test.ts` |
| Independent gear, ground friction | `ground.test.ts` |
| Wind, gusts, turbulence, crosswind | `environment.test.ts`, `core.test.ts` (WindField) |
| Assisted mode separate from physics | `assistance.test.ts` |
| Telemetry overlay, flight recorder | `telemetry.test.ts`, `FlightDebugOverlay`, `FlightRecorder` |
| Automated level-flight / glide / stall / turn / takeoff / landing / crosswind tests | `acceptance.test.ts` |
| Mobile profiling; no GC spikes attributable to the model | section 4 (device run still pending) |
| Build, tests, no critical regressions | `npm run build`, `npx vitest run` (72 files, 496 tests at the time of writing) |
| Legacy removed after validation | commit "flight(P11)" |

## 7. Known gaps / next steps

* Real-device profiling (above).
* Other frames fly through the same code path and pass stability/takeoff/climb checks (`frames.test.ts`) but are **not** individually calibrated; tune per frame with `glideTrim` + `analysis/performance`.
* No dedicated NPC-aircraft LOD (spec section 39): there are no NPC aircraft in the repo yet. The player's aircraft always runs the full model.
* VFX driven by the sim (dust, prop blur, touchdown smoke) not implemented: there is no VFX layer in the repo to attach to.
* Mission takeoff-roll gates changed 45 → 55 m (`content/missions.ts`) because the estimator now reports the physical takeoff roll (engine upgrade: 48 m; starter: 81 m).
* `TerrainQueryService.getElevation` allocates ~8 KB per call; caching there would remove most of the remaining GC in flight.
