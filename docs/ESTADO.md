# Estado del proyecto (índice vivo)

Lo mantiene el líder. Leer esto y `CLAUDE.md` antes que cualquier otra cosa; la especificación solo por secciones (Grep u `offset`). Última actualización: 2026-10-19, tras cerrar la Oleada 1.

## Dónde está todo
- Repo: `C:\Proyectos\WEB-IZAO` (NTFS), rama `main`, GitHub `Proyectokolectivo1/WEB-IZAO` (remoto sin conectar, sin `push`). Git funciona sin `safe.directory`.
- Supabase `wyxjmlgrcjclelbrluvd` (eu-central-1). Migraciones por el MCP de Supabase; archivos en `packages/db/supabase/migrations/` con la versión remota.
- VPS Contabo (Hub Europe, `169.58.102.153`): solo por el MCP `contabo`, que aún no tiene `tools/contabo-mcp/.env`. F0b sin hacer.
- Decisiones: `docs/DECISIONES.md` (D-001 a D-023). Procedimientos: `docs/RUNBOOK.md`, `docs/MANUAL_ADMIN.md`. Cierres: `docs/fases/oleada-0.md`, `oleada-1.md`.

## Hecho (una línea por área)
| Área | Estado | Dónde |
|---|---|---|
| Monorepo, Docker local, Nginx, deploy, backups cifrados | Hecho y revisado | `infra/`, `apps/web`, `apps/worker` |
| Esquema (65 tablas, RLS), seed, 520 productos de prueba, geografía CO/EC | Hecho; pgTAP 15 suites | `packages/db/` |
| Funciones de stock, canje y expiración | Hecho; concurrencia probada en local | `packages/db/supabase/migrations/` |
| Login admin con MFA, roles, bloqueo de intentos | Hecho; sin prueba real (faltan llaves) | `apps/web/lib/auth`, `apps/web/app/admin` |
| `@izao/core`: money, pricing (10 casos), order-state, schemas, contracts | Hecho | `packages/core/src/*` (import por subruta, p. ej. `@izao/core/pricing`) |
| MasterShop sin red: líneas, pedido, estados, mock, cliente | Hecho; sin API real | `packages/integrations/mastershop/` |

## Contratos que no se deben romper
- Dinero: `bigint` en unidad menor; todo cálculo por `@izao/core/money` y `@izao/core/pricing`.
- Estados del pedido solo por `@izao/core/order-state` (`transicionar`).
- Funciones de la base devuelven jsonb `{ok, estado, repetido?, motivo?, advertencia?}`; solo `service_role`.
- `orders.number` y `discount_code_text` los asigna la base.
- Un checkout del servidor usa `checkoutInputSchemaFor(metodosActivos)` y recalcula con `calcularPrecios`.

## Pendiente
**Del dueño:** `tools/contabo-mcp/.env` y `setup-vps.sh`; llaves `age`; `apps/web/.env.local` y `crear-admin`; límites de Auth y CAPTCHA en Supabase; fotos, logo, catálogo real con IDs de MasterShop; datos legales ([COMPLETAR]); mover o borrar la clave `43iCH7rQJ3vx` de `D:\WEB IZAO REACT`; conectar `origin` y autorizar el primer `push`; credenciales de Wompi, WhatsApp, MasterShop, Addi, Sistecrédito, OpenRouter.
**Técnico:** `POST /api/checkout/preview` (vista previa del carrito, izao-pagos, Oleada 3: `CODE_INVALID` único, `max_quantity = min(existencias, pedida)`, `line_discount` por línea, rate limit Redis y Turnstile); F0b (HTTPS y backup real en el VPS); rate limiting con Redis; devolver stock al cancelar o devolver; panel debe impedir `payment_method_settings` activo con `cod_enabled` falso; suites pgTAP 01–12 sin repetir tras las últimas migraciones.

## Oleada en curso
Ninguna lanzada. Propuesta: Oleada 2 (F1 + F2): catálogo, ficha, carrito, panel de productos y contenido. Plan en la conversación del líder; al aprobarse se copia aquí.

## Reglas de continuidad y contexto
1. **Lectura mínima:** `CLAUDE.md`, este archivo, tu definición en `.claude/agents/`, tu skill y SOLO las secciones de la especificación de tu tarea.
2. **Contexto por debajo de ~30 %:** no leas archivos enteros sin necesidad (usa `Grep`, `offset`/`limit`), no vuelques salidas largas (`| tail -20`, `--filter`), no repitas lo que ya está en este archivo, reportes de máximo 25 líneas (archivos, hashes, resultado, dudas).
3. **Tu bitácora:** cada agente mantiene `docs/estado/<tu-agente>.md` (es tuyo; aunque `docs/` sea del líder). Máximo 40 líneas: `Hecho` (con hashes), `Pendiente`, `Siguiente paso exacto`, `Decisiones que necesitan al líder`. Actualízala antes de cada reporte final.
4. **Si estimas que tu contexto pasa de ~30 %:** llega a un punto seguro (pruebas verdes, commit), actualiza tu bitácora y termina con "Punto de retoma: …" en el reporte. No sigas trabajando.
5. **El líder:** al pasar de ~30 % actualiza este archivo, hace commit y propone abrir un chat nuevo con el prompt de retoma de abajo. Nunca cierra una oleada sin actualizar este archivo.
6. **Commits:** `git add -- <rutas> && git commit -o -m "..." -- <rutas>`, con `&&` y `set -o pipefail` si hay tuberías. Nunca `git add -A`.

## Prompt de retoma (pegar en un chat nuevo del líder)
```text
Eres el LÍDER técnico de Izao Perfumería. Lee solo CLAUDE.md, docs/ESTADO.md, docs/EQUIPO.md y el último docs/fases/oleada-N.md; no leas la especificación completa. Revisa docs/estado/*.md para ver el punto de retoma de cada agente y `git log --oneline | head -20`. Resume en 10 líneas dónde estamos y qué sigue; espera mi aprobación antes de crear el equipo de la oleada. Mismas reglas: tú coordinas, no implementas; máximo 4 compañeros; revisión de izao-revisor antes de cerrar; el VPS solo por el MCP contabo.
```
