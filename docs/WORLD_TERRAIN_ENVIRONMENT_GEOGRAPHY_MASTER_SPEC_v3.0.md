# PROJECT FLIGHT
## WORLD TERRAIN / ENVIRONMENT / BIOMES / TOPOGRAPHY / GEOGRAPHY
### MASTER IMPLEMENTATION SPECIFICATION — v3.0
### Production Constitution + Systems Design + Technical Art + Runtime Architecture + Content Plan + QA Contract

**Estado:** CANONICAL / EXECUTION-READY / WORLD ATLAS COMPLETE  
**Proyecto:** PROJECT FLIGHT  
**Fecha de consolidación:** 2026-09-17  
**Formato:** Markdown canónico de repositorio  
**Unidad espacial:** 1 unidad de mundo = 1 metro  
**Ámbito:** Todo el mundo físico exterior al avión y su interacción con vuelo, navegación, aeródromos, progresión, clima, streaming, render, colisión, audio, VFX, economía y misiones.  
**Compatibilidad requerida:** implementación web/mobile actual basada en TypeScript + Three.js y modelos de datos existentes de `AirfieldDefinition`, `RouteEdgeDefinition`, `RegionDefinition`, `MissionDefinition` y `Vec3`.  
**Ampliación v3.0:** atlas territorial canónico completo: masas continentales, regiones, ciudades, pueblos, costas, lagos, ríos, archipiélagos, infraestructura, landmarks, corredores aéreos, microzonas y reglas de densidad/identidad.

---

# 0. MASTER EXECUTION PROMPT

Este bloque puede entregarse literalmente a un agente de ingeniería, world design, technical art o implementación.

> Trabaja sobre el repositorio existente de PROJECT FLIGHT. Implementa el sistema de mundo físico descrito por este documento como una evolución incremental y compatible con la arquitectura actual. No reconstruyas el juego desde cero ni sustituyas arbitrariamente contratos ya funcionales. Conserva IDs persistentes existentes de aeródromos, rutas, regiones y saves salvo que exista una migración explícita.
>
> El mundo no es un fondo decorativo. Debe ser un sistema físico, legible y navegable que determine ruta, dificultad, combustible, altitud, oportunidad de aterrizaje de emergencia, meteorología, posición de aeródromos, economía y progresión.
>
> La jerarquía causal obligatoria es:
>
> `macrogeografía → geología → relieve → hidrología → clima local → suelo → bioma → vegetación → uso humano → infraestructura → aeródromos → landmarks → gameplay`.
>
> Cada capa debe consumir información de la anterior. Está prohibido resolver el mundo mediante ruido procedural independiente por sistema.
>
> Implementa primero contratos de datos, queries y debug views. Después genera/autoriza contenido. El renderer nunca debe contener reglas de aeródromo, misión o progresión hard-coded. El motor de terreno debe ser determinista por `worldSeed + generatorVersion + regionId`.
>
> Optimiza específicamente para navegador móvil: presupuestos de memoria, draw calls, shader cost, instancing, LOD/HLOD, culling, streaming anticipado por velocidad/rumbo, collision LOD y floating origin deben formar parte del sistema desde el inicio.
>
> Cada fase debe cerrar con tests automatizados, profiling, capturas de validación y criterios de aceptación. No marques una fase como terminada si sólo existe visualmente pero no alimenta gameplay o si sólo funciona en una ruta concreta.

---

# 1. PROPÓSITO DEL SISTEMA

El mundo físico de PROJECT FLIGHT debe producir una sensación concreta:

> El jugador comienza volando sobre una cuenca rural relativamente segura, aprende a orientarse leyendo caminos, campos, arroyos y colinas; después el terreno se vuelve progresivamente menos permisivo, lo obliga a ganar altura, elegir pasos, respetar valles, alcanzar la costa, enfrentarse al océano y finalmente cruzar hacia islas y nuevas regiones.

La geografía debe explicar la progresión del juego.

No se diseñan “niveles” separados. Se diseña un territorio continuo o percibido como continuo en el que:

- cada destino tiene una ubicación física estable;
- cada ruta atraviesa terreno real;
- la topografía afecta consumo y riesgo;
- los aeropuertos tienen sentido geográfico;
- los biomas derivan de condiciones ambientales;
- las carreteras conectan asentamientos;
- los ríos fluyen cuesta abajo;
- los landmarks sirven para navegación visual;
- el espacio disponible para un aterrizaje forzoso cambia según la región;
- la expansión territorial hace que nuevos tipos de avión sean necesarios.

---

# 2. PRINCIPIOS CONSTITUCIONALES

## 2.1 Causalidad antes que decoración

Un elemento existe porque el sistema lo justifica.

Ejemplos correctos:

- árboles más densos en corredores húmedos;
- cultivos en fondo de valle;
- carretera siguiendo una terraza fluvial;
- pueblo junto a cruce de caminos;
- aeródromo en planicie aluvial;
- bosque reducido alrededor de asentamientos;
- roca expuesta en pendiente fuerte;
- humedal en costa baja.

Ejemplos incorrectos:

- colocar “un bosque bonito” sin transición;
- río que cruza una divisoria;
- carretera recta atravesando un acantilado;
- aeropuerto aislado sin acceso ni razón de existir;
- vegetación tropical en una isla sólo porque es isla;
- montaña generada con una misma función de ruido repetida en todas las regiones.

---

## 2.2 Legibilidad aeronáutica

El terreno se diseña para ser leído desde el aire.

Los objetos prioritarios no son los que se ven mejor a 1.7 m del suelo, sino los que crean información visual útil a:

- 50 m AGL;
- 150 m AGL;
- 500 m AGL;
- 1,500 m AGL;
- altitudes de crucero tardías.

La macroforma, el patrón de uso humano, la hidrología y las siluetas deben sobrevivir mucho más lejos que los pequeños props.

---

## 2.3 Continuidad multiescala

El terreno debe ser coherente en seis escalas:

1. **Mundo** — forma general de tierras/mares.
2. **Macroregión** — interior, costa, archipiélago, continente lejano.
3. **Provincia fisiográfica** — cuenca, valle, sierra, altiplano, planicie costera.
4. **Landscape unit** — valle agrícola, foothill, ribera, meseta.
5. **Landform** — terraza, arroyo, mesa, barranco, duna, abanico aluvial.
6. **Microterreno** — baches, surcos, rocas, huellas, cunetas.

La escala menor no puede contradecir la mayor.

---

## 2.4 El terreno es una variable de performance

Terrain design debe modificar, directa o indirectamente:

- distancia efectiva de ruta;
- altura necesaria;
- climb requirement;
- combustible esperado;
- margen de planeo;
- riesgo de aterrizaje forzoso;
- visibilidad del destino;
- turbulencia;
- viento;
- longitud utilizable de aproximación;
- tipo de tren de aterrizaje preferible;
- valor de una aeronave STOL;
- reward/difficulty del contrato.

---

## 2.5 El mundo debe recordar al jugador

El mundo base es estable, pero la progresión modifica permanentemente:

- pista principal;
- hangar;
- plataforma;
- vegetación despejada;
- accesos;
- depósitos;
- instalaciones;
- eventualmente strips restauradas.

La progresión se ve en el paisaje.

---

# 3. ESTADO ACTUAL DEL REPOSITORIO Y CONTRATO DE COMPATIBILIDAD

La implementación actual ya utiliza un grafo de aeródromos data-driven.

IDs persistentes existentes que esta especificación debe conservar:

```text
home_scrubland
dry_field
old_ranch
valley_municipal
coastal_gate
island_outpost
```

Rutas existentes:

```text
home-dry-field
home-old-ranch
dry-field-valley
valley-coast
coast-island
```

Regiones actualmente referenciadas:

```text
meadow_start
quarry_pass
coastal_run
```

La nueva arquitectura NO debe invalidar esos IDs.

---

## 3.1 Migración semántica recomendada

Los IDs actuales pueden mantener compatibilidad mientras su significado se amplía:

| ID actual | Rol objetivo v2 |
|---|---|
| `meadow_start` | Home Basin / transición agrícola |
| `quarry_pass` | Foothills + Valley Municipal corridor |
| `coastal_run` | Coastal Plain + Near Islands gateway |

Nuevas regiones posteriores podrán añadirse con IDs estables:

```text
highland_pass
inner_coast
near_archipelago
volcanic_chain
foreign_mainland
```

No renombrar `meadow_start` sólo porque el nombre ya no describa todo su contenido. La compatibilidad del save tiene más valor que una limpieza nominal.

---

# 4. ARQUITECTURA MAESTRA DEL MUNDO

```text
WorldDefinition
├── WorldCoordinateSystem
├── MacroLandmass[]
├── PhysiographicProvince[]
├── RegionDefinition[]
│   ├── ClimateProfile
│   ├── GeologyProfile
│   ├── HydrologyProfile
│   ├── BiomePalette
│   ├── LandUseProfile
│   └── StreamingProfile
├── TerrainSector[]
│   └── TerrainTile[]
├── WaterBody[]
├── RoadGraph
├── SettlementGraph
├── LandmarkRegistry
├── AirfieldRegistry
└── RouteGraph
```

Gameplay no debe preguntar directamente a mallas Three.js para conocer el mundo.

Debe existir una capa de datos/queries.

---

# 5. SISTEMAS DE AUTORIDAD

## 5.1 `TerrainQueryService`

Autoridad sobre:

- elevation;
- normal;
- slope;
- surface;
- biome;
- water;
- obstacle;
- emergency landing suitability.

## 5.2 `WorldGraphService`

Autoridad sobre:

- aeródromos;
- rutas;
- regiones;
- landmarks;
- descubrimiento.

## 5.3 `WorldStreamingService`

Autoridad sobre:

- tiles residentes;
- LOD;
- colisión;
- prefetch;
- eviction.

## 5.4 `EnvironmentService`

Autoridad sobre:

- climate profile;
- weather-local modifiers;
- ground wetness;
- visibility;
- wind exposure.

## 5.5 Renderer

El renderer representa datos.

MUST NOT:
- decidir si una región está desbloqueada;
- inventar altura de aeropuerto;
- modificar ruta;
- decidir surface physics;
- contener `if (airfieldId === ...)`.

---

# 6. SISTEMA DE COORDENADAS

## 6.1 Global

`x/z` = plano horizontal global.  
`y` = elevación.

Sea level canónico:

```text
y = 0 m
```

Toda elevación de aeródromo debe terminar coincidiendo con el terreno real.

Actualmente `AirfieldDefinition.worldPosition` y `elevationM` existen por separado; la evolución debe eliminar inconsistencias mediante una regla:

```ts
airfield.worldPosition[1] === terrain.getElevation(worldPositionXZ)
```

o mediante una excepción documentada durante migración.

---

## 6.2 Precisión

Para rutas de decenas/cientos de kilómetros:

- guardar posición global en alta precisión;
- usar posición local para Three.js/física;
- rebase del origen;
- no acumular error de float en el avión.

Modelo conceptual:

```ts
type GlobalPosition = {
  x: number
  y: number
  z: number
}

type LocalOrigin = {
  globalX: number
  globalY: number
  globalZ: number
}
```

---

# 7. FLOATING ORIGIN

## 7.1 Trigger

Rebase cuando el jugador exceda una distancia local configurable.

Target inicial:

```text
2–5 km de desplazamiento local
```

El valor final se define por profiling de física/render.

## 7.2 Elementos que deben sobrevivir sin discontinuidad

- Aircraft rigid body.
- Camera.
- Wind particles.
- Clouds if local.
- Contrails.
- Mission markers.
- Ground VFX.
- Audio emitters.
- AI traffic.
- Landing zones.
- Terrain collision.
- Route visualization.

No debe existir salto visible ni impulso físico.

---

# 8. FORMA GENERAL DEL MUNDO

## 8.1 Geografía recomendada

Una masa continental inicial con:

- cuenca interior;
- valle agrícola;
- cordón de foothills;
- sierra/highlands;
- planicie costera;
- océano;
- archipiélago;
- segunda masa continental lejana.

La campaña espacial queda:

```text
HOME BASIN
   ↓
AGRICULTURAL VALLEY
   ↓
FOOTHILLS
   ↓
HIGHLAND PASS
   ↓
COAST
   ↓
NEAR ISLANDS
   ↓
VOLCANIC CHAIN
   ↓
FOREIGN MAINLAND
```

La progresión puede ramificarse, pero el aumento de severidad geográfica se conserva.

---

# 9. ESCALA DEL MUNDO

No usar escala terrestre 1:1.

La relación correcta es:

> Distancias suficientemente largas para que el alcance importe, pero suficientemente comprimidas para que el jugador no pase minutos sin decisiones.

El código actual ya coloca:

- `dry_field` ~3.8 km de ruta;
- `old_ranch` ~7.6 km;
- `valley_municipal` ~11.3 km desde Dry Field;
- `coastal_gate` ~17.5 km desde Valley;
- `island_outpost` ~20.6 km desde Coast.

Estos valores son válidos para un vertical slice.

El mundo definitivo puede multiplicar distancias con aircraft speed progression, pero debe preservar el concepto de frontera incremental.

---

# 10. FISIOGRAFÍA

Cada región recibe una firma fisiográfica.

```ts
type PhysiographyProfile = {
  reliefClass:
    | 'flat'
    | 'rolling'
    | 'broken'
    | 'mountainous'
  dominantLandforms: string[]
  minElevationM: number
  maxElevationM: number
  meanSlopeDeg: number
  maxCommonSlopeDeg: number
  drainageDensity: number
  exposedRockProbability: number
}
```

---

# 11. GEOLOGÍA FUNCIONAL

No simular tectónica en runtime.

Sí definir provincias porque condicionan:

- silueta;
- color de roca;
- pendiente;
- drenaje;
- suelo;
- biomas;
- material de pistas;
- landmarks.

Provincias recomendadas:

### G-01 Sedimentary Interior Basin
- planicies;
- capas;
- arroyos;
- mesas pequeñas;
- suelo polvo/arcilla/grava.

### G-02 Eroded Foothill Belt
- ridges;
- quebradas;
- roca expuesta;
- abanicos aluviales.

### G-03 Highland Core
- relieve fuerte;
- roca competente;
- valles estrechos.

### G-04 Coastal Depositional Plain
- sedimentos;
- humedales;
- dunas;
- estuario.

### G-05 Volcanic Island Arc
- conos;
- calderas;
- lava;
- valles radiales;
- cliffs.

### G-06 Foreign Mainland Mixed Province
- combinación distinta para evitar repetición.

---

# 12. GRAMÁTICA DE EDAD GEOMORFOLÓGICA

## Terreno antiguo
- perfiles redondeados;
- valle ancho;
- suelo profundo;
- vegetación más continua.

## Terreno joven
- crestas agudas;
- relieve alto;
- debris fan;
- rock exposure;
- valle estrecho.

## Terreno volcánico joven
- superficies ásperas;
- lava;
- drenaje radial;
- poca tierra.

## Terreno sedimentario
- estratos;
- mesas;
- escarpes;
- badlands locales.

Esto debe sentirse en silueta aun sin texturas.

---

# 13. FRECUENCIAS TOPOGRÁFICAS

El heightfield final es una composición de bandas.

| Banda | Escala típica | Responsabilidad |
|---|---:|---|
| F0 | 30–150 km | masa terrestre, sierra, cuenca |
| F1 | 5–30 km | valle, ridge, plateau |
| F2 | 0.5–5 km | colina, spur, terraza |
| F3 | 20–500 m | ravine, gully, dune |
| F4 | 0.1–20 m | bache, surco, roca, ditch |

Nunca permitir que F4 altere el perfil aerodinámico del mundo a distancia.

---

# 14. PIPELINE DE HEIGHTFIELD

Orden obligatorio:

