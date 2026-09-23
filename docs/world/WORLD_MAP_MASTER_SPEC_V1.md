PROJECT FLIGHT

WORLD & MAP MASTER SPECIFICATION

Geographic, Physical, Environmental & Gameplay World Bible

Versión: 1.0
Objetivo: especificación ejecutable del mundo completo.

⸻

0. VISIÓN

El mundo de Project Flight debe sentirse como un territorio real que existía antes de que el jugador llegara.

No debe percibirse como:

* un heightmap procedural;
* biomas pegados unos junto a otros;
* una pista rodeada de props;
* islas de contenido separadas por terreno vacío;
* un mapa construido exclusivamente alrededor de misiones.

Debe percibirse como un pequeño país/archipiélago geográficamente plausible, comprimido para gameplay.

La filosofía central es:

Geografía primero. Gameplay sobre la geografía.

Montañas, ríos, costas, ciudades, carreteras y aeropuertos deben guardar relaciones causales.

Una montaña genera vertientes.

Las vertientes generan cauces.

Los cauces generan valles.

Los valles concentran vegetación, carreteras y asentamientos.

Las ciudades aparecen donde existe agua, terreno razonablemente plano, costa útil o cruces de transporte.

Los aeropuertos aparecen donde la topografía, economía y población justifican su existencia.

Así el mundo deja de parecer diseñado artificialmente.

⸻

1. ESCALA DEL MUNDO

1.1 Escala objetivo

El mapa principal debe utilizar aproximadamente:

48 × 48 km de terreno navegable principal

Área:

≈2,300 km²

No todo será tierra.

Distribución conceptual:

Superficie	Objetivo
Tierra	55–65%
Océano	35–45%
Terreno densamente desarrollado	4–7%
Terreno rural	25–35%
Naturaleza dominante	50–60%

La escala está deliberadamente comprimida.

Debe permitir que un ultraligero lento sienta que realiza un viaje importante sin exigir vuelos excesivamente largos.

⸻

2. FORMA GENERAL

El territorio estará compuesto por:

MAINLAND

Una gran masa terrestre irregular que ocupa aproximadamente el oeste y centro del mapa.

EASTERN ISLAND

Una isla importante separada por un estrecho.

SOUTHERN ARCHIPELAGO

Varias islas pequeñas.

NORTHERN MOUNTAIN MASSIF

Cordillera dominante.

CENTRAL VALLEY

Principal corredor urbano y agrícola.

WESTERN DRYLANDS

Región seca y accidentada.

SOUTH COAST

Zona tropical/subtropical.

EASTERN HIGHLANDS

Relieve montañoso secundario.

Esto permite que un único mapa contenga contrastes enormes sin requerir teletransportación.

⸻

3. MACROGEOGRAFÍA

El mundo debe tener una historia geológica implícita.

3.1 Eje tectónico

La estructura dominante será una cadena montañosa aproximadamente:

NW → SE

Esto determina:

* divisorias de aguas;
* valles;
* sombras orográficas;
* orientación de ríos;
* ubicación de pasos de montaña;
* patrones climáticos.

No utilizar montañas distribuidas aleatoriamente.

⸻

4. ELEVACIONES

Referencia global:

Elemento	Altitud
Océano	0 m
Playa	0–8 m
Llanura costera	5–80 m
Valle central	80–350 m
Meseta	350–900 m
Sierra	900–1,800 m
Alta montaña	1,800–2,700 m
Pico máximo	≈2,850 m

Esto crea diferencias verticales suficientemente grandes para afectar realmente al vuelo.

⸻

5. REGIONES PRINCIPALES

El mundo se divide en 9 macroregiones.

No son niveles.

Son regiones geográficas continuas.

⸻

R01 — STARTER BASIN

Función

Zona inicial.

Debe representar visualmente el nivel más humilde de la progresión.

Terreno

Cuenca semiárida.

Altitud:

180–320 m

Pendientes generalmente menores de 8°.

Suelo:

* tierra seca;
* grava;
* polvo;
* pasto amarillo;
* zonas compactadas;
* pequeños canales de erosión.

Hangar inicial

Aquí se encuentra el aeropuerto/hangar del jugador.

Inicialmente:

* pista de tierra;
* hangares improvisados;
* cerca deteriorada;
* caminos sin pavimentar;
* escasa infraestructura.

La transformación futura de este lugar constituye una representación física de la progresión.

Entorno

