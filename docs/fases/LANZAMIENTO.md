# Lista de salida a producción — Colombia (/co)

Fecha de la revisión: 2026-11-09 · Responsable: izao-qa · Código revisado: `3efe7ef` (el que corre en producción).
Evidencia: `docs/fases/F9-qa-co-2026-11-09/` (k6, Lighthouse local y de producción, e2e, humo de producción). Informe anterior: `docs/fases/F9-lanzamiento.md` (2026-11-06).
Leyenda: **VERDE** = automatizado y pasa · **DUEÑO** = no se puede cerrar sin una acción o dato del dueño o del proveedor · **FALLA** = defecto de código o de contenido con dueño asignado.
Regla de §31.3: no se apunta el DNS al sitio nuevo hasta que todos los puntos estén en VERDE o con el DUEÑO cerrado.

## 1. Lista de §31.3

| # | Punto | Estado | Evidencia / responsable |
|---|---|---|---|
| 1 | Credenciales de producción cargadas y probadas (Wompi, WhatsApp, MasterShop, Addi, Sistecrédito, OpenRouter) | DUEÑO | Wompi y MasterShop probados solo en sandbox o con pruebas manuales (bitácora izao-pagos 11-06); WhatsApp cargada sin prueba de producción; Addi, OpenRouter y Turnstile sin prueba real; Sistecrédito sin documentación (no vendible por diseño). QA no ve secretos. Dueño + izao-pagos |
| 2 | Plantillas de WhatsApp aprobadas por Meta | DUEÑO | Solo `cobro_abono` activa; las otras 3 esperan SQL del líder; el estado en Meta lo ve solo el dueño |
| 3 | Webhooks registrados y probados (Wompi, WhatsApp, MasterShop) | DUEÑO (parcial) | VERDE: firmas y adaptadores (vitest de wompi, whatsapp, mastershop, addi, sistecredito y core). Falta un evento firmado real de cada proveedor (0 eventos reales de Wompi) |
| 4 | Todas las variantes visibles en CO vinculadas a MasterShop | FALLA / DUEÑO | Producción lista hoy 8 productos en CO, con foto; la vinculación de las variantes de prueba sigue sin hacerse y MasterShop expone 2 productos (bitácora izao-logistica). El dueño sube el catálogo a MasterShop; izao-logistica aplica el SQL |
| 5 | Pedido real contra entrega de bajo valor: abono, creación en MasterShop, guía impresa, cancelación | DUEÑO | Sin hacer; depende de los puntos 1, 2, 4 y 6. El flujo está cubierto con mocks (e2e de checkout con `page.route`, unitarias de COD y del worker) |
| 6 | Agente de impresión instalado y arranca solo tras reiniciar el PC | DUEÑO | Falta `SumatraPDF.exe`, instalar y probar la Tarea Programada y las 10 guías seguidas (izao-agente-windows + dueño) |
| 7 | Backups y restauración verificados | FALLA (parcial) | El backup diario cifrado existe; los de media del 06, 08 y 11 fallaron por permisos y ya se corrigió en el repo (aplica tras el próximo despliegue). La restauración real contra `auth` de Supabase sigue sin probar: falta la llave `age` del dueño y Docker local (Docker Desktop no responde en este equipo). izao-infra + dueño |
| 8 | Políticas revisadas por un abogado | FALLA / DUEÑO | Solo `tratamiento-de-datos` está publicada (200); `politica-de-envios`, `terminos-y-condiciones`, `devoluciones-y-garantias` y `quienes-somos` dan 404 en /co y /ec. La publicada aún trae corchetes de plantilla (`[Centro de Medellin, Medellin]` en CO; en EC la plantilla completa). Dueño y abogado; izao-admin (que el validador no deje corchetes) |
| 9 | Píxeles disparando con eventos de prueba; feeds válidos | FALLA | La tienda no tiene código de Meta Pixel, GA4 ni TikTok (0 coincidencias de `fbq`, `gtag`, `ttq` en el HTML) ni ruta de feeds; la CSP los bloquearía. izao-tienda + izao-infra |
| 10 | Sitemaps enviados; `robots.txt` permite rastreo | VERDE (envío: DUEÑO) | `robots.txt` y sitemaps por país válidos (prueba de producción `f9-produccion`); falta enviarlos a Search Console (dueño) |