```text
LAND/OCEAN MASK
→ GEOLOGICAL PROVINCES
→ MACRO ELEVATION
→ MOUNTAIN / BASIN SHAPING
→ REGIONAL RELIEF
→ HYDROLOGY PREPASS
→ EROSION
→ RIVER INCISION
→ DEPOSITION
→ COAST REFINEMENT
→ LOCAL LANDFORMS
→ DESIGNER OVERRIDES
→ AIRFIELD PROTECTION
→ MICRODETAIL
→ MATERIAL MASKS
→ BIOME MASKS
→ LAND USE
```

Razón: un río no debe generarse después de colocar una ciudad sin saber por dónde fluye.

---

# 15. MODELO DE EROSIÓN

No se requiere una simulación hidráulica científicamente completa.

Se requieren outputs plausibles:

- drainage grooves;
- convex ridge tops;
- concave valleys;
- sediment at low gradient;
- talus below cliffs;
- exposed rock on high slope;
- alluvial fans.

Se puede precomputar offline o generar determinísticamente al cargar contenido.

---

# 16. MAPAS DERIVADOS

Por tile/región:

```text
HEIGHT
NORMAL
SLOPE
ASPECT
CURVATURE
FLOW_DIRECTION
FLOW_ACCUMULATION
WATERSHED
WETNESS
DISTANCE_TO_WATER
SOIL
ROCK_EXPOSURE
BIOME_WEIGHTS
LAND_USE
SURFACE_PHYSICS
EMERGENCY_LANDING
```

MUST ser inspectables con debug modes.

---

# 17. SLOPE CLASSES

| Clase | Pendiente | Uso |
|---|---:|---|
| S0 | 0–2° | runway, floodplain, large fields |
| S1 | 2–5° | agriculture, town |
| S2 | 5–15° | rolling landscape |
| S3 | 15–30° | hills, woodland |
| S4 | 30–45° | rock + sparse vegetation |
| S5 | >45° | cliff / severe hazard |

Los thresholds son tuning inicial.

---

# 18. CURVATURA

`convex`:
- ridge;
- thinner soil;
- drier;
- wind exposed.

`concave`:
- drainage;
- wetter;
- deeper soil;
- vegetation denser.

La vegetación procedural debe leer curvature/moisture.

---

# 19. HIDROLOGÍA

## 19.1 Watershed hierarchy

```text
BASIN
└── SUB_BASIN
    └── CATCHMENT
        └── CHANNEL
```

## 19.2 Flow

Ríos y arroyos deben obedecer descenso.

Test obligatorio:

```text
elevation[next] <= elevation[current] + tolerance
```

cuando el segmento no represente una estructura artificial.

---

# 20. ARROYOS Y CAUCES EFÍMEROS

Muy importantes para Home Basin.

Características:

- normalmente secos;
- lecho claro;
- grava/arena;
- vegetación ligeramente más densa;
- bank erosion;
- puentes/ford.

Gameplay:

- landmark;
- posible aterrizaje engañoso;
- terreno irregular;
- polvo.

---

# 21. RÍOS PERENNES

Valley region.

Deben crear:

- green corridor;
- bridges;
- irrigation;
- settlements;
- agricultural pattern;
- navigational axis.

Desde vuelo bajo, la ribera debe ser más visible que el agua angosta.

---

# 22. RESERVOIR / PRESA

Se recomienda un embalse cerca de transición Home → Valley.

Función:

- landmark de gran saliencia;
- waypoint;
- misión potencial;
- frontera visual.

Necesita:

- flooded-valley silhouette;
- dam at outlet;
- road access;
- downstream water.

---

# 23. LAGOS

Tipos:

- natural;
- crater;
- reservoir;
- seasonal;
- lagoon.

No usar lagos redondos aleatorios.

---

# 24. HUMEDALES

Sólo donde geografía lo permite:

- low coastal;
- estuary;
- river floodplain.

Visual:
- shallow channels;
- reed mass;
- dark wet ground.

Gameplay:
- parece plano;
- es pésimo para forced landing.

---

# 25. COSTAS

Coastline = macro + meso + micro.

## Macro
- bay;
- cape;
- peninsula;
- strait.

## Meso
- beach;
- cliff;
- estuary;
- lagoon.

## Micro
- wet sand;
- foam;
- rocks;
- dune edge.

Evitar la costa procedural ondulada uniformemente.

---

# 26. OCÉANO

Debe resolver:

- horizonte estable;
- lectura de escala;
- wave direction;
- foam near shore;
- distant color;
- cloud shadow;
- reflection control.

No se necesita simulación oceánica pesada.

El principal reto jugable sobre agua es la pérdida de referencias de altura.

---

# 27. ISLAS

Una isla importante debe poseer:

- silueta aérea memorable;
- watershed;
- costa no uniforme;
- topografía interior;
- settlement logic;
- airfield opportunity;
- wind identity.

Tipos:

- low sandy;
- eroded volcanic;
- high volcanic;
- limestone;
- agricultural inhabited;
- rugged dry.

---

# 28. VOLCANIC ISLAND MODEL

Capas:

```text
central edifice
→ radial ridges
→ incised valleys
→ old vegetated surfaces
→ young lava surface
→ coastal terrace
→ cliffs / pocket beaches
```

Aeródromos se ubican donde exista:

- lava plateau graded;
- coastal terrace;
- narrow valley flat.

Esto genera approach difficulty orgánico.

---

# 29. CLIMA BASE

Cada región define:

```ts
type ClimateProfile = {
  meanTempC: number
  seasonalAmplitudeC: number
  annualMoisture: number
  moistureSeasonality: number
  oceanInfluence: number
  prevailingWindDeg: number
  prevailingWindMs: number
  cloudiness: number
}
```

El clima no necesita ser climatología planetaria exacta.

Debe ser internamente consistente.

---

# 30. OROGRAFÍA Y CLIMA

Windward mountains:
- wetter;
- greener;
- cloudier.

Leeward:
- dry;
- scrub;
- dustier.

Esta regla puede producir una transición visual fuerte y lógica.

---

# 31. MICROCLIMAS

Crear modifiers por:

- valley;
- ridge;
- coast;
- wetland;
- urban heat visual only if useful.

Ejemplos:

```ts
type MicroClimateVolume = {
  id: string
  bounds: Volume
  windMultiplier: number
  gustMultiplier: number
  fogBias: number
  humidityBias: number
}
```

---

# 32. WIND EXPOSURE

Precompute/derive field:

```text
0 = sheltered
1 = fully exposed
```

Usos:

- gust intensity;
- tree animation;
- dust;
- crosswind difficulty;
- sound.

Ridge > valley.

Coast > inland sheltered.

---

# 33. TERRAIN-INDUCED TURBULENCE

Simplificación:

- leeward ridge zone;
- canyon/valley funnel;
- abrupt cliff;
- building wake near airport.

No intentar CFD.

Un vector/noise field con magnitud basada en terrain + wind es suficiente.

---

# 34. FOG GEOGRÁFICO

Fog profiles:

- valley morning;
- coast;
- wetland.

Fog must occupy plausible zones.

No usar fog global como solución para ocultar pop-in.

---

# 35. PRECIPITATION → GROUND STATE

Rain updates:

- wetness;
- dust suppression;
- mud risk;
- braking;
- puddle mask;
- soil color.

`groundSaturation` debe evolucionar con lag.

No todo se seca instantáneamente cuando deja de llover.

---

# 36. BIOME DEFINITION

Biome = función de:

```text
temperature
+ moisture
+ elevation
+ slope
+ aspect
+ soil
+ disturbance
+ human land use
```

No usar:

```ts
if (height > 1000) forest
```

como única regla.

---

# 37. BIOME BLEND DATA

```ts
export interface BiomeWeights {
  [biomeId: string]: number
}
```

Invariante:

```text
sum(weights) ≈ 1.0
```

El terrain shader puede consumir 2–4 pesos principales por tile/pixel.

---

# 38. CATÁLOGO DE BIOMAS CORE

IDs propuestos:

```text
semi_arid_scrub
dry_grassland
temperate_grassland
agricultural_mosaic
riparian_corridor
dry_woodland
temperate_woodland
dense_forest
montane_forest
highland_scrub
rocky_mountain
badlands
xeric_plain
wetland
coastal_dune
coastal_scrub
subtropical_dry_woodland
subtropical_moist_forest
volcanic_barrens
urban_periurban
```

---

# 39. `semi_arid_scrub`

### World role
Starting identity.

### Ground
- tan;
- ochre;
- gray gravel.

### Vegetation
- shrubs;
- dry grass;
- sparse small tree.

### Visibility
Excellent.

### Emergency landing
Moderate/high in flat areas.

### Hazards
- rocks;
- arroyos;
- fences;
- dust.

### Human layer
- ranch;
- dirt road;
- water tank;
- field boundaries.

---

# 40. `dry_grassland`

### Terrain
Flat/rolling.

### Seasonal states
- green;
- straw;
- patchy transition.

### Gameplay
Good emergency landing.

### Visual value
Shows wind.

---

# 41. `agricultural_mosaic`

Subclasses:

```text
crop_field
fallow
pasture
orchard
irrigated
dryland
```

Field shape must respond to:

- road;
- parcel;
- slope;
- water.

No global checkerboard.

---

# 42. `riparian_corridor`

Narrow but visually salient.

Rules:

- follows drainage;
- higher moisture;
- darker soil;
- denser tree/grass;
- visible from altitude.

Use as navigation line.

---

# 43. `dry_woodland`

Sparse canopy.

Ground visible.

Good transition from basin to foothills.

Forced landing risk increases.

---

# 44. `temperate_woodland`

- clusters;
- clearings;
- irregular edge;
- road cuts.

Avoid endless uniform tree carpet.

---

# 45. `dense_forest`

Use where terrain difficulty should increase.

Must include:

- canopy variation;
- gaps;
- river cuts;
- logging/road only if region justifies.

Rendering cost is high: use HLOD.

---

# 46. `montane_forest`

Altitude-banded.

Cloud/mist compatible.

Approach obstacles significant.

---

# 47. `highland_scrub`

Above dense tree zone or exposed plateau.

- low vegetation;
- grass;
- rock.

Good visual transition to severe terrain.

---

# 48. `rocky_mountain`

Slope/material-dominant.

Very poor forced landing.

Primary gameplay:
- terrain clearance;
- route/pass selection.

---

# 49. `badlands`

- incised gullies;
- stratified sediment;
- sparse cover.

Use as landmark/route hazard, not entire world.

---

# 50. `xeric_plain`

Possible:
- gravel plain;
- rocky desert;
- salt basin;
- sparse dunes.

Avoid generic Sahara cliché.

---

# 51. `wetland`

- reeds;
- shallow water;
- mud;
- channels.

Flat ≠ safe.

Emergency landing suitability low.

---

# 52. `coastal_dune`

- beach;
- wet sand;
- foredune;
- blowout;
- scrub.

Dune orientation reads prevailing wind.

---

# 53. `coastal_scrub`

Transition coast → interior.

Low vegetation;
wind exposed;
salty/faded palette.

---

# 54. `subtropical_dry_woodland`

Near islands / distant mainland.

Stronger green but seasonal.

Do not blanket with palms.

---

# 55. `subtropical_moist_forest`

Windward volcanic island / wet region.

Dense canopy;
watercourses;
cloud interaction.

---

# 56. `volcanic_barrens`

- black/dark lava;
- ash;
- sparse pioneer plants.

High visual contrast.

Ground hazard very high for wheels.

---

# 57. `urban_periurban`

Not a natural biome but useful render/land-use classification.

Contains:
- lots;
- road;
- buildings;
- industrial margins;
- sparse planted vegetation.

---

# 58. BIOME TRANSITIONS

Natural transition widths:

```text
regional climate shift: 500 m–5 km
soil/drainage edge: 20–500 m
human field boundary: 0–10 m
road/firebreak: abrupt
shoreline: meters–tens of meters
```

No hard natural seams.

---

# 59. VEGETATION ARCHITECTURE

```text
CANOPY
SECONDARY_TREES
SHRUB
GRASS
GROUND_COVER
MICRO_DEBRIS
```

Cada layer posee:

- density;
- size distribution;
- clustering;
- exclusion;
- LOD.

---

# 60. VEGETATION PLACEMENT FUNCTION

Conceptual:

```ts
density =
  biomeDensity
  * moistureResponse
  * slopeResponse
  * elevationResponse
  * disturbanceResponse
  * landUseResponse
  * randomField
```

`randomField` nunca domina la causalidad.

---

# 61. TREE CLUSTERING

Preferir clustered blue-noise / Poisson variants.

Evitar:
- lattice;
- uniform density;
- identical rotation/scale.

Randomness constrained:

```text
scale variation ±15–30%
yaw random
species mix by biome
```

---

# 62. VEGETATION HEIGHT AND GAMEPLAY

| Class | Height | Collision |
|---|---:|---|
| grass | <0.5 m | none |
| shrub | 0.5–3 m | soft/no |
| low tree | 3–8 m | hazard |
| medium | 8–18 m | obstacle |
| tall | 18–30+ m | major obstacle |

Airfield obstacle analysis must use vegetation height.

---

# 63. GRASS SYSTEM

Near-ground only.

Functions:
- speed cue;
- wind cue;
- propwash response;
- runway edge definition.

Far view:
- terrain texture/material.

No necesidad de millones de blades a distancia.

---

# 64. SOIL CATALOG

```text
dry_silt
sandy
clay
gravelly
fertile_loam
volcanic_soil
wet_mud
compacted_earth
salt_crust
```

Cada uno define:
- color;
- roughness;
- wetness response;
- rolling resistance;
- sink risk;
- dust;
- mud.

---

# 65. GROUND SURFACE PHYSICS

Extender la arquitectura actual de `RunwaySurface`.

Nueva interfaz recomendada:

```ts
export interface GroundSurfaceDefinition {
  id: string
  rollingResistance: number
  brakingGripDry: number
  brakingGripWet: number
  sinkRisk: number
  bumpiness: number
  tireDamageRisk: number
  dustFactor: number
  mudFactor: number
  vfxProfileId: string
  audioProfileId: string
}
```

`RunwaySurface` sigue existiendo como categoría de contenido; la física consulta un registry.

---

# 66. RUNWAY MATERIAL MAPPING

Compatibilidad:

```text
dirt    -> compacted_earth / dry_silt profile
grass   -> turf profile
gravel  -> gravel runway profile
asphalt -> asphalt profile
paved   -> generic paved profile
```

No romper `RunwaySurface` actual.

---

# 67. ROCK SYSTEM

Cada geology profile define:

- hue;
- fracture;
- strata;
- blockiness;
- weathering.

Rock set no puede ser global idéntico.

---

# 68. CLIFFS

Necesitan:

- slope-based mesh/shader;
- triplanar mapping;
- ledges;
- talus;
- vegetation pockets.

Vertical UV stretching = bug.

---

# 69. TALUS / SCREE

Generar debajo de cliff/steep rock.

Visual:
- material blend;
- medium boulders;
- slope continuation.

Gameplay:
- unsafe landing.

---

# 70. MICROTOPOGRAPHY

Sólo colisión detallada donde importa:

- runways;
- taxi areas;
- fields usable for emergency;
- home hub.

Tipos:
- rut;
- mound;
- furrow;
- washboard;
- ditch;
- rock;
- shallow erosion.

Cruise altitude no necesita esta geometría residente.

---

# 71. HOME RUNWAY ROUGHNESS

`home_scrubland` debe ser intencionalmente malo.

Target inicial:
- 180 m actual;
- 14 m width;
- dirt;
- roughness actual 0.65.

Visual/physics details:
- 2–3 longitudinal ruts;
- irregular crown;
- stones;
- patchy grass edge;
- slight drainage depression;
- compacted wheel tracks.

Roughness no debe sentirse como ruido vibrando cada frame; debe provenir de un perfil espacial determinista.

---

# 72. AIRFIELD TERRAIN OVERRIDE

Todo aeródromo crea una capa `AirportTerrainOverride`.

