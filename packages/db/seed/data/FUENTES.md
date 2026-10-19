# Fuentes de los datos de seed

Fecha de consulta de las fuentes geográficas: 2026-10-18.

## Colombia (`co/regions.json`, `co/cities.json`)

- Fuente oficial: DANE, DIVIPOLA (División Político-Administrativa de Colombia).
- Publicación consultada: "DIVIPOLA- Códigos municipios", datos.gov.co, conjunto `gdxc-w37w`, con datos suministrados por el DANE.
  - URL: https://www.datos.gov.co/resource/gdxc-w37w.json (consulta paginada con `$select=cod_dpto,dpto,cod_mpio,nom_mpio`, orden por `cod_mpio`).
  - Fecha de última actualización indicada por el portal: 2026-09-24.
- Conteos:
  - Departamentos: 33 (32 departamentos + Bogotá, D.C.). Código de 2 dígitos.
  - Municipios: 1.122. Código de 5 dígitos.
  - Capitales (`is_capital = true`): 32, una por departamento.
- Limitaciones:
  - La transcripción se hizo leyendo la respuesta paginada del portal mediante WebFetch. Los conteos por departamento son coherentes (Antioquia 125, Boyacá 123, Cundinamarca 116, Santander 87, Nariño 64), pero falta cruzar la lista completa con el archivo oficial del DANE.
  - Cundinamarca (25) no tiene municipio con `is_capital = true`: su capital es Bogotá, D.C., que es entidad territorial propia (código 11) y figura como región aparte.
  - Los nombres de municipios van en MAYÚSCULAS, tal como los publica el DANE. Si la interfaz necesita otro formato, debe aplicarlo la capa de presentación.

## Ecuador (`ec/regions.json`, `ec/cities.json`)

- Fuente oficial: INEC, División Político Administrativa del Ecuador (DPA), tabla de provincias, cantones y parroquias.
  - URL: https://www.ecuadorencifras.gob.ec/documentos/web-inec/Poblacion_y_Demografia/CPV_aplicativos/modulo_cpv/dpa_.pdf
  - Fecha de consulta: 2026-10-18. El PDF no muestra fecha de edición; se usó la versión publicada en esa URL.
- Conteos:
  - Provincias: 24 (códigos 01 a 24).
  - Cantones: 221 (código de 4 dígitos).
  - Capitales (`is_capital = true`): 24, la cabecera cantonal de cada provincia (p. ej. Cuenca 0101, Tulcán 0401, Quito 1701, Guayaquil 0901, Santa Elena 2401).
- Limitaciones:
  - El texto se extrajo del PDF con `pdftotext`. Son 1.023 filas de parroquias.
  - En 74 cantones la separación entre provincia, cantón y parroquia no era automática; esos nombres se resolvieron a mano contra la misma tabla.
  - Se excluyen los tres códigos 90xx ("Zonas no delimitadas"), que no son cantones.
  - Los nombres de cantones van en MAYÚSCULAS, tal como aparecen en el documento.

## Notas generales

- Los productos, marcas, familias, géneros, concentraciones y categorías de `taxonomias/` y `productos.json` son **inventados** para pruebas. Las marcas son ficticias y ningún texto afirma originalidad, autenticidad, certificados ni afiliación con marcas reales.
