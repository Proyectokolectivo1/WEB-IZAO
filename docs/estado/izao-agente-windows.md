# Bitácora de izao-agente-windows

## Hecho
- `apps/print-agent/` completo: cola (claim/result/label/heartbeat/config v1), backoff, SQLite anti-reimpresión, SumatraPDF, modo panel (Playwright + perfil persistente, pasos remotos), vigilante, CLI (`run`, `supervisor`, `set-token`, `doctor`, `test-print`, `panel-login`, `stop`), logs rotativos con redacción, token en Credential Manager.
- Pruebas: 60 pytest verdes (servidor falso, SumatraPDF falso, Chrome real contra panel local, proceso real e2e). No imprimen de verdad.
- Empaquetado: `scripts/build.ps1` (PyInstaller `--onedir`, probado: exe arranca, keyring y listado de impresoras ok), `packaging/instalar.ps1` (probado en seco), `desinstalar.ps1`, `.bat`, `README.md` en español.
- D-028 en `docs/DECISIONES.md` (Sumatra y Playwright verificados, reglas de reimpresión, forma de `print`/`panel`).
- v1.1.0 (contrato 1.1, D-051): `claim` trae `label_url`; el agente baja el PDF directo de `cdn.bemaster.com` (https, 443, host exacto, sin Authorization, sin redirecciones, 20 s, 10 MB, `%PDF-`), reintenta (3 internos + ciclos; 403/no-PDF/etc. falla tras 3 ciclos, sin red espera hasta `printer_wait_minutes`) y reporta `failed` sin secretos. `label_url` se guarda en SQLite (migración automática de bases 1.0) y sobrevive a reinicios. `contract_revision` opcional. 91 pytest verdes (`tests/test_label_url.py`, HTTP simulado).
- Commit: ver `git log -- apps/print-agent`.

## Pendiente
- `vendor/SumatraPDF.exe` (descarga oficial por el dueño/operador) y probar impresión real con la impresora de etiquetas; este PC no tiene "Microsoft Print to PDF" habilitada.
- Capturas de pantalla para el README (solo texto por ahora).
- Instalar y probar la Tarea Programada en el PC de despacho; firma del exe (SmartScreen).
- Selectores/pasos reales del panel de MasterShop (los define el panel de la tienda).

## Siguiente paso exacto
Reconstruir con `scriptsuild.ps1` (necesita `vendor\SumatraPDF.exe`) -> `release\IzaoAgent-1.1.0.zip`. Con el token real: ejecutar `Instalar.bat` en el PC de despacho, `Diagnostico.bat`, crear "Imprimir página de prueba" desde el panel y verificar que sale una vez.

## Decisiones que necesitan al líder
- izao-logistica: documentar en `agente-api.md` la forma de `print`/`panel` (D-028) y exponerla en `print_agents.remote_config`; la lista de empaque hoy cierra `failed` por 501.
- izao-admin: módulo Agente con token (hash `hashTokenAgente`), edición de pasos del panel y Reimprimir (`requested_by=admin:*`).
- `pnpm lint/typecheck/test` no incluye el agente (Python); correr `.venv\Scripts\python -m pytest` en `apps/print-agent` (o añadir un paso de CI de Windows a cargo de izao-infra).