No debe estar vacío.

Debe contener:

* granjas;
* pequeñas casas;
* postes;
* cercas;
* árboles aislados;
* caminos rurales;
* cultivos;
* maquinaria;
* pequeños depósitos;
* corrales;
* líneas eléctricas.

Densidad baja pero continua.

⸻

R02 — CENTRAL VALLEY

El corazón económico del mapa.

Geografía

Gran valle delimitado por montañas.

Ancho:

5–9 km

Longitud aproximada:

18 km

Altitud:

100–400 m

Características

* río principal;
* tierras agrícolas;
* carretera principal;
* ferrocarril;
* pueblos;
* ciudad principal;
* aeropuerto regional.

La densidad aumenta gradualmente conforme se aproxima la ciudad.

Nunca:

campo → línea invisible → ciudad

Debe existir:

campo → granjas → suburbio disperso → suburbio → zona comercial → núcleo urbano

⸻

R03 — NORTHERN MOUNTAINS

La región verticalmente más dramática.

Relieve

Picos:

1,600–2,850 m

Valles profundos.

Pendientes:

20–55°.

Elementos:

* riscos;
* barrancos;
* pasos;
* cañones;
* crestas;
* lagos de montaña;
* cascadas;
* bosque de coníferas.

Gameplay

Introduce:

* turbulencia;
* corrientes ascendentes;
* vuelos por valle;
* obstáculos naturales;
* aeródromos difíciles;
* clima rápidamente cambiante.

Los aviones iniciales pueden aproximarse a ciertas zonas, pero atravesar cómodamente la cordillera requerirá mejores prestaciones.

⸻

R04 — WESTERN BADLANDS

Región seca.

Inspiración conceptual:

* altiplano;
* Arizona;
* norte de México;
* Baja California.

No debe copiar ninguna ubicación real.

Elementos

* mesas;
* cañones;
* roca expuesta;
* arroyos secos;
* matorral;
* enormes vistas;
* minas;
* carreteras aisladas;
* pistas clandestinas/abandonadas;
* pueblos mineros.

Paleta:

ocre, arena, rojo apagado y vegetación desaturada.

⸻

R05 — SOUTHERN GREENBELT

Transición hacia clima húmedo.

Geografía

Colinas suaves.

Altitud:

50–650 m.

Vegetación

* bosque subtropical;
* campos verdes;
* vegetación densa alrededor de agua;
* plantaciones;
* palmeras progresivamente más frecuentes.

Debe existir una transición de varios kilómetros entre clima seco y húmedo.

⸻

R06 — SOUTH COAST

Región costera principal.

Características

* playas;
* bahías;
* acantilados;
* manglares;
* lagunas;
* pequeños puertos;
* pueblo turístico;
* carreteras costeras;
* aeródromo costero.

La línea costera debe ser irregular.

Nunca generar una costa suavemente sinusoidal.

Debe contener escalas distintas:

Macro

cabos y bahías.

Meso

calas y penínsulas.

Micro

rocas, pequeñas playas, entradas de agua.

⸻

R07 — EASTERN ISLAND

Primera gran barrera psicológica del jugador.

Desde tierra firme debe poder verse en condiciones atmosféricas adecuadas.

Separación:

6–10 km de agua

Esto convierte cruzar el estrecho en un hito de progresión.

Características

* relieve volcánico;
* costa rocosa;
* pequeña ciudad;
* selva;
* pistas difíciles;
* carreteras serpenteantes.

Pico principal:

≈1,400 m.

⸻

R08 — SOUTHERN ARCHIPELAGO

Pequeñas islas.

Funciones:

* exploración;
* bush flying;
* aterrizajes cortos;
* hidroaviones;
* rutas turísticas.

Algunas islas no deben contener pistas.

Esto aumenta la utilidad futura de aeronaves anfibias como el Icon A5.

⸻

R09 — EASTERN HIGHLANDS

Región avanzada.

Mesetas y montañas complejas.

Debe contener uno de los aeropuertos más difíciles del juego.

Aproximación condicionada por:

* montaña;
* viento;
* pista corta;
* desnivel;
* obstáculos.

⸻

6. HIDROLOGÍA

El agua debe responder al relieve.

Sistema principal

Crear:

1 cuenca hidrográfica dominante

con:

* río principal;
* 4–7 tributarios importantes;
* docenas de pequeños cauces.

El río nace en Northern Mountains.

