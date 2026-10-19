---
name: izao-agente-impresion
description: Úsala al construir o modificar el agente local de Izao en Python para el PC Windows de despacho — impresión automática de guías con SumatraPDF, cola contra el servidor, heartbeat, modo panel con Playwright y perfil persistente, instalador y arranque automático.
---

# Agente de impresión (Windows)

Referencia: `docs/ESPECIFICACION.md` §15.

## Proyecto

`apps/print-agent/`: Python 3.12, `httpx`, `pydantic`, `pyyaml`, `tenacity`, `playwright` (opcional), SQLite local. Empaquetado con PyInstaller en `izao-agent.exe`. Configuración en `config.yaml` (impresora, copias, ajustes de SumatraPDF, URL del servidor, token, pasos del modo panel y selectores).

## Bucle principal

1. `heartbeat` cada 30 s (versión, impresora, tamaño de cola, último error).
2. `jobs/claim` cada 10 s (hasta 5 trabajos).
3. Por trabajo: descargar PDF desde `jobs/{id}/label` → guardar en `%LOCALAPPDATA%\IzaoAgent\labels` → imprimir → `jobs/{id}/result`.
4. Registrar todo en SQLite para no reimprimir si el servidor no recibió el resultado (reintento del reporte, no de la impresión).

## Impresión

`SumatraPDF.exe -print-to "<impresora>" -print-settings "<ajustes>" -silent "<pdf>"` con timeout de 60 s. Validar que la impresora existe (`win32print.EnumPrinters`) al arrancar y en cada heartbeat. 3 fallos → `failed` con detalle.

## Modo panel (respaldo)

- Playwright con `channel="chrome"`, `headless=False`, `launch_persistent_context(user_data_dir=…\IzaoAgent\chrome-profile)`.
- Pasos y selectores desde la configuración remota (`/api/agent/config`); nada fijo en código.
- PDFs: preferencia `plugins.always_open_pdf_externally = true` y captura del evento de descarga; nunca usar el diálogo de impresión del sistema.
- Reto de Cloudflare o sesión perdida → pausar el modo panel, reportar estado `needs_login`, reintentar cada 5 min.
- Captura de pantalla en cada fallo, subida al servidor.

## Arranque y resiliencia

- Tarea Programada "al iniciar sesión" del usuario de despacho (no servicio en sesión 0, porque impresión y Chrome necesitan sesión de usuario).
- *Watchdog*: proceso supervisor que reinicia el agente si muere.
- Instrucciones de Windows en el README: inicio de sesión automático, no suspender, actualizaciones fuera de horario.

## Seguridad

Solo conexiones salientes HTTPS. Token del agente en el Administrador de credenciales de Windows (`keyring`), no en texto plano. El agente nunca recibe la llave de MasterShop.

## Instalador y README

Script que copia a `C:\IzaoAgent`, incluye SumatraPDF portable, crea la tarea programada, pide el token y abre Chrome con el perfil dedicado para el primer inicio de sesión. README paso a paso para un usuario no técnico, con capturas.

## Pruebas

Servidor de prueba local con trabajos falsos; impresora virtual "Microsoft Print to PDF" en CI de Windows; prueba de que un trabajo no se imprime dos veces tras reiniciar el agente a mitad del proceso.
