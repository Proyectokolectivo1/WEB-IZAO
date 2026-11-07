# F9 — Pruebas de lanzamiento contra producción (solo lectura)

Fecha: 2026-11-06 · Responsable: izao-qa · Objetivo: `https://izaoperfumeria.com` (`/co` y `/ec`), imagen web/worker `066a2c3`.
Reglas: solo lectura. No se crearon pedidos, no se usó el checkout hasta pagar, no se envió WhatsApp, no se escribió en MasterShop ni en la base. El bolso se llenó solo en `localStorage`. Se observó el widget de Turnstile del login, sin interactuar con él.

## Veredicto

**La lista de salida de §31.3 NO está completa: no se puede apuntar el DNS ni abrir la venta.** Lo técnico del sitio público (rendimiento, accesibilidad, cabeceras, SEO base) está sólido; lo que falta es contenido, integración real y pruebas de extremo a extremo con datos reales.

## 1. Lista de salida §31.3

| # | Punto | Estado | Evidencia |
|---|---|---|---|
| 1 | Credenciales de producción cargadas y probadas | **NO VERIFICABLE / incompleto** | Wompi solo en sandbox (bitácora izao-pagos 06-11: webhook GET 405, firma inválida 401, 0 eventos reales). MasterShop y WhatsApp cargadas por el dueño (ESTADO 11-04), sin prueba de producción de WhatsApp. Addi sandbox pendiente, Sistecrédito sin documentación, OpenRouter sin prueba real. Depende del dueño/izao-pagos. |
| 2 | Plantillas de WhatsApp aprobadas por Meta | **NO VERIFICABLE** | Solo `cobro_abono` activa; las otras 3 plantillas esperan SQL del líder (bitácora izao-pagos). Estado en Meta solo lo ve el dueño. |
| 3 | Webhooks registrados y probados (Wompi, WhatsApp, MasterShop) | **NO VERIFICABLE (parcial)** | Rutas existen y rechazan GET: wompi 405, addi 405, mastershop/{secreto} 405, whatsapp 403 sin token de verificación. Falta evento firmado real de cada proveedor (no se envía POST en solo lectura). |
| 4 | Todas las variantes visibles en CO vinculadas a MasterShop | **FALLA** | Bitácora izao-logistica/pagos: 1030 variantes sin `mastershop_product_id`; MasterShop lista 2 productos; SQL de 2 filas entregado y sin aplicar. En producción hoy `/api/catalog?country=co` devuelve 2 productos. |
| 5 | Pedido real contra entrega de bajo valor (abono, MasterShop, guía impresa, cancelación) | **FALLA (no hecho)** | Solo hay prueba de MasterShop 3084317 creada y cancelada a mano, sin abono ni guía impresa por el agente. Wompi IZ-CO-000041 expiró sin pagarse. |
| 6 | Agente instalado y arranca solo tras reiniciar | **NO VERIFICABLE** | Contrato 1.1 y versión 1.1.0 en el repo (4192159); sin evidencia de instalación en el PC de despacho. Depende del dueño/izao-agente-windows. |
| 7 | Backups y restauración verificados | **FALLA (parcial)** | Backup diario cifrado OK: `2026-11-03`..`2026-11-06.sql.gz.age` (458–466 KB) en `/srv/izao/backups/db/` (vps_exec, lectura). Restauración solo probada contra un esquema `auth` de fixture; no hay restauración de un backup real de producción (criterio F0 y RUNBOOK). |
| 8 | Políticas revisadas por un abogado | **FALLA** | Solo `tratamiento-de-datos` publicada. `politica-de-envios`, `terminos-y-condiciones`, `devoluciones-y-garantias`, `quienes-somos` dan 404 en ambos países. La publicada muestra corchetes de plantilla (ver D-2). Revisión legal: dueño. |
| 9 | Píxeles disparando con eventos de prueba; feeds válidos | **FALLA** | No hay código de Meta Pixel/GA4/TikTok en la tienda (ni `fbq`, `gtag`, `ttq` en el HTML ni en `apps/web/app|components|lib`; las integraciones existen solo en el panel). La CSP actual (`script-src`/`connect-src`) bloquearía esos dominios. No existe ruta de feeds. |
| 10 | Sitemaps enviados; `robots.txt` permite rastreo | **OK / NO VERIFICABLE el envío** | `robots.txt`: `Allow: /`, bloquea `/admin`, `/api/`, carrito, checkout, pedido, pagar, buscar; 3 `Sitemap:`. `/sitemap.xml` (índice), `/co/sitemap.xml` (23 URL) y `/ec/sitemap.xml` (21 URL, sin productos) válidos y por país. El envío a Search Console es del dueño. |

