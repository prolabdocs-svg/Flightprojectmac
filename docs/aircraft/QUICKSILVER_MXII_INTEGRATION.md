# Quicksilver MX II Sprint integration

The starter frame now identifies and streams as a Quicksilver MX II Sprint. It has a dedicated runtime GLB path, installable reference wing and fuel modules, working aileron/elevator/rudder/propeller/wheel pivots, a gear stance, cockpit/pilot geometry, and the existing engine sound and upgrade path. The initial Field Twin loadout retains the game's calibrated starter wing, tank, mass, and handling so the established gameplay loop remains intact; it is not a factory MX II configuration.

The manufacturer's current Rotax 582 reference sheet lists 32 ft 7 in span, 180 ft² wing area, 6 US gal capacity, 720 lb maximum takeoff weight, a 65 hp Rotax 582, and a 68 in propeller. The published wing and tank are represented as installable workshop parts, and Rotax 582 power/propeller data are available in the aircraft parts catalog. The frame's current game MTOW and default loadout remain calibrated values rather than the published factory specification. Factory-accurate mass, stations, and performance integration remains future work.

The model keeps the project's stylized open tubular high-wing/pusher sculpt and its existing component split, scales its span to the manufacturer dimension, removes the prototype A0 identification marks, and ships it as a separate named GLB. It is not a newly sculpted forensic replica. The cabin/seat stations, structural masses, airfoil polar, control tuning, landing gear coordinates, and engine location are estimates or gameplay calibrations because the public specification sheet does not define them. The current model still needs another visual review against the linked photographs and eventually a model authored from orthographic references.

## Sources

- [Manufacturer MX II Sprint specifications](https://www.quicksilveraircraft.com/movil/MX-II-SPRINT-Spec.php)
- [Quicksilver assembly manual index](https://air-techinc.com/assembly-manuals/)
- [MX II Sprint reference photograph](https://commons.wikimedia.org/wiki/File:Quicksilver_MX_II_Sprint_two_seater_photo_2.jpg)
- [MX II Sprint side-view photograph](https://www.aviationcorner.net/show_photo_en.asp?id=199920)

See [the source manifest](../../assets/aircraft/quicksilver-mxii/source/reference_manifest.json), [parts and frame data](../../src/content/parts.ts), [flight definition](../../src/flight/aircraft/quicksilver.ts), and [runtime rig](../../src/render/aircraftRig.ts).
