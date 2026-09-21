# PROJECT FLIGHT 3D Asset Kit

`airframes/project_flight_roster.blend` is the editable Blender source and the GLB files are the
mobile-ready exports. All geometry is original, low-poly, meter-scaled and uses named meshes for
controls and damage integration (wings, ailerons, elevator, rudder, wheels and propeller).

| Export | Contents |
| --- | --- |
| `airframes/*.glb` | 70 canonical airframes from the master spec, one GLB per stable frame ID |
| `upgrades/*.glb` | 19 visible, modular upgrades: props, tires, tanks, high-lift, avionics, gear, floats, cargo and winglets |
| `pf_aircraft_ultralight.glb` | A0 hero ultralight: generated, not hand-edited — see below |
| `pf_field_props.glb` | Barn, water tower, tree, windsock and runway marker |
| `pf_scrap_valley_props.glb` | Gantry crane, scrap bale cluster and utility pole |
| `pf_mission_props.glb` | Landing target ring and checkpoint flag |

The generators are [`tools/blender_build_assets.py`](../../../tools/blender_build_assets.py) and
[`tools/blender_generate_roster.py`](../../../tools/blender_generate_roster.py). The latter parses
the supplied master-spec roster directly, guaranteeing the IDs and exported set stay aligned.

## A0 hero ultralight (`pf_aircraft_ultralight.glb`)

The sculpt is a single fused mesh (`tools/a0/source/pf_aircraft_ultralight.source.glb`). `node tools/a0/split_a0.mjs`
rebuilds the shipped GLB from it: it cuts the ailerons, elevator and rudder out of the closed shell at their hinge
lines (small gap, capped faces), extracts the propeller, assigns the shared A0 material family
(`A0_FABRIC/FRAME/MECHANICAL/ENGINE_DARK/RUBBER/SEAT/PILOT/PROP`), bakes the 1024px livery atlas and adds the pilot.
Nodes `aileron_L_pivot`, `aileron_R_pivot`, `elevator_pivot`, `rudder_pivot` and `propeller_pivot` sit on the hinge lines;
their local +X is the hinge axis and `src/render/aircraftRig.ts` rotates them from the flight model's control target.
Silhouette, proportions and part layout come unchanged from the source sculpt. Change the livery in `tools/a0/livery.mjs`.
