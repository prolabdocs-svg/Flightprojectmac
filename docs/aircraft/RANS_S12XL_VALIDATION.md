# Validación — estado de trabajo

## Evidencia automatizada actual

- Blender 5.2.2 ejecutó el generador; el GLTF Transform produjo tres GLB Meshopt y publicó los recursos runtime.
- Bounds de los tres GLB: X 9,4488 m, Y 2,2407 m, Z 6,6 m; nariz hacia +Z. La misma envolvente aparece en LOD0/1/2.
- Métricas actuales y procedimiento reproducible: [RANS_S12XL_MODELING.md](RANS_S12XL_MODELING.md).
- `src/render/aircraftRig.test.ts` comprueba que los nombres de nodos extraídos de los tres GLB permiten adjuntar el rig RANS. Incluye alerones, flaps, elevador, timón, hélice y ruedas.
- La prueba encontró y corrigió el nombre del pivote de nariz: el asset exporta `wheel_nose_pivot`; el rig RANS ahora busca ese identificador.
- Última verificación: TypeScript sin errores; `npm run build` pasó; `npm run lint` terminó con advertencias ya existentes fuera de este cambio; 9 pruebas focalizadas pasaron en 5 archivos (55 omitidas por el filtro del comando).
- Revisión de esta iteración: `npm test` completó con 875 tests aprobados y 12 timeouts en cinco archivos (`world/vegetation`, `world/masterWorldAdapter`, `world/master/streamingRuntime`, `map/mapPlan`, `ui/screens/MapScreen`). Los timeouts fueron durante suite con 105 workers; no indican fallos de aserción del RANS. El subconjunto de RANS/rig/assets/flight-model pasó 56 tests y `npm run build` pasó con TypeScript incluido.

## Evidencia visual presente

`assets/aircraft/rans-s12xl/previews/` contiene renders ortográficos cardinales, tres cuartos y acercamientos diagnósticos generados desde Blender. Son vistas del blockout para revisión interna, no superposiciones con planos/fotos ni aprobación geométrica. Los close-ups muestran que el ala tapa parte de la cabina y el motor; esas áreas siguen incompletas frente al brief.

Después de ajustar la posición del motor, se regeneraron las vistas cardinales, tres cuartos y detalles con Blender. Se aprecia el motor inmediatamente detrás de la cabina y las dos palas. Se añadieron paños laterales de policarbonato y se redujeron los travesaños que cortaban la vista. Un close-up cockpit desde dentro ya enseña asientos biplaza, arneses, sticks y panel; falta una vista exterior dedicada con menos oclusión para aprobar la cabina cerrada. No se incorporaron fotos de terceros al repositorio.

## Pendiente para aceptación

- Superponer el plano de tres vistas a escala y documentar desviaciones en vistas frontal, lateral, superior y posterior.
- Capturas de hangar y runtime de vuelo con la cámara y luces del juego; verificar cambios de LOD a distintas distancias y superficies en extremos.
- Demostrar rodaje, giro de rueda nariz, despegue, viraje, vuelo, aterrizaje, daños y persistencia en la interfaz.
- Medir FPS, memoria y carga contra Quicksilver en la misma plataforma/escena.
- Completar motor 582 (radiador, escape, instalación visible), interiores y mecanismo de mando/timón con evidencias de referencia.
- Suite amplia de CI/lint/typecheck actualizada. No afirmar aprobación visual o de producción hasta reunir esa evidencia.