## 2. Lista de la skill `izao-qa-lanzamiento` (cierre de fase)

| Punto | Estado | Evidencia |
|---|---|---|
| `pnpm lint`, `typecheck`, `test` | VERDE | 10 de 10 tareas en cada uno; web 176 archivos y 1 618 pruebas; core, ui, whatsapp, sistecredito, wompi, mastershop, addi y worker en verde (2026-11-09) |
| E2E Playwright sobre el build de ejemplo (`STORE_DATOS=ejemplo`) | FALLA (3 pruebas distintas) | 527 pasan, 6 fallan, 191 omitidas (el ejemplo no tiene fotos, categorías ni productos solo-EC). Las 6 son: 2 a11y de contraste (D-Q8), 2 de Iza (D-Q9; escritorio y móvil) y 2 de F1 que pasan al repetirse (agotamiento de sockets de Windows, `ECONNRESET` y `ERR_NO_BUFFER_SPACE`; no son del producto) |
| axe WCAG 2.2 AA en producción | FALLA | 18 rutas por ancho: fallan por consola (CSP y LQIP, D-Q1) y por un contraste intermitente en `/co/catalogo` a 768 px que no se reproduce con 3 s de espera |
| Lighthouse móvil ≥ 90 rend. y ≥ 95 acces. | VERDE | Producción: rend. 94–100 y acces. 100 en home, catálogo y ficha. Carrito y checkout no se re-midieron en producción en esta ronda (local 95–97 / 100) |
| LCP < 2,5 s, CLS < 0,1, TBT < 200 ms, JS < 170 KB | FALLA (catálogo) | Producción: LCP mediana de `/co/catalogo` 3,0 s (3,0 / 2,14 / 3,02) y `/co` 2,25 s; JS 150–167 KB; CLS 0; TBT ≤ 17 ms |
| Carga k6 (catálogo 100 req/s, checkout 10 req/s) | VERDE contra la app; PENDIENTE contra la base real | Sección 3 |
| *Advisors* de Supabase sin alertas críticas | VERDE | Sin nivel ERROR. 62 INFO «RLS sin políticas» (esperado: denegado por defecto, regla 6) y 42 INFO de índices sin uso (tablas casi vacías). WARN: protección contra contraseñas filtradas desactivada (ajuste de Auth; dueño) |
| Revisión de textos (voz de marca, regla 7) | VERDE | Prueba de producción de regla 7: 0 afirmaciones de originalidad, certificados o afiliación y 0 `<img>` de logos de marcas. Los nombres de producto incluyen marcas como nombre comercial: el dueño debe confirmarlo con el catálogo real |
| pgTAP (RLS, `catalog_listing`) | VERDE (último registro) | 01–33 verdes en remoto (ESTADO 11-03); las migraciones 34–38 no se re-corrieron en esta ronda |
| Pruebas manuales (iPhone/Safari, Android/Chrome, tablet, teclado, 10 guías) | DUEÑO | Requieren dispositivos y el PC de despacho |
| Iza contra OpenRouter real | DUEÑO | Sin llave de prueba; solo mocks |
| Abandono de contra entrega con reloj simulado (F4) | PENDIENTE | La lógica tiene pruebas unitarias en el worker; no hay e2e con reloj falso contra el stack completo (requiere Redis y una base de staging) |

## 3. Carga con k6 (build local de ejemplo, NO producción)