```ts
type AirportTerrainOverride = {
  airfieldId: string
  gradingPolygon: Polygon
  runwayProfiles: RunwayTerrainProfile[]
  vegetationExclusion: Polygon[]
  obstaclePreservation: ObstacleRef[]
  drainageFeatures: DrainageFeature[]
}
```

Procedural generator MUST respetarla.

---

# 73. RUNWAY VERTICAL PROFILE

No asumir slopePct = 0 para siempre.

Representar:
- threshold elevation A;
- threshold elevation B;
- crown;
- local irregularity.

UI puede seguir mostrando slope promedio.

---

# 74. AIRFIELD PLACEMENT

Criterios:

```text
topographic fit
+ runway length opportunity
+ approach clearance
+ prevailing wind
+ drainage
+ settlement/economic reason
+ gameplay role
```

Los strips malos pueden violar uno de esos criterios deliberadamente, no todos por accidente.

---

# 75. AIRFIELD ARCHETYPES

```text
farm_strip
ranch_strip
valley_municipal
plateau_strip
mountain_valley_strip
coastal_strip
island_strip
regional_airport
remote_utility
```

Cada uno requiere terrain context distinto.

---

# 76. APPROACH CORRIDOR DATA

Extender `RunwayDefinition` idealmente con:

```ts
approach?: {
  primaryEnd: 'A' | 'B'
  corridorLengthM: number
  obstacleScanWidthM: number
  preferredDirection?: boolean
}
```

El terrain validator calcula:
- highest obstacle;
- terrain rise;
- approach difficulty.

---

# 77. EMERGENCY LANDING SUITABILITY

Mapa interno `0..1`.

Inputs:

```text
flatness
surface firmness
vegetation
water
field dimensions
obstacle density
urban density
fence/powerline risk
```

Ejemplo:

```ts
suitability =
  flatnessScore
  * surfaceScore
  * clearanceScore
  * sizeScore
```

No exponerlo al jugador al inicio.

---

# 78. AGRICULTURAL FIELD AS LANDING SITE

Cada parcel define:

```ts
type FieldParcel = {
  cropType: string
  cropHeightM: number
  furrowHeadingDeg: number
  soilSurfaceId: string
  fenceRisk: number
  usableLengthM: number
}
```

Un campo arado transversal puede ser peligroso aunque sea plano.

---

# 79. ROADS

Jerarquía:

```text
highway
regional_paved
local_paved
gravel
dirt
farm_track
```

Routing cost:
- slope penalty;
- bridge cost;
- cliff prohibition;
- settlement connection reward.

---

# 80. ROAD VISIBILITY FROM AIR

Los caminos son navegación.

A 500 m AGL:
- highway debe leerse;
- secondary road puede leerse;
- dirt track sólo bajo buena luz.

Material/width/vegetation edges deben contribuir.

---

# 81. BRIDGES

Bridge sólo si road/rail cruza agua.

Bridge becomes:
- landmark;
- waypoint;
- scale cue.

No usar bridges como props decorativos sin red.

---

# 82. POWER LINES

Necesarias cerca de mundo rural pero peligrosas.

Data model:
- corridor;
- pole/tower points;
- wire height.

Rendering:
- wires only near enough;
- poles/towers far.

Collision/hazard may stay active independently.

---

# 83. SETTLEMENT GRAPH

Niveles:

```text
isolated_farm
hamlet
village
small_town
regional_town
city
industrial_port
```

Settlement placement score:

```text
road_access
+ water_access
+ slope suitability
+ economic anchor
+ historical bias
```

---

# 84. SETTLEMENT MORPHOLOGY

Home Basin:
- dispersed;
- ranch/farm;
- loose village.

Valley:
- linear along river/road;
- denser.

Coast:
- port/road;
- periurban.

Foreign mainland:
- new grammar.

---

# 85. BUILDING LOD

Near:
- individual geometry.

Mid:
- simplified blocks.

Far:
- merged HLOD.

Extreme:
- urban color/roughness mass.

No renderizar ventanas individuales a kilómetros.

---

# 86. RURAL ASSET KIT

Minimum:

```text
farmhouse_A/B
shed_A/B/C
barn_A/B
water_tank
silo
small_workshop
fence_post
gate
tractor_proxy
greenhouse_optional
utility_pole
```

Variation:
- roof;
- material;
- wear;
- layout.

---

# 87. AGRICULTURAL PARCEL GENERATION

Pipeline:

```text
land-use mask
→ road/water constraints
→ large parcels
→ subdivision
→ crop assignment
→ field road
→ fence/hedge
```

Fields should not all have same orientation.

---

# 88. ORCHARDS

Deliberate regularity is correct.

Rows:
- align with parcel;
- respond to slope;
- access aisle.

From altitude they become strong navigation pattern.

---

# 89. LANDMARK REGISTRY

```ts
export interface LandmarkDefinition {
  id: string
  regionId: string
  type: LandmarkType
  worldPosition: Vec3
  recognitionRadiusM: number
  silhouetteScore: number
  contrastScore: number
  uniquenessScore: number
  navigationPriority: number
  discoveredByDefault: boolean
}
```

---

# 90. NATURAL LANDMARKS

Candidate:
- reservoir;
- mesa;
- distinct ridge;
- gorge;
- crater;
- cape;
- island silhouette;
- mountain peak.

---

# 91. BUILT LANDMARKS

Candidate:
- dam;
- radio tower;
- quarry;
- bridge;
- silo;
- port;
- water tower;
- industrial plant.

---

# 92. LANDMARK SALIENCE

Score:

```text
salience =
0.35 silhouette
+ 0.25 contrast
+ 0.20 uniqueness
+ 0.20 route relevance
```

No hace falta exponer el número; sirve para diseño.

---

# 93. ROUTE COMPOSITION

Cada pioneer route debe tener dramaturgia espacial.

Template:

```text
departure anchor
→ orientation cue
→ mid-route confirmation
→ challenge terrain
→ destination reveal
→ approach cue
```

---

# 94. ROUTE: `home-dry-field`

Objetivo:
- tutorial navigation.

Terrain:
- semi-flat scrub;
- fields;
- dirt road.

Landmarks:
- water tank;
- road Y;
- field boundary.

Emergency landing:
high.

---

# 95. ROUTE: `home-old-ranch`

Objetivo:
- range + rough strip.

Terrain:
- slightly rolling;
- arroyo crossing;
- sparse agriculture.

Landmarks:
- arroyo;
- ridge;
- barn cluster.

Landing:
grass rough short strip.

---

# 96. ROUTE: `dry-field-valley`

Objetivo:
- transition to regional aviation.

Terrain:
- agriculture increases;
- river appears;
- road corridor.

Landmark:
- reservoir/dam.

Destination:
`valley_municipal`.

---

# 97. ROUTE: `valley-coast`

Objetivo:
- first major geography transition.

Terrain:
- foothills/pass;
- descent;
- coastline reveal.

This route should not remain a simple 17.5 km flat leg.

`terrainPenalty: 1.15` already hints at this; v2 should derive that penalty from route terrain metrics.

---

# 98. ROUTE: `coast-island`

Objetivo:
- first over-water commitment.

Terrain:
- departure coastal plain;
- open water;
- island silhouette.

Emergency landing:
near zero over water.

Navigation:
landmark sparse.

`navigationPenalty: 1.35` should become an output of geographic analysis, not only a manually entered constant.

---

# 99. ROUTE ANALYZER

Implement:

```ts
type RouteTerrainAnalysis = {
  horizontalDistanceM: number
  cumulativeClimbM: number
  maxTerrainElevationM: number
  minSafeAltitudeM: number
  waterFraction: number
  forestFraction: number
  emergencyLandingMean: number
  landmarkDensity: number
  terrainPenalty: number
  navigationPenalty: number
}
```

Initially existing hand-authored penalties remain fallback.

---

# 100. CLIMB COST

Route planner can estimate:

```text
effectiveDistance =
distance
+ climbPenalty
+ windPenalty
+ detourPenalty
```

No reemplaza la física; sirve para preflight.

---

# 101. TERRAIN CLEARANCE

Samplear corredor:

```text
route centerline ± corridor width
```

Obtener:
- max terrain;
- ridge positions;
- pass alternatives.

Preflight puede indicar:
- recommended cruise altitude.

---

# 102. MOUNTAIN PASSES

Un paso debe:
- ser visible;
- reducir elevación de cruce;
- conectar valles;
- servir de ruta alternativa.

Diseño:
- short/high route vs long/low route.

Esto crea decisiones reales.

---

# 103. CANYONS

Uso:
- landmark;
- optional skill route;
- special mission.

No obligar a canyon flying temprano.

---

# 104. PLATEAUS / MESAS

Uso:
- silhouette;
- high-elevation airfield;
- terrain gate.

Deben distinguirse de noise hills.

---

# 105. QUARRY

Muy compatible con `quarry_pass`.

Componentes:
- stepped pit;
- pale exposed rock;
- haul road;
- small industrial structures.

Función:
- landmark central;
- visual identity de foothills.

---

# 106. HOME BASIN — REGION BIBLE

## Geological identity
Sedimentary/alluvial interior basin.

## Elevation target
~550–850 m local slice.

## Terrain
- broad flat;
- low ridge;
- arroyo;
- alluvial fan.

## Biomes
- semi_arid_scrub dominant;
- dry_grassland;
- agriculture;
- riparian tiny.

## Human
- ranches;
- dirt roads;
- village;
- tanks.

## Aviation
- rough strips;
- forgiving emergency surface.

## Weather
- clear;
- gusty afternoon;
- dust.

## Core emotion
“Puedo intentar aterrizar casi en cualquier parte, pero mi avión todavía es terrible.”

---

# 107. AGRICULTURAL VALLEY — REGION BIBLE

## Elevation
slightly lower or similar to basin.

## Landform
- elongated valley;
- river;
- terraces.

## Biomes
- agricultural;
- riparian;
- grass;
- woodland patches.

## Human
- villages;
- paved roads;
- irrigation.

## Aviation
- first serviced airport.

## Emotion
“El mundo empieza a sentirse conectado y civilizado.”

---

# 108. FOOTHILLS / QUARRY PASS — REGION BIBLE

## Relief
broken.

## Geology
exposed sedimentary/igneous mix.

## Features
- quarry;
- ridges;
- ravines;
- pass.

## Emergency landing
reduced.

## Weather
gustier near ridge.

## Emotion
“Ya no basta con apuntar al destino; debo leer el terreno.”

---

# 109. HIGHLAND PASS — REGION BIBLE

Future.

- high plateau;
- steep ridge;
- cloud;
- montane vegetation;
- valley strips.

Primary gate:
aircraft climb performance.

---

# 110. COASTAL RUN — REGION BIBLE

Debe ampliar `coastal_run`.

## Terrain
- foothill descent;
- plain;
- estuary;
- dunes/cliffs.

## Human
- town;
- port;
- highway.

## Aviation
`coastal_gate`.

## Wind
sea-breeze/crosswind profile.

## Emotion
“Por primera vez veo una frontera que mi avión no puede tratar como tierra firme.”

---

# 111. NEAR ARCHIPELAGO — REGION BIBLE

First islands.

- dry/subtropical;
- short strips;
- cliffs/beaches;
- few alternates.

Unlock:
range + navigation.

---

# 112. VOLCANIC CHAIN — REGION BIBLE

Late mid-game.

- dramatic volcano;
- windward forest;
- leeward dry slope;
- lava;
- cloud.

Airport:
coastal terrace or plateau.

---

# 113. FOREIGN MAINLAND — REGION BIBLE

Must feel culturally/environmentally different without becoming a caricature.

Difference through:
- roads;
- parcel geometry;
- building materials;
- vegetation;
- airport style;
- settlement density.

---

# 114. FIRST OCEAN REVEAL

Debe ser authored hero moment.

Sequence:

1. climb through foothills;
2. terrain opens;
3. atmospheric haze clears;
4. coastline appears;
5. horizon sea;
6. distant island silhouette optionally visible.

No popup debe robar el momento inmediatamente.

---

# 115. FIRST ISLAND TEASE

Debe ser visible antes de ser cómoda de alcanzar.

Under clear conditions:
- silhouette on horizon.

Map may show:
- rumored/unknown.

Esto conecta terrain vista + aspirational progression.

---

# 116. MAP AND WORLD CONSISTENCY

Map must derive from world truth.

If road moves:
map updates/bake updates.

If reservoir shape changes:
map matches.

If airfield elevation changes:
map/flight data match.

No duplicate hand-authored map geography independent from terrain.

---

# 117. MAP LAYERS

```text
base relief
water
roads
settlements
landmarks
airfields
route
weather overlay
discovery mask
```

Early navigation may hide some layers.

---

# 118. CONTOUR GENERATION

Contours from actual heightfield.

Scale by zoom.

Example:
- local: 10–20 m interval;
- regional: 50 m;
- world: 100–250 m.

Values depend on vertical scale.

---

# 119. DISCOVERY

Landscape can be physically present before its label.

States:
- unknown;
- rumored;
- discovered;
- visited;
- mastered.

Current `AirfieldDiscoveryState` already supports this exact progression.

World spec should mirror it for landmarks/regions as needed.

---

# 120. LANDMARK DISCOVERY

Rule:
- distance;
- line of sight;
- visibility;
- recognition radius.

A discovered landmark becomes available on map.

---

# 121. TERRAIN DISCOVERY / MAP REVEAL

Prefer physiographic chunks:

- valley;
- basin;
- coastline sector;
- island.

Avoid perfect circular fog bubbles when possible.

---

# 122. ENVIRONMENT STATE

```ts
export interface EnvironmentRuntimeState {
  wetness: number
  groundSaturation: number
  drought: number
  visibilityM: number
  cloudShadowStrength: number
  riverStage: number
}
```

Not all fields need MVP implementation, but reserve architecture.

---

# 123. WETNESS SHADER RESPONSE

Wet:
- darker albedo;
- lower roughness selectively;
- reduced dust.

MUST NOT:
- turn soil into mirror;
- apply same response to grass and asphalt.

---

# 124. DUST SYSTEM

Emission sources:
- wheels;
- propwash;
- wind gust;
- crash impact.

Inputs:
- surface dust factor;
- dryness;
- speed;
- prop power.

---

# 125. PROPWASH

Near-ground effect:

```text
power ↑
distance ↓
surface loose ↑
→ dust/grass response ↑
```

Should visually reinforce engine upgrades.

---

# 126. WHEEL VFX

Surface-specific:

| Surface | Effect |
|---|---|
| dirt | dust |
| wet dirt | mud |
| gravel | light gravel particles |
| grass | grass compression |
| asphalt | tire/skid |

Use pooled emitters.

---

# 127. GROUND AUDIO

Surface registry maps:
- roll loop;
- impact;
- skid;
- gravel hit.

Aircraft touchdown should sound different by runway.

---

# 128. WATER INTERACTION

Need functional surface for ditching.

Systems:
- water level;
- water contact;
- splash;
- drag;
- sink/float result.

Do not rely only on shader.

---

# 129. SEASONAL ARCHITECTURE

Even if v1 ships one season, biome definitions support:

```ts
seasonalVariants?: {
  wet?: ...
  dry?: ...
  cold?: ...
}
```

Do not bake irreversible “summer only” assumptions.

---

# 130. DAY/NIGHT WORLD

Night:
- rural darkness;
- sparse road lights;
- settlement clusters;
- airport lights by class.

No universal illumination carpet.

Terrain mainly silhouette.

---

# 131. LIGHTING VALIDATION

Test:
- dawn;
- noon;
- sunset;
- overcast.

Destination runway must remain readable through material/value design.

---

# 132. ATMOSPHERIC PERSPECTIVE

Distance response:
- reduced contrast;
- desaturation;
- haze.

Important:
major silhouette remains readable.

No fog curtain hiding terrain LOD.

---

# 133. CLOUD SHADOW

Broad low-frequency projection.

