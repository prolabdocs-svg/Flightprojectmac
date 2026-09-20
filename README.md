# PROJECT FLIGHT

A physics-based DIY-aircraft builder & flying game for web and desktop, scaffolded from
`PROJECT_FLIGHT_MASTER_GDD_TDD_PRODUCTION_SPEC.md`. You build a scrappy homebuilt aircraft in
a garage, fly it with a virtual RC "Mode 2" transmitter, and improve it with cash/RP earned
from flights.

This is a **vertical-slice implementation**, not the full production scope in the spec. It
follows the recommended stack and architecture, with an end-to-end core loop (garage → fly →
results → garage). All eight authored regions have a progressive 16-contract campaign; their
visual prop kits are intentionally lightweight and tuned for the shipping performance budget.

## Tech stack (per the spec's own "31.1 Stack recomendado")

The spec explicitly targets **mobile browsers as an installable PWA**, not a native app store
build — the "Plataforma primaria" is stated as "navegador móvil (iOS/Android), PWA instalable".
So instead of defaulting to React Native/Expo, this scaffold uses exactly what section 31 asks
for:

- **TypeScript**, `strict: true`.
- **Three.js** (WebGL2) for 3D rendering — vanilla scene graph, not react-three-fiber, per the
  spec's explicit "React únicamente para UI de menús/meta, no para administrar cada objeto 3D."
- **Rapier3D (WASM, `@dimforge/rapier3d-compat`)** for rigid-body physics/collision; the
  aerodynamic model itself is a custom force layer applied on top (spec 8.1).
- **Vite** for dev/build.
- **React 19** for menu/HUD UI only.
- **Zustand** for UI/game state (input state, macro screen state, player profile).
- **IndexedDB**-backed save repository behind a `SaveRepository` interface, with a one-time
  migration from the legacy localStorage save.
- **PWA**: `manifest.json` + a minimal hand-written service worker (`public/sw.js`) implementing
  cache-on-demand for the app shell (spec 46.2 describes a fuller strategy — precache manifest,
  stale-while-revalidate, network-first for API — this is a deliberately small first pass).

This runs "on mobile" by being opened in Safari/Chrome on a phone (installable to the home
screen via the manifest) — there is no native iOS/Android build step, matching the spec.

For desktop distribution, the same production payload is wrapped in a sandboxed Electron shell
for macOS, Windows and Linux. See [STEAM_RELEASE.md](STEAM_RELEASE.md) for the platform release
checklist and the external Steamworks steps.

## Running it

```bash
npm install
npm run dev        # starts Vite dev server, open the printed URL
npm run build       # production build + strict TypeScript check (tsc -b && vite build)
npm run preview     # serve the production build locally
```

To try it on a phone on the same network, run `npm run dev -- --host` and open
`http://<your-computer-ip>:5173` on the phone (or use the `.claude/launch.json` preview
config already set up for this repo). For a closer-to-production test, install it to the home
screen from the browser's "Add to Home Screen" menu after a production build+preview — that
exercises the PWA manifest/service worker path.

There is no native mobile project (no Xcode/Android Studio step) — it is a web app that runs
full-screen, landscape-oriented, and touch-first.

## Desktop / Steam build

```bash
npm run desktop:run          # production build, then run the local desktop shell
npm run desktop:package      # macOS universal directory for SteamPipe
npm run desktop:package:win  # Windows x64 directory for SteamPipe
npm run desktop:package:linux # Linux x64 directory for SteamPipe
```

Outputs go to `release/`. These scripts prepare native depots; publishing, signing,
notarization and SteamPipe upload require the publisher's protected credentials.

## Content integrity checks

`src/content/contentValidation.test.ts` runs as part of `npm test` (Vitest) and cross-checks
the content modules under `src/content/` (regions, missions, parts, tech tree, paint) against
each other: no duplicate ids within a collection, every mission's `regionId` resolves to a
real region, every tech node's prerequisites/`unlocksPartIds` resolve to real nodes/parts,
every part's `requiresTechId` resolves to a real tech node, and every frame hardpoint/
`defaultLoadout` in `parts.ts` resolves to a real, category-matching part. It also verifies
campaign unlock gates and linked mission airfields. Failures name the specific id and file at
fault.

## What's implemented

- **Data-driven region environment kits:** regions now own an authored weather/terrain profile,
  deterministic gust model shared by renderer and physics, mobile-friendly procedural terrain
  relief, moving cloud cover and a readable windsock. The Field and Scrap Valley have distinct
  calm-meadow / gusty-quarry air and visual treatment.

- **Full screen flow** (spec section 82, subset): Boot → Onboarding (Mode 2 explainer) → Main
  Hangar → Map/mission list → Mission briefing → Flight (HUD + 3D) → Results → back to Hangar,
  plus a Builder/editor-de-montaje screen and a Settings screen with a Pause overlay during
  flight.
- **RC Mode 2 virtual sticks** (spec 7 & 38): two independent touch gimbals with per-finger
  `pointerId` tracking (true multitouch), left stick's vertical axis is **sticky** (throttle
  stays where you release it, doesn't spring back) while its horizontal axis (rudder) springs
  to center; right stick springs to center on both axes (pitch/roll). Expo/rate curve presets
  (`beginner`/`normal`/`sport`) and an invert-pitch option are wired up in Settings.
  `src/input/mode2Store.ts`, `src/ui/components/VirtualStick.tsx`.
- **Flight physics** (spec section 8/9): a single dynamic Rapier rigid body per aircraft, with a
  custom per-surface aerodynamic force model — lift/drag curves with a soft (non-binary) stall,
  induced + parasitic drag, a simplified propeller thrust curve (strong at low speed, falling
  off with airspeed), fuel burn, ground braking, and a small empirical self-leveling torque so
  the arcade model stays flyable. `src/sim/aero.ts`, `src/sim/flightController.ts`.