Criterios de F9 adicionales (§30): pruebas de carga **no ejecutadas** (ver sección 7); manual del admin: `docs/MANUAL_ADMIN.md` existe (no revisado en esta ronda); endurecimiento: ver sección 4.

## 2. Lighthouse (1 corrida por URL, simulado 4G móvil / escritorio)

Evidencia: `docs/fases/F9-evidencia/lighthouse/` (`resumen.json` y HTML móvil). Script: `apps/web/tests/lighthouse/produccion.cjs`.

| Ruta | Modo | Rend. | Acces. | B. prácticas | SEO | LCP s | CLS | TBT ms | TTFB ms | JS KB |
|---|---|---|---|---|---|---|---|---|---|---|
| /co | móvil | 100 | 100 | 96 | 91 | 1.7 | 0 | 15 | 243 | 147 |
| /co | escritorio | 100 | 100 | 96 | 91 | 0.52 | 0 | 0 | 224 | 148 |
| /co/perfume/9pm-afnan-para-hombres | móvil | 98 | 100 | 96 | 91 | 2.37 | 0 | 19 | 211 | 154 |
| /co/perfume/9pm-afnan-para-hombres | escritorio | 100 | 100 | 96 | 91 | 0.55 | 0 | 0 | 230 | 154 |
| /ec | móvil | 100 | 100 | 96 | 91 | 1.41 | 0 | 9 | 215 | 147 |
| /ec | escritorio | 99 | 100 | 96 | 91 | 0.63 | 0 | 0 | 227 | 148 |
| /co/catalogo | móvil | 100 | 100 | 96 | 91 | 1.54 | 0.003 | 7 | 197 | 157 |
| /co/catalogo | escritorio | 100 | 100 | 96 | 91 | 0.47 | 0.001 | 0 | 217 | 157 |
| /co/carrito | móvil | 97 | 100 | 93 | 58* | 2.57 | 0.001 | 9 | 381 | 185 |
| /co/checkout | móvil | 97 | 100 | 93 | 54* | 2.59 | 0 | 15 | 205 | 195 |

\* El SEO bajo en carrito y checkout es `is-crawlable`: son `noindex` a propósito. No es defecto.

Contra umbrales (rend. ≥ 90, acces. ≥ 95, LCP < 2,5 s, CLS < 0,1, TBT < 200 ms, JS < 170 KB):
- Cumplen: home, catálogo, ficha y /ec en todo (LCP máximo 2,37 s en la ficha móvil).
- **No cumplen**: LCP móvil de carrito (2,57 s) y checkout (2,59 s) apenas sobre 2,5 s; JS transferido de carrito (185 KB) y checkout (195 KB) sobre los 170 KB (la métrica de lhci es el total de scripts, cota superior del JS inicial; home/ficha/catálogo 147–157 KB sí pasan).
- SEO 91 en las páginas públicas: falta `meta description` en home, catálogo y /ec (ver D-4).
- Buenas prácticas 96: error de consola por `/favicon.ico` 404 (no hay favicon cargado).

**Limitación:** los productos casi no tienen fotos, así que el LCP medido es de texto (h1 o título). El LCP real con fotos de producto y banners no está medido; la ficha ya está en 2,37 s sin imagen y es el riesgo principal. Repetir con el catálogo y las fotos reales. INP no se mide en laboratorio (TBT ≤ 19 ms como proxy). Una sola corrida por URL, con red desde el equipo de QA hacia el VPS de Europa.

## 3. Accesibilidad (axe WCAG 2.2 AA) y responsive (375 y 768 px)