Desciende hacia Central Valley.

Atraviesa zonas agrícolas.

Forma meandros en terreno plano.

Desemboca en South Coast.

⸻

7. RÍOS

Ancho:

Cabecera:

2–8 m

Curso medio:

10–30 m

Curso bajo:

25–70 m

No utilizar anchura constante.

Debe existir:

* erosión;
* barras de sedimento;
* vegetación ribereña;
* puentes;
* rápidos;
* meandros;
* pequeñas islas fluviales.

⸻

8. LAGOS

Mínimo:

Lake A

Lago montañoso.

Lake B

Embalse artificial.

Debe poseer presa.

Lake C

Laguna costera.

Cada uno visualmente distinto.

⸻

9. CLIMA

El clima deriva de geografía + altitud + proximidad al océano.

No asignar simplemente “weather presets” por bioma.

Variables:

* temperatura;
* humedad;
* viento;
* nubosidad;
* precipitación;
* visibilidad;
* presión;
* altitud.

⸻

10. VIENTO

Debe tener interacción con el relieve.

Costa

Brisa marina.

Valle

Canalización del viento.

Montaña

Updraft en barlovento.

Downdraft en sotavento.

Crestas

Turbulencia.

Tormentas

Ráfagas variables.

Esto transforma el mapa físico en parte del modelo de vuelo.

⸻

11. BIOMAS

Biomas principales:

1. Semi-arid scrubland
2. Agricultural valley
3. Temperate grassland
4. Pine forest
5. Alpine terrain
6. Badlands
7. Subtropical forest
8. Tropical coast
9. Mangrove
10. Volcanic island
11. Urban
12. Wetland

⸻

12. ECOTONOS

Elemento obligatorio.

Los biomas nunca deben encontrarse mediante líneas.

Ejemplo:

desierto → matorral → pastizal seco → pastizal → bosque disperso → bosque

Longitud típica de transición:

500 m–3 km

dependiendo del cambio.

⸻

13. VEGETACIÓN

La vegetación responde a:

species probability = biome × altitude × moisture × slope × water proximity × human disturbance

Por tanto:

un árbol no aparece simplemente porque un RNG determinó una posición.

⸻

14. DENSIDAD

Se utilizarán cinco categorías.

D0 Wilderness

Prácticamente ninguna construcción.

D1 Remote Rural

1–5 estructuras/km².

D2 Agricultural

Granjas y viviendas dispersas.

D3 Periurban

Desarrollo irregular.

D4 Urban

Construcción continua.

La transición debe ser gradual.

⸻

15. RED DE CARRETERAS

Jerarquía:

H1

Autopista principal.

H2

Carreteras regionales.

H3

Carreteras locales.

H4

Caminos rurales.

H5

Caminos de tierra.

Las carreteras deben responder a topografía.

Nunca atravesar una montaña arbitrariamente.

Utilizar:

* valles;
* pasos;
* puentes;
* túneles ocasionales;
* curvas de nivel.

⸻

16. FERROCARRIL

Una línea ferroviaria principal conecta:

puerto → ciudad → valle industrial.

Visualmente proporciona excelentes referencias de navegación aérea.

⸻

17. ASENTAMIENTOS

Jerarquía:

Capital regional

Towns

3–4.

Villages

8–12.

Hamlets

15–25.

Rural clusters

decenas.

⸻

18. CIUDAD PRINCIPAL

No debe intentar imitar GTA mediante miles de edificios únicos.

Debe utilizar composición urbana legible desde el aire.

Distritos:

* downtown;
* industrial;
* suburbios;
* comercial;
* casco antiguo;
* periferia;
* aeropuerto.

Skyline moderado.

La ciudad debe ocupar aproximadamente:

3 × 4 km

pero con periferia irregular.

⸻

19. LANDMARKS

Los landmarks son fundamentales porque el jugador navega en 3D.

Ejemplos:

* torre de radio;
* presa;
* puente grande;
* cantera;
* mina;
* faro;
* estadio;
* puerto;
* fábrica;
* monumento montañoso;
* enorme formación rocosa;
* parque eólico;
* antenas;
* central eléctrica.

Objetivo:

Desde prácticamente cualquier región deben existir 2–4 referencias visuales reconocibles.

⸻

20. AEROPUERTOS

El mapa debe contener aproximadamente:

18–24 puntos de aterrizaje.

No todos serán aeropuertos tradicionales.