Benefits:
- scale;
- sky-ground integration.

Performance:
- simple;
- no expensive per-cloud volumetric ground shadow for MVP.

---

# 134. WORLD AUDIO

Altitude-dependent mix.

Ground:
- insects;
- wind;
- livestock;
- surf;
- road.

Air:
- aircraft dominates;
- environment fades.

Use biome/region snapshots.

---

# 135. WILDLIFE

Minimal systemic layer.

Possible:
- birds;
- livestock.

Birds:
- ambient first;
- hazard later if justified.

No ecosystem simulation required.

---

# 136. LIVESTOCK

Ranch region:
- small herds;
- field confinement.

From air:
- moving dots/scale cues.

Near runway:
must not create random unavoidable collision early.

---

# 137. ENVIRONMENTAL STORYTELLING

Examples:
- abandoned old strip;
- repaired bridge;
- washout;
- quarry expansion;
- old irrigation canal;
- derelict shed;
- storm-damaged tree band.

Purpose:
world history + landmark identity.

---

# 138. WORLD CHRONOLOGY

Persistent modifications categories:

```text
PLAYER_BASE
MISSION_RESTORATION
MAJOR_WORLD_EVENT
COSMETIC_TRANSIENT
```

Only first three save persistently.

---

# 139. RENDER TERRAIN ARCHITECTURE

Recommended layers:

```text
TerrainGeometry
TerrainMaterial
TerrainTileRuntime
TerrainCollision
TerrainDecoration
TerrainHLOD
```

No giant monolithic world mesh.

---

# 140. TILE HIERARCHY

```text
Region
└── Sector
    └── Tile
        └── Patch
```

Starting targets for testing:

- sector: 8 km;
- tile: 1 km;
- patch: LOD-driven.

Not final until profiled.

---

# 141. TERRAIN LOD

Must prioritize:
- silhouette stability;
- crack-free seams;
- approach accuracy.

Technique options:
- quadtree;
- clipmap;
- chunked LOD.

Choose based on actual Three.js/mobile benchmark, not theory.

---

# 142. SCREEN-SPACE ERROR

LOD selection should use projected error rather than only distance.

Why:
camera altitude changes dramatically.

---

# 143. TERRAIN SEAMS

Adjacent tiles require:
- same boundary heights;
- matched normals;
- same material blend;
- collision continuity.

Automated seam test mandatory.

---

# 144. RUNWAY LOD EXCEPTION

Runway:
- preserves geometry;
- threshold;
- slope;
- collision

at greater priority than neighboring decorative terrain.

Never simplify runway into unusable bumpy approximation during approach.

---

# 145. HLOD

Settlement:
```text
buildings → blocks → mass proxy
```

Forest:
```text
trees → low-LOD instances → canopy impostor → ground biome tint
```

Airport:
```text
props disappear first, runway/hangar silhouette remain
```

---

# 146. VEGETATION IMPOSTORS

Need:
- hue match;
- density match;
- stable crossfade.

Avoid visible billboard spin.

---

# 147. OBJECT IMPORTANCE

```ts
type WorldObjectImportance =
  | 'critical'
  | 'navigation'
  | 'obstacle'
  | 'context'
  | 'cosmetic'
```

Culling uses category.

---

# 148. CULL RULES

Critical:
never cull inside operational range.

Navigation:
long distance.

Obstacle:
visual/collision enough to avoid invisible hazard.

Cosmetic:
aggressive.

---

# 149. WORLD STREAMING PREDICTOR

Inputs:

```text
position
velocity
heading
altitude
active route
destination
descent likelihood
```

Priority cone extends forward.

At high speed:
prefetch farther.

---

# 150. COLLISION STREAMING

Critical problem:
aircraft can descend rapidly into tile not yet high-detail.

Solution:
- coarse global collision always available;
- fine collision bubble;
- predicted impact corridor prefetch.

---

# 151. STREAMING STATE MACHINE

```text
UNLOADED
→ METADATA
→ FAR_PROXY
→ VISUAL
→ COLLISION
→ FULL
→ DOWNGRADE
→ UNLOADED
```

Active destination minimum:
`VISUAL` long before arrival.

---

# 152. STREAMING FAILURE POLICY

Never show void.

Fallback:
- retain lower LOD;
- retain coarse collision;
- skip cosmetic.

If runway detail unavailable:
- keep safe authored runway fallback;
- log critical error.

---

# 153. MEMORY BUDGET DISCIPLINE

Runtime should track:

```text
terrain geometry MB
terrain textures MB
vegetation MB
building HLOD MB
water MB
audio MB
active sector count
```

Expose debug HUD.

---

# 154. MOBILE RENDER PRIORITIES

1. control latency;
2. physics stability;
3. terrain collision;
4. runway visibility;
5. aircraft;
6. major landmarks;
7. horizon terrain;
8. vegetation mass;
9. props.

A decorative barn never has priority over stable control input.

---

# 155. TERRAIN SHADER

Layer inputs:
- biome;
- slope;
- surface;
- wetness;
- macro variation.

Target:
limited active layers per fragment.

Expensive ecological calculations are precomputed, not done every pixel.

---

# 156. MACRO/MICRO TEXTURE SCALE

Macro:
- 100 m–km variation;
- visible from altitude.

Micro:
- cm–m;
- ground detail.

Do not rely on tiled 2 m texture for aerial view.

---

# 157. TRIPLANAR ROCK

Use on steep terrain.

Potential:
- 1 rock texture family per geology profile;
- macro tint.

---

# 158. TEXTURE COMPRESSION

Select formats supported by target browsers/devices.

Need:
- capability detection;
- fallback.

Terrain content pipeline should not assume desktop-only GPU.

---

# 159. VEGETATION DRAW CALLS

Use instancing.

Species variation via:
- per-instance scale;
- rotation;
- material index/atlas.

Avoid one mesh/material per tree.

---

# 160. SHADOW BUDGET

Highest:
- aircraft;
- near runway obstacles.

Moderate:
- buildings/near trees.

Far vegetation:
- simplified/no realtime individual shadow.

---

# 161. WATER RENDER BUDGET

Ocean:
single efficient system.

River/lake:
shared materials.

Do not use planar reflection per water body.

---

# 162. AUTHORING STACK

Non-destructive:

```text
BASE_MACRO_HEIGHT
GEOLOGY_SHAPE
EROSION
HYDROLOGY
DESIGNER_SCULPT
AIRPORT_OVERRIDE
MATERIALS
BIOMES
LAND_USE
VEGETATION
PROPS
GAMEPLAY
```

Designer edits must survive regeneration of unrelated layers.

---

# 163. DETERMINISM

Generation key:

```text
worldSeed
+ generatorVersion
+ regionId
+ tileCoord
```

Same inputs = same world.

Required for:
- save;
- replay;
- QA;
- bug reproduction.

---

# 164. WORLD VERSIONING

```ts
type WorldBuildVersion = {
  worldSeed: number
  generatorVersion: number
  contentVersion: number
}
```

If generator change materially moves gameplay geometry:
- migration required;
- old save compatibility tested.

---

# 165. PROPOSED FILE LAYOUT

Recommended incremental repo structure:

```text
src/
  world/
    data/
      airfields.ts               # existing, evolve
      regions.ts                 # existing/current content
      landmarks.ts
      geology.ts
      biomes.ts
      surfaces.ts
      worldConfig.ts
    terrain/
      terrainQueryService.ts
      terrainGenerator.ts
      terrainTile.ts
      terrainTileManager.ts
      heightPipeline.ts
      erosion.ts
      hydrology.ts
      terrainMaterials.ts
      terrainCollision.ts
    environment/
      climate.ts
      moisture.ts
      windExposure.ts
      groundState.ts
    vegetation/
      vegetationRegistry.ts
      vegetationScatter.ts
      vegetationLod.ts
    human/
      roadGraph.ts
      parcels.ts
      settlements.ts
      utilities.ts
    navigation/
      landmarks.ts
      routeTerrainAnalyzer.ts
      emergencyLandingMap.ts
    streaming/
      worldStreamingService.ts
      streamingPredictor.ts
      floatingOrigin.ts
      hlod.ts
    debug/
      worldDebugOverlay.ts
      terrainDebugModes.ts
      streamingDebug.ts
```

No es obligatorio copiar exactamente nombres, pero sí separar responsabilidades.

---

# 166. CORE TYPE EXTENSIONS

Mantener los tipos existentes y extenderlos.

```ts
export interface TerrainSample {
  elevationM: number
  normal: Vec3
  slopeDeg: number
  surfaceId: string
  waterDepthM: number
  dominantBiomeId: string
  emergencyLandingSuitability: number
}

export interface TerrainQueryService {
  sample(x: number, z: number): TerrainSample
  getElevation(x: number, z: number): number
  getSurfaceId(x: number, z: number): string
  getWaterDepth(x: number, z: number): number
}
```

---

# 167. EXTENDED REGION TYPE

No borrar `RegionDefinition.environment`.

Agregar opcionalmente:

```ts
terrainProfileId?: string
climateProfileId?: string
biomePaletteId?: string
streamingProfileId?: string
```

Esto permite migración sin romper content actual.

---

# 168. EXTENDED AIRFIELD TYPE

Opcional:

```ts
terrainContext?: {
  archetypeId: string
  airportOverrideId: string
  approachProfileId?: string
}
```

No mover datos existentes hasta que consumidores estén migrados.

---

# 169. SURFACE REGISTRY

```ts
const SURFACES: Record<string, GroundSurfaceDefinition>
```

Renderer, physics, VFX y audio consultan el mismo ID.

Evitar duplicar:

```text
"gravel" physics in sim
"gravel" dust in renderer
"gravel" sound in audio
```

con tres tablas divergentes.

---

# 170. REGION DATA EXAMPLE — `meadow_start`

```ts
{
  id: 'meadow_start',
  terrainProfileId: 'home_basin',
  climateProfileId: 'semi_arid_interior',
  biomePaletteId: 'home_basin_palette',
  streamingProfileId: 'standard_low_density'
}
```

Current environment fields remain valid.

---

# 171. HOME BASIN TERRAIN PROFILE

```yaml
id: home_basin
elevation:
  base_m: 610
  min_m: 560
  max_m: 880
relief: rolling_low
landforms:
  - alluvial_plain
  - low_ridge
  - arroyo
  - alluvial_fan
geology: sedimentary_basin
hydrology: ephemeral
```

---

# 172. `quarry_pass` PROFILE

```yaml
id: quarry_pass_profile
elevation:
  min_m: 520
  max_m: 1350
relief: broken
landforms:
  - ridge
  - ravine
  - quarry
  - mountain_pass
geology: eroded_foothills
hydrology: seasonal_stream
```

---

# 173. `coastal_run` PROFILE

```yaml
id: coastal_run_profile
elevation:
  min_m: 0
  max_m: 650
relief: coast_transition
landforms:
  - coastal_plain
  - estuary
  - dune
  - sea_cliff
  - island
geology: coastal_depositional
hydrology: perennial_to_estuarine
```

---

# 174. `home_scrubland` TERRAIN INTEGRATION

Current:
```text
worldPosition [0,0,0]
elevationM 612
```

Migration:
- global y coordinate becomes terrain elevation 612;
- local renderer may still place strip near y=0 after floating-origin/local vertical transform, but domain data must retain 612 m.

Do not silently treat 0 as sea level for home.

---

# 175. AIRFIELD HEIGHT RECONCILIATION

Current content uses `worldPosition.y = 0` while `elevationM` varies.

Temporary compatibility strategy:

```ts
globalY = airfield.elevationM
localY = terrainLocalHeight
```

Long-term:
normalize `worldPosition` to actual global y only after save/content audit.

---

# 176. WORLD QUERY / PHYSICS CONTRACT

Aircraft ground collision never directly assumes a flat plane.

Physics queries:
- elevation;
- normal;
- surface.

Ground reaction uses actual normal.

---

# 177. RUNWAY COLLISION

Runway collision is:
- terrain-conforming or authored;
- deterministic;
- sufficiently dense for wheel contact.

No generic `PlaneGeometry` once world terrain phase is enabled.

---

# 178. OFF-RUNWAY COLLISION

Coarser but continuous.

Must permit:
- emergency landing;
- crash.

---

# 179. GROUND CONTACT MATERIAL

Aircraft wheel/gear receives:
- normal;
- friction;
- resistance;
- bump input.

Depends on surface registry.

---

# 180. VEGETATION COLLISION POLICY

Trees:
simplified cylinder/capsule + canopy hazard optional.

Shrubs:
soft/no collision.

Grass:
none.

Large airport obstacle trees:
authoritative collision.

---

# 181. BUILDING COLLISION

Simplified volumes.

No triangle soup necessary at high flight speed.

Hero landmarks can use more accurate forms if needed.

---

# 182. ROAD COLLISION

Road can reuse terrain with material override.

Bridges require geometry collision.

---

# 183. OCEAN COLLISION

Water surface query.

Aircraft:
- ditch;
- crash;
- float if future seaplane support.

---

# 184. FUTURE SEAPLANE SUPPORT

Architecture should not prohibit water takeoff.

Reserve:
- water surface physics;
- water runway/operating area;
- float gear category later.

No need to implement now.

---

# 185. TERRAIN AND WEATHER INTEGRATION API

`WeatherService` asks:

```text
region
elevation
wind exposure
coast distance
microclimate
```

Terrain asks Weather:
```text
rain
ground wetness
wind
```

Avoid circular mutation; use runtime environment state.

---

# 186. REGION WEATHER BASE

Keep current `RegionDefinition.environment`.

Future:
climate profile generates default range; mission/weather seed selects actual instance.

---

# 187. GUST VOLUMES

Current `RegionDefinition.windVolumes` is compatible with terrain effects.

Use authored/procedural volumes for:
- ridge;
- pass;
- coast;
- quarry thermal/turbulence.

---

# 188. WIND FIELD BLENDING

Never abrupt.

Blend by:
- distance to volume edge;
- altitude.

Airplane must not receive instantaneous 10 m/s vector discontinuity.

---

# 189. DENSITY ALTITUDE HOOK

Terrain elevation must feed atmospheric/performance model later.

Even if not fully simulated now:
store correct airport elevation.

---

# 190. TERRAIN-BASED MISSION DIFFICULTY

Mission score inputs:

```text
route terrain clearance
water fraction
forced landing scarcity
destination approach
navigation landmark scarcity
surface roughness
```

This produces more meaningful difficulty than distance alone.

---

# 191. TERRAIN-BASED REWARD

Possible multiplier:

```text
reward =
base
* distanceFactor
* terrainRisk
* landingDifficulty
* payload
```

Cap multipliers to prevent exploit.

---

# 192. TERRAIN-BASED AIRCRAFT ROLE

### Ultralight
Home/flat.

### Bush/STOL
Foothill, rough, short.

### Touring
Long paved/coast.

### Utility
Payload remote.

### Advanced
Highland/island/long range.

Terrain prevents linear replacement.

---

# 193. NAVIGATION WITHOUT GPS

Early game uses:
- road;
- river;
- ridge;
- reservoir;
- town.

World must remain playable when HUD destination arrow is reduced.

This is a key quality benchmark.

---

# 194. LANDMARK DENSITY TARGET

Early:
1 strong cue every ~30–60 s flight at expected aircraft speed.

Later:
lower cue density over ocean/mountain intentionally.

Exact values tune with speeds.

---

# 195. DESTINATION REVEAL DISTANCE

For each airfield:

```ts
visualRecognitionDistanceM
```

Influenced by:
- runway contrast;
- buildings;
- terrain;
- lighting;
- navigation tech.

The runway may render earlier than small props.

---

# 196. AIRPORT FAR PROXY

At distance:
- simple runway strip;
- major hangar mass;
- clearing.

No complex props.

Must preserve bearing/recognition.

---

# 197. AIRPORT MID LOD

Add:
- markings;
- windsock;
- buildings;
- major obstacles.

---

