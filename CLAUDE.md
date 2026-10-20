# Izao Perfumería — Reglas del proyecto

E-commerce de fragancias para Colombia (`/co`, COP) y Ecuador (`/ec`, USD) en `izaoperfumeria.com`.
La fuente de verdad es `docs/ESPECIFICACION.md`. Léela completa antes de la primera tarea y vuelve a la sección correspondiente antes de cada módulo.

## Stack

Next.js 15 (App Router) + React 19 + TypeScript estricto · Tailwind 4 con tokens CSS · `motion` · Supabase (Postgres 17, Auth) proyecto `wyxjmlgrcjclelbrluvd` (eu-central-1) · Redis + BullMQ · Docker Compose en VPS Contabo · Nginx · agente Python en Windows para impresión.
Monorepo pnpm + Turborepo: `apps/web`, `apps/worker`, `apps/print-agent`, `packages/core`, `packages/db`, `packages/integrations`, `packages/ui`.

## Reglas que nunca se rompen

1. **Dinero:** enteros en unidad menor (`bigint`; COP exponente 0, USD exponente 2). Nunca `float`. Todo cálculo pasa por `packages/core/money` y `packages/core/pricing`.
2. **El servidor manda:** precios, descuentos, recargos, abonos y stock se recalculan en el servidor al crear el pedido. El cliente solo muestra.
3. **Nada configurable va quemado:** porcentajes, valores, textos, tiempos, colores y tipografías viven en la base y se editan en el panel. El código solo tiene valores por defecto del *seed*.
4. **Secretos:** infraestructura en `.env` (nunca en git); credenciales comerciales cifradas con AES-256-GCM desde el panel. Nunca se envía un secreto al navegador ni a logs.
5. **Integraciones:** webhooks verifican firma, son idempotentes (`webhook_events`) y encolan; los jobs son idempotentes y con reintentos.
6. **RLS activo en todas las tablas**, denegado por defecto.
7. **Textos:** ningún texto, ficha, política ni respuesta del chatbot afirma originalidad, autenticidad, certificados ni afiliación con marcas. No se usan logos de marcas de terceros.
8. **País:** todo lo comercial (visibilidad, precio, stock, moneda, banners, métodos de pago, transportadora) es por país. La descripción del producto es común.
9. **Español** en interfaz, mensajes, commits y documentación.

## Cómo trabajar

- Construye por las fases de la sección 30 de la especificación y cumple sus criterios de aceptación.
- Usa la skill `izao-*` correspondiente antes de tocar cada área.
- Si algo choca con la documentación oficial de un proveedor, gana el proveedor: ajusta y registra en `docs/DECISIONES.md`.
- Marcadores en la especificación: `[VERIFICAR]` = confirmar contra la documentación oficial antes de codificar; `[COMPLETAR]` = dato del dueño, nunca inventarlo.
- Antes de cerrar una tarea: `pnpm lint && pnpm typecheck && pnpm test`.

## Continuidad y ahorro de contexto

- **Al empezar, lee solo:** este archivo, `docs/ESTADO.md` (qué está hecho, qué falta, contratos y pendientes), tu definición en `.claude/agents/`, tu skill y únicamente las secciones de `docs/ESPECIFICACION.md` que toca tu tarea (con `Grep` u `offset`). No leas la especificación completa ni archivos enteros sin necesidad.
- **Mantén tu contexto por debajo de ~30 %:** salidas largas con `| tail -20` o `--filter`, no repitas lo que ya está en `docs/ESTADO.md`, reportes de máximo 25 líneas (archivos, hashes, resultado, dudas).
- **Tu bitácora:** `docs/estado/<tu-agente>.md` es tuyo (máximo 40 líneas: Hecho con hashes, Pendiente, Siguiente paso exacto, Decisiones que necesitan al líder). Actualízala antes de cada reporte.
- **Si estimas que pasaste de ~30 %:** llega a un punto seguro (pruebas verdes, commit), actualiza tu bitácora y termina con "Punto de retoma: …". El líder abrirá un chat nuevo con el prompt de retoma de `docs/ESTADO.md`; todos retoman desde su bitácora y `git log`.
- **Commits:** `git add -- <rutas> && git commit -o -m "..." -- <rutas>`; nunca `git add -A`; con tuberías usa `set -o pipefail`.

## VPS de Contabo

El VPS se opera **solo** con el MCP `contabo` (`tools/contabo-mcp/`, ver su README). `ssh` y `scp` directos están bloqueados.
- Antes de cualquier cambio de infraestructura: `vps_policy` y `vps_inventory`.
- Cambios difíciles de revertir (Nginx, certificados, primer despliegue, migraciones de datos): `vps_exec` con `snapshot_first: true`.
- El VPS aloja otros proyectos: nunca los toques, aunque un comando lo permitiera.
- Si la política bloquea algo necesario, no busques rodeos: pide al usuario que lo ejecute él.
- Los secretos de producción los sube el usuario; tú solo verificas que existan (`test -f`).
- Repo en `/srv/izao/app`; datos en `/srv/izao/{media,backups,redis,geo,nginx,certbot}`.

## Equipo de agentes

El proyecto se construye con un equipo de agentes definido en `.claude/agents/` y coordinado según `docs/EQUIPO.md` (roles, modelos, dueños de archivos, oleadas y ciclo de revisión). Respeta la zona de archivos de tu rol: no edites archivos de otro dueño; pídeselo por mensaje.

## Skills del proyecto

| Skill | Área |
|---|---|
| `izao-supabase-db` | Migraciones, RLS, índices, `catalog_listing`, límites del plan gratuito |
| `izao-motor-precios` | Descuentos, recargo de financiación, abono y recaudo |
| `izao-catalogo` | Listado infinito, filtros, búsqueda, tarjetas, ficha, caché |
| `izao-imagenes` | Pipeline WebP con `sharp` y entrega de imágenes |
| `izao-diseno-marca` | Tokens, tipografía, animación, voz, accesibilidad |
| `izao-panel-admin` | Convenciones de módulos del panel, permisos, auditoría |
| `izao-integraciones` | Credenciales cifradas, adaptadores, webhooks y jobs |
| `izao-wompi` | Pago completo, link de abono, webhook |
| `izao-financiacion` | Addi y Sistecrédito |
| `izao-contraentrega-whatsapp` | Flujo de abono, plantillas de Meta, recordatorios, abandono |
| `izao-mastershop` | API de MasterShop, pedido, prorrateo, estados, sincronización |
| `izao-agente-impresion` | Agente Python de Windows |
| `izao-metricas` | Dashboard, fórmulas, agregados, Excel |
| `izao-chatbot-iza` | Chatbot con OpenRouter, herramientas y presupuesto |
| `izao-despliegue` | Docker, Nginx, despliegue, backups, monitoreo |
| `izao-qa-lanzamiento` | Pruebas y lista de salida a producción |