⸻

21. CLASES DE AERÓDROMO

A0 — Player Airfield

Base.

A1 — Dirt Strips

5–7.

A2 — Rural paved

3–5.

A3 — Regional

2–3.

A4 — International

A5 — Mountain strips

2–4.

A6 — Island strips

2–3.

A7 — Water landing zones

varias.

⸻

22. PROGRESIÓN GEOGRÁFICA

La progresión no debe utilizar muros invisibles.

Debe emerger de:

* autonomía;
* velocidad;
* techo operacional;
* longitud requerida de pista;
* resistencia al viento;
* capacidad STOL;
* combustible;
* navegación.

Ejemplo:

El jugador puede intentar llegar a Eastern Island desde temprano.

El juego no lo bloquea.

Simplemente su avión puede:

* quedarse sin combustible;
* no superar determinada montaña;
* tener dificultades con viento;
* no disponer de pista apropiada.

Esto conserva la fantasía de mundo abierto.

⸻

23. RUTAS

Cada aeropuerto genera una red de conexiones potenciales.

No diseñar misiones como niveles aislados.

Diseñar:

grafo aeroportuario.

Cada nodo:

Airport
├── position
├── elevation
├── runway
├── runwaySurface
├── runwayLength
├── approachDifficulty
├── fuelAvailability
├── services
├── weatherRisk
├── cargoDemand
└── connections

⸻

24. MAPA DEL JUGADOR

El menú mapa debe representar el mundo real.

No ser una simple pantalla de selección de niveles.

Debe mostrar topografía.

Capas:

* relieve;
* agua;
* carreteras;
* ciudades;
* aeropuertos;
* pistas;
* waypoints;
* rutas;
* clima.

⸻

25. TOPOGRAFÍA DEL MAPA

Utilizar:

* hillshade;
* tintado hipsométrico;
* curvas de nivel discretas;
* sombreado de montaña.

El jugador debe poder distinguir inmediatamente:

montaña vs valle vs costa.

⸻

26. FOG OF DISCOVERY

El mundo existe desde el principio.

Pero información detallada puede descubrirse.

Inicialmente:

* geografía básica visible;
* aeropuertos importantes visibles.

Exploración descubre:

* pistas remotas;
* POI;
* rutas;
* ubicaciones especiales.

⸻

27. ESCALA VISUAL

Uno de los principales problemas de los mundos procedurales es perder escala.

Se deben introducir objetos conocidos:

* automóvil;
* casa;
* poste;
* árbol;
* torre;
* carretera.

Estos objetos proporcionan referencias permanentes del tamaño del avión y del mundo.

⸻

28. COMPOSICIÓN DESDE EL AIRE

Cada zona debe diseñarse específicamente para verse desde:

5 m AGL

Taxi/aterrizaje.

50 m

Vuelo rasante.

200 m

Vuelo ultraligero.

500 m

Vuelo regional.

1,500+ m

Navegación estratégica.

Cada escala necesita información visual diferente.

⸻

29. FRECUENCIA DE INTERÉS

El jugador no debe pasar largos periodos viendo terreno genérico.

Objetivo:

Micro-interest

Cada 100–300 m.

árbol, roca, edificio, camino, cultivo.

Meso-interest

Cada 500–1,500 m.

granja, puente, formación, pequeño pueblo.

Macro-interest

Cada 3–6 km.

ciudad, montaña, aeropuerto, lago, landmark.

⸻

30. ANTI-NOISE RULE

Más objetos ≠ mejor mundo.

Debe existir:

densidad estructurada.

Las zonas naturales necesitan espacio negativo.

Una montaña remota debe sentirse remota.

Un valle urbano debe sentirse ocupado.

El contraste produce escala.

⸻

31. TERRENO TÉCNICO

El terreno debe construirse mediante múltiples capas.

WORLD TERRAIN
│
├── Macro Elevation
│
├── Geological Forms
│
├── Hydraulic Erosion
│
├── Local Relief
│
├── Surface Materials
│
├── Hydrology
│
├── Vegetation
│
├── Human Infrastructure
│
├── Prop Scatter
└── Gameplay Overrides

⸻

32. MACRO HEIGHTFIELD

No utilizar noise directamente como terreno final.

Pipeline:

authored macro shapes
        ↓
mountain masks
        ↓
valley carving
        ↓
watersheds
        ↓
erosion
        ↓
local noise
        ↓
gameplay grading