# 198. AIRPORT NEAR LOD

Add:
- runway surface details;
- signs;
- props;
- grass;
- small clutter.

---

# 199. HOME AIRFIELD UNIQUE DENSITY

Home receives higher authored detail because visited repeatedly.

Within 500–800 m:
- handcrafted terrain;
- props;
- road;
- ranch context;
- drainage.

---

# 200. WORLD PERFORMANCE MODES

Quality tiers:

### LOW
- reduced tree density;
- shorter shadows;
- aggressive HLOD;
- simple water.

### MEDIUM
balanced.

### HIGH
- longer vegetation range;
- improved shadow;
- denser props.

Critical gameplay geometry identical.

---

# 201. ADAPTIVE QUALITY

Optional:
monitor frame time.

May reduce:
- foliage range;
- shadow range;
- particle count.

Never:
- input update;
- physics tick;
- runway collision.

---

# 202. PERFORMANCE TELEMETRY

Debug/analytics:
- frame CPU;
- frame GPU estimate;
- resident tiles;
- triangles;
- draw calls;
- instances;
- texture memory;
- stream latency;
- dropped tile requests.

---

# 203. WORLD DEBUG MODES

Required keyboard/dev UI modes:

```text
HEIGHT
SLOPE
CURVATURE
FLOW
WATER
MOISTURE
BIOME
SURFACE
LAND_USE
VEGETATION_DENSITY
EMERGENCY_LANDING
LANDMARKS
AIRFIELD_EXCLUSION
LOD
STREAMING
COLLISION
```

---

# 204. DEBUG ROUTE ANALYSIS

Draw:
- route line;
- sample points;
- terrain profile;
- safe altitude;
- water fraction;
- landmarks.

---

# 205. DEBUG TERRAIN PROFILE

For a selected route:
2D elevation chart useful for balancing.

---

# 206. DEBUG TILE VIEW

Display:
- tile ID;
- LOD;
- state;
- memory;
- load time.

---

# 207. DEBUG SURFACE

Color ground by physics surface.

Useful to catch visible/physical mismatch.

---

# 208. AUTHORING TOOLS

Designer operations:
- sculpt;
- smooth;
- flatten;
- terrace;
- paint geology override;
- paint biome override;
- paint land use;
- add runway protection;
- place landmark;
- regenerate selected layer;
- lock procedural result.

---

# 209. NO FULL REGEN FOR LOCAL EDIT

Editing a runway must not regenerate region-wide forests arbitrarily.

Need deterministic sub-seeds by tile/layer.

---

# 210. CONTENT HASH

Each tile:
```text
heightHash
biomeHash
placementHash
```

Use in QA/build cache.

---

# 211. BUILD PIPELINE

```text
validate source data
→ generate macro height
→ hydrology
→ erosion/deposition
→ authored overrides
→ airport protection
→ climate/moisture
→ biome/material
→ roads/parcels
→ settlements
→ vegetation
→ landmarks
→ gameplay fields
→ LOD/HLOD
→ package
→ automated tests
```

---

# 212. OFFLINE VS RUNTIME GENERATION

Recommended:
- expensive erosion/hydrology baked;
- runtime loads compact results;
- lightweight scatter can be deterministic runtime.

Mobile must not spend startup seconds running heavy erosion.

---

# 213. TERRAIN DATA FORMAT

Could use:
- compact height arrays;
- quantized values;
- compressed masks;
- region metadata JSON/TS.

Select after profiling.

Avoid giant uncompressed JSON matrices.

---

# 214. HEIGHT QUANTIZATION

16-bit heights may be enough per tile with base+scale.

Evaluate:
- runway precision;
- mountain range;
- file size.

Runway override can use higher precision.

---

# 215. NORMALS

Can derive or bake.

At tile seams:
must match.

---

# 216. BIOME MASK STORAGE

Potential RGBA:
4 dominant weights per tile.

Or index + weights.

Do not allocate one full texture per biome.

---

# 217. HYDROLOGY STORAGE

Large rivers:
vector/mesh data.

Small drainage:
mask/terrain material.

Avoid thousands of individual water meshes.

---

# 218. ROAD STORAGE

Graph + splines.

Runtime builds/render sections.

Far:
baked into terrain/macro material if useful.

---

# 219. SETTLEMENT STORAGE

Seed + authored core.

Hero towns:
authored.

Minor farms:
procedural layouts.

---

# 220. QA: DETERMINISM

Test:
same seed/version generates identical hashes.

---

# 221. QA: TILE SEAM

Compare border samples.

Max allowed vertical difference near zero tolerance.

---

# 222. QA: HYDROLOGY

Detect:
- uphill river;
- dangling stream;
- lake with multiple surface elevations;
- water over ridge.

---

# 223. QA: AIRFIELD

For each:

- runway has valid length;
- width > 0;
- terrain matches elevation;
- no vegetation exclusion violation;
- approach obstacle data valid;
- surface physics exists;
- route graph connects.

---

# 224. QA: ROUTE

For every route:
- from/to IDs valid;
- measured world distance within accepted delta of authored `distanceM`;
- terrain profile sampled;
- no impossible wall unless intended.

Long-term:
derive distance from positions automatically and use authored distance only as legacy.

---

# 225. QA: `distanceM` CONSISTENCY

Existing route distances may differ from straight line.

Define:

```text
distanceM = intended route planning distance
```

not necessarily direct Euclidean.

Store optionally:
```text
straightLineDistanceM
```

---

# 226. QA: BIOME

- weights valid;
- no sharp unexplained seam;
- vegetation density within range;
- water-compatible.

---

# 227. QA: VEGETATION

No:
- tree runway;
- tree road center;
- tree in water;
- floating tree.

---

# 228. QA: LAND USE

- town connected to road;
- farm parcel plausible slope;
- bridge at crossing;
- airport access possible visually.

---

# 229. QA: EMERGENCY LANDING CURVE

Measure route mean.

Targets conceptuales:

```text
early local routes: high/moderate
foothill: moderate/low
highland: low
overwater: near zero
```

---

# 230. QA: VISUAL NAVIGATION

Blind test:
tester sees screenshot without HUD and identifies approximate region.

Route test:
can reach early destination with landmarks only.

---

# 231. QA: LOD POP

Record high-speed flight.

Flag:
- mountain silhouette jumps;
- town pops;
- forest density pop;
- runway appears late.

---

# 232. QA: STREAMING

Stress:
fastest aircraft + low altitude + region transition.

No:
- frame freeze;
- missing collision;
- void.

---

# 233. QA: MEMORY

Test on target low-memory iOS/Android class.

Track peak during:
- forest;
- town;
- coast;
- destination approach.

---

# 234. QA: WEATHER TRANSITION

Wind volumes blend smoothly.

Ground wetness maps to visible and physical surface.

---

# 235. QA: NIGHT

Airport lights visible;
terrain not over-lit;
navigation remains possible with unlocked tools.

---

# 236. AUTOMATED TEST EXAMPLES

```ts
describe('terrain world', () => {
  it('samples finite height everywhere inside playable bounds')
  it('keeps airfield runway free of vegetation')
  it('keeps water surface level consistent')
  it('produces deterministic tile hashes')
  it('preserves tile border heights')
})
```

---

# 237. AIRFIELD INTEGRATION TEST

```ts
for (const field of AIRFIELDS) {
  const y = terrain.getElevation(
    field.worldPosition[0],
    field.worldPosition[2]
  )

  expect(Math.abs(y - field.elevationM)).toBeLessThan(tolerance)
}
```

During migration, known legacy exception list allowed but must reach zero.

---

# 238. ROUTE TERRAIN TEST

For `valley-coast`:
- must include foothill/higher terrain samples;
- must not remain completely flat.

For `coast-island`:
- waterFraction must exceed target.

---

# 239. HOME TERRAIN TEST

Within runway:
- roughness measurable;
- no severe spike;
- surface dirt;
- obstacle-free center.

---

# 240. MVP SCOPE

Do not attempt whole world first.

MVP:

- 1 continuous ~30–50 km corridor;
- `home_scrubland`;
- `dry_field`;
- `old_ranch`;
- `valley_municipal`;
- transition toward `coastal_gate`;
- 5 biomes;
- reservoir;
- arroyo/river;
- one town;
- roads;
- airfield terrain integration.

---

# 241. MVP BIOMES

```text
semi_arid_scrub
dry_grassland
agricultural_mosaic
riparian_corridor
rocky_foothill
```

`rocky_foothill` can initially map to `rocky_mountain` family with region tuning.

---

# 242. MVP LANDMARKS

- Home ridge.
- Water tank/tower.
- Reservoir.
- Quarry.
- Valley town.
- Major road junction.

---

# 243. MVP SURFACES

- dry_silt;
- grass;
- agricultural_soil;
- gravel;
- rock;
- asphalt;
- water;
- wet_mud future state.

---

# 244. MVP VEGETATION

Keep asset count small:

- 2 scrub;
- 2 grass;
- 2 dry trees;
- 1 riparian tree;
- 1 rocky ground plant.

Distribution quality > species count.

---

# 245. MVP SUCCESS CRITERIA

A build passes terrain MVP when:

1. player can take off from `home_scrubland` on non-flat physical terrain;
2. fields/roads/arroyos can be used to orient;
3. `dry_field` and `old_ranch` feel geographically different;
4. surface affects rolling;
5. off-field landing is possible;
6. vegetation never blocks runway unexpectedly;
7. route to Valley introduces richer geography;
8. tile transitions are invisible enough in normal play;
9. performance remains target stable on mobile-class device.

---

# 246. PHASE WLD-00 — CONTRACTS

Tasks:
- add world types;
- surface registry;
- TerrainQueryService;
- world config;
- migration-friendly Region extensions.

Tests:
- type compile;
- registry completeness.

DoD:
game builds without visual change.

---

# 247. PHASE WLD-01 — STATIC TERRAIN FOUNDATION

Tasks:
- height tiles;
- terrain renderer;
- normal/slope;
- collision;
- home basin.

DoD:
aircraft flies/lands on actual terrain.

---

# 248. PHASE WLD-02 — AIRFIELD INTEGRATION

Tasks:
- airport override;
- runway grading;
- surface physics;
- vegetation exclusion.

DoD:
all six current airfields can be placed in physical terrain without hard-coded planes.

---

# 249. PHASE WLD-03 — HYDROLOGY

Tasks:
- flow data;
- arroyo;
- river;
- reservoir;
- water queries.

DoD:
water shapes match terrain and map.

---

# 250. PHASE WLD-04 — MATERIALS / BIOMES

Tasks:
- terrain shader;
- biome weights;
- five MVP biomes;
- macro texture.

DoD:
region readable from altitude.

---

# 251. PHASE WLD-05 — VEGETATION

Tasks:
- registry;
- scatter;
- exclusions;
- instancing;
- LOD.

DoD:
vegetation causal, stable, performant.

---

# 252. PHASE WLD-06 — HUMAN LAND USE

Tasks:
- road graph;
- fields;
- farm clusters;
- town.

DoD:
roads and settlements make geographic sense.

---

# 253. PHASE WLD-07 — NAVIGATION LANDMARKS

Tasks:
- landmark registry;
- recognition;
- discovery;
- map sync.

DoD:
early route playable visually.

---

# 254. PHASE WLD-08 — ROUTE TERRAIN ANALYSIS

Tasks:
- corridor sampler;
- climb;
- water fraction;
- emergency landing mean;
- terrain penalty derivation.

DoD:
preflight terrain metrics available.

---

# 255. PHASE WLD-09 — STREAMING

Tasks:
- tile state;
- predictor;
- eviction;
- collision safety.

DoD:
continuous flight at high speed.

---

# 256. PHASE WLD-10 — FLOATING ORIGIN

Tasks:
- global/local coordinates;
- rebase;
- object registration.

DoD:
50+ km flight no precision artifact.

---

# 257. PHASE WLD-11 — WEATHER/TERRAIN

Tasks:
- exposure;
- ridge turbulence;
- wetness;
- dust.

DoD:
terrain influences environmental feel and flight.

---

# 258. PHASE WLD-12 — COAST

Tasks:
- coast;
- ocean;
- dunes/estuary;
- `coastal_gate`.

DoD:
first ocean reveal + operational airport.

---

# 259. PHASE WLD-13 — ISLAND

Tasks:
- island terrain;
- water crossing;
- `island_outpost`;
- low alternate density.

DoD:
geographic milestone works.

---

# 260. PHASE WLD-14 — HIGHLANDS

Tasks:
- high terrain;
- pass;
- cloud interaction;
- terrain-clearance missions.

---

# 261. PHASE WLD-15 — ARCHIPELAGO

Tasks:
- island diversity;
- multiple strips;
- regional streaming.

---

# 262. PHASE WLD-16 — FOREIGN MAINLAND

Tasks:
- new geography;
- new human grammar;
- larger airports.

---

# 263. PHASE WLD-17 — OPTIMIZATION

Tasks:
- profiling;
- memory tuning;
- shader variants;
- HLOD;
- adaptive quality.

---

# 264. PHASE WLD-18 — TOOLING / CONTENT SCALE

Tasks:
- debug editor;
- region validators;
- automated world build;
- content lint.

---

# 265. IMPLEMENTATION PRIORITY

If resources are limited, order:

```text
terrain collision
> runway integration
> route readability
> surface physics
> LOD/streaming
> biomes
> vegetation
> human detail
> decorative props
```

---

# 266. NON-GOALS

For first production cycle, do NOT block on:

- globe curvature;
- satellite-realistic planet;
- tectonic runtime;
- dynamic river erosion;
- individual plant simulation;
- traffic city simulation;
- full seasons;
- wildfire simulation;
- photogrammetry;
- real-world geography 1:1.

---

# 267. FAILURE MODES TO AVOID

## “Procedural oatmeal”
Everything equally noisy.

Fix:
macroforms + authored landmarks.

## “Biome theme park”
Desert instantly beside forest.

Fix:
climate/moisture transitions.

## “Flat airport bubbles”
Terrain unnaturally flattened around every runway.

Fix:
fit runway into landform; grade only operational footprint.

## “Infinite forest carpet”
No readability or landing decisions.

Fix:
canopy structure/clearings/land use.

## “Road spaghetti”
Roads with no purpose.

Fix:
settlement graph.

## “Invisible obstacles”
Collision without visible cue.

Fix:
obstacle render priority.

## “Mobile cliff”
Great screenshot, 15 FPS.

Fix:
budget before dressing.

---

# 268. CONTENT GOVERNANCE

Every new region PR/change must include:

- region spec;
- biome palette;
- terrain profile;
- landmark list;
- airfield list;
- route purpose;
- emergency landing analysis;
- screenshots 100/500/1500 m;
- performance metrics;
- QA checklist.

---

# 269. REGION REVIEW TEMPLATE

```md
## Region ID
## Gameplay purpose
## Progression tier
## Geographic narrative
## Geology
## Elevation range
## Landforms
## Hydrology
## Climate
## Biomes
## Human land use
## Airports
## Landmarks
## Route corridors
## Emergency landing density
## Render budget
## Acceptance
```

---

# 270. AIRFIELD ENVIRONMENT REVIEW TEMPLATE

```md
## Airfield ID
## Terrain archetype
## Elevation
## Runway slope
## Surface
## Approach A
## Approach B
## Obstacles
## Surrounding land use
## Visual recognition cues
## Emergency alternatives
## Weather risks
## LOD requirements
```

---

# 271. LANDMARK REVIEW TEMPLATE

```md
## Landmark ID
## Position
## Type
## Silhouette
## Recognition radius
## Routes supported
## Map state
## LOD
```

---

# 272. PERFORMANCE BUDGET TEMPLATE

```text
Target device:
Resolution:
FPS target:
CPU world ms:
GPU terrain ms:
GPU vegetation ms:
Draw calls:
Resident terrain MB:
Resident vegetation MB:
Streaming peak MB/s:
Worst sector:
```

