# MASTER GEOGRAPHIC MAP V1 — FROZEN

Estado: **congelado** (esta última iteración). Fase 2 (integración en runtime) está construida sobre esta macrogeografía y **no** cambia el
heightfield, hidrología o regiones — solo consume `masterGeography`/`masterMap` como autoridad. Cambiar la macrogeografía otra vez requiere
reabrir este documento explícitamente.

Autoridad: [`WORLD_MAP_MASTER_SPEC_V1.md`](WORLD_MAP_MASTER_SPEC_V1.md) (macrogeografía, canónica desde esta iteración) manda sobre escala,
regiones y geografía; [`WORLD_TERRAIN_ENVIRONMENT_GEOGRAPHY_MASTER_SPEC_v3.0.md`](../WORLD_TERRAIN_ENVIRONMENT_GEOGRAPHY_MASTER_SPEC_v3.0.md)
sigue mandando sobre sistemas (streaming, coordenadas, contratos). Reconciliación completa en §5.

## 0. Qué cambió en esta iteración (antes → después)

Todo lo que sigue reemplaza únicamente `src/world/master/masterGeography.ts` (datos) y ajustes puntuales de `masterMap.ts` (algoritmo);
ningún archivo fuera de `src/world/master/`, `scripts/world/`, `docs/world/` fue tocado salvo `package.json`/`package-lock.json` (sharp) y
`.gitignore`.

| Defecto (Fase 1 inicial) | Corrección | Verificado por |
|---|---|---|
| Costa norte con lóbulos repetidos ("borde de galleta") | Costa norte rediseñada a mano: un fiordo profundo, una bahía ancha, una península delgada, un tramo de acantilado recto y un cabo amplio — escalas deliberadamente desiguales | Test `the north coast is irregular in SCALE` (varianza de amplitud/espaciado de extremos ≥ 0.4, un tramo ≥ 3 km y uno ≤ 1.6 km) |
| Valle Central demasiado ancho/liso (6–14 km) y sin paredes legibles | Muros oeste partidos en dos sierras con paso entre ellas, piedemonte este + terraza, colinas aisladas en el suelo del valle; costo de cruce de pared de región multiplicado (fuerza el límite de región al pie del muro) | Tests `5–9.5 km wide … 17–21 km long`, `legible walls: ≥250 m … within 5 km` |
| Isla Oriental en forma de "salchicha" (relación de aspecto ≈ 4:1) | Costa rediseñada compacta con bahía de caldera; volcán con 3 costillas radiales (N/S/O) en vez de una cresta lineal; volcán 1,410→1,500 m | Test `Eastern Island is compact … PCA aspect ≤ 2.5` (real: **2.25**), `déficit de casco convexo ≥ 8%` |
| Volcán de la isla 1,353–1,410 m (fuera del objetivo 1,450–1,550) | Pico principal a 1,500 m, base más ancha | Test `1,450–1,550 m volcano`, `never above the continental ceiling` |
| Rectas de erosión de 45°/90° visibles en el hillshade (artefacto D8) | Jitter determinista (±24 m) en la elevación usada **solo** para elegir la dirección de drenaje durante la erosión + difusión de laderas ponderada por cuenca + repartición del corte sobre el vecindario 3×3 (valles en V, no ranuras de 1 celda) | Tests `relief is isotropic` (ratio máx/mín de curvatura direccional < 1.25, real 1.04), `no ruler-straight drainage` (< 2.6 km, real ≤ 1.87 km) |
| Lago circular + surco recto del Field resaltaban en la zona de fusión (fuera del núcleo) | Cabecera del río del Field (fuera del núcleo verbatim) recibe meandros naturales, atenuados a cero exactamente donde empalma con el núcleo | Test `Starter Basin headwater … natural meandering stream (sinuosity ≥ 1.08)`, y el test de conservación del núcleo (sin cambios, sigue en `< 0.05 m`) |
| Sitios de campaña sin geografía (Fase 2, nuevo) | 7 sitios (`scrap_valley`, `red_canyon`, `backcountry`, `coast_run`, `industrial_belt`, `high_desert_test_range`, `the_range`) anclados por búsqueda offline (terreno seco, llano, dentro de su macrorregión) y allanados a una plataforma única | §4 |