Escenario: `pnpm build:e2e` (commit `3efe7ef`) servido con `next start` en `127.0.0.1:3110`, Supabase falso local (`k6/soporte/supabase-checkout-falso.mjs`, 8 ms por consulta simulados), k6 v2.3.0 en la misma máquina. Resultados en `docs/fases/F9-qa-co-2026-11-09/k6/`.

| Script | Tasa sostenida | Solicitudes | p95 | Errores | Umbral |
|---|---|---|---|---|---|
| `catalogo.js` (`/api/catalog`, filtros, orden, cursor) | 100,0 req/s × 3 min | 18 001 | 2,26 ms | 0 % | p95 < 120 ms: cumple |
| `ficha.js` (`/co/perfume/{slug}`) | 50,0 req/s × 2 min | 6 001 | 2,54 ms (máx. 232 ms, petición en frío) | 0 % | p95 < 300 ms (supuesto mío): cumple |
| `paginas.js` (home, catálogo, carrito, checkout) | 60,0 req/s × 2 min | 7 200 | 12,0 ms (home 12,1; catálogo 14,2; carrito 7,2; checkout 7,3) | 0 % | p95 < 300 ms (supuesto mío): cumple |
| `checkout.js` (vista previa + pedido con Wompi) | 10,0 pedidos/s × 2 min | 1 201 pedidos y 1 201 previas | previa 40 ms; **pedido 110,8 ms** | 0 % | p95 < 500 ms (supuesto mío): cumple. El 11.º pedido por minuto de una IP recibe 429: cumple |

Sin iteraciones perdidas en ningún escenario.

Lo que estas cifras **no** prueban (a medir en staging con la base real y Redis, `DATOS=seed`, 520 productos):
- El catálogo se sirvió desde los datos de ejemplo en memoria: no mide `rpc_catalogo`, Postgres ni la caché de Redis. El criterio de F1 «p95 < 120 ms» queda demostrado solo para la capa de aplicación.
- El checkout usa un Supabase falso: no hay bloqueos de stock, disputa de filas ni el `crear_pedido_checkout` real. El link de pago de Wompi no se prepara (el falso no tiene credenciales ni devuelve el pedido): la respuesta trae `payment: null`, como prevé el código. No se llamó a ningún proveedor ni se usó Redis (la cola de COD no se ejerció).
- Cuello de botella observado: el pedido hace del orden de 9 consultas a la base en serie (la vista previa, unas 3), así que su p95 es casi todo latencia de base (110 ms con 8 ms simulados por consulta; el código de la aplicación aporta pocos ms). Con la latencia real del VPS al Supabase de Frankfurt hay que volver a medir antes de abrir la venta; se sugiere a izao-pagos revisar si algunas consultas (ubicación, política, idempotencia) pueden ir en paralelo. La cifra de 9 es una estimación a partir del conteo de consultas del falso.
- Los scripts leen `DATOS=ejemplo` (por defecto) o `DATOS=seed`, y `PAIS=co` (por defecto). Se abortan si `BASE_URL` apunta a `izaoperfumeria.com`.

## 4. Lighthouse (4G simulada en móvil, escritorio con conexión rápida)

Producción real, mediana de 3 corridas (`docs/fases/F9-qa-co-2026-11-09/produccion-lh/`), con fotos reales de banner y de producto (8 productos con imagen en CO):

| Ruta (móvil) | Rend. | Acces. | B. prácticas | SEO | LCP s (corridas) | CLS | TBT ms | JS KB |
|---|---|---|---|---|---|---|---|---|
| /co | 98–99 | 100 | 93 | 100 | 2,25 (1,99 / 2,26 / 2,25) | 0 | 11 | 150 |
| /co/catalogo | 94–98 | 100 | 93 | 100 | **3,0** (3,0 / 2,14 / 3,02) | 0 | 10–17 | 167 |
| /co/perfume/9pm-afnan-para-hombres | 100 | 100 | 100 | 100 | 1,66 (1 corrida) | 0 | 4 | 157 |

Local sobre el build de ejemplo, con un producto en el bolso para carrito y checkout, caché vaciada, mediana de 3 corridas en móvil y 1 en escritorio (`lighthouse/`):