---

# 273. DEFINITION OF DONE — TERRAIN TILE

A tile sólo está terminado si:

- height valid;
- border valid;
- collision valid;
- material valid;
- biome valid;
- streaming metadata valid;
- no runway conflict;
- no water conflict;
- LOD generated;
- performance within budget.

---

# 274. DEFINITION OF DONE — BIOME

- ecological placement coherent;
- near/far visual consistent;
- vegetation set exists;
- material set exists;
- ground physics mapped;
- transition validated;
- LOD validated;
- performance validated.

---

# 275. DEFINITION OF DONE — REGION

- unique macro silhouette;
- coherent drainage;
- biome causal;
- human geography plausible;
- routes meaningful;
- airports integrated;
- landmarks support navigation;
- emergency landing curve matches progression;
- map matches world;
- streaming passes;
- mobile profiling passes.

---

# 276. DEFINITION OF DONE — WORLD SYSTEM

The system is complete when:

- player can fly continuously between all current physical destinations;
- terrain is not a flat backdrop;
- aircraft can contact terrain anywhere;
- terrain surface influences ground behavior;
- water is physically meaningful;
- world can stream beyond current visual slice;
- regions are data-driven;
- landmarks aid navigation;
- airfields are embedded in geography;
- route analysis understands terrain;
- world remains deterministic;
- saves survive generator/version rules;
- debug tools expose hidden fields;
- mobile performance remains stable.

---

# 277. CANONICAL REGION / ROUTE MAPPING

```text
meadow_start
  home_scrubland
  ├── dry_field
  └── old_ranch

quarry_pass
  valley_municipal
  [future highland gate]

coastal_run
  coastal_gate
  └── island_outpost
```

Future:

```text
highland_pass
near_archipelago
volcanic_chain
foreign_mainland
```

---

# 278. CAMPAIGN GEOGRAPHY AS PROGRESSION

Stage 1:
flat, dry, open.

Stage 2:
fields + river.

Stage 3:
ridges + quarry.

Stage 4:
mountain/pass.

Stage 5:
coast.

Stage 6:
open water.

Stage 7:
rugged island.

Stage 8:
new mainland.

At each stage:
- visual diversity;
- operational difficulty;
- route planning;
- aircraft relevance

increase juntos.

---

# 279. NORTH STAR FLIGHT

El jugador despega de `home_scrubland`.

La pista sigue mostrando las irregularidades y arreglos acumulados desde el inicio.

A baja altura identifica el camino de tierra y el arroyo.

El terreno agrícola se vuelve más denso conforme se aproxima al valle.

El embalse confirma que va en ruta correcta.

A partir de `valley_municipal`, los campos dejan paso a foothills.

El avión necesita ganar altitud.

El jugador elige un paso visible entre dos ridges porque el cruce directo requeriría más climb.

El quarry queda a un lado como landmark.

Al salir del paso, la topografía cae.

Aparece una planicie distinta, más húmeda, con una carretera mayor y un town/port.

Después, durante el descenso, el horizonte se abre y por primera vez aparece el océano.

`coastal_gate` se reconoce junto a la costa.

Más adelante, desde la pista o durante un vuelo local, una isla apenas visible aparece en el horizonte.

Todavía no es cómoda de alcanzar.

La isla no fue “desbloqueada” porque un menú cambió.

Se hizo relevante porque el jugador finalmente construyó una aeronave y una operación capaces de tratar una nueva geografía como espacio alcanzable.

Ésta es la función del mundo de PROJECT FLIGHT.

---

# 280. REGLA FINAL

La regla superior del terrain/world design es:

> **Cada kilómetro debe sentirse causado por la geografía, no generado para rellenar distancia.**

El jugador nunca debería pensar:

> “Entré al siguiente biome chunk.”

Debe pensar:

> “Dejé la cuenca seca, seguí el río hacia el valle, crucé por el paso de montaña, descendí hacia la costa y ahora tengo frente a mí un océano que mi avión todavía no puede cruzar con seguridad.”

Cuando esa lectura existe, terreno, progresión, navegación, avión y misión dejan de ser sistemas separados.

Se convierten en PROJECT FLIGHT.

---


# 281. WORLD ATLAS v3 — OBJETIVO

La v2 define **cómo funciona** el mundo. Esta ampliación define **qué mundo existe**. El atlas es canónico: establece macroforma, nombres de producción, relaciones espaciales, jerarquía de asentamientos, cuerpos de agua, corredores, siluetas y función jugable. No obliga a mostrar todos los nombres al jugador; `displayName` puede localizarse o mantenerse oculto hasta discovery.

Principio rector: el jugador debe poder recordar una ruta por geografía, no sólo por HUD. Cada provincia necesita una silueta, una paleta, un patrón humano y un riesgo aeronáutico distinguibles en menos de 5 s desde el aire.

Escala objetivo del mundo completo: **~180 km E–O × ~150 km N–S de espacio navegable**, comprimido deliberadamente. La campaña inicial ocupa una fracción; los océanos y corredores lejanos permiten que alcance, velocidad y confiabilidad sigan importando hasta late game.

---

# 282. MACROFORMA CANÓNICA

El mundo se organiza alrededor del **Mar de Caldera**, con dos masas continentales y dos cadenas insulares. Coordenadas siguientes son centros de diseño aproximados, no posiciones finales de pista.

```text
                              N
                              ↑
             SIERRA DE BRUMA / HIGHLANDS
                    ^^^^^^^^^^^^^^^
 WESTERN MAINLAND   ^             ^       FOREIGN MAINLAND
 ┌───────────────┐  ^  HOME       ^       ┌──────────────────┐
 │ BADLANDS      │──┤  BASIN      ├───────│ ALTIPLANO ESTE   │
 │ / QUARRY      │  │   VALLEY    │       │ RIVER COUNTRY    │
 │               │  └──────┬──────┘       │                  │
 │                  COASTAL PLAIN          │ GRAND CITY       │
 └─────────────── coast ======== sea ======└──────────────────┘
                         \   ○ ○ ○
                          \ NEAR ARCHIPELAGO
                           \      △  △  △
                            \ VOLCANIC CHAIN
                              ↓
                              S
```

MUST:
- el interior drena mayoritariamente hacia la costa suroriental;
- la sierra divide cuencas y produce rain shadow;
- la costa contiene al menos un estuario, una bahía, acantilados y playas bajas;
- el archipiélago cercano se percibe desde la costa en condiciones claras;
- la cadena volcánica forma un stepping-stone visual hacia el continente extranjero;
- ninguna región se resuelve como cuadrado biome-paint.

---

# 283. JERARQUÍA TERRITORIAL

```ts
type AtlasPlaceClass =
  | 'capital_city'
  | 'regional_city'
  | 'town'
  | 'village'
  | 'hamlet'
  | 'industrial_site'
  | 'port'
  | 'airfield'
  | 'natural_landmark'

type AtlasProvince = {
  id: string
  macroRegionId: string
  centerXZ: [number, number]
  extentKm: [number, number]
  elevationRangeM: [number, number]
  dominantBiomes: string[]
  settlements: string[]
  waters: string[]
  landmarks: string[]
  airRiskTags: string[]
}
```

Densidad humana debe caer con pendiente, aridez, exposición oceánica y distancia a carreteras principales. Las ciudades grandes no aparecen en regiones sin agua/acceso/economía que las justifique.

---

# 284. MACROREGIÓN A — HOME BASIN / CUENCA DE ORIGEN

**Rol:** tutorial sistémico, hogar emocional, referencia visual constante.  
**Extensión:** ~18 × 16 km.  
**Elevación:** 180–520 m.  
**Firma:** cuenca seca de pastizal, matorral, parcelas irregulares, lomas bajas y cauces efímeros.

Subzonas:

| ID | Nombre producción | Carácter | Gameplay |
|---|---|---|---|
| `hb_scrub_core` | Llanos del Taller | matorral abierto | home strip, emergencia fácil |
| `hb_west_ridges` | Lomas Secas | rolling ridges | primeras sombras/lee turbulence |
| `hb_creek` | Arroyo del Molino | cauce estacional | landmark lineal |
| `hb_farms` | Parcelas del Sur | agricultura pobre | navegación y forced landing condicionado |
| `hb_ranchbelt` | Cinturón Ranchero | corrales/caminos | destino `old_ranch` |

La base `home_scrubland` se ubica fuera de cualquier núcleo urbano. Debe verse improvisada: pista de tierra desigual, hangar/taller incremental, camino de acceso, depósito y vegetación despejada por uso. El jugador debe distinguirla por su patrón, no por un beacon gigante.

---

# 285. ASENTAMIENTOS DE HOME BASIN

1. **San Cierzo** — pueblo de 1–2 km de diámetro aparente; centro compacto, iglesia/torre de agua, talleres en salida carretera. No tiene skyline moderno.
2. **El Molino** — aldea lineal junto al arroyo y puente; 20–40 estructuras visibles en near LOD.
3. **Rancho Viejo** — conjunto rural que contextualiza `old_ranch`; silos/corrales/árboles cortaviento.
4. **Las Parcelas** — caseríos dispersos, sin centro único.

Red vial: una carretera secundaria pavimentada forma el eje San Cierzo → Agricultural Valley; caminos de terracería conectan ranchos y home airfield. Ningún camino rural debe parecer autopista por ancho o marking.

---

# 286. MACROREGIÓN B — AGRICULTURAL VALLEY / VALLE VERDE

**Extensión:** ~24 × 14 km. **Elevación:** 110–360 m.  
**Identidad:** valle fluvial más fértil, mosaico de cultivos, canales, arboledas, granjas, pueblos y primera infraestructura claramente organizada.

Cuerpo estructurante: **Río Verde**, perenne pero estrecho en temporada seca. El río meandra; terrazas superiores soportan carreteras y asentamientos; la llanura inmediata tiene vegetación riparia y zonas inundables.

`dry_field` ocupa la transición occidental seca. `valley_municipal` está en una terraza amplia junto a la ciudad regional, nunca dentro de edificios densos.

Landmarks: silos gemelos, puente largo del Río Verde, cantera vieja visible hacia foothills, depósito elevado, patchwork agrícola reconocible a 500–1,500 m AGL.

---

# 287. CIUDAD REGIONAL — VILLA VERDE

**Clase:** regional city. **Huella:** 3.5–5 km. **Población ficcional implícita:** suficiente para hospital, industria ligera y aeródromo municipal; no se simula demografía individual.

Morfología desde el aire:
- centro histórico compacto de manzanas pequeñas;
- expansión residencial de baja altura;
- corredor comercial sobre carretera;
- polígono industrial al sotavento/afuera;
- parque ribereño y puentes;
- `valley_municipal` separado por franja agrícola/periurbana.

No usar rascacielos. El hito vertical máximo del early game debe seguir siendo legible sin convertir el valle en metrópolis.

---

# 288. MACROREGIÓN C — FOOTHILLS / QUARRY PASS

**Extensión:** ~22 × 18 km. **Elevación:** 300–1,150 m.  
**Firma:** transición abrupta de agricultura a ridges erosionados, quebradas, cantera, roca expuesta y carreteras sinuosas.

Elementos canónicos:
- **Cantera Roja** (`quarry`) como landmark artificial de alta salience;
- **Paso del Águila**, primer saddle topográfico claramente útil;
- **Barranca Seca**, canyon corto que castiga vuelo demasiado bajo;
- pueblo minero **Piedra Alta** sobre terraza, no fondo de cauce;
- torres de transmisión sobre una ridge secundaria, nunca cruzando approach final.

Esta región enseña que la distancia horizontal deja de ser la única medida: climb performance y lectura de paso empiezan a dominar.

---

# 289. MACROREGIÓN D — SIERRA DE BRUMA / HIGHLAND PASS

**Extensión:** ~30 × 24 km. **Elevación:** 850–2,650 m.  
**Firma:** cordillera compacta, bosque montano en vertientes húmedas, roca/scrub en crestas, nubes orográficas, valles estrechos y laguna alta.

Picos/landmarks:
- **Cerro Centinela** — 2,430 m, piramidal, referencia regional;
- **Pico de Bruma** — 2,650 m, techo canónico de la primera masa continental;
- **Laguna Espejo** — lago glacial/tectónico estilizado a ~1,720 m;
- **Paso Alto** — corredor navegable principal a ~1,580 m;
- **Cascada Blanca** — visible sólo en medium/near, recompensa exploración.

Reglas: crestas generan lee turbulence; cloud base puede ocultar pasos; no debe existir una ruta recta segura a baja altura. Las aeronaves STOL pueden explotar strips de montaña que otras aeronaves no deberían usar.

---

# 290. HIDROLOGÍA CONTINENTAL OCCIDENTAL

Sistema canónico:

```text
Laguna Espejo
   ↓ tributarios
Río Alto ─────┐
              ├→ Río Verde → Embalse del Arco → Estuario Verde → Mar de Caldera
Arroyo Molino ┘
```

**Embalse del Arco:** gran water landmark entre valle y costa, presa visible desde aire, shoreline irregular y carretera sobre/adyacente a presa.  
**Laguna Salina:** cuerpo endorreico pequeño en badlands occidental; agua estacional, borde blanquecino.  
**Humedales del Estuario:** transición río-mar, canales distributarios y vegetación baja.

Todo tributario debe cumplir downhill flow salvo cascada explícita. Puentes sólo donde el road graph realmente cruza agua.

---

# 291. MACROREGIÓN E — COASTAL RUN / COSTA DEL ARCO

**Extensión:** ~34 km de litoral × 16 km interior. **Elevación:** 0–420 m.  
**Firma:** primer gran cambio cromático y espacial: horizonte marino, bruma, playas, dunas, estuario, salinas, agricultura subtropical y asentamientos costeros.

Costa segmentada:
- **Bahía del Arco:** agua relativamente protegida, puerto y ciudad;
- **Playa Larga:** costa baja/dunas, buen landmark lineal;
- **Punta Aguja:** promontorio rocoso con faro;
- **Acantilados del Norte:** forced landing prácticamente nulo;
- **Marismas Verdes:** estuario/humedal, visualmente complejo pero poco seguro.

`coastal_gate` se ubica tierra adentro de la bahía, orientado para que una aproximación revele el océano sin exigir sobrevuelo urbano denso.

---

# 292. CIUDAD COSTERA — PUERTO DEL ARCO

**Clase:** regional city/port. **Huella:** 5–7 km.  
Capas visuales: puerto comercial pequeño, muelles pesqueros, centro bajo, depósitos, barrios periféricos, carretera costera, marina y rompeolas.

Hitos: faro de Punta Aguja, dos grúas portuarias HLOD, tanque blanco de combustible, puente del estuario. Deben funcionar como navegación VFR y no sólo como decoración.

La ciudad es el primer lugar donde la densidad de obstáculos hace claramente mala idea improvisar un aterrizaje fuera de pista.

---

# 293. MAR DE CALDERA

El océano no es vacío. Se divide en bandas jugables:

1. **Litoral 0–3 km:** espuma, shoals, barcos pequeños, referencias terrestres fuertes.
2. **Canal cercano 3–15 km:** mar abierto, referencias decrecientes, viento más limpio.
3. **Canal profundo 15–35 km:** mayor exposición, navegación y combustible críticos.
4. **Corredor oceánico tardío >35 km:** reservado a aeronaves con alcance/confiabilidad apropiados.

Contenido escaso pero significativo: cargueros HLOD, pesqueros, boyas sólo cerca de costa, nubes aisladas, variación de swell y color por profundidad. No sembrar props uniformemente.

---

# 294. MACROREGIÓN F — NEAR ARCHIPELAGO / ISLAS DEL VIENTO

Cadena de 7 islas principales + islotes. Distancia costa–primera isla: compatible con `coast-island`; el resto extiende progresión.

