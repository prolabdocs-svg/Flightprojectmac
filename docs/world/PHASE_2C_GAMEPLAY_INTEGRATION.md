# Phase 2C — Master-world gameplay integration

Connects Phase 2B's isolated `MasterStreamingRuntime` (built and stress-tested against a bare
`THREE.Group`/`Rapier.World`, never touching the real game) to the real flight loop: real
`THREE.Scene`, real `Rapier.World`, a real aircraft rigid body, a real `TerrainQueryService`, and
`FlightScreen.tsx`'s render loop.

## Audit: ownership before this phase

| System | Owner | Notes |
|---|---|---|
| `THREE.Scene` | `FlightScene` (`src/render/FlightScene.ts`), constructed in `FlightScreen.tsx` boot | one per flight |
| `Rapier.World` | `createWorld()` (`src/sim/physics.ts`), constructed in `FlightScreen.tsx` boot | one per flight, freed on unmount |
| Ground-truth elevation | `TerrainQueryService` (`src/world/terrainQuery.ts`) | built once in `FlightScreen.tsx`, shared by `FlightModel`'s ground contact and `WorldEnvironment`'s **own separate instance** (see below) |
| Visual terrain mesh | `WorldEnvironment.addTerrain()` | one static `PlaneGeometry`, built once per flight from `TerrainQueryService.getElevation` |
| Physics terrain collider | `FlightScreen.tsx` boot: `createHeightfieldCollider(...)`, **only** when `region.environment.terrain === 'meadow'` (i.e. only `the_field`) | every other region flew over a flat safety floor at y = -500 with no real ground collider at all |
| Aircraft render position | `controller.body.translation()` each physics tick → interpolated each render frame → `scene.syncAircraft(renderPosition, ...)` | Rapier and THREE already share one coordinate space (region-local metres); there was no floating origin anywhere in the game before this phase |
| Master-world authority | `MasterTerrain` (`src/world/master/masterRuntime.ts`) | already reproduces `the_field`'s exact legacy relief inside the Starter Basin core, and already exposes `createMasterRegionTerrain()` — a `TerrainQueryService` for any campaign-site region backed by the master map |
| Master streaming (tiles/LOD/physics ring/floating origin) | `MasterStreamer` + `MasterRenderStreamer` + `MasterColliderStreamer` + `MasterStreamingRuntime` (Phase 2B) | fully built and stress-tested, but **not called from anywhere in the running game** |

Bug found in this audit, not present before: `WorldEnvironment` builds its **own**
`createTerrainQueryService(region)` instance (`WorldEnvironment.ts` constructor), separate from the
one `FlightScreen.tsx` builds for physics/spawn. Both are pure functions of `region`, so they agreed
by construction — but the moment one caller starts asking for the master-backed variant and the
other doesn't, they diverge. Fixed here by letting the caller inject the `TerrainQueryService`
(`WorldEnvironment`'s new `options.terrainQuery`) instead of always building its own.

## External concurrent change discovered mid-task

While wiring this up, a concurrent session landed **`hasRegionComposition()` / `regionCompositions.ts`**
and extended `WorldEnvironment`'s own legacy analytic heightfield (`FIELD_TERRAIN_SIZE_M`,
`fieldGrid`, roads via `FieldWorld`) to the *same seven campaign-site regions*
(`scrap_valley`, `red_canyon`, `backcountry`, `coast_run`, `industrial_belt`,
`high_desert_test_range`, `the_range`) that master streaming was about to take over. Landing both
unconditionally would have produced exactly the double-terrain-authority bug this phase exists to
prevent: two independent ground meshes / two disagreeing `TerrainQueryService` instances for the
same region.

**Resolution:** `useMasterWorld` in `FlightScreen.tsx` is gated off for any region with a legacy
composition (`!hasRegionComposition(region.id)`), on top of the frame check
(`getMasterTerrain().hasFrame(region.id)`) and the `the_field` exclusion. Since every campaign-site
region currently has a composition, **master streaming is fully wired, real, and covered by
integration tests against the real Rapier/THREE runtime, but is not currently reachable from a
normal flight** — the gate exists specifically so this phase's changes can land without fighting
Slice-4's terrain work in the same files. Flagged explicitly as GLOBAL GATE note, not a silent
success: this is real, tested code that is not yet flipped on for any region in day-to-day
gameplay. See "Remaining debt" below for how to close it.