Todas las correcciones se verificaron con múltiples iteraciones de render (hillshade recortado en la zona conflictiva, vistas oblicuas,
métricas numéricas) antes de fijarse — no se aceptó la primera pasada en ningún caso; ver §7.

## 1. Auditoría — sin cambios respecto a la entrega anterior

Se mantiene íntegra la tabla de auditoría de la iteración previa: `fieldGeography.ts`, `fieldComposition.ts`, `fieldPlacement.ts`,
`fieldWorld.ts` se conservan; el Field se traduce rígidamente a R01. Ver el historial de este documento para el detalle completo si hace
falta, o `git log -- docs/world/`.

## 2. Marco de coordenadas y Starter Basin — sin cambios

`WORLD_ORIGIN = (0,0)`, X/Z ∈ ±24,000 m, celda 48 m. `master = local + (10500, −2000)` m, `+230 m` de elevación. Núcleo verbatim hasta
4.8 km (Chebyshev), fusión hasta 6.45 km. Sin cambios en esta iteración (el test de conservación del núcleo verifica error < 0.05 m, sin
regresión).

## 3. Reconciliación completa: 8 regiones de campaña × 9 macroregiones × aeródromos × 17 misiones

### 3.1 Mapeo aplicado (no provisional — verificado por test)

| Región de campaña (`src/content/regions.ts`) | Macrorregión | Anclaje geográfico (E, N km) | Datum (m) | Justificación |
|---|---|---|---|---|
| `the_field` | R01 Starter Basin | (−10.5, −2.0) | 230 (+relieve del Field) | Es el propio Starter Basin; conservado, no un mapeo. |
| `scrap_valley` | R02 Central Valley | (2.8, −0.6) | 238.5 | "Deshuesadero y cantera" encaja con el suelo agrícola/industrial del valle; cerca de `industrial_belt`. |
| `red_canyon` | R04 Western Badlands | (−20.3, −2.8) | 733.7 | "Cañones rojos, mesas" es literalmente la descripción de Badlands. |
| `backcountry` | R03 Northern Mountains | (−6.72, 9.24) | 855.5 | "Bosques, lagos y pistas cortas entre montañas" → estribaciones de R03; su lago es local (`waterBodies.ts`), no depende del lago maestro. |
| `coast_run` | R06 South Coast | (4.4, −12.7) | 86.7 | "Acantilados, playas, viento cruzado sobre agua" → costa sur. |
| `industrial_belt` | R02 Central Valley | (1.2, −7.6) | 190.8 | "Puentes, almacenes, corredores de precisión" → zona industrial del valle, río principal cerca para el puente de la misión `industrial_bridge_01`. |
| `high_desert_test_range` | R04 Western Badlands | (−17.7, 6.5) | 294.2 | "Salina, hangares de prueba, récords de velocidad" → llano seco de Badlands. |
| `the_range` | R09 Eastern Highlands | (7.3, 8.3) | 2103.1 | "Valles altos, cumbres, cruce final" → punto más alto y difícil, coherente con "uno de los aeropuertos más difíciles" (spec §R09). |

Sin macrorregión sin campaña asignada: R05 (Southern Greenbelt), R07 (Eastern Island) y R08 (Southern Archipelago) **no tienen** región de
campaña todavía — son geografía disponible para contenido futuro, documentado como tal (no un defecto: la spec pide 18–24 aeródromos y hoy
hay 13).

### 3.2 Conflictos encontrados y su resolución

1. **`scrap_valley` e `industrial_belt` comparten macrorregión (R02).** No es un conflicto: R02 (18 km de largo) tiene espacio para ambos
   sitios con más de 3 km de separación (verificado por test); la spec de campaña ya los trataba como progresión secuencial dentro del
   mismo "valle industrial".
