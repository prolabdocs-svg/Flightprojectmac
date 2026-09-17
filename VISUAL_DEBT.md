# Visual Debt

| ID | Area | Problem | Severity | Player visibility | Performance impact | Proposed fix | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VIS-001 | Aircraft | Starter gameplay used a procedural proxy despite a shipped GLB. | P0 | Constant | None | Export and load the authored `pf_aircraft_ultralight.glb`; map named damage meshes and hydrate it as the scene starts. | Render | Done |
| VIS-006 | Runway | The visible strip was placed at world y=0 and could be buried below graded terrain. | P0 | Constant | None | Build it from the active airfield's dimensions, surface and shared terrain elevation. | Render | Done |
| VIS-007 | Aircraft import | Blender's Z-up export arrived in the Y-up scene without a forward-axis correction, making the fuselage visibly vertical. | P0 | Constant | None | Apply one +90° root X correction when hydrating the authored GLB. | Render | Done |
| VIS-002 | World | Background still uses procedural kits, although all regions now have authored landmark anchors. | P1 | Frequent | Medium | Replace remaining generic background kits after capture review identifies the weakest region. | Environment | In progress |
| VIS-003 | Materials | All regions share the close-range field texture. | P1 | Frequent | Low | Per-region tint now preserves close-range biome identity; add compact material variants after profiling texture budget. | Materials | In progress |
| VIS-004 | Mobile QA | No representative capture/profile evidence for target hardware. | P0 | Release gate | Unknown | Capture the required flight suite on target-class hardware and profile it. | Tech Art | Open |
| VIS-005 | Terrain texture | AI texture generation could not run because the configured provider has no remaining credits. | P1 | Frequent | None | Regenerate the planned tile once credits are available; do not substitute unreviewed art. | Materials | Blocked |