- **Aircraft assembly / parts system** (spec 6 & 35/36): a `FrameDefinition` with hardpoints,
  `PartDefinition`s (engine, wing set, fuel tank, landing gear) each with mass/CoM/drag/aero
  data, and a resolver that aggregates installed parts into total mass, center of mass, drag,
  and the list of active aero surfaces. One frame ("Frame Zero", Tier 0) with two options per
  category is implemented. `src/content/parts.ts`, `src/content/assembly.ts`.
- **World streaming**: eight authored campaign regions carry environment, weather, gust, cloud,
  and local wind-volume data. Each has a progressive contract chain; chunk scheduling and
  instanced vegetation keep rendering bounded on mobile.
- **Sixteen missions across eight regions** covering Distance Run, Precision Landing, STOL,
  navigation and speed contracts. Optional bonus objectives (no-damage, fuel remaining,
  landing quality and time) feed into the reward calculation. `src/content/missions.ts`,
  `src/content/economy.ts`.
- **Economy / progression**: cash + Research Points rewarded per flight (spec 14.2's shape:
  base + distance + landing quality + bonuses, with a floor so a crash never zeroes your
  reward), a simple part shop inside the Builder screen, and mission best-scores tracked per
  profile.
- **Progression/customization**: a research-point tech tree gates relevant parts, and a Paint
  screen provides purchasable fabric/tube color presets applied to the flight scene.
- **Save system** (spec 44): a versioned `PlayerProfile` persisted to IndexedDB on every
  mutation, loaded at boot, and migrated from the legacy localStorage key when present.
- **Audio**: Web Audio engine, UI, and result cues with saved music/SFX volume controls.
- **PWA and desktop shells**: manifest + service worker for offline web boot, plus a stable,
  sandboxed `project-flight://` desktop origin for distributable builds.
- **Flight HUD** (spec 24/82.12): speed/altitude/fuel/RPM readouts, mission distance banner,
  crash/landed state banner, secondary controls (engine start/stop, brake, flaps, emergency
  chute), and the two virtual sticks — all safe-area aware for notched phones.

## What's stubbed / explicitly TODO

The spec describes a full 1.0 production (8 regions, 8 aircraft tiers, damage & detachment
system, tech tree, weather, replays/ghosts, leaderboards, cloud save, content-studio tooling,
localization, etc.). None of that is realistic to build "from scratch" in one pass, so this
scaffold focuses on making the **core loop real and playable** and leaves the rest as clearly
marked extension points:

- **Only Tier 0–1 aircraft content is playable.** The eight-region campaign is playable, while
  later regions still need broader bespoke landmark/prop passes for art-complete release review.
- **Damage/detachment is implemented for primary aero surfaces**, but it is not yet a full
  per-module repair and visual-asset system.
- **Workshop breadth is still limited.** The tech tree, Builder part market, and Paint screen
  are implemented, but a full inventory/workshop-upgrade loop is not.
- **No replay/ghost system, no Daily Challenge, no Leaderboards, no cloud save/auth** (spec
  26–29, 45, 50). The `SaveRepository` interface exists so cloud sync can be added without
  touching game logic.
- **Art is a mixed production set.** The starter tube-frame/fabric-wing aircraft is an authored
  GLB and every region has streamed authored anchors; procedural terrain and lightweight
  fallback kits remain by design. Final marketing captures still need a device-profiled art
  review across the full campaign.
- **Gamepad estándar:** mando USB/Bluetooth con Gamepad API (sticks, gatillos y botones
  estándar) está soportado. Un transmisor RC USB que no se exponga como gamepad estándar
  aún requerirá un adaptador/mapeo específico.
- **Flight model is game-tuned rather than a real-flight trainer.** It has deterministic tests
  for takeoff, stall, recovery and landing, but still needs external playtest telemetry before
  any public claim about difficulty balance or realism.
- **No WebGPU renderer / dynamic quality tiers** (spec 21/40/48) — plain WebGL2 via
  `THREE.WebGLRenderer`, fixed quality.
- **Fixed timestep is implemented (60Hz accumulator loop) but Rapier's own `world.step()` is
  called without a custom substep count** — fine for this slice, worth revisiting for
  high-speed impacts per spec 8.3.

## Project structure

```
src/
  core/types.ts          Shared domain types (parts, aero specs, missions, save schema)
  content/                Static game content & pure logic: parts, frames, regions,
                          missions, aircraft assembly (mass/CoM), reward calculation
  sim/                    Simulation layer: Rapier bootstrap, aerodynamics, flight controller
  input/                  RC Mode 2 input state (Zustand) + expo/rate curves
  render/FlightScene.ts   Vanilla Three.js scene (terrain, landmarks, aircraft, chase camera)
  save/save.ts            IndexedDB save repository + legacy migration
  state/                  Zustand stores: macro screen state, player profile
  ui/screens/             One component per full-screen UI surface (spec section 82)
  ui/components/          Virtual joystick, Flight HUD, Pause overlay
public/
  manifest.json, sw.js    PWA install + offline shell
```

## Assumptions made (no clarification requested, per instructions)

- Interpreted "que pueda correr en mobile" as "runs in a mobile browser", matching the spec's
  own stated primary platform, rather than switching to a native React Native/Expo stack the
  spec doesn't ask for.
- Prioritized playable Field/Scrap Valley content while defining the remaining campaign-region
  contract as data for future streamed mission and prop packs.
- Aircraft/part numeric values (mass, power, drag, etc.) are original gameplay abstractions
  invented for this scaffold — the spec explicitly says its own numbers are gameplay
  abstractions too, not real aeronautical data, and asks that this never be used as a guide for
  real aircraft.

# Flightprojectmac