2. **`red_canyon` y `high_desert_test_range` comparten macrorregión (R04).** Mismo razonamiento; Western Badlands es la región más extensa
   (237–245 km²) y ambos sitios están a más de 9 km entre sí.
3. **IDs de aeródromos citados en la spec v3.0 §3** (`home_scrubland`, `dry_field`, `old_ranch`, `valley_municipal`, `coastal_gate`,
   `island_outpost`) **no existen en el repositorio real.** El repo usa `field_home`, `field_north_strip`, `field_east_meadow`,
   `field_far_ridge`, `field_ridge_hollow`, `scrap_yard_strip`, `scrap_quarry_strip`, `red_canyon_mesa`, `backcountry_lake_strip`,
   `coast_run_pier`, `industrial_cargo_yard`, `desert_salt_strip`, `range_summit_pad` (13 aeródromos). **Se conservan los del repo**; la
   v3.0 describe un estado anterior o un plan no realizado. No se inventó ningún ID nuevo.
4. **`island_outpost` (Eastern Island) y `coastal_gate`** de la v3.0 no tienen contraparte real: hoy no hay aeródromo en R06 más allá de
   `coast_run_pier`, ni ninguno en R07/R08. Documentado como deuda (§6), no inventado.
5. **`range_finale_01` y `industrial_bridge_01`** exigen `minRangeKm: 5.5`, que con el Starter Basin recolocado en Badlands (R01) sigue
   siendo alcanzable porque las distancias siguen siendo *locales* al marco de cada región (el mapeo es una traslación rígida; no cambia
   ninguna distancia interna de misión).
6. **Ningún ID nuevo fue creado** para regiones, aeródromos o misiones. El único identificador nuevo es el de la propia entidad de
   integración (`CampaignSite`, `MasterAirfield`, etc., en el código, no en contenido de juego).

### 3.3 Migraciones necesarias para consumir esto (no aplicadas todavía)

- `MapScreen`/`WorldMapCanvas`/`getRegionMap('master')`: ya existe el adaptador (`src/map/masterMapGeography.ts`), pero la pantalla de mapa
  sigue usando `getRegionMap(regionId)` por región de campaña. Migrar a un solo mapa mundial es un cambio de UI fuera del alcance de esta
  entrega (otra sesión edita `MapScreen.tsx`; no se tocó).
- `routePlanner.ts`/`airfields.ts`: siguen operando en marcos locales; `MasterTerrain.airfields()`/`nearestAirfield()` ya dan la vista
  global equivalente para cuando se quiera migrar sin tocar esos archivos ahora.
- `WorldEnvironment.ts` (render): sigue generando la malla del Field de forma local; el streaming por tiles (`masterStreaming.ts`) es la
  vía de reemplazo pero no se ha conectado a Three.js/Rapier todavía (ver §4.3).

## 4. Fase 2 — integración en runtime (construida, no conectada a la escena)

### 4.1 Autoridad geográfica única

[`src/world/master/masterRuntime.ts`](../../src/world/master/masterRuntime.ts) expone `MasterTerrain`, el único punto que gameplay debería
consultar:

- `elevationAt/groundAt/slopeDegAt/waterAt/surfaceAt(x,z)` — terreno, agua y superficie natural por coordenada mundial.
- `regionAt/sampleGeo(x,z)` — macrorregión y datos crudos del master.
- `frame(campaignRegionId)`, `localToWorld/worldToLocal`, `localNaturalElevation` — el puente traducción-rígida entre los 8 marcos locales
  de campaña y el mundo continuo.
- `airfields()/airfield(id)/nearestAirfield()` — los 13 aeródromos reales, posicionados en el mundo y con elevación real.
- `landmarks()/terrainProfile()` — navegación (picos, presa, perfiles de ruta).
- `createMasterRegionTerrain(region)` — un **reemplazo directo** de `createTerrainQueryService(region)` que devuelve el mismo contrato
  `TerrainQueryService`, respaldado por el master en vez del perfil analítico por tipo de terreno. Para `the_field` reproduce el terreno
  legado exactamente (test: elevación y pendiente iguales en 400+ puntos, `< 1e-6 m`).