`apps/web/tests/produccion/f9-produccion.spec.ts`, capturas en `docs/fases/F9-evidencia/capturas/`.
Home, catálogo, ficha, carrito (con un producto), checkout (con un producto), `/co/pagar/{token inválido}`, `/admin/login`, home y catálogo de `/ec`, a 375 y 768 px: **0 violaciones axe, 0 desborde horizontal, 0 errores de consola propios** (18/18). `/pagar` con token inválido responde 404 con `noindex` (esperado). El login del panel ya incluye Turnstile; sus mensajes internos de consola (CSP del iframe de Cloudflare) se descartan por ser de terceros.
Observación visual: a 375 px la home muestra una sección vacía sobre las categorías (línea y «01», sin título ni banner). Probablemente falta de contenido/animación de entrada; izao-tienda debe confirmarlo con contenido real.

## 4. Seguridad de cabeceras y TLS

| Verificación | Resultado |
|---|---|
| TLS | TLS 1.3 (TLS 1.2 ECDHE-AES256-GCM aceptado, 1.1 rechazado). Let's Encrypt, válido hasta 2027-01-16. HTTP→HTTPS 301 y `www`→dominio 301. OK |
| Renovación del certificado | No verificable: la política del MCP no permite leer los timers; izao-infra debe confirmar `certbot` antes del 2027-01-16. |
| HSTS | `max-age=31536000`, **sin `includeSubDomains`** (bajo). |
| CSP | Presente, con `frame-ancestors 'self'`, `object-src 'none'`, `base-uri 'self'`; `script-src` con `'unsafe-inline'` (aceptado por Next sin nonces) y sin `unsafe-eval`. Sin dominios de píxeles (ver punto 9). |
| X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy / COOP | Presentes (SAMEORIGIN, nosniff, strict-origin-when-cross-origin). OK |
| Fuga de versión | `Server: nginx/1.24.0 (Ubuntu)` visible (bajo, `server_tokens off`). |
| Cookies | La tienda no pone cookies a un anónimo. `/admin/login` no emite cookies antes de autenticarse. OK |
| `/admin` y `/api/admin/*` sin sesión | `/admin*` → 303 a `/admin/login`; `/api/admin/*` y `/api/agent/config` → 401 JSON sin datos. OK |
| `/media` | `/media/`, listados, `.html`, `.svg`, `..%2e` → 404. `labels/`, `warranty/`, `agent-screenshots/` → 404. OK (no hay un archivo `.webp` real con el cual comprobar la entrega; sin fotos aún). |
| Archivos sensibles | `/.env`, `/.git/*`, `/package.json`: 404. OK |
| Webhooks y API de pedidos | GET → 404/405/403; `/api/health` solo devuelve status/service/time/uptime. OK |
| 404 de ficha inexistente | 404 limpio, sin pila. OK |

## 5. Regla 7 (contenido)

44 URL del sitemap (CO y EC) más carrito/checkout revisadas: **0 coincidencias** de originalidad, autenticidad, certificado, afiliación, distribuidor oficial, licencia, réplica; **0 etiquetas `<img>`** (sin logos de marcas de terceros). Los nombres de producto de prueba incluyen marcas («9pm Afnan», «One Million Lucky») como nombre comercial; no afirman relación. El dueño debe confirmar ese uso al cargar el catálogo real. Iza (chatbot) no se probó en producción (costaría presupuesto de OpenRouter).

## 6. Humo e2e en solo lectura

35 pruebas de `f9-produccion.spec.ts`: 31 pasan, 4 fallan por defectos del producto (D-1 EC sin productos, D-2 placeholders, D-4 meta description, D-9 cabeceras). Pasan: navegación home→catálogo→categoría→ficha, `/api/catalog`, sugerencias, búsqueda, bolso en `localStorage` (cero POST a checkout/pago), sitemaps, robots, canonical/hreflang recíprocos CO↔EC, cabeceras de `/admin`, `/media`, HTTP→HTTPS. No se observó el error de hidratación #418 en estas cargas (no se midió su frecuencia).
Comando: `cd apps/web && pnpm exec playwright test -c tests/playwright.produccion.config.ts` (`PROD_URL` opcional; la config normal ignora `tests/produccion/`).