El noise solamente debe añadir detalle.

Nunca determinar la geografía principal.

⸻

33. RUNWAY GRADING

Cada aeropuerto requiere modificación explícita del terreno.

Radio aproximado:

300–1,000 m

según aeropuerto.

Debe evitarse:

* pista flotante;
* pista enterrada;
* bordes verticales;
* terreno irregular atravesando runway.

La transición hacia terreno natural debe ser suave.

⸻

34. MATERIAL DEL TERRENO

No depender únicamente de textura por bioma.

Material = función de:

altitude
slope
moisture
geology
vegetation
human use

Ejemplo:

pendiente rocosa → roca.

zona plana húmeda → pasto.

zona transitada → tierra.

cauce → grava/sedimento.

⸻

35. GEOLOGÍA VISUAL

Las montañas deben tener estructura.

Introducir:

* estratos;
* fracturas;
* roca expuesta;
* scree;
* erosión;
* cliffs;
* taludes.

Evitar “montañas de plastilina”.

⸻

36. OCEÁNO

El océano no debe ser un plano azul infinito.

Necesita:

* oleaje;
* variación de profundidad;
* espuma;
* rompientes;
* reflejos;
* color dependiente de profundidad;
* interacción costera.

Cerca de costa:

agua clara.

Profundidad:

azul progresivamente oscuro.

⸻

37. ATMÓSFERA

Es esencial para percibir tamaño.

Implementar atmospheric perspective.

Distancia creciente:

* menor contraste;
* menor saturación;
* tendencia al color atmosférico.

Las montañas lejanas deben perder definición gradualmente.

⸻

38. NUBES

Las nubes forman parte de la geografía visual.

Tipos:

* scattered cumulus;
* coastal clouds;
* mountain cap;
* overcast;
* storm cells.

Sombras proyectadas sobre el terreno son obligatorias para mejorar sensación de profundidad.

⸻

39. CICLO DIURNO

El mundo debe ser funcional durante:

* amanecer;
* mañana;
* mediodía;
* tarde;
* golden hour;
* noche.

El sol debe modificar radicalmente la lectura del relieve.

⸻

40. ILUMINACIÓN NOCTURNA

La distribución de luces revela geografía humana.

Desde el aire:

* ciudades brillantes;
* pueblos pequeños;
* carreteras parcialmente iluminadas;
* casas rurales aisladas;
* aeropuertos reconocibles.

No iluminar uniformemente el mapa.

⸻

41. STREAMING

Dividir el mundo en chunks.

Recomendación inicial:

512 × 512 m

o equivalente según performance real.

Sistema:

Player
 ↓
High Detail Ring
 ↓
Medium Detail Ring
 ↓
Low Detail Ring
 ↓
Horizon Representation

⸻

42. LOD

LOD0

0–150 m.

LOD1

150–500 m.

LOD2

500–1,500 m.

LOD3

1.5–5 km.

Impostor/HLOD

5+ km.

Los valores finales deben determinarse mediante profiling mobile.

⸻

43. HORIZON SYSTEM

Un juego de vuelo necesita horizonte mucho más distante que un juego terrestre.

Las montañas principales deben poder observarse a:

15–30 km

aunque mediante representación simplificada.

Nunca permitir que montañas aparezcan súbitamente mediante pop-in.

⸻

44. MOBILE PERFORMANCE

Presupuesto conceptual visible:

Terrain:
1 sistema principal.

Vegetación cercana:
instancing.

Vegetación distante:
clusters/HLOD.

Buildings:
modulares + instancing.

Ciudades lejanas:
HLOD.

Sombras:
prioridad cercana.

Props pequeños:
culling agresivo.

El mundo debe parecer más complejo de lo que realmente se renderiza.

⸻

45. PHYSICS SURFACES

Cada superficie debe poseer propiedades físicas.

ASPHALT
DIRT
GRASS
MUD
SAND
GRAVEL
ROCK
WATER
SNOW

Variables:

* friction;
* rollingResistance;
* bumpiness;
* sink;
* brakingEfficiency;
* particleResponse.

Una pista de tierra debe sentirse físicamente diferente de asfalto.

⸻

46. COLLISION MODEL

No generar collider desde una malla visual simplificada incorrectamente.

Debe existir coherencia:

visual terrain ≈ physics terrain

especialmente en:

* aeropuertos;
* carreteras;
* montañas;
* costas;
* edificios cercanos.