## What's wired (single terrain authority, when engaged)

For a region that passes the `useMasterWorld` gate:

- **Terrain query**: `createMasterRegionTerrain(region, masterTerrain)` replaces
  `createTerrainQueryService(region)` in `FlightScreen.tsx`. Graded runway pads, water bodies,
  biomes, slope/aspect are layered exactly as before (`createTerrainQueryService`'s existing logic);
  only the raw relief comes from `MasterTerrain.groundAt`, translated into the region's local frame
  by `MasterTerrain.localNaturalElevation`.
- **Visual terrain**: `WorldEnvironment` gets `{ terrainQuery, skipTerrainMesh: true }` (new
  constructor options, `src/render/WorldEnvironment.ts`) — it never builds its own static plane or
  its own `TerrainQueryService`; scatter/water/clouds/etc. all read the injected, master-backed
  query, so props still sit on the correct ground even though the mesh under them is drawn
  elsewhere. `FlightScene`'s constructor gained an optional 5th `worldEnvOptions` parameter
  (additive, existing 4-arg call sites unaffected) to plumb this through.
- **Physics terrain**: `MasterWorldAdapter` (new, `src/world/master/masterWorldAdapter.ts`) builds a
  `MasterStreamingRuntime` against the real `scene.scene` and the real Rapier `world`. The
  region-only `if (region.environment.terrain === 'meadow')` legacy heightfield path is untouched —
  the two paths are mutually exclusive by construction (`useMasterWorld` is never true for `meadow`,
  the only meadow region is `the_field`, which is excluded).
- **Render tiles**: `MasterRenderStreamer` adds/removes real `THREE.Mesh` tiles into `scene.scene`
  every frame, LOD-selected and 2:1-stitched exactly as Phase 2B validated in isolation.
- **Physics colliders**: `MasterColliderStreamer` adds/removes real Rapier heightfield colliders into
  the real `world`, restricted to the physics ring around the aircraft.
- **Floating origin**: `MasterWorldAdapter.addFollower(shiftFn)` lets a caller register anything
  holding region-local state that ISN'T a `THREE.Object3D` (`FloatingOrigin.register` only shifts
  `Object3D.position`). `FlightScreen.tsx` registers one follower that shifts the aircraft's Rapier
  body translation and the render loop's interpolation vectors
  (`previousPosition`/`currentPosition`/`renderPosition`/`windPosition`) by the exact same delta the
  origin just applied to every tile mesh and terrain collider — a pure relabelling of the same
  geographic point. Velocity, attitude, altitude, heading, fuel and mission state are never touched
  (spec item 5).
- **Predictive streaming**: driven every render frame (not every physics substep — tile selection is
  a render/LOD concern) from the aircraft's real Rapier `linvel()` and a real AGL
  (`bodyY − terrainQuery.getElevation(bodyX, bodyZ)`). The `StreamView` API (`x, z, vx, vz, aglM`) is
  already aircraft-agnostic (Phase 2B) — a faster future airframe just widens the same physics ring
  and look-ahead prefetch, no new call site.
- **Collider budget (item 4 fix)**: `MasterColliderStreamer` previously had no per-frame create/
  destroy cap (documented 2B debt). Added `ColliderBudget { maxCreatesPerFrame, maxRemovesPerFrame }`
  (default 16 creates / 32 removes per `apply()`), configurable via `MasterWorldAdapter`'s
  constructor → `MasterStreamingRuntime` → `MasterColliderStreamer`. A tile the budget can't reach
  this frame simply isn't built yet; it stays resident in the streamer's own plan and is retried next
  frame (nothing is starved, only spread out). The one exception is the `plan.unload` safety net — a
  tile that has fully left the streaming plan must never keep a stray collider at any speed, so that
  removal path stays unbudgeted (bounded anyway by `MasterStreamer.maxLoadsPerUpdate`). New
  `metrics.pendingCreates` reports the backlog.