**Decisión de diseño clave:** ningún detalle procedural nuevo se sintetiza en Fase 2. El relieve es exactamente el heightfield de 48 m del
master, remuestreado con **bicúbica** (Catmull-Rom) para continuidad C¹; dentro del núcleo del Starter Basin se sustituye por la función
analítica exacta del Field (no hay remuestreo ahí, es exacto). Esto es deliberado: mantiene los tiles de streaming "watertight por
construcción" (ver 4.3) y es deuda documentada, no un descuido — los 48 m entre nodos del master seguirán necesitando una capa de detalle
local (ruido/rocas) antes de que el terreno cercano se vea bien a 5 m AGL. Ver §6.

### 4.2 Grading de sitios (spec §33)

Cada sitio de campaña no-Field se allana a **una plataforma plana única** (mediana de altura del rectángulo de la huella + margen de 60 m,
con transición suave de 450 m hacia el terreno natural — igual que el grading de pista de la spec). El datum se recalcula **después** del
relleno de depresiones para que nunca quede una plataforma "flotando" sobre una cuenca que se llena más tarde. Verificado: cada aeródromo
mantiene pendiente < 0.01 m de variación a lo largo de toda la pista (test `runway t=-0.5,0,0.5`).

### 4.3 Streaming / LOD / floating origin (diseño para el terreno completo, pura lógica — sin THREE/Rapier todavía)

[`src/world/master/masterStreaming.ts`](../../src/world/master/masterStreaming.ts):

- **Quadtree de tiles cuadrados**, 33×33 vértices constantes por tile (presupuesto de GPU/collider proporcional al *número* de tiles, no a
  su tamaño). L0 = 512 m (16 m de espaciado, grado físico) hasta L5 = 16.4 km (root). 3×3 roots L5 cubren el mundo entero (48 km) más
  margen.
- **Selección por distancia 3D con histéresis** (evita parpadeo en el borde de un umbral) y **balance 2:1** garantizado por construcción
  (un leaf nunca toca un leaf 2+ niveles más grueso) — el único fix de costura necesario es la clásica unión en T (vértices impares del
  borde = punto medio del vecino más grueso), implementado en `tileHeightGrid` y verificado por test byte-exacto.
- **Anillo de física**: solo tiles L0 dentro de un radio que crece con la velocidad (look-ahead de 14 s) reciben collider; por encima de
  700 m AGL el anillo colapsa al tile bajo la aeronave. Esto es la respuesta directa a "sin comprometer física ni rendimiento": el collider
  nunca cubre más que una vecindad pequeña, incluso con el mundo completo cargado.
  Se pasó por dos iteraciones de test antes de estabilizar el comportamiento (ver §7).
- **Floating origin**: reutiliza `src/world/floatingOrigin.ts` (existente, extendido con `gridSnapM` en vez de reescrito) para que el
  rebase caiga siempre en una esquina de tile de 512 m — los buffers de vértices (relativos al origen) no necesitan recalcularse tras un
  rebase. Umbral 3,072 m: la resolución de float32 a esa distancia es sub-milímetro (`float32ResolutionM`), deliberadamente conservador
  frente al mínimo necesario, documentado como tal.
- **No conectado a Three.js/Rapier todavía.** `masterStreaming.ts` es lógica pura y testeada (14 tests); construir la malla real, subir
  buffers a la GPU y crear/destruir colliders Rapier es la siguiente fase de trabajo (no pedida en esta entrega) — ver §6.

### 4.4 Tests de Fase 2 (26 en `masterRuntime.test.ts` + `masterStreaming.test.ts`, además de los 35 de macrogeografía)

