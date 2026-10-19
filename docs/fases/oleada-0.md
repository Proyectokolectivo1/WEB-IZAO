# Oleada 0 — Cimientos (F0a, tramo local)

Cierre: 2026-10-19. Equipo: `izao-infra`, `izao-db`, `izao-datos`, `izao-admin`; revisión de `izao-revisor` en tres pasadas.

## Hecho

| Área | Entregable | Commits clave |
|---|---|---|
| Monorepo | pnpm + Turborepo, ESLint, Prettier, TypeScript estricto; `apps/web` (Next 15) y `apps/worker` (BullMQ) con `/api/health` | `2cae450`, `d9e9850` |
| Docker y Nginx | Compose local sano (redis, web, worker, uptime); Nginx por entorno (contenedor y host), HSTS, CSP, límites; `deploy.sh` con rollback | `1e77a4b`, `78d0f11`, `80982b8`, `1815783`, `d27e7ec` |
| Backups | `backup.sh` cifrado con age/gpg, permisos 600/700, sin datos de sesiones; `restore.sh` con lista blanca; cron en UTC; alertas | `90de5eb`, `bf9fc28`, `7504509`, `f417145` |
| Base de datos | 65 tablas con RLS, privilegios revocados a `anon`/`authenticated`, `catalog_listing` con triggers, `number_sequences`, retención de `audit_log`; 11 suites pgTAP | `57de118` … `36da56d` |
| Seed | Países, monedas, `country_settings`, plantillas de WhatsApp, páginas legales (en borrador); 57 regiones, 1.343 ciudades; 520 productos ficticios (400 visibles por país) | `9899eea`, `03fe595`, `b026658` |
| Login admin | Login con MFA TOTP aal2, roles de §24.3, sesión de 12 h, cookie propia, bloqueo de intentos, auditoría, `crear-admin` | `5340a70` … `2bff105` |

Decisiones: `docs/DECISIONES.md` D-001 a D-021. Procedimientos: `docs/RUNBOOK.md`, `docs/MANUAL_ADMIN.md`.

## Criterios de aceptación de F0 (§30)

| Criterio | Estado |
|---|---|
| Admin entra con MFA | Cumplido a nivel de código y pruebas (129 en `apps/web`); sin prueba real contra Supabase (faltan llaves) |
| Backup diario generado y restaurado en prueba | Cumplido en local contra un esquema `auth` tipo GoTrue; **no probado contra el `auth` real** |
| HTTPS activo en el dominio | **F0b**: depende del MCP `contabo`, el Nginx del host y el `.env` |

## Revisión

- 1.ª pasada: 4 altos, 12 medios, 13 bajos → corregidos.
- 2.ª pasada: 2 altos nuevos (backup no restauraba el esquema real; `limit_req` evadible), 4 medios → corregidos.
- 3.ª pasada: **APROBADO**; 2 medios (N-1, N-2) y bajos → corregidos en `64f4dc0`, `23b18be` y siguientes.
- Sin secretos en el historial completo; regla 7 sin infracciones.

## Pendientes

**Del dueño**
- Crear `tools/contabo-mcp/.env`, ejecutar `setup-vps.sh` como root una vez en el VPS e instalar `age`; generar las llaves de cifrado de los backups (la privada fuera del VPS).
- Crear `apps/web/.env.local` con las llaves de Supabase y una `APP_ENCRYPTION_KEY` nueva de 32 bytes en base64; correr `crear-admin` y probar el login real.
- Configurar los límites de Auth y el CAPTCHA en Supabase; verificar los límites por IP (todos los ingresos salen de la IP del VPS).
- Mover o borrar la clave `43iCH7rQJ3vx` de `D:\WEB IZAO REACT`; eliminar esa carpeta cuando confirme la copia en C:.
- Conectar `origin` a `Proyectokolectivo1/WEB-IZAO` y autorizar el primer `push` (no se ha subido nada).
- Revisar legalmente las políticas; completar los `[COMPLETAR]` (razón social, NIT, contacto).

**F0b (con el MCP `contabo`)**: inventario y política del VPS, snapshot, Nginx del host, certbot y HTTPS, cron, backup real con la llave age, restauración de un backup real, Uptime Kuma. Registrar el inventario en `docs/RUNBOOK.md`.

**Técnicos**
- Rate limiting con Redis de §26.1 (hoy el bloqueo se cuenta sobre `audit_log`).
- Medir 429 de la zona `izao_next_action` antes de F1 (CGNAT).
- Decidir si la CSP de la tienda conserva `data:` (placeholders de `next/image`).
- Ejecutar pgTAP `01_rls` en Supabase tras cada migración; revisar `get_advisors`.
- Cruzar los municipios de Colombia con el archivo oficial del DANE.
- `.npmrc` con `node-linker=hoisted` queda; reevaluar ahora que el repo está en NTFS.
- Incluir SSO/OAuth de `auth.*` en la lista blanca del backup solo si algún día se usan.