⸻

47. WORLD EVENTS

El mundo puede contener eventos emergentes:

* tormenta;
* incendio forestal;
* niebla;
* inundación;
* carretera bloqueada;
* barco;
* tren;
* tráfico;
* animales;
* trabajos aeroportuarios.

No todos necesitan modificar gameplay inicialmente.

Su función principal es hacer sentir vivo el territorio.

⸻

48. FAUNA

Distribución regional.

Ejemplos:

montaña:
aves.

campo:
ganado.

costa:
aves marinas.

bosque:
fauna terrestre ocasional.

Evitar llenar el mapa de animales.

⸻

49. VEHÍCULOS

Carreteras principales:

tráfico ligero.

Carreteras rurales:

tráfico esporádico.

Aeropuertos:

vehículos de servicio.

Ferrocarril:

tren ocasional.

Océano:

barcos.

Son principalmente indicadores de escala y vida.

⸻

50. STORYTELLING AMBIENTAL

Cada región debe contar pequeñas historias sin texto.

Ejemplos:

avión abandonado;

granja deteriorada;

mina;

pueblo parcialmente abandonado;

hotel costero;

barco encallado;

antigua pista militar;

torre meteorológica;

campamento;

obra vial.

⸻

51. WORLD SIGNATURES

Cada región necesita tres niveles de identidad.

Color signature

Paleta dominante.

Shape signature

Silueta característica.

Landmark signature

Objeto reconocible.

Ejemplo:

Northern Mountains:

Color:
verde oscuro + roca gris.

Shape:
picos verticales.

Landmark:
gran pico dividido.

Esto permite reconocer regiones instantáneamente.

⸻

52. COMPOSICIÓN PROCEDURAL CONTROLADA

Utilizar procedural generation únicamente donde aporta escala.

Procedural

* vegetación;
* rocas pequeñas;
* cultivos;
* edificios secundarios;
* props.

Authored

* montañas principales;
* costas;
* ríos;
* ciudades;
* carreteras principales;
* aeropuertos;
* landmarks;
* vistas importantes.

⸻

53. WORLD DATA MODEL

La implementación debe separar representación visual de datos.

WorldDefinition
├── Regions
├── Terrain
├── Hydrology
├── Climate
├── Biomes
├── Settlements
├── Infrastructure
├── Airports
├── POIs
├── FlightRoutes
├── WeatherZones
└── StreamingCells

⸻

54. REGION DATA

Ejemplo conceptual:

interface WorldRegion {
  id: string
  bounds: Polygon
  biomeProfile: BiomeProfile
  elevationRange: [number, number]
  climate: ClimateProfile
  density: number
  vegetationProfile: VegetationProfile
  geology: GeologyProfile
  landmarks: Landmark[]
}

⸻

55. WORLD SEED

Aunque parte del contenido sea procedural, el mundo principal debe utilizar:

seed fija.

Esto garantiza:

* reproducibilidad;
* QA;
* misiones consistentes;
* landmarks persistentes;
* debugging.

⸻

56. MAP COORDINATES

Establecer un sistema universal.

Centro:

WORLD_ORIGIN = (0,0)

Rango aproximado:

X = -24,000 → +24,000
Z = -24,000 → +24,000

Y representa elevación.

Toda ubicación importante debe registrarse mediante coordenadas.

⸻

57. MASTER MAP

Antes de producir assets finales se debe generar un Master Geographic Map que contenga:

1. coastline;
2. elevation;
3. mountain ranges;
4. watersheds;
5. rivers;
6. lakes;
7. biome boundaries;
8. settlements;
9. roads;
10. rail;
11. airports;
12. landmarks.

Ese mapa se convierte en la autoridad espacial del proyecto.

⸻

58. ORDEN CORRECTO DE CONSTRUCCIÓN

No comenzar colocando casas y árboles.

Construcción:

01 World bounds
↓
02 Coastline
↓
03 Macro elevation
↓
04 Mountains
↓
05 Valleys
↓
06 Watersheds
↓
07 Rivers/lakes
↓
08 Climate
↓
09 Biomes
↓
10 Roads
↓
11 Settlements
↓
12 Airports
↓
13 Landmarks
↓
14 Vegetation
↓
15 Buildings
↓
16 Props
↓
17 Atmospheric systems
↓
18 World activity
↓
19 Gameplay
↓
20 Optimization

⸻