Verifican: conservación exacta del Field a través del adaptador; equivalencia con `TerrainQueryService` legado; cada aeródromo real en
tierra, en su macrorregión y sobre su plataforma; las 17 misiones reales jugables (spawn/target en tierra, pendiente suave, enlaces de
aeródromo resuelven en la región correcta, la carrera de distancia no sale del mundo); separación mínima entre sitios y respecto al núcleo
del Field; balance 2:1 de tiles; costura exacta; anillo de física solo-L0; determinismo del streamer; floating origin snapado a la rejilla.

## 5. Reconciliación con la spec v3.0 — sin cambios respecto a la entrega anterior

Se mantiene la tabla completa de la entrega previa (escala, rol del Field, discrepancia de IDs, ausencia del "continente extranjero", etc.)
— ver el historial de git de este archivo. Punto nuevo: la v3.0 no dice nada sobre streaming en tiles; el diseño de §4.3 es compatible con
su chunk de "512×512 m" (spec v3.0 §41) porque L0 usa exactamente ese tamaño.

## 6. Deuda restante (honesta, no oculta)

1. **Streaming no conectado a la escena real** (Three.js/Rapier). Lo que existe es la lógica de selección/costura/anillo de física,
   probada de forma aislada. Cablear esto a `WorldEnvironment.ts` y a los colliders Rapier reales es el siguiente paso obligatorio antes de
   que el mundo completo sea jugable.
2. **Sin detalle sub-tile.** A 16 m de espaciado (L0), un objeto de escala humana (spec §27) no tiene relieve propio; hace falta una capa
   de ruido/rocas/erosión local por encima del master, coherente entre visual y física, antes del vuelo rasante (spec §28, 5–50 m AGL).
3. **R05, R07, R08 sin contenido de campaña.** Geografía lista (Southern Greenbelt, Eastern Island, Southern Archipelago) pero sin
   misiones/aeródromos — la spec pide 18–24 aeródromos; hoy hay 13.
4. **`pressureAltitudeBaseM` en 0 para todos los sitios.** El modelo de atmósfera/ISA de vuelo no se ha rebalanceado para las altitudes
   reales (`the_range` está ahora a 2,103 m real; sus misiones se tunearon originalmente asumiendo aire a nivel del mar local). Cambiar
   esto sin retunear `MISSIONS`/`aircraftRequirement` rompería el balance de vuelo — deliberadamente diferido.
5. **`MapScreen`/`WorldMapCanvas` no consumen el mapa maestro.** El adaptador existe (`buildMasterRegionMap`); conectarlo es un cambio de
   UI que pertenece a la otra sesión activa en esos archivos.
6. **Southern Greenbelt / South Coast** siguen derivando su límite sur mediante una regla de altura suavizada, no completamente por costo
   de relieve — aceptable (test en verde) pero es la regla más "arbitraria" de las nueve.
7. **`sharp` como devDependency** cubre el pipeline de renderizado de validación; no se usa en producción del juego.

## 7. Iteraciones de esta ronda (qué se probó y se descartó)

1. Costa norte: primer rediseño (fiordo en −13.4/17.6) producía una isla desconectada del continente en las pruebas — el fiordo era
   demasiado profundo relativo al ancho de tierra restante; se ajustó la profundidad y el punto de anclaje del fiordo dos veces.
2. Valle Central: primer intento de estrechar los muros generó una anchura correcta en el eje N pero **la métrica de "región" seguía**
   **siendo ancha** porque el costo de cruce de pared era demasiado bajo (60→160) — corregido subiendo el multiplicador de costo de subida
   solo dentro de R02.
3. Isla Oriental: primer rediseño de costa compacta pasó a colisionar el estrecho por debajo de 6 km; se retrasó/adelgazó la costa oeste de
   la isla hasta volver a 6.6 km.
