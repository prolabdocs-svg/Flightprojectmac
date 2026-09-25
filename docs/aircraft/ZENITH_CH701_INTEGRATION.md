# Zenith STOL CH 701 integration

`frame_zenith_ch701` is now wired through aircraft research, purchase, build assembly, flight physics, the Blender-authored runtime model, and animated control / landing-gear pivots. The model is a stylized original based on the CH 701's high rectangular wing, fixed slats, short boxy cabin, tricycle gear, and large low-pressure tyres.

## Reference data

- [Zenith CH 701 specifications](https://zenithair.net/stol-ch701-specifications/): 27 ft / 8.23 m span, 122 sq ft / 11.33 m² wing area, 20 ft 11 in / 6.38 m length, 1,100 lb / 499 kg gross weight, 20 US gal / 75.7 L fuel, and the 80 hp Rotax 912 configuration.
- [Zenith high-lift design](https://zenithair.net/high-lift-design-2/): documents the slat/high-lift design and its narrow efficient cruise range.
- [Zenith STOL introduction](https://zenithair.net/introduction-stol-ch-701/): describes short-field operation and the aircraft's utility-aircraft silhouette.

## Implementation notes

- Simulation uses the measured planform and selected 80 hp Rotax 912 catalogue model. Mass stations, airfoil polars, drag components, control response, and gear damping are estimates tuned for this game's scale; they are not a validated aircraft model.
- `tools/zenith_ch701/build_zenith_ch701.py` regenerates `public/assets/models/airframes/zenith_ch701.glb` and the editable Blender source. Control nodes use the runtime rig contract.
- The CH 701 has a separate handling setup and a lower glide target than the clean starter because its fixed slats and gear favor low-speed STOL work. Flight harness coverage checks stable trim, climb, takeoff, control-rig behavior, asset pivots, and parameter provenance.
- Cabin instruments are presentation geometry; instrument readings, pilot/passenger animation, LOD, and measured aircraft-specific sound remain outstanding.