| Ruta | Móvil: rend. / acces. / B.P. / SEO | LCP móvil s | JS KB | Escritorio: rend. / LCP s |
|---|---|---|---|---|
| /co | 97 / 100 / 100 / 100 | 2,63 | 153 | 100 / 0,57 |
| /co/catalogo | 97 / 100 / 100 / 100 | 2,63 | 161 | 100 / 0,59 |
| /co/perfume/{slug} | 97 / 100 / 100 / 100 | 2,64 | 151 | 100 / 0,59 |
| /co/carrito | 95 / 100 / 96 / 66* | 2,86 | 166 | 100 / 0,62 |
| /co/checkout | 97 / 100 / 96 / 66* | 2,56 | 165 | 100 / 0,55 |

\* El SEO 66 de carrito y checkout es `noindex` a propósito. Su B.P. 96 es un error de consola del build de ejemplo, sin diagnosticar.
Lectura: los LCP locales (2,56–2,86 s) son **pesimistas y no concluyentes**: `next start` sirve HTTP/1.1 y la simulación de Lighthouse serializa unos 25 recursos por 6 conexiones; en producción (HTTP/2 detrás de Nginx) la misma ficha mide 1,66 s. El veredicto de LCP es el de producción. Imágenes reales: en el build de ejemplo **no hay** (banners SVG de ejemplo); en producción sí hay fotos, y ahí está el único incumplimiento medido (`/co/catalogo`). Accesibilidad: 100 en todas las rutas medidas por Lighthouse.

## 5. Defectos abiertos de esta ronda

