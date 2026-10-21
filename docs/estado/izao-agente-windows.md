# Bitácora de izao-agente-windows

## Hecho
- `apps/print-agent/` completo: cola (claim/result/label/heartbeat/config v1), backoff, SQLite anti-reimpresión, SumatraPDF, modo panel (Playwright + perfil persistente, pasos remotos), vigilante, CLI (`run`, `supervisor`, `set-token`, `doctor`, `test-print`, `panel-login`, `stop`), logs rotativos con redacción, token en Credential Manager.
- Pruebas: 60 pytest verdes (servidor falso, SumatraPDF falso, Chrome real contra panel local, proceso real e2e). No imprimen de verdad.
- Empaquetado: `scripts/build.ps1` (PyInstaller `--onedir`, probado: exe arranca, keyring y listado de impresoras ok), `packaging/instalar.ps1` (probado en seco), `desinstalar.ps1`, `.bat`, `README.md` en español.
- D-028 en `docs/DECISIONES.md` (Sumatra y Playwright verificados, reglas de reimpresión, forma de `print`/`panel`).
- Commit: ver `git log -- apps/print-agent`.

## Pendiente
- `vendor/SumatraPDF.exe` (descarga oficial por el dueño/operador) y probar impresión real con la impresora de etiquetas; este PC no tiene "Microsoft Print to PDF" habilitada.
- Capturas de pantalla para el README (solo texto por ahora).
- Instalar y probar la Tarea Programada en el PC de despacho; firma del exe (SmartScreen).
- Selectores/pasos reales del panel de MasterShop (los define el panel de la tienda).

## Siguiente paso exacto
Con el token real: ejecutar `Instalar.bat` en el PC de despacho, `Diagnostico.bat`, crear "Imprimir página de prueba" desde el panel y verificar que sale una vez.

## Decisiones que necesitan al líder
- izao-logistica: documentar en `agente-api.md` la forma de `print`/`panel` (D-028) y exponerla en `print_agents.remote_config`; la lista de empaque hoy cierra `failed` por 501.
- izao-admin: módulo Agente con token (hash `hashTokenAgente`), edición de pasos del panel y Reimprimir (`requested_by=admin:*`).
- `pnpm lint/typecheck/test` no incluye el agente (Python); correr `.venv\Scripts\python -m pytest` en `apps/print-agent` (o añadir un paso de CI de Windows a cargo de izao-infra).
