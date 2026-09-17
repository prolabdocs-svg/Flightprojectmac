# PROJECT FLIGHT — UNIFIED BEST-OF MERGE STATUS

**Date:** 2026-09-16 (America/Mexico_City)  
**Authoritative workspace:** Google Drive / `PROJECT FLIGHT`  
**Status:** Source-tree merge completed

## 1. Canonical state

PROJECT FLIGHT is now maintained as **one active source tree**. The preserved Claude branch is historical input, not a second active implementation. The current Drive working tree contains the prior Claude implementation plus the previously merged GPT/Master world systems and the final runtime integration documented below.

The `.git` metadata copied into Drive still points `main` and `merge/gpt-claude-best-of` to commit `2f12539c0a6fd0b0f0bd8372b92dbe778eb05204`. Because this final pass was performed through Google Drive file updates rather than Git, the source tree contains working-tree changes relative to that commit. This document describes the authoritative Drive source state.

## 2. Claude implementation retained

The unified version preserves the strongest implemented systems from the Claude development line, including:

- Three.js + Rapier browser-first flight runtime.
- RC Mode 2 touch-control semantics and control presets.
- Corrected +Z aircraft-forward convention.
- Per-tick Rapier force/torque reset and current tuned flight model.
- Structural damage, degradation and detachment behavior.
- Builder, parts, economy, progression, Tech Tree and Paint systems.
- The Field and Scrap Valley playable content.
- Audio, onboarding, accessibility and route code splitting.
- IndexedDB persistence with legacy localStorage migration.
- Existing test suite and PWA/service-worker architecture.

## 3. GPT / Master architecture retained and integrated

The unified version preserves the previously integrated Master/GPT world systems:

- Data-driven campaign region definitions.
- Eight-region campaign contract.
- Deterministic weather/gust model.
- Authored local wind volumes.
- World environment renderer with terrain, cloud, rain and windsock cues.
- Chunk-streaming/world scheduling foundations.
- Instanced vegetation/performance work.

This final Drive merge also adds the runtime contracts that were still missing:

### 3.1 Fixed-step simulation clock

Added `src/core/fixedStepClock.ts` and unit coverage. Simulation cadence is now a first-class abstraction rather than an accumulator embedded in `FlightScreen`.

- Default fixed step: 60 Hz.
- Bounded frame delta.
- Bounded catch-up steps.
- Excess catch-up time is dropped to avoid a spiral of death.
- Exposes interpolation alpha for presentation-only smoothing.

### 3.2 Render interpolation

`FlightScreen` now maintains previous/current physics transform snapshots and interpolates only the rendered aircraft pose. Rapier remains the authoritative simulation state.

### 3.3 Deterministic restart lifecycle

`gameStore` now owns a monotonically increasing `flightSession`. Every transition to `run`, including **Reiniciar vuelo**, increments the session. `App.tsx` keys `FlightScreen` with that value, forcing a clean teardown/recreation of the flight runtime.

### 3.4 Browser/mobile lifecycle

Active flight pauses on `visibilitychange` and `pagehide`. The fixed-step clock is cleared across pause boundaries so returning from background cannot trigger wall-clock catch-up.

### 3.5 Camera convention and smoothing

The chase camera is now consistent with the +Z aircraft-forward convention:

- camera behind: local -Z;
- look target ahead: local +Z;
- camera position/look smoothing uses exponential `dt` response and is no longer display-refresh dependent.

### 3.6 Ground-contact consistency

The broad ground collider friction in `FlightScreen` was changed from `0.85` to `0.04`, matching the wheel-like rolling-resistance approximation already used by the aircraft collider and avoiding reintroduction of the previous taxi/contact instability.

### 3.7 Flight reset heading

`FlightController` stores the configured mission spawn heading. `reset()` restores that heading instead of hardcoding zero degrees.

### 3.8 Pointer ownership

`VirtualStick` captures and releases pointers through `currentTarget`, while retaining one `pointerId` per stick. This preserves two-stick Mode 2 multitouch ownership more robustly.

### 3.9 Resource lifecycle

`FlightScene.dispose()` now disposes scene-owned geometries and materials, render lists, and the renderer. `FlightScreen` frees the Rapier `World` during teardown. The installed `@dimforge/rapier3d-compat` type declaration explicitly supports `World.free(): void`.

## 4. Files created

- `src/core/fixedStepClock.ts`
- `src/core/fixedStepClock.test.ts`
- `src/state/gameStore.test.ts`

## 5. Existing files updated in place

The following Drive files retained their existing IDs and paths while their bytes were replaced with the merged implementation:

- `src/App.tsx`
- `src/state/gameStore.ts`
- `src/ui/components/VirtualStick.tsx`
- `src/sim/flightController.ts`
- `src/render/FlightScene.ts`
- `src/ui/screens/FlightScreen.tsx`

`PauseOverlay.tsx` required no direct edit: its existing `goTo('run')` restart path now works correctly through `flightSession`.

## 6. Validation performed

### Passed

- TypeScript parser/transpile validation on all modified runtime files.
- Standalone runtime assertions for `FixedStepClock`.
- Exact installed Rapier API inspection confirms `World.free(): void`.
- Drive readback performed after writes.
- SHA-256 equality verified byte-for-byte between validated local merge files and the final Drive bytes for all critical updated files.
- Staging-file cleanup verified: no `.merge-stage-*` files remain in Drive search.

### Critical Drive byte hashes

- `src/App.tsx` — `ef4b871a47b53fef9fd710c284c92c19cc60104ca5949273bc49620e91f79b02`
- `src/state/gameStore.ts` — `95c58edb8561a350802e84b92353d4891425bec38c45087c39875b8bf46161c6`
- `src/ui/components/VirtualStick.tsx` — `5968bc06abb689d5314e94090bae4e5e9c04b154976d0651bb6080d80e3a31a3`
- `src/sim/flightController.ts` — `7122a6f9aa041703a4922b271dbb82844ca6328b884bf5a11c0640c5d635381b`
- `src/render/FlightScene.ts` — `d2f6d25b0e22470f26e47b4a27c9c70f8a68382fd7cde311adfd05db953c4cb1`
- `src/ui/screens/FlightScreen.tsx` — `a30b5f40cb542e29d564289d6609277ac5a9d30158a5d2f89dd87aa260d792d5`
- `src/core/fixedStepClock.ts` — `d56d0b841f7541b15e1d6786b37f3770fbd4f70ee3f98e7ce8bd884c85768c02`

### Still required before a release claim

A full repository execution of the existing validation gate must still be run in an environment where the complete Drive checkout is mounted as a normal filesystem project:

```bash
npm test
npm run build
npm run lint
```

This merge does **not** claim those three commands have passed after the final Drive-only changes. The source-level checks above passed; the complete package-level gate remains the next release validation step.

## 7. Definition of the unified version

From this point forward, references to **PROJECT FLIGHT**, the **GPT version**, the **Claude version**, or the **best-of version** should resolve to this single Google Drive source tree. Historical branches/specifications are inputs and reference material; they are not parallel active game implementations.