| # | Prioridad | Defecto | Pasos para reproducir | Dueño |
|---|---|---|---|---|
| D-Q1 | Alta | La CSP (`img-src 'self' blob: https:`) bloquea los placeholders LQIP `data:image/webp;base64,…` de las tarjetas: errores de consola en `/co`, `/co/catalogo` y `/ec` (Best Practices 93, antes 100) y el desenfoque de carga nunca se ve (§27.1) | `cd apps/web && pnpm exec playwright test -c tests/playwright.produccion.config.ts -g "home-co @375px"` | izao-infra (CSP: agregar `data:` solo a `img-src`) o izao-tienda (otra forma de LQIP); decide el líder **Estado (feat/correcciones-qa-co): NO corregido en la tienda; pendiente de izao-infra.** La CSP la fija solo Nginx (`infra/nginx/izao-zones.conf`, valor `default` del `map`); la app no envía CSP. Cambio mínimo: `img-src 'self' blob: https:` a `img-src 'self' data: blob: https:` (sin tocar `script-src`), y ajustar `infra/scripts/test-nginx.sh`, `docs/DECISIONES.md` (línea 262) y `docs/RUNBOOK.md` (línea 115). El LQIP son 16 px WebP en base64 (`lib/admin/media/procesar.ts`). |
| D-Q2 | Alta | LCP móvil de `/co/catalogo` con la foto real del banner: mediana 3,0 s (> 2,5 s); `/co` 2,25 s | `CHROME_PATH=<chromium> MODOS=mobile RUTAS=/co/catalogo BASE=https://izaoperfumeria.com node tests/lighthouse/produccion.cjs <carpeta>` (3 veces) | izao-tienda (tamaño y prioridad de la imagen del banner); el TTFB de 200–400 ms es de izao-infra **Estado (feat/correcciones-qa-co, cc3f91d): parcial.** El marcado ya era correcto (`fetchpriority=high`, `loading=eager`, preload en el `<head>`, `sizes` por caja, sin carrusel con un solo banner); sobraba que la primera tarjeta y las tres siguientes pedían su foto con prioridad o ansiosas y competían con el banner: con banner arriba ya no. Local con fotos sintéticas (`EJEMPLO_FOTOS=1`, 1 banner), móvil: LCP 3,31 s a 3,23 s; piso local con banner SVG: 2,63 s (bundle y número de recursos). Opción medida y NO aplicada: `<Suspense>` en el listado de la página 1 (con 180 ms de base simulada, 3,23 s a 2,86 s) porque sin JavaScript el listado queda oculto (`hidden`) y se rompe el respaldo «primer lote en el HTML»; decide el líder. Veredicto final: Lighthouse contra producción. |
| D-Q3 | Bloquea | 4 políticas en 404 y plantilla con corchetes en la publicada | `curl -I https://izaoperfumeria.com/co/pagina/politica-de-envios` | dueño y abogado; izao-admin |
| D-Q4 | Bloquea | EC sin productos visibles (`/api/catalog?country=ec` vacío) | `curl "https://izaoperfumeria.com/api/catalog?country=ec&limit=25"` | dueño (catálogo EC); izao-datos |
| D-Q5 | Bloquea | Sin píxeles ni feeds | buscar `fbq`, `gtag`, `ttq` en el HTML de `/co` | izao-tienda + izao-infra |
| D-Q6 | Media | Sin favicon (404) | `curl -I https://izaoperfumeria.com/favicon.ico` | dueño (logo) + izao-tienda |
| D-Q7 | Baja | `Server: nginx/1.24.0` expone la versión (falta `server_tokens off`) | `curl -I https://izaoperfumeria.com/co` | izao-infra |
| D-Q8 | Media | Contraste insuficiente de `.etiqueta.text-ink/70` sobre `.fondo-tono` (placeholder de imagen sin foto) en la ficha a 768 px | `STORE_DATOS=ejemplo pnpm exec playwright test -c tests/playwright.config.ts a11y/ -g "ficha con formulario de reseña"` (2 pruebas) | izao-tienda **Corregido (f696261):** `PiramideOlfativa` usa `text-ink/80` (mínimo 5,6:1 con los tokens por defecto; era 4,3:1); las 2 pruebas a11y de ficha pasan. |
| D-Q9 | Media | Tras un error del modelo (`codigo: proveedor`) el botón `asesor-iza` no aparece aunque `whatsappNumero` viene en el estado: la prueba «§20.2 un corte de red…» falla de forma determinista en escritorio y móvil | `STORE_DATOS=ejemplo pnpm exec playwright test -c tests/playwright.config.ts e2e/f8-iza.spec.ts -g "corte de red"` | izao-tienda (el archivo de la prueba tiene un cambio suyo sin confirmar; no se debilitó) **Corregido (197cccb): era defecto de la prueba, no del producto.** `asesor-iza` solo se pinta con `whatsappNumero` y en los datos de ejemplo no hay; la prueba no llamaba a `simularEstado`. Pasa en escritorio y móvil. |
| D-Q10 | Informativo | Sin prueba de carga contra la base real ni e2e con reloj simulado del abandono COD | sección 3 | izao-qa con staging |

Corregido en la zona de pruebas: `f9-produccion.spec.ts` exigía HSTS con `includeSubDomains`, pero izao-infra decidió el 2026-11-09 mantenerlo en 6 meses sin `includeSubDomains` ni `preload` (RUNBOOK, «HSTS»); ahora valida `max-age` de al menos 6 meses y sin `preload`. Además se añadió una espera de 700 ms tras las animaciones de entrada por el contraste intermitente.

## 6. Cómo repetir

```bash
# Carga (build de ejemplo + Supabase falso):
pnpm --filter @izao/web build:e2e && bash k6/soporte/levantar-local.sh
k6 run -e BASE_URL=http://127.0.0.1:3110 k6/catalogo.js    # también ficha.js, paginas.js, checkout.js
# Lighthouse local con el bolso lleno:
cd apps/web && BASE=http://127.0.0.1:3110 node tests/lighthouse/local.cjs <carpeta>
# Producción (solo lectura):
cd apps/web && pnpm exec playwright test -c tests/playwright.produccion.config.ts
```
