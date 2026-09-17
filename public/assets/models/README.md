# PROJECT FLIGHT 3D Asset Kit

`airframes/project_flight_roster.blend` is the editable Blender source and the GLB files are the
mobile-ready exports. All geometry is original, low-poly, meter-scaled and uses named meshes for
controls and damage integration (wings, ailerons, elevator, rudder, wheels and propeller).

| Export | Contents |
| --- | --- |
| `airframes/*.glb` | 70 canonical airframes from the master spec, one GLB per stable frame ID |
| `upgrades/*.glb` | 19 visible, modular upgrades: props, tires, tanks, high-lift, avionics, gear, floats, cargo and winglets |
| `pf_aircraft_ultralight.glb` | Hero tube-and-fabric homebuilt prototype with articulated named controls |
| `pf_field_props.glb` | Barn, water tower, tree, windsock and runway marker |
| `pf_scrap_valley_props.glb` | Gantry crane, scrap bale cluster and utility pole |
| `pf_mission_props.glb` | Landing target ring and checkpoint flag |

The generators are [`tools/blender_build_assets.py`](../../../tools/blender_build_assets.py) and
[`tools/blender_generate_roster.py`](../../../tools/blender_generate_roster.py). The latter parses
the supplied master-spec roster directly, guaranteeing the IDs and exported set stay aligned.