| Isla | Forma | Relieve | Función |
|---|---|---|---|
| **Isla Faro** | pequeña/elongada | 0–120 m | `island_outpost`, primer cruce |
| **Santa Loma** | oval | 0–380 m | agricultura + pueblo |
| **Dos Hermanas** | doble ridge | 0–520 m | navegación/lee turbulence |
| **Cayo Verde** | baja | 0–35 m | manglar/humedal, casi sin margen |
| **Isla Aguja** | estrecha | 0–690 m | cliff/STOL challenge |
| **San Telmo** | grande | 0–760 m | town + aeródromo regional |
| **Cayo Blanco** | coral/sand | 0–18 m | late visual challenge |

Cada isla debe tener coastline fingerprint único reconocible en mapa y desde 1,500 m AGL.

---

# 295. ISLA FARO / `island_outpost`

Primer destino oceánico. La pista ocupa una terraza natural; no debe sentirse pegada sobre la isla. Componentes: faro, 8–15 construcciones de servicio/pesca, pequeño embarcadero, tanque, camino perimetral parcial y vegetación deformada por viento.

Approach principal cruza agua; alternate direction enfrenta terreno ascendente/obstáculos moderados. El faro es landmark, pero la pista debe poder encontrarse por forma de costa y clearing incluso si el faro queda fuera de pantalla.

---

# 296. MACROREGIÓN G — VOLCANIC CHAIN / CADENA DE FUEGO

Tres islas volcánicas mayores y varios stacks:
- **Caldera Norte** — volcán erosionado, crater rim incompleto;
- **Isla Ceniza** — joven, negra/rojiza, lava fields y vegetación pionera;
- **Monte Sol** — gran cono de 1,850 m, bosque húmedo barlovento y rain shadow sotavento.

La cadena introduce verticalidad oceánica. Viento + relieve crea rotor; nubes pueden coronar conos; aeródromos se ubican en coastal benches o calderas erosionadas plausibles, nunca en cima plana artificial.

Late-game scenic landmark: cráter parcialmente inundado de Caldera Norte. No requiere volcanismo activo destructivo en MVP.

---

# 297. MACROREGIÓN H — FOREIGN MAINLAND / CONTINENTE DE LEVANTE

**Extensión navegable:** ~70 × 60 km dentro del world envelope.  
**Objetivo:** hacer que el mundo vuelva a sentirse enorme después de dominar la primera costa.

Provincias:
- `fm_west_cliffs` — costa alta y bahías;
- `fm_river_country` — gran llanura fluvial;
- `fm_east_plateau` — altiplano seco;
- `fm_south_forest` — bosque húmedo/subtropical;
- `fm_metro_belt` — corredor urbano/industrial controlado;
- `fm_north_range` — cordillera secundaria.

El continente mezcla grandes aeropuertos con strips remotos. Aircraft progression debe cambiar el tipo de oportunidad, no sólo aumentar números.

---

# 298. GRAN CIUDAD — NOVA LEVANTE

**Clase:** capital city. **Huella visual:** 10–14 km, densidad concentrada.  
Es el único skyline verdaderamente metropolitano del mundo base y por eso debe reservarse para late game.

Estructura: CBD compacto de mid/high-rise HLOD, cinturón residencial, río ancho con 3–4 puentes mayores, puerto/terminal logística, aeropuerto internacional periférico, autopista orbital parcial y zona industrial.

Mobile rule: la ciudad se representa jerárquicamente. Far = skyline proxy + macroblocks; mid = HLOD districts; near = sólo corredor relevante con geometría detallada. Prohibido intentar simular cada edificio individual a distancia.

---

# 299. CIUDADES Y PUEBLOS DEL CONTINENTE DE LEVANTE

- **Río Claro:** ciudad agrícola sobre gran meandro; aeropuerto regional.
- **Mesa Roja:** town del altiplano; minería/energía; aire caliente y density altitude.
- **Bosque Sur:** pueblo maderero/turístico en clearing; approach rodeado de árboles.
- **Puerto Niebla:** ciudad costera pequeña con fog frecuente.
- **Valle Norte:** settlement de montaña, strip corto y slope.
- **Tres Puentes:** town logístico en confluencia fluvial/carretera.

Cada uno requiere un `SettlementProfile`, un landmark primario, un patrón de techos/materiales y una razón económica visible desde el aire.

---

# 300. RED DE CARRETERAS Y TRANSPORTE

Jerarquía:

```text
T0 motorway        late mainland only
T1 primary road    city ↔ city / coast ↔ interior
T2 secondary       town ↔ town / airfield access
T3 rural road      farms/ranches
T4 track           strips, quarry, remote sites
```

Ferrocarril sólo aparece donde aporta lectura: Valley industrial → Puerto del Arco y Nova Levante freight belt. No crear una red ferroviaria mundial si no tiene gameplay/visual value.

Puertos: Puerto del Arco, San Telmo, Nova Levante y Puerto Niebla. Marinas/pesqueros menores pueden existir en villages insulares.

---

# 301. RED DE AERÓDROMOS — EXPANSIÓN CANÓNICA

Conservar obligatoriamente los seis IDs existentes. Añadir progresivamente:

```text
home_scrubland       dirt / improvised / home
dry_field            dirt-grass / farm
old_ranch            rough dirt / ranch
valley_municipal     paved-light / municipal
coastal_gate         paved / regional
island_outpost       short paved-or-compacted / island
highland_strip       short rough / mountain STOL
reservoir_strip      gravel / utility
san_telmo_airport    paved / island regional
caldera_strip        volcanic gravel / STOL
monte_sol_regional   paved / volcanic regional
levante_international paved / major
rio_claro_regional   paved / regional
mesa_roja_strip      gravel / hot-high
bosque_sur_strip     grass-dirt / forest
puerto_niebla_airport paved / coastal fog
valle_norte_strip    sloped gravel / mountain
```

Cada unlock debe tener una razón física: alcance, climb, runway requirement, water crossing, weather exposure o payload. Evitar unlocks arbitrarios sólo por XP.

---

# 302. CORREDORES AÉREOS DE CAMPAÑA

La red no es una línea única. Después del tutorial se abre en ramas:

```text
HOME
├─ Dry Field ─ Valley Municipal ─ Coastal Gate ─ Island Outpost
├─ Old Ranch ─ Quarry Pass ─ Highland Strip ─ Reservoir
└─ Valley Municipal ─ Reservoir ─ Coast

COAST
├─ Island Faro ─ Santa Loma ─ San Telmo
└─ San Telmo ─ Volcanic Chain ─ Levante

LEVANTE
├─ River Country
├─ Plateau / hot-high
├─ Forest / STOL
└─ Metro / heavy aircraft
```

El grafo debe permitir rutas alternativas cuando aircraft capability lo justifique. Un avión mejor puede cruzar directamente un tramo que antes requería escalas; ésa es una recompensa espacial tangible.

---

# 303. PAISAJES / VISTAS HERO

El world team debe proteger al menos 12 composiciones de alto valor:

1. salida del home strip con Sierra de Bruma al fondo;
2. primer cruce del Río Verde;
3. Cantera Roja desde el oeste;
4. entrada al Paso Alto entre nubes;
5. Laguna Espejo desde cresta;
6. primer reveal del Mar de Caldera;
7. final sobre Bahía del Arco;
8. costa alejándose durante primer cruce;
9. Isla Faro apareciendo bajo haze;
10. archipiélago completo al amanecer/atardecer;
11. Monte Sol elevándose desde océano;
12. primera aparición del skyline de Nova Levante.

Streaming, fog, HLOD y procedural placement no pueden destruir estas composiciones.

---

# 304. MICROIDENTIDAD REGIONAL

Cada región define `RegionalVisualDNA`:

```ts
type RegionalVisualDNA = {
  soilHueFamily: string
  rockHueFamily: string
  roofPalette: string[]
  roadEdgeStyle: string
  fenceArchetype: string
  poleArchetype: string
  dominantTreeSilhouettes: string[]
  fieldGeometry: 'irregular' | 'rectilinear' | 'terraced' | 'none'
  atmosphericSignature: string
  clutterSet: string[]
}
```

Ejemplos: Home = postes simples/cercas alambre/polvo; Valley = canales/silos/parcelas verdes; Coast = techos claros/palmas selectivas/salitre; volcanic = piedra oscura/techos resistentes/viento; Levante metro = infraestructura vial y logística. Reutilizar assets sí; reutilizar exactamente la misma combinación no.

---

# 305. RELIEVE — REGLAS NUMÉRICAS POR PROVINCIA

| Provincia | elevación | slope común | relief wavelength | landing availability |
|---|---:|---:|---|---|
| Home Basin | 180–520 m | 0–8° | 1–6 km | alta |
| Valley | 110–360 m | 0–5° floor / 12° edge | 2–8 km | alta-media |
| Foothills | 300–1,150 m | 6–22° | 1–5 km | media-baja |
| Highlands | 850–2,650 m | 12–35° | 2–10 km | muy baja |
| Coastal Plain | 0–180 m | 0–6° | 2–12 km | media |
| Coastal Cliffs | 0–420 m | 15–45° | 0.5–4 km | mínima |
| Near Islands | 0–760 m | variable | 0.5–5 km | baja |
| Volcanic Chain | 0–1,850 m | 8–38° | 2–9 km | muy baja |
| Levante River | 0–420 m | 0–6° | 3–15 km | alta-media |
| Levante Plateau | 600–1,650 m | 2–15° | 4–18 km | media |

Estos rangos guían generación; no deben producir cliffs por simple clamp.

---

# 306. CLIMAS Y TRANSICIONES

Gradiente canónico:
- interior occidental: semiárido cálido;
- valle: semiárido/subhúmedo por río/agricultura;
- highlands: templado montano, mayor nubosidad;
- costa: marítimo cálido, haze/humedad;
- islas: oceánico, viento sostenido;
- volcanes: fuerte orografía barlovento/sotavento;
- Levante sur: subtropical húmedo;
- Levante plateau: continental seco/hot-high.

Las fronteras climáticas se mezclan por elevación, distancia al mar y rain shadow. Nunca cambiar cielo/vegetación en una línea administrativa.

---

# 307. CICLO DIARIO COMO GEOGRAFÍA

El horario debe cambiar cómo se lee el mismo territorio:
- madrugada: niebla de valle/estuario localizada;
- mañana: sombras de relieve útiles para navegación;
- mediodía: peor lectura de microrelieve, mayor thermal activity interior;
- tarde: sea breeze y sombras largas;
- noche: settlement light patterns sustituyen parcialmente landmarks naturales.

Las luces nocturnas siguen road/settlement graph. No distribuir puntos luminosos aleatorios sobre terreno deshabitado.

---

# 308. DENSIDAD DE CONTENIDO POR ALTITUD

La composición se evalúa en cuatro bandas:

| Banda | Prioridad |
|---|---|
| 0–80 m AGL | runway, obstáculos, microterreno, fences, props |
| 80–300 m | field boundaries, roads, tree masses, building clusters |
| 300–1,000 m | river shape, town morphology, ridges, coastline, landmarks |
| >1,000 m | macrorelief, water bodies, urban mass, island silhouette, haze |

Un asset que sólo funciona a nivel peatón pero consume presupuesto en vuelo tiene baja prioridad.

---

# 309. PUNTOS DE INTERÉS NO-AEROPUERTO

POIs deben recompensar exploración sin convertir el mapa en icon soup: mina abandonada, presa, faro, observatorio de montaña, barco varado, ruinas costeras, estación meteorológica, puente ferroviario, antena en ridge, cráter inundado, cascada, granja solar del altiplano, bosque quemado/regenerado y cantera activa.

Regla: máximo 1 POI de alta salience por ~25–50 km² en early world; aumentar sólo en regiones urbanas. Discovery puede otorgar mapa, contratos o pequeños rewards, no necesariamente moneda directa.

---

# 310. ECONOMÍA VISIBLE EN EL PAISAJE

Cada región debe explicar qué mueve carga/personas:
- Home: ranchos, piezas, combustible, correo;
- Valley: agricultura/alimentos;
- Quarry: minerales/materiales;
- Highlands: suministros remotos/turismo;
- Coast: pesca/puerto/logística;
- Islands: víveres, medicina, pasajeros;
- Volcanic: comunidades aisladas/turismo/carga especializada;
- Levante: industria, logística, pasajeros, heavy cargo.

Mission generator consume esta matriz para que origen/destino/carga sean geográficamente plausibles.

---

# 311. EMERGENCY LANDING ECOLOGY

El mapa de aterrizaje forzoso debe contar una historia de progresión:
- Home: numerosos claros, caminos y parcelas tolerables;
- Valley: más superficies planas pero cultivos/canales/cables complican;
- Foothills: pocas terrazas y carreteras;
- Highlands: casi sólo strips/valles seleccionados;
- Coast: playas utilizables sólo por estado/marea abstracta y obstáculos;
- Ocean: ninguna opción terrestre;
- Islands: escasas superficies, fuerte incentivo a planear ruta;
- Levante River: vuelve a abrir opciones;
- Metro: terreno plano pero obstáculos hacen suitability baja.

No equiparar `flat` con `safe`.

---

# 312. WATER CROSSING DESIGN

Todo cruce sobre agua define:

```ts
type WaterCrossingProfile = {
  distanceOverWaterM: number
  maxDistanceFromLandM: number
  visibleLandmarks: string[]
  typicalWindExposure: number
  alternateLandingIds: string[]
  minRecommendedRangeReserve: number
  psychologicalMilestone: boolean
}
```

Primer cruce debe ser tenso pero legible. Cruces tardíos pueden ocultar destino bajo haze y exigir heading/range discipline. No usar océano sólo para inflar tiempo.

---

# 313. WORLD EDGE DESIGN

El borde navegable jamás se presenta como muro invisible obvio. Estrategias: océano profundo sin destinos, cordilleras de gran altitud, weather deterioration, falta de combustible práctico y límites de contrato. Si se requiere hard boundary técnico, debe quedar detrás de barrera geográfica plausible y mostrar feedback claro antes del contacto.

---

# 314. MAPA 2D CANÓNICO

El mapa deriva del mismo atlas. Capas desbloqueables:
- coastline/hydrography;
- shaded relief/contours;
- settlements;
- roads;
- airfields;
- discovered POIs;
- route feasibility overlay;
- emergency suitability;
- weather.

Las formas de isla, río y carretera deben coincidir con el mundo 3D. Prohibido dibujar un “map art” independiente que contradiga coordenadas runtime.

---

# 315. NOMENCLATURA Y LOCALIZACIÓN

IDs técnicos: inglés snake_case estable. `displayName`: localizable. Nombres de producción de este atlas pueden cambiar antes de ship mediante tabla de alias, pero no se deben cambiar IDs de save.

```ts
type PlaceNameRecord = {
  id: string
  canonicalDisplayKey: string
  aliases: string[]
  discoveredNameKey?: string
}
```

No llenar el mundo con nombres cómicos o referencias directas a lugares reales; la identidad debe ser propia.

---

# 316. WORLD CONTENT BUDGET

Target base completo, ajustable por profiling:
- 2 masas continentales navegables;
- 10–12 provincias fisiográficas;
- 7+ islas principales;
- 1 gran metrópolis, 3–5 ciudades regionales, 12–20 towns/villages;
- 16–24 aeródromos útiles;
- 25–40 landmarks de navegación;
- 20–35 POIs secundarios;
- 4 cuerpos de agua continentales mayores/medios + red fluvial;
- 1 gran mar/océano jugable;
- 15–25 familias de biome blend, no 25 shaders distintos.

El presupuesto es de **variedad perceptual**, no de asset count bruto.

---

# 317. WORLD STREAMING CELLS — ATLAS BINDING

Cada `TerrainSector` conoce provincia y macroregión. Streaming predictor debe priorizar:
1. corredor de rumbo actual;
2. destination approach bubble;
3. terrain collision coarse en glide envelope;
4. landmarks de alta salience;
5. adjacent diversion airfields;
6. visual content secundario.

