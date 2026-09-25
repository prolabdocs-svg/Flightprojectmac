# Project Flight beta status

Updated: 2026-09-23

This is a working-tree checkpoint against the worldwide beta objective, not a release claim. The repository has a broad pre-existing uncommitted change set; preserve it when continuing development.

## Verified at this checkpoint

- `npm run build` passes (TypeScript and Vite production build).
- `npm run asset:validate` passes (43 assets).
- The full Vitest suite passes: 104 files, 886 tests (`npm test -- --maxWorkers=2`, after the latest route/world changes).
- The focused flight, stall, mission loop, operations UI, assembly, save, and flap-control group passes: 52 tests across 7 files.
- The formerly failing Quicksilver factory package and RANS GLB-node checks pass; master streaming determinism passes alone.
- Campaign-site flights now route terrain queries and streamed render/colliders through the master world whenever that campaign region has a master frame, including authored-composition regions. The Field retains its legacy terrain authority.
- Campaign air-route edge distances now use master-world coordinates/elevations, so links between region-local coordinate frames have real geographic lengths rather than subtracting unrelated local positions.
- The master runtime, adapter, terrain query, placement, mission-loop, and operations UI focused group passes (83 tests across the latest verification commands).
- `git diff --check` passes.
- The gameplay systems include hangar, map and contract planning, flight, results, persistent profile/economy, maintenance, upgrades, paint, research, weather inputs, terrain streaming, floating origin, field operations, and generated contracts.
- Current content inventory remains 8 campaign regions, 6 playable aircraft frames, 17 designed missions, and 13 airfields.

## Current Quicksilver work

- The starter frame and dedicated runtime asset are named Quicksilver MX II Sprint. The asset reuses the existing stylized open-frame ultralight sculpt, removes A0 marks, fits its span to the published dimension, and exposes control and gear pivots. It is not a new orthographic reconstruction.
- Installable Quicksilver reference parts represent the published 180 ft² wing and 6 US gal tank; Rotax 582 data include the published 65 hp and 68 in propeller. The starting Field Twin build keeps the game's calibrated wing, 8 L tank, mass, MTOW, and handling to preserve the existing mission loop. It is not factory-accurate yet.
- RANS wing lift is now partitioned across its existing flap/aileron regions instead of adding lift area on top of the full wing. Flap commands pass through assistance and actuator slew into RANS flight control and rendering.

## Remaining objective gaps

- Only RANS S-12XL and Zenith CH 701 have their own reference-oriented model and flight paths. ICON A5, Cessna 172, SR-71, and An-225 still need aircraft-specific implementations; the Quicksilver needs factory-accurate physics and a model authored from aircraft references.
- The 60-mission and 100-airfield targets are not met (17 designed missions and 13 fields). Current designed missions emphasize distance, precision landing, STOL, and time-trial challenges.
- The worldwide chart and route graph now share master-world coordinates. Flights and contracts still launch and resolve in a single campaign region; switching regions in-flight and cross-region contract completion remain future work.
- Detailed cockpit instruments, aircraft-specific sound and damage, additional weather effects, measured mobile performance budgets, and a measured 15–25 hour progression loop remain incomplete.

## Test boundary

The full suite was rerun after the Quicksilver/GLB test fixes, campaign master-world hookup, master-coordinate route lengths, and longer timeout for the deterministic streaming stress test. It passes: 104 files, 886 tests. The isolated master adapter/runtime, route planner, aircraft, and mission loop groups also pass.