4. Anti-rectas de erosión: **tres intentos**. (a) solo difusión de laderas → suavizó demasiado las crestas (verificado visualmente, no
   solo por métrica). (b) jitter de 1.6 m → insuficiente (persistían rectas visibles). (c) jitter de 24 m + difusión ponderada por cuenca +
   reparto del corte al vecindario → resolvió sin perder nitidez de cresta (confirmado con el recorte del hillshade antes/después y con la
   métrica de isotropía).
5. Reservorio: se re-verificó que seguía formando agua real tras el aumento de jitter (afecta indirectamente la ruta del río); confirmado
   con `stats.json` (2.61 km² a 437 m).
6. Streaming: primera versión de `physicsRing` no colapsaba correctamente a "casi cero" tiles en crucero por culpa de un punto de vista
   exactamente en una esquina de 4 tiles; el test se corrigió para reflejar el comportamiento correcto (colapsa a como máximo el/los
   tile(s) bajo la aeronave, no necesariamente cero) en vez de relajar el código.
7. El primer sitio de `backcountry` buscado automáticamente exigía estar cerca de un lago del master (no existe uno accesible y llano
   cerca) — se corrigió el criterio de búsqueda al confirmar que el lago de `backcountry` es local (`waterBodies.ts`), no depende del
   master; el sitio final (799 m, rango 151 m) es plausible para "pistas cortas entre montañas".

## 8. Métricas finales

| Métrica | Valor |
|---|---|
| Tierra / océano | 55.83 % / 44.17 % |
| Continente / Isla Oriental / islotes | 1,187 km² / **80.9 km²** / archipiélago en cadena |
| Estrecho (mín.) | **6.60 km** |
| Cota máxima | **2,846.6 m**; volcán isla **1,500 m** (dentro de 1,450–1,550); máx. de mar −634 m |
| Aspecto (PCA) de la Isla Oriental | **2.25** (objetivo ≤ 2.5; antes ≈ 4) |
| Área por región (km²) | R01 154.7 · R02 131.0 · R03 320.4 · R04 245.6 · R05 138.0 · R06 109.4 · R07 80.9 · R08 14.2 · R09 92.1 |
| Central Valley (mediana de ancho, N=−6..2) | **7.7 km** (objetivo 5–9); longitud ~19 km |
| Depresiones no declaradas | **0** |
| Isotropía del drenaje (N. Mountains) | ratio 1.04 (objetivo < 1.25) |
| Racha de drenaje recto más larga | ≤ 1.87 km (objetivo < 2.6 km) |
| Lagos | Lago Espejo 0.88 km²@1,589 m · Embalse 2.61 km²@437 m · Laguna costera (agua a cota ≤0) · Lago del Field 2.17 km²@220 m (conservado) |
| Sitios de campaña | 7, todos ≥3 km entre sí y fuera de la zona de fusión del Field; plataforma plana verificada (<0.01 m de variación) |
| Aeródromos reconciliados | 13/13 en tierra, en su macrorregión |
| Misiones reconciliadas | 17/17 jugables (spawn/target en tierra, pendiente suave, enlaces resuelven) |
| Tests de mundo (macrogeografía + runtime + streaming) | **61** (`masterMap.test.ts` 35 + `masterRuntime.test.ts` 12 + `masterStreaming.test.ts` 14) |
| Suite completa del repo | **712/712** tests, `tsc -b` limpio, `oxlint` limpio (2 warnings preexistentes ajenos), `vite build` exitoso |

## 9. Cómo regenerar / verificar

```bash
node scripts/world/run.mjs /scripts/world/renderMasterMap.ts /tmp/mm     # artefactos completos (no committed; ~35 MB)
npx vitest run src/world/master                                          # 61 tests de mundo (macro + runtime + streaming)
npx vitest run                                                           # suite completa (712 tests)
npx tsc -b && npx oxlint src scripts/world && npx vite build
```

Previews pequeñas (JPEG, committed) en [`docs/world/master-map-v1/previews/`](master-map-v1/previews/); métricas completas en
[`docs/world/master-map-v1/stats.json`](master-map-v1/stats.json).