## 7. Carga (k6)

Existen `k6/catalogo.js` y `k6/ficha.js`, pero **no se corrieron**: k6 no está instalado y los scripts abortan a propósito si `BASE_URL` contiene `izaoperfumeria.com` (crearía carga real y, en checkout, pedidos). Plan propuesto, sin ejecutar:
1. Copia de staging (o el compose local) con el seed de 520 productos y Redis, mismo tamaño de VPS si es posible.
2. Catálogo: 100 req/s sostenidas 5 min, p95 < 120 ms, errores < 1 %. Ficha: p95 < 300 ms (supuesto mío).
3. Checkout (`k6/checkout.js`, aún por escribir): 10 req/s con Wompi/Addi/WhatsApp/MasterShop en mock; nunca contra producción.
4. En producción solo, con autorización del dueño y fuera de horario, un humo de ≤ 10 VUs / 1 min sobre catálogo y ficha, quitando la guarda de forma explícita.

## 8. Defectos priorizados

| # | Prioridad | Defecto | Dueño sugerido |
|---|---|---|---|
| D-1 | Bloquea | Catálogo real ausente: CO tiene 2 productos, **EC tiene 0** (`/api/catalog?country=ec` vacío, sitemap EC sin productos), casi sin fotos; 1030 variantes sin vínculo a MasterShop. | dueño (catálogo, fotos, IDs) + izao-logistica (SQL de vinculación) + izao-datos |
| D-2 | Bloquea | Políticas: solo se publicó tratamiento de datos; faltan envíos, términos, devoluciones y garantías, quiénes somos. La publicada y `/garantias` muestran placeholders: `[IZAOPERFUMERIAS.A.S] [901855564] [Centro de Medellin, Medellin] [correo] [+57314665558] [1-11-2026]` y `[5]`/`[30]` días en la garantía (en CO y EC). | dueño y abogado (contenido), izao-admin (que la plantilla/validador no deje corchetes alrededor de valores ya completados), izao-tienda (render de `[5]`/`[30]` en `/garantias`) |
| D-3 | Bloquea | Píxeles y feeds no existen en la tienda y la CSP los bloquearía. | izao-tienda (inyección con consentimiento, feeds) + izao-infra (CSP) |
| D-4 | Alta | Falta `meta description` en home, catálogo y /ec (SEO 91). Título genérico «Izao Perfumería» en home y EC. | izao-tienda (admin: campos SEO de home) |
| D-5 | Alta | Restauración real de backup no probada; sin prueba contra esquema `auth` de Supabase. | izao-infra |
| D-6 | Alta | Flujos reales pendientes: abono COD de punta a punta, Wompi aprobado/rechazado (requiere clic humano en el reglamento), guía impresa por el agente, agente instalado, plantillas de Meta, credenciales de Addi/Sistecrédito/OpenRouter. | dueño, izao-pagos, izao-logistica, izao-agente-windows |
| D-7 | Media | LCP móvil de carrito/checkout 2,57–2,59 s y JS de 185–195 KB (> 170 KB); LCP de la ficha 2,37 s sin foto (riesgo con imágenes). | izao-tienda |
| D-8 | Media | Sin favicon (404, error de consola, B.P. 96). | dueño (logo) + izao-tienda |
| D-9 | Baja | HSTS sin `includeSubDomains`; `Server: nginx/1.24.0` expuesto; confirmar renovación automática del certificado (vence 2027-01-16). | izao-infra |
| D-10 | Baja | k6 sin ejecutar y `checkout.js` sin escribir; INP sin datos de campo; sin prueba manual en iPhone/Android ni de teclado/lector. | izao-qa (con staging) y dueño (dispositivos) |

## 9. Archivos de esta ronda

`apps/web/tests/produccion/f9-produccion.spec.ts`, `apps/web/tests/playwright.produccion.config.ts`, `apps/web/tests/lighthouse/produccion.cjs`, `apps/web/tests/playwright.config.ts` (solo `testIgnore`), `docs/fases/F9-evidencia/` (`hallazgos.json`, `lighthouse/`, `capturas/`).
