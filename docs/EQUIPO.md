# Plan del equipo de agentes — Izao Perfumería

Este documento lo lee el **líder** (sesión principal de Claude Code) antes de crear el equipo. Las definiciones de cada rol están en `.claude/agents/`.

## 1. Principios

1. **Contratos primero.** Nadie implementa en paralelo hasta que existan: esquema de base (F0), tipos generados, esquemas `zod` compartidos, interfaces de adaptadores y la máquina de estados del pedido. Con esos contratos, cada agente trabaja sin esperar a los demás.
2. **Cada archivo tiene un dueño.** Dos agentes no editan el mismo archivo. Si un agente necesita un cambio fuera de su zona, se lo pide al dueño por mensaje.
3. **Nada se marca terminado sin revisión.** Toda tarea pasa por `izao-revisor` y por las verificaciones automáticas antes de cerrarse.
4. **Equipos pequeños.** Máximo 4 compañeros activos a la vez (más el líder). Se rota el equipo por oleadas.
5. **El líder coordina, no programa.** Divide, asigna, desbloquea, integra y valida criterios de aceptación. Solo escribe en `docs/` y en la configuración raíz.

## 2. Roles y modelos

| Agente | Modelo | Por qué | Zona (dueño de) |
|---|---|---|---|
| Líder (sesión principal) | `opus` | Planeación, integración y decisiones con toda la especificación | `docs/`, archivos raíz (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`) |
| `izao-db` | `opus` | El esquema es la base de todo; errores aquí se propagan | `packages/db/` |
| `izao-pagos` | `opus` | Dinero, estados y webhooks: cero tolerancia a errores | `packages/core/` (pricing, money, order-state, metrics), `packages/integrations/{wompi,addi,sistecredito,whatsapp}/`, `apps/web/app/api/webhooks/{wompi,addi,sistecredito,whatsapp}/`, `apps/web/app/api/checkout/`, `apps/worker/src/jobs/{payments,whatsapp,cod}/` |
| `izao-logistica` | `opus` | API de MasterShop con trampas y conciliación de costos | `packages/integrations/mastershop/`, `apps/web/app/api/webhooks/mastershop/`, `apps/web/app/api/agent/`, `apps/worker/src/jobs/{carrier,sync}/` |
| `izao-revisor` | `opus` | Revisión de calidad, seguridad y apego a la especificación (solo lectura) | Ninguna (no edita) |
| `izao-tienda` | `sonnet` | UI pública bien especificada | `packages/ui/`, `apps/web/app/[country]/`, `apps/web/app/api/catalog/`, `apps/web/app/api/chat/`, `apps/web/components/store/` |
| `izao-admin` | `sonnet` | Módulos CRUD con patrón repetible | `apps/web/app/admin/`, `apps/web/components/admin/`, `apps/web/app/api/admin/` |
| `izao-agente-windows` | `sonnet` | Programa Python acotado | `apps/print-agent/` |
| `izao-infra` | `sonnet` | Docker, Nginx y scripts con especificación cerrada; único que opera el VPS con el MCP `contabo` | `infra/`, `.github/`, `tools/contabo-mcp/`, `apps/worker/src/{index,queues,cron}.ts` |
| `izao-qa` | `sonnet` | Pruebas e2e, carga, Lighthouse | `apps/web/tests/`, `tests/`, `k6/` |
| `izao-datos` | `haiku` | Datos de *seed* masivos y repetitivos | `packages/db/seed/data/` (archivos de datos; los scripts los escribe `izao-db`) |

Archivos compartidos con dueño único: `apps/web/middleware.ts` y `apps/web/lib/auth/` → `izao-admin`; `apps/web/lib/db/` → `izao-db`; `apps/web/app/layout.tsx` y tokens de tema → `izao-tienda`; `apps/web/app/api/health/` → `izao-infra`.

## 3. Oleadas

| Oleada | Fases | Equipo activo | Entregable de cierre |
|---|---|---|---|
| **0 — Cimientos** (sin paralelo real) | F0 | Líder, `izao-infra`, `izao-db`, `izao-datos` | Monorepo, Docker local, migración inicial con TODO el modelo de §6, RLS, seed, tipos generados, login admin con MFA |
| **1 — Contratos** | F0 → F1 | Líder, `izao-pagos`, `izao-logistica`, `izao-db` | `packages/core` (money, pricing con los 10 casos en verde, order-state, esquemas zod), interfaces de adaptadores, `buildCarrierLines` probado |
| **2 — Producto** | F1 + F2 | `izao-tienda`, `izao-admin`, `izao-db` (soporte), `izao-qa` | Catálogo con scroll infinito, ficha, carrito, contenido y apariencia editables, importación de catálogo |
| **3 — Dinero** | F3 + F4 + F6 | `izao-pagos`, `izao-tienda` (checkout UI), `izao-admin` (módulos de pagos/WhatsApp/descuentos), `izao-qa` | Checkout con Wompi, contra entrega con WhatsApp, Addi y Sistecrédito en sandbox |
| **4 — Despacho** | F5 | `izao-logistica`, `izao-agente-windows`, `izao-admin` (pedidos y agente), `izao-qa` | Pedido en MasterShop, etiqueta, impresión automática |
| **5 — Inteligencia** | F7 + F8 | `izao-pagos` (métricas en core), `izao-admin` (dashboard), `izao-tienda` (Iza), `izao-qa` | Dashboard, gastos, Meta Ads, Excel, chatbot |
| **6 — Lanzamiento** | F9 | `izao-infra`, `izao-qa`, `izao-revisor`, líder | Lista de §31.3 completa |

`izao-revisor` está disponible en todas las oleadas como subagente de revisión.

## 4. Ciclo de cada tarea

1. El líder crea tareas pequeñas (medio día de trabajo como máximo) con: referencia a la sección de la especificación, skill a cargar, archivos que toca, criterio de aceptación verificable y dependencias.
2. El dueño la toma, carga la skill, implementa con pruebas y ejecuta `pnpm lint && pnpm typecheck && pnpm test --filter <paquete>`.
3. Commit solo de sus archivos (`git add <rutas>`, nunca `git add -A`) con mensaje en español: `feat(pagos): link de abono Wompi (§12.2)`.
4. Pide revisión a `izao-revisor` indicando el commit y la sección.
5. Corrige hallazgos críticos y altos. Los medios y bajos quedan como tareas nuevas.
6. El líder verifica el criterio de aceptación y cierra la tarea.

## 5. Reglas de coordinación

- Cambios a contratos compartidos (esquema de base, tipos de `packages/core`, interfaces de adaptadores) solo los hace su dueño y los avisa a todos por mensaje con el resumen del cambio.
- Si un agente queda bloqueado más de dos intentos por la misma causa, se detiene y escribe al líder con el error exacto.
- Ningún agente instala dependencias en la raíz sin pedírselo al líder (evita conflictos en `pnpm-lock.yaml`). Dentro de su paquete, sí, avisando.
- VPS: solo `izao-infra` (y el líder para verificar) usan el MCP `contabo`, siguiendo las reglas de `CLAUDE.md`. Ningún otro agente opera el servidor.
- Credenciales: nadie pide ni escribe secretos. Para probar integraciones se usan *mocks* o variables de sandbox que el dueño del negocio carga en `.env.local`.
- Al final de cada oleada el líder escribe `docs/fases/oleada-N.md` con lo hecho, decisiones y pendientes, y apaga a los compañeros que no siguen.