59. PRIMERA VISTA DEL JUGADOR

La pista inicial constituye el primer frame jugable importante.

Desde ella deberían observarse:

Cerca

* tierra;
* pasto;
* hangar;
* cerca;
* vehículos;
* postes.

Media distancia

* granjas;
* carretera;
* árboles;
* edificios rurales.

Fondo

* sierra claramente reconocible.

Cielo

* nubes volumétricas estilizadas;
* haze;
* aves ocasionales.

Debe transmitir inmediatamente:

“Existe un mundo enorme más allá de esta pista.”

⸻

60. EXPERIENCIA DE EXPANSIÓN

La progresión geográfica ideal:

Etapa 1

Starter Basin.

Etapa 2

Central Valley.

Etapa 3

South Coast / Western Badlands.

Etapa 4

Northern Mountains.

Etapa 5

Eastern Island.

Etapa 6

Archipelago + extreme airports.

El jugador no desbloquea mapas.

Su aeronave progresivamente le permite conquistar el mismo mapa.

⸻

61. PRINCIPIO VISUAL

La dirección artística ya definida para Project Flight debe mantenerse.

Esto significa:

formas simplificadas + materiales limpios + geometría deliberada + iluminación sofisticada + terreno creíble.

No perseguimos fotorealismo.

Tampoco low-poly genérico.

La referencia conceptual es:

La claridad y personalidad de Dear Passengers / Emergency Buddies, aplicada a un mundo cuya geografía tiene la credibilidad espacial de un simulador de vuelo.

Los assets pueden ser estilizados.

La geografía no puede sentirse falsa.

⸻

62. REGLA DE SILUETA

Desde gran altitud, incluso sin texturas, el mapa debe seguir siendo interesante.

Si apagamos:

* árboles;
* edificios;
* texturas;
* props;

el terreno desnudo debe conservar:

* composición;
* dirección;
* jerarquía;
* landmarks naturales;
* rutas visuales.

Si el heightfield desnudo parece noise, la geografía está mal.

⸻

63. TEST DEL MAPA

Antes de considerarlo terminado realizar:

Satellite Test

Vista vertical completa.

Debe parecer territorio plausible.

Horizon Test

Capturas desde tierra.

Debe producir horizontes reconocibles.

500m Test

Debe existir composición.

2km Test

Las regiones deben seguir siendo legibles.

Flight Test

Volar cada corredor principal.

Navigation Test

Intentar navegar sin minimapa usando landmarks.

Density Test

No deben existir enormes áreas accidentalmente vacías.

Silence Test

Deben existir áreas deliberadamente vacías.

⸻

64. CRITERIO DE CALIDAD

4–6/10

Terrain procedural con assets distribuidos.

Inaceptable.

7/10

Buen mapa indie.

Geografía reconocible pero limitada.

8/10

Mundo coherente, variado y bien compuesto.

8.5/10

Cada región posee identidad propia, navegación visual clara, transiciones convincentes y geografía que afecta directamente al vuelo.

9/10+

El mundo parece haber sido descubierto en vez de diseñado.

Ese es el objetivo final.

⸻

65. DEFINICIÓN DE DONE

El WORLD MAP V1 no estará terminado hasta existir físicamente:

* macrocontinente;
* isla oriental;
* archipiélago;
* cordillera;
* valle central;
* badlands;
* costa;
* sistema completo de ríos;
* lagos;
* regiones climáticas;
* 12 biomas/ecosistemas;
* red vial;
* ferrocarril;
* ciudad;
* pueblos;
* desarrollo rural;
* 18–24 aeródromos;
* landmarks;
* vegetación;
* world props;
* tráfico básico;
* océano;
* atmósfera;
* clima;
* ciclo día/noche;
* streaming;
* LOD/HLOD;
* colisiones;
* superficies físicas;
* mapa estratégico;
* navegación geográfica.

Y, sobre todo:

el jugador debe poder despegar del humilde aeródromo inicial, elegir una dirección cualquiera y encontrar durante decenas de kilómetros un territorio continuo, reconocible, físicamente coherente y visualmente compuesto.

⸻

66. PRINCIPIO MAESTRO

Todo sistema futuro deberá respetar esta jerarquía:

Geología → relieve → agua → clima → ecosistema → ocupación humana → infraestructura → aviación → gameplay.

Nunca al revés.

Esta cadena causal será la regla fundamental utilizada para construir el mundo de Project Flight.
