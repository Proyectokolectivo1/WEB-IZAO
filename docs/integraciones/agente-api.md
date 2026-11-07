# API del agente de impresión (`/api/agent/*`)

Contrato entre el servidor (dueño: izao-logistica) y el agente de Windows (dueño: izao-agente-windows). Fuente: §15.3 y §15.5 de la especificación. Versión del contrato: **1**, revisión **1.1** (compatible: solo agrega campos; un agente 1.0 los ignora).

## Reglas comunes

- Solo HTTPS saliente desde el agente. Base: `https://izaoperfumeria.com`.
- Autenticación: `Authorization: Bearer <token del agente>`. El token (≥ 32 caracteres, `[A-Za-z0-9_-]`) se genera en el panel (módulo Agente) y se muestra una sola vez; el servidor guarda `print_agents.token_hash = sha256(token)` en hexadecimal minúscula. Agente inexistente o `is_active = false` → `401`.
- Cuerpos y respuestas en JSON UTF-8 (salvo el PDF). Sin caché (`cache-control: no-store`).
- Errores: `{ "error": "<codigo>" }` con el HTTP correspondiente; nunca detalles de la base.
  - `400 datos_invalidos` · `401 no_autorizado` · `404 no_encontrado` · `409 estado_invalido` · `413 muy_grande` · `501 no_disponible` · `503 no_disponible_temporalmente` (reintentar con espera).
- Idempotencia: repetir una llamada con el mismo resultado no cambia nada y responde `200`. El agente puede reintentar cualquier llamada ante red caída o `5xx`.
- Fechas en ISO 8601 UTC.

## `POST /api/agent/heartbeat`

Cada 30 s.

```json
{
  "version": "1.0.0",
  "printer": "Zebra ZD220",
  "printer_ok": true,
  "queue_size": 0,
  "last_error": null,
  "panel_state": "ok"
}
```

- `version` ≤ 40, `printer` ≤ 200 o `null`, `queue_size` entero ≥ 0, `last_error` ≤ 500 o `null`, `panel_state` opcional: `ok` | `needs_login` | `paused` | `disabled`.
- Guarda `last_heartbeat_at`, `version`, `printer_name` y `status_payload`. El modo (`api`/`panel`) lo decide el servidor (ver `config`).

Respuesta `200`: `{ "ok": true, "server_time": "…", "config_version": "…" }`. Si `config_version` cambió, el agente vuelve a pedir `GET /api/agent/config`.

## `POST /api/agent/jobs/claim`

Cada 10 s. Cuerpo opcional `{ "max": 5 }` (1–5, defecto 5).

1. Devuelve primero los trabajos que **ya** tiene reclamados este agente sin resultado (reanudar tras un reinicio; el agente consulta su SQLite y, si ya imprimió, solo reporta el resultado).
2. Completa con trabajos `queued` del más antiguo al más nuevo, y con los reclamados por otro agente hace más de 15 min sin resultado (agente caído). El reclamo es un `UPDATE` condicionado al estado leído: dos agentes nunca reciben el mismo trabajo.

```json
{
  "jobs": [
    {
      "id": "6c0e…",
      "type": "label",
      "order_number": "IZ-CO-000123",
      "reprint": false,
      "created_at": "2026-10-20T15:00:00.000Z",
      "claimed_at": "2026-10-20T15:00:05.000Z",
      "label_path": "/api/agent/jobs/6c0e…/label",
      "label_url": null
    }
  ]
}
```

- `type`: `label` | `packing_list` | `test_page`. `reprint = true` cuando lo pidió un admin (`requested_by = admin:<id>`): es un trabajo nuevo con otro `id`; el agente lo imprime aunque ya haya impreso la etiqueta de ese pedido.
- `label_url` (1.1): `null` salvo en `label` cuando el servidor **no** tiene copia del PDF (el CDN de MasterShop bloquea la IP del VPS, D-051). Entonces el agente:
  1. Descarga el PDF desde `label_url` con su propia conexión (IP de Colombia), **sin** `Authorization` ni el token del agente, sin seguir redirecciones a otro host, tiempo límite 20 s, tope 10 MB, y exige cabecera `%PDF-`.
  2. Valida antes de pedirla: `https`, puerto 443, host exactamente `cdn.bemaster.com` (el servidor ya la filtra; el agente lo repite).
  3. Si falla (403/404/red), reintenta con espera como cualquier impresión y, al agotar, reporta `failed` con el error (el panel puede reimprimir).
  Si `label_url` es `null`, usa `label_path` como en 1.0. `GET /label` sigue respondiendo `404` cuando no hay copia en el servidor.
- Regla: un pedido no se imprime dos veces automáticamente. El servidor solo crea un trabajo automático por envío; el agente no reimprime un `id` que su SQLite marca como impreso.

## `GET /api/agent/jobs/{id}/label`

Descarga el PDF del trabajo (`content-type: application/pdf`). Solo si el trabajo está reclamado por este agente (o ya tiene resultado de este agente). `label`: la guía guardada por el servidor; `test_page`: página de prueba generada por el servidor; `packing_list`: `501 no_disponible` (pendiente). Otro agente o id desconocido → `404`. El agente nunca recibe la llave de MasterShop.

## `POST /api/agent/jobs/{id}/result`

```json
{ "status": "printed", "attempts": 1 }
```

```json
{ "status": "failed", "attempts": 3, "error": "SumatraPDF terminó con código 1", "screenshot_png_base64": "iVBORw0…" }
```

- `status`: `printed` | `failed`. `attempts` 1–10 (intentos locales; el agente hace hasta 3 antes de `failed`). `error` ≤ 1000 (obligatorio en `failed`). `screenshot_png_base64` opcional, PNG ≤ 2 MB (modo panel).
- `claimed` → `printed` (`printed_at`) o `failed` (`error`, alerta en el pedido).
- Idempotente: repetir el mismo resultado → `200 { "ok": true, "duplicado": true }`. Un resultado distinto sobre un trabajo ya cerrado o un trabajo no reclamado por este agente → `409 estado_invalido`.

Respuesta `200`: `{ "ok": true, "duplicado": false }`.

## `GET /api/agent/config`

```json
{
  "contract_version": 1,
  "contract_revision": "1.1",
  "config_version": "…",
  "agent": { "id": "…", "name": "PC despacho", "mode": "api" },
  "intervals": { "heartbeat_seconds": 30, "claim_seconds": 10, "panel_retry_seconds": 300 },
  "max_claim": 5,
  "print": null,
  "panel": null
}
```

- `mode`: `api` (defecto) o `panel` (respaldo, §15.4). `panel` trae la URL del panel de pedidos, los pasos activos y los selectores; `print` puede traer ajustes remotos de impresión (copias, `-print-settings`). Ambos `null` mientras el panel no los configure: el agente usa su `config.yaml`.
- Los intervalos salen de la configuración remota del agente; los valores mostrados son los de §15.

## Pendientes conocidos

- `print_agents.remote_config` (jsonb, objeto) ya existe: el panel debe permitir editar `print`, `panel` e `intervals`; con `{}` se devuelven los valores por defecto.
- Lista de empaque (`packing_list`) generada por el servidor.
- Alerta de agente sin heartbeat > 5 min (job del worker + aviso rojo en el panel).