- **Instrumentation (item 8)**: `window.__pf.masterWorld()` (dev builds only, same pattern as the
  existing `__pf.simulate`/`__pf.loadBot` devtools hooks) returns local/global position, origin
  offset, active/pending tiles, triangle count, active colliders + pending-create backlog, and
  distance to unprepared terrain. Off the HUD by default; nothing new renders in normal gameplay.

## Not wired in this pass (debt for Phase 3)

1. **The gate above never fires in current gameplay** — every campaign-site region already has a
   `regionCompositions.ts` entry, so `useMasterWorld` is always `false` today. Closing this requires
   either migrating those compositions to read master elevation (so `WorldEnvironment`'s
   `skipTerrainMesh` path and `FieldWorld`'s road/settlement placement both target the same ground),
   or composing the campaign sites directly against `MasterRenderStreamer` tiles instead of a static
   plane. Both are real, scoped follow-ups, not this phase's job (explicit instruction: don't touch
   `fieldComposition.ts`/`fieldRoads.ts`/`vegetation.ts`/`regionArtBible.ts`/`densitySystem.ts`).
2. **No on-screen debug overlay UI** — item 8's overlay is a devtools function
   (`__pf.masterWorld()`), not a rendered HUD panel. `FlightDebugOverlay.tsx` already exists and is
   the natural place to add a toggled panel; skipped here as YAGNI until a region actually reaches
   the master path in gameplay, since there'd be nothing to show yet — add when item 1 above lands.
3. **No GPU/visual verification.** This is a headless agent environment with no display; no
   screenshot or human visual check was possible. Verification here is exclusively automated:
   `masterWorldAdapter.test.ts` drives the real `MasterStreamingRuntime`, a real Rapier `World`
   and a real `THREE.Scene` (no renderer/GPU) through creation, teardown, multi-rebase sweeps,
   elevation parity, and an out-and-back flight, plus the existing Phase 2B suites
   (`streamingRuntime.test.ts`'s 800-frame stress test, `colliderStreaming.test.ts`,
   `renderStreaming.test.ts`, `masterStreaming.test.ts`). **Human visual inspection in a real
   browser/device is explicitly still pending** — flip the gate in item 1 (or call
   `new MasterWorldAdapter(...)` directly against a debug region) and fly it to confirm no seams,
   popping, or z-fighting are visible in practice.

## Tests added

- `src/world/master/masterWorldAdapter.test.ts` (new): render+collider creation against a real
  scene/world; `dispose()` leaves zero meshes/colliders; a registered follower (mock aircraft body)
  is shifted by the same delta as the terrain across a multi-rebase sweep; region-local elevation
  parity with `createMasterRegionTerrain`; throws for an unknown region id instead of silently
  producing wrong geography; an out-and-back flight settles tile counts back down.
- `src/world/master/colliderStreaming.test.ts` (existing suite, unchanged assertions still pass):
  now exercises the new budgeted `apply()` path — default budget (16 creates/frame) is sized so the
  existing single-`apply()` exact-count assertion (a 700 m physics ring, 12 tiles) still holds in one
  frame; the high-speed sweep test (up to 96 physics tiles in one theoretical frame) is exactly the
  case the budget now spreads across frames instead of spiking.

## Stress test (post-integration)

Phase 2B's own 800-frame headless stress test (`streamingRuntime.test.ts`) is unchanged in shape and
still the authoritative perf baseline (≤420 tiles / cap 420, ~799k triangles, bounded colliders, no
monotonic growth) since `MasterWorldAdapter` adds a thin coordinate-translation layer around the same
`MasterStreamingRuntime`, not new per-frame work. No baseline numbers changed; the collider budget
only changes how creation is *spread across frames*, not how many colliders exist once the ring
stabilizes — confirmed by `colliderStreaming.test.ts`'s existing bound (`maxActive < 400`) still
passing.

## Gates

Run from repo root: `npx vitest run`, `npx tsc -b`, `npx oxlint`, `npx vite build`. Results recorded
at the time this phase landed are in the session report; per this branch's stated protocol, any
failure clearly originating in a file this phase did not touch (concurrent `src/mission/**`,
`flightModel.ts`, etc.) is a **GLOBAL GATE FAILED — EXTERNAL CONCURRENT CHANGE**, not a Phase 2C
regression — this phase's own files are reported separately.
