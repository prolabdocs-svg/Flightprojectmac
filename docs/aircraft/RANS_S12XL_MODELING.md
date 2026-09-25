# Modelado RANS S-12XL

El generador reproducible está en `tools/rans_s12xl/build_rans_s12xl.py`. Genera la fuente GLB en `assets/aircraft/rans-s12xl/models/rans_s12xl_source.glb` y el archivo editable `assets/aircraft/rans-s12xl/source/rans_s12xl_master.blend`. Después, `tools/rans_s12xl/prepare_lods.mjs` consolida mallas estáticas por material y publica LOD0/1/2 en `public/assets/models/airframes/`. Ejecutar Blender antes del script de LODs regenera todos los GLB. Unidades de autoría en metros; parte de ejes de juego (+Z morro, +Y arriba) y aplica conversión única a Blender Z-up/glTF Y-up. Incluye ala alta de tela, cabina lado a lado, tren triciclo, empenaje, motor posterior y hélice impulsora de dos palas. Los pivotes nombrados siguen el rig del proyecto.

Es un blockout estilizado y de baja complejidad: no tiene UV/atlas propio, interior de producción, cableado completo, radiador/escape exactos ni pruebas de intersección. No sustituye una escultura manual de producción ni debe presentarse como fotogrametría. El GLTFLoader confirma bounds 9.4488 × 2.2407 × 6.6 m y morro +Z. La malla no cuenta aún con comparación ortográfica aprobada contra el plano.

## LOD y presupuesto observado

Los niveles reducen detalles secundarios conservando las superficies animadas y pivotes. El pipeline combina mallas estáticas compatibles, comprime con Meshopt y deja por separado ramas mecánicas. Valores medidos con `gltf-transform inspect` y el contador del generador:

| Archivo | Triángulos | Vértices procesados/render | Vértices GPU | GLB | Meshes |
| --- | ---: | ---: | ---: | ---: | ---: |
| LOD0 | 7.822 | — | — | 101,6 KiB | 18 |
| LOD1 | 7.318 | — | — | 96,0 KiB | 17 |
| LOD2 | 7.122 | — | — | 94,4 KiB | 17 |

Recalculado en la corrida Blender + `prepare_lods.mjs` del 2026-09-23, después de separar los paños laterales de vidrio, revisar arcos del canopy y ubicar componentes representativos del Rotax. LOD1 omite las cintas de costilla finas; LOD2 también omite agujas/esferas de instrumentos y cables de bujía. La reducción sigue siendo conservadora y mantiene las proporciones. El script reporta triángulos y meshes; no mide vértices GPU, FPS, memoria residente ni tiempo de carga comparables con Quicksilver. Los campos de vértices quedan vacíos en vez de conservar métricas antiguas incompatibles con estos GLB.