Al cruzar mar, mantener coast HLOD más tiempo de lo normal para reforzar orientación y escala.

---

# 318. DATASET MÍNIMO DEL ATLAS

Crear archivos data-driven:

```text
src/world/data/atlas/
  macroRegions.ts
  provinces.ts
  settlements.ts
  waterBodies.ts
  landmarks.ts
  pointsOfInterest.ts
  transportGraph.ts
  visualDNA.ts
  climateZones.ts
  campaignCorridors.ts
```

Cada record necesita schema validation y unique ID test. `RegionDefinition` actual referencia `provinceId`/`macroRegionId`; no duplicar arrays de strings divergentes.

---

# 319. WORLD GENERATION ORDER v3

Orden obligatorio para construir contenido nuevo:

```text
1 macro landmass masks
2 tectonic/geologic provinces
3 macro elevation + ridges
4 erosion/drainage
5 water bodies/coast
6 climate fields
7 soil/biome fields
8 settlement suitability
9 settlement graph
10 road/rail graph
11 airfield suitability + authored overrides
12 landmarks/POIs
13 mission/route analysis
14 visual dressing
15 LOD/HLOD/streaming bake
16 QA + performance
```

Si una carretera o ciudad requiere violar pasos 1–8, documentar authored override explícito.

---

# 320. ACCEPTANCE — CADA PROVINCIA

Una provincia sólo está terminada si:
- su silhouette se reconoce en mapa sin labels;
- tiene causalidad geológica/hidrológica;
- contiene al menos 2 señales visuales únicas;
- transición a vecinas funciona a ground y cruise altitude;
- road/settlement graph tiene sentido;
- airfields están integrados al terreno;
- route analyzer produce dificultad coherente;
- emergency suitability está validada;
- weather profile modifica vuelo;
- far/mid/near LOD están revisados;
- cumple presupuesto mobile en worst-case heading.

---

# 321. ACCEPTANCE — CADA ASENTAMIENTO

MUST:
- estar conectado a transporte;
- tener fuente/razón económica plausible;
- respetar slope/flood constraints;
- poseer morphology propia;
- tener un landmark o patrón reconocible cuando su rol de navegación lo requiera;
- no invadir approach surfaces;
- disponer de HLOD;
- generar luces nocturnas por estructura vial;
- tener collision sólo donde aporta gameplay.

---

# 322. ACCEPTANCE — CADA CUERPO DE AGUA

MUST:
- pertenecer a watershed o lógica costera;
- coincidir con terrain elevation;
- tener shoreline material transition;
- evitar z-fighting/tile seams;
- exponer gameplay risk correctamente;
- poseer far proxy si es landmark;
- mantener mapa 2D y 3D sincronizados.

---

# 323. ACCEPTANCE — RUTA AÉREA

Además de los tests v2, toda ruta nueva debe registrar:

```text
horizontal distance
terrain-adjusted path distance
minimum safe profile
climb requirement
water exposure
forced-landing scarcity
landmark cadence
weather modifiers
runway constraints at destination
recommended aircraft capability bands
```

No fijar una aeronave concreta como única solución salvo misión especial; usar capability gates.

---

# 324. VERTICAL SLICE GEOGRÁFICO DEFINITIVO

Antes de escalar a todo el atlas, producir un slice completo:

```text
home_scrubland
→ Arroyo del Molino
→ dry_field
→ Río Verde / agricultural mosaic
→ valley_municipal / Villa Verde edge
→ foothill reveal / Cantera Roja
```

Debe demostrar en un solo vuelo: microterreno, biomes, settlement graph, water, roads, landmarks, LOD, streaming, terrain collision, emergency suitability, day lighting y mobile budget.

Si este corredor no alcanza calidad objetivo, no multiplicar contenido.

---

# 325. SECOND SLICE — MONTAÑA A MAR

```text
valley_municipal
→ Cantera Roja
→ Paso Alto
→ reservoir reveal
→ descent through coastal foothills
→ Puerto del Arco / Bahía del Arco
→ coastal_gate
```

Objetivo: validar verticalidad, orographic weather, long-range silhouettes, coastline y first-ocean reveal.

---

# 326. THIRD SLICE — PRIMER CRUCE OCEÁNICO

```text
coastal_gate
→ Punta Aguja
→ open water
→ Isla Faro
→ island_outpost
```

Objetivo: validar water rendering budget, coast HLOD persistence, haze, range tension, wind exposure, island silhouette y destination streaming sobre agua.

---

# 327. LATE-GAME SLICE

```text
San Telmo
→ Monte Sol volcanic flank
→ deep-water corridor
→ Levante west cliffs
→ river country
→ Nova Levante skyline
→ levante_international
```

Debe demostrar que la tecnología de world streaming escala sin cambiar de arquitectura.

---

# 328. PRODUCCIÓN DE ASSETS POR KIT

Kits mínimos:
- `KIT_HOME_RURAL`
- `KIT_VALLEY_AGRICULTURE`
- `KIT_QUARRY_INDUSTRIAL`
- `KIT_HIGHLAND`
- `KIT_COASTAL_PORT`
- `KIT_ISLAND_VILLAGE`
- `KIT_VOLCANIC`
- `KIT_LEVANTE_RURAL`
- `KIT_LEVANTE_METRO`

Cada kit: structures, roofs/materials, fences, utility props, vegetation complements, road furniture, HLOD proxies y damage-free collision proxies. Asset kit no define placement; placement consume atlas + land-use rules.

---

# 329. MATRIZ DE DIFERENCIACIÓN REGIONAL

| Región | Silueta | Color macro | Patrón humano | Riesgo dominante |
|---|---|---|---|---|
| Home | lomas bajas | ocre/verde seco | ranchos dispersos | runway roughness |
| Valley | valle ancho/río | verde mosaico | campos/pueblos | wires/channels |
| Foothills | ridges quebradas | rojo/gris | cantera/carretera | terrain clearance |
| Highlands | picos/valles | verde oscuro/roca | muy escaso | climb/cloud/rotor |
| Coast | horizonte plano/promontorios | arena/azul/verde | puerto/corredor | haze/wind/obstacles |
| Near Islands | silhouettes aisladas | mar dominante | villages | water exposure |
| Volcanic | conos/calderas | negro/verde | coastal benches | rotor/vertical relief |
| Levante River | planicie/río grande | verde/azul | ciudades/infra | density/traffic |
| Levante Plateau | mesas | naranja/pardo | minería/energía | hot-high |
| Levante Metro | skyline | gris/verde | urbano denso | obstacles/performance |

Si dos filas se sienten iguales durante playtest, una necesita rediseño.

---

# 330. WORLD QUALITY GATE

Escala interna de producción:
- **<7/10:** prototipo; no escalar.
- **7–8:** indie competente; sistemas presentes pero identidad/continuidad insuficiente.
- **8.5:** mínimo para cerrar un slice de producción.
- **9+:** objetivo world-class mobile: geografía memorable, navegación natural, performance estable, integración sistémica y arte coherente.

La puntuación no se obtiene por cantidad de props. Se evalúan: causalidad 15%, navegación/legibilidad 15%, vuelo/gameplay 20%, identidad visual 15%, continuidad/streaming 10%, technical art 10%, mobile performance 10%, polish/QA 5%.

Ninguna región puede compensar performance < target con arte, ni gameplay roto con estética.

---

# 331. BACKLOG EJECUTABLE DEL ATLAS

Orden de ejecución recomendado:

- **ATLAS-00:** schemas + IDs + coordinate envelope.
- **ATLAS-01:** macro masks occidental + coastline.
- **ATLAS-02:** Home/Valley terrain + Río Verde.
- **ATLAS-03:** settlements/roads Home/Valley.
- **ATLAS-04:** first vertical slice quality gate.
- **ATLAS-05:** Foothills + quarry + pass.
- **ATLAS-06:** Highlands + reservoir + climate/orography.
- **ATLAS-07:** Coast + estuary + Puerto del Arco.
- **ATLAS-08:** second slice quality gate.
- **ATLAS-09:** ocean + Isla Faro.
- **ATLAS-10:** third slice quality gate.
- **ATLAS-11:** full Near Archipelago.
- **ATLAS-12:** Volcanic Chain.
- **ATLAS-13:** Levante macroterrain/hydrology.
- **ATLAS-14:** Levante settlements/transport.
- **ATLAS-15:** Nova Levante HLOD city.
- **ATLAS-16:** late-game slice.
- **ATLAS-17:** global map/discovery integration.
- **ATLAS-18:** cross-region optimization.
- **ATLAS-19:** final world QA, deterministic bake and save migration.

Cada ticket se descompone antes de ejecución en data, terrain, art, runtime, tests, profiling y acceptance captures.

---

# 332. MASTER DEFINITION OF DONE v3.0

El **mundo completo** está definido cuando existe una respuesta inequívoca y data-driven a estas preguntas:

1. ¿Qué forma tiene cada masa terrestre y por qué?
2. ¿Dónde nace y termina cada río relevante?
3. ¿Qué clima/bioma corresponde a cada elevación/exposición?
4. ¿Dónde están ciudades, pueblos, carreteras y por qué existen?
5. ¿Qué distingue visualmente cada región desde el aire?
6. ¿Dónde puede aterrizar el jugador si falla el motor?
7. ¿Qué terrain/weather capability exige cada frontera de progresión?
8. ¿Qué landmark permite navegar sin depender permanentemente del HUD?
9. ¿Cómo se transmite el mundo a mobile sin pop, stutter ni collision holes?
10. ¿Cómo se verifica automáticamente que mapa, física, terrain y rutas coinciden?

La implementación está terminada sólo cuando esas respuestas también existen en runtime, tests y profiling; el Markdown por sí mismo no constituye implementación.

---

# 333. REGLA FINAL DEL ATLAS

> PROJECT FLIGHT debe sentirse como un lugar antes de sentirse como una colección de misiones.

El jugador debe recordar **la curva del río antes de Villa Verde**, **la cantera roja antes del paso**, **el momento en que aparece el mar**, **la silueta de Isla Faro**, **el cono de Monte Sol** y **el skyline lejano de Levante**. Si la ruta sólo se recuerda como “marcador A → marcador B”, el world design ha fallado.

El objetivo no es reproducir GTA: San Andreas geográficamente. El estándar tomado de él es la **densidad de contraste y memoria espacial**: territorios comprimidos pero creíbles, cambios de relieve/bioma frecuentes, ciudades con identidad, campo con función y transiciones suficientemente suaves para que el mundo parezca uno solo.

---

# APPENDIX A — WORLD FIELD REGISTRY

```text
height
normal
slope
aspect
curvature
geology
rock_exposure
flow_direction
flow_accumulation
watershed
water
water_depth
distance_to_water
climate_temperature
climate_moisture
wind_exposure
fog_bias
soil
surface_physics
biome_weights
land_use
road_distance
settlement_density
vegetation_density
tree_height
obstacle_density
airport_exclusion
emergency_landing
landmark_salience
streaming_priority
```

---

# APPENDIX B — SURFACE MATRIX

| Surface | Rolling | Dry braking | Wet braking | Sink | Dust | Mud |
|---|---:|---:|---:|---:|---:|---:|
| asphalt | low | high | medium/high | none | none | none |
| gravel | medium | medium | medium | low | medium | low |
| compacted dirt | medium | medium | low/med | low | high | med |
| dry silt | high | low/med | low | medium | very high | high wet |
| grass | medium | med | low | low/med | low | med |
| mud | high | low | very low | high | none | very high |
| rock | low/irregular | variable | variable | none | low | none |
| sand | high | low | low | high | medium | none |

Numbers exactos pertenecen a tuning, no a esta matriz conceptual.

---

# APPENDIX C — BIOME GAMEPLAY MATRIX

| Biome | Visibility | Forced landing | Render cost | Navigation |
|---|---|---|---|---|
| semi_arid_scrub | high | med/high | low | med |
| dry_grassland | high | high | low | low/med |
| agriculture | high | high/variable | med | high |
| riparian | high line cue | low inside corridor | med | high |
| dry woodland | med/high | med | med | med |
| dense forest | med | very low | high | med |
| mountain | high silhouette | very low | med | high |
| wetland | med | very low | med/high | high |
| coast | high | variable | med | very high |
| ocean | high horizon | none | low/med | low |
| volcanic island | high | low | med | very high |

---

# APPENDIX D — CURRENT AIRFIELD INTEGRATION

```yaml
home_scrubland:
  region: meadow_start
  terrain_archetype: basin_dirt_home
  elevation_m: 612
  biome: semi_arid_scrub
  special: persistent_upgradeable_airfield

dry_field:
  region: meadow_start
  terrain_archetype: flat_farm_dirt
  elevation_m: 605
  biome: agriculture_dry

old_ranch:
  region: meadow_start
  terrain_archetype: rolling_ranch_grass
  elevation_m: 635
  biome: dry_grassland

valley_municipal:
  region: quarry_pass
  terrain_archetype: valley_floor_municipal
  elevation_m: 580
  biome: agricultural_riparian

coastal_gate:
  region: coastal_run
  terrain_archetype: coastal_plain_airport
  elevation_m: 14
  biome: coastal_scrub

island_outpost:
  region: coastal_run
  terrain_archetype: island_gravel_strip
  elevation_m: 9
  biome: island_coastal
```

---

# APPENDIX E — WORLD BUILD VALIDATION CHECKLIST

- [ ] Global coordinate convention documented.
- [ ] Sea-level datum fixed.
- [ ] Current airfield IDs preserved.
- [ ] Region IDs preserved/migrated safely.
- [ ] TerrainQueryService implemented.
- [ ] Ground surface registry implemented.
- [ ] Airfield terrain override implemented.
- [ ] Home runway no longer generic flat plane.
- [ ] Tile seams automated.
- [ ] Hydrology downhill validation.
- [ ] Biome weights validation.
- [ ] Vegetation exclusion validation.
- [ ] Road graph connectivity.
- [ ] Settlement connectivity.
- [ ] Landmark registry.
- [ ] Route terrain analyzer.
- [ ] Emergency landing map.
- [ ] World streaming state machine.
- [ ] Destination prefetch.
- [ ] Coarse collision always available.
- [ ] Floating origin.
- [ ] Mobile memory HUD.
- [ ] World debug modes.
- [ ] Screenshot altitude review.
- [ ] Performance worst-case review.
- [ ] Map/world consistency review.
- [ ] Save migration test.

---

# APPENDIX F — ANTI-PATTERNS

MUST NOT:

- poner un plano infinito de suelo como solución final;
- usar un único `noise()` para toda la geografía;
- generar ríos sin flow;
- colocar aeropuertos en “plataformas” circulares artificiales;
- ocultar terrain pop con fog excesivo;
- usar bosques uniformes;
- hacer cada isla igual;
- hacer cada región un simple recolor;
- duplicar física de superficie entre renderer/sim;
- mantener world coordinates enormes directamente en float local;
- cargar el mundo completo en memoria;
- permitir collision invisible;
- permitir runway sin collision cargada durante approach;
- regenerar mundo distinto al recargar un save;
- mover IDs persistentes sin migración;
- generar carreteras sin destinos;
- generar settlements sin acceso;
- poner árboles sobre runway;
- tratar campo agrícola como landing safe universal;
- sacrificar input/physics para aumentar foliage.

---

# APPENDIX G — IMPLEMENTATION AGENT ACCEPTANCE REPORT

Al cerrar cualquier fase, el agente debe reportar:

```md
## Phase
## Files changed
## Data migrations
## Runtime systems added
## Content added
## Tests added
## Tests result
## Build result
## Lint result
## Performance snapshot
## Known limitations
## Screens / debug captures
## Definition of Done status
```

No basta “implemented terrain”.

Debe demostrarse cada contrato.

---

**END — PROJECT FLIGHT WORLD TERRAIN / ENVIRONMENT / BIOMES / TOPOGRAPHY / GEOGRAPHY MASTER IMPLEMENTATION SPEC v3.0**
