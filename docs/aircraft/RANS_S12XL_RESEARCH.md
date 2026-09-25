# RANS S-12XL Airaile — investigación y configuración

Estado: configuración de referencia definida, pero el modelo visual entregado es un blockout estilizado de juego. No se afirma reproducción de un número de serie específico.

## Configuración documentada

Se eligió la fila de 65 hp (Rotax 582) de la hoja de especificaciones S-12XL obtenida del repositorio documental NTSB. La hoja publica envergadura 31 ft, área 152 ft², cuerda media 4 ft 10.5 in, longitud 21 ft 8 in, altura 88 in, cabina 41 in, 2 plazas, 2 puertas, tren triciclo fijo, tanque combinado 18 US gal, Rotax 582 65 hp, hélice de madera 68 in y reductora 1:2.58. La ficha incluye prestaciones a nivel del mar y masa bruta 975 lb, vacío 475 lb, útil 500 lb. Son valores de ficha; no se extrapolan a toda unidad construida.

Convertidos: envergadura 9.4488 m; área 14.1213 m²; cuerda 1.4859 m; longitud 6.604 m; altura 2.2352 m; ancho cockpit 1.0414 m; diámetro hélice 1.7272 m; combustible 68.14 L; masa vacía 215.46 kg; masa bruta 442.25 kg.

## Variante y excepciones

La hoja se titula S-12XL y separa las columnas de motores 503, 582 y 912/912S. La base jugable toma solamente la columna 582. El S-12 original, XL y S-12S no se mezclan: la documentación histórica de Jane's consultada describe al XL con asientos lado a lado y cabina parcial o completa opcional; el S-12S aparece como modelo distinto. RANS publica un manual de instalación separado para el 582 (texto y piezas), además del manual de piezas XL; estos son evidencia primaria de la instalación del motor y de sistemas como flaps, puertas de media altura y ruedas estándar de 6 in, aunque su aplicabilidad a un serial concreto no está establecida. EC-DP9, serial S-12-AV002, está identificado por JetPhotos como S-12XL con Rotax 582 y tiene una foto exterior tomada el 28-mar-2010 por Rafael Alvarez Cacho. AirHistory también identifica EC-CX1 (serie S-12-196) como S-12XL 582, fotografiado el 1-abr-2025; esa página devuelve 403 al acceso automatizado. Las fotos de Commons C-IXII son S-12XL de 2005, licencia CC0, pero no se usaron para afirmar instalación 582.

La ficha de especificaciones documenta hélice de madera, dos palas según Jane's, 68 in, reducción 1:2.58. El fabricante/titular recomienda configuración específica según instalación; no se deduce el sentido de giro o el modelo de buje desde una imagen. Se marca como no verificado. La foto EC-DP9 aporta una configuración fotográfica real de 582, pero solo desde un ángulo exterior y no confirma cada detalle del motor, reductora o hélice.

## Proveniencia y confianza

| Dato | Estado | Fuente | Confianza |
| --- | --- | --- | --- |
| 31 ft, 152 ft², 21 ft 8 in, 88 in, dos plazas, tren fijo triciclo | Documentado | [Hoja S-12XL del repositorio NTSB](https://data.ntsb.gov/Docket/Document/docBLOB?FileExtension=.PDF&FileName=Rans+S+12+Specification+Sheet-Master.PDF&ID=40462454) | Alta para ficha publicada |
| Rotax 582, 65 hp, hélice madera 68 in, reducción 1:2.58 | Documentado | Misma hoja (fila 65 hp) | Alta para esa opción de ficha |
| Instalación 582, sistema de flaps, puertas Lexan y ruedas estándar 6 in | Manuales de piezas/integración del fabricante | [Portal/manuales oficiales RANS](https://www.rans.com/out-of-production-ac-manuals) | Alta para componentes/opciones XL; no asignado a un serial concreto |
| S-12XL 582 fotografiado | Aeronave identificada | [EC-DP9, serial S-12-AV002](https://www.jetphotos.com/photo/6818566) | Alta para identificación; un ángulo y copyright |
| Hélice de dos palas | Documentación técnica histórica | [Jane's/Migavia S-12XL](https://janes.migavia.com/usa/rans/s-12xl.html) | Media |
| Variante específica EC-CX1/582, serie S-12-196 | Identificación de aeronave | [AirHistory EC-CX1](https://www.airhistory.net/photo/808069/EC-CX1) | Alta identificación, acceso visual limitado |
| Ala alta arriostrada, pod, empenaje y disposición de tren del dibujo | Interpretación geométrica | [Plano tres vistas S-12XL](https://data.ntsb.gov/Docket/Document/docBLOB?FileExtension=.PDF&FileName=RANS+S12-XL+Three+View+Drawing-Master.PDF&ID=40397014) | Media-alta, pendiente superposición de píxeles |
| Curvatura de canopy, perfiles, bisagras, geometría de soportes y posiciones de motor | Inferido en blockout | Interpretación prudente del plano y la familia | Baja-media |

## No verificado / pendiente

No quedó acreditado que los manuales de instalación consultados correspondan al serial EC-DP9 o EC-CX1, ni el modelo exacto de reductora instalado, buje, giro, radiador, escape, perfil alar, incidencia, centro de gravedad o deflexiones certificadas. Las cifras aerodinámicas de gameplay del código están etiquetadas como estimadas/calibradas y no constituyen datos de operación real.

## Revisión del blockout (2026-09-23)

La comparación visual del render lateral con el plano NTSB motivó adelantar y elevar el conjunto 582/propulsor hacia el borde posterior de la cabina. El cambio responde a la foto identificada EC-DP9 y al plano; la coordenada exacta no está acotada en las fuentes y sigue siendo una interpretación. Se hizo más baja la sección opaca del pod para abrir visualmente el recinto biplaza y se cerró la piel superior del acristalamiento. El modelo 582 ahora distingue culatas azules, entradas de carburador, cámara de expansión, radiador y mangueras. Esta es una simplificación visual basada en documentación de componentes Rotax 582; su colocación exacta en EC-DP9 no está demostrada.

Las capturas son revisiones de malla, no aprobación final: el ala todavía ocluye parte del conjunto desde ángulos altos y el detalle del motor debe cotejarse con fotos autorizadas más cercanas. La escala global y el sistema de ejes no cambiaron.
