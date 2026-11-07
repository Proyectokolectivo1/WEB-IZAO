# Agente de Impresión de Izao Perfumería

Un programa pequeño que vive en el PC de despacho y **imprime solo la guía de cada pedido** apenas está lista.
No necesita que usted haga nada durante el día: solo que el PC esté encendido, con la sesión iniciada y la impresora lista.

---

## Parte 1. Para quien atiende el despacho (no técnica)

### Qué necesita antes de empezar

1. Un PC con **Windows 10 u 11 de 64 bits**, conectado a internet.
2. **Google Chrome** instalado (solo se usa en el modo de respaldo, pero conviene tenerlo).
3. La **impresora de etiquetas ya instalada** en Windows (que imprima una página de prueba normal).
4. El **token del agente**: una clave larga que se crea en el panel de la tienda, en *Agente > Crear agente*. Se muestra **una sola vez**; cópiela y téngala a mano.
5. La carpeta del instalador (el ZIP `IzaoAgent-1.1.0.zip`) que le entregó quien administra la tienda.

### Instalar (10 minutos)

1. Haga clic derecho sobre el ZIP > **Extraer todo...** y deje que cree la carpeta. *(No ejecute nada desde dentro del ZIP.)*
2. Abra la carpeta y haga **doble clic en `Instalar.bat`**.
3. Si Windows muestra "Windows protegió su PC", pulse **Más información > Ejecutar de todas formas**.
4. Responda lo que pide la ventana negra:
   - **Número de la impresora**: escriba el número de su impresora de etiquetas y pulse Enter.
   - **Token**: pegue la clave (clic derecho dentro de la ventana pega el texto). No verá nada mientras pega; es normal. Pulse Enter.
   - **¿Imprimir una página de prueba?**: escriba `S`. Debe salir una hojita con el texto "Prueba de impresion".
   - **¿Abrir Chrome para MasterShop?**: escriba `N`, a menos que le hayan dicho que use el modo panel (ver más abajo).
5. Al final debe decir **"Listo. El agente quedó instalado y en marcha."** Todas las líneas de la revisión deben decir `[ OK ]`.

El programa queda en `C:\IzaoAgent` y se enciende solo cada vez que inicia sesión en Windows.

### Ajustes de Windows (hágalos una sola vez)

El agente necesita que Windows no lo interrumpa:

1. **Que el PC inicie sesión solo** (así, si hay un corte de luz, vuelve a funcionar sin que nadie haga nada):
   tecla Windows + R > escriba `netplwiz` > Enter > desmarque *"Los usuarios deben escribir su nombre y contraseña para usar el equipo"* > Aceptar > escriba la contraseña de este usuario dos veces.
2. **Que no se duerma**: el instalador ya lo configura (no suspender, no apagar el disco). Compruébelo en *Configuración > Sistema > Inicio/apagado y suspensión*: ambos en **Nunca**.
3. **Actualizaciones fuera de horario**: *Configuración > Windows Update > Opciones avanzadas > Horas activas* > elija las horas en que despacha (por ejemplo 7:00 a 20:00). Así Windows no reinicia el PC en pleno trabajo.
4. **No cierre sesión** al terminar el día. Puede apagar la pantalla, pero deje el PC encendido. Si lo apaga, al volver a iniciar sesión el agente arranca solo.
5. En el panel de energía, la opción *"Al cerrar la tapa"* (si es portátil) debe ser **No hacer nada**.

### Cómo saber que todo va bien

- En el **panel de la tienda**, módulo *Agente*, debe verse el agente en **verde** con "último latido" de hace menos de un minuto.
- Haga doble clic en **`Diagnostico.bat`** (en `C:\IzaoAgent`): todas las líneas deben decir `[ OK ]`.
- Para ver qué ha hecho el agente: **`Ver-Registros.bat`** abre la carpeta con los registros (`agent.log`). Si debe enviar esos archivos a soporte, no tienen contraseñas ni el token.

### Archivos útiles de `C:\IzaoAgent`

| Archivo | Para qué sirve |
|---|---|
| `Diagnostico.bat` | Revisa impresora, token y conexión, y dice qué falta |
| `Prueba-Impresion.bat` | Imprime una hojita de prueba en la impresora configurada |
| `Detener.bat` / `Iniciar.bat` | Pausa o vuelve a encender el agente (por ejemplo para cambiar el rollo) |
| `Ver-Registros.bat` | Abre la carpeta de registros |
| `config.yaml` | Ajustes (impresora, copias). Se abre con el Bloc de notas |
| `Iniciar-Sesion-Panel.bat` | Solo modo panel: abre Chrome para iniciar sesión en MasterShop |
| `Desinstalar.bat` | Quita el agente de este PC |

### Si algo falla

| Qué ve | Qué hacer |
|---|---|
| El panel muestra el agente **en rojo** o "sin latido" | Revise que el PC esté encendido, con sesión iniciada y con internet. Si todo está bien, doble clic en `Iniciar.bat`. |
| `Diagnostico.bat` dice **FALTA impresora** | La impresora está apagada, desconectada o cambió de nombre. Enciéndala. Si le cambiaron el nombre, ábralo en `config.yaml` (línea `printer:`) y deje el nombre exacto de Windows. |
| Dice **FALTA token** o **el servidor rechazó el token** | El token cambió o se desactivó el agente. Pida uno nuevo en el panel y ejecute `Instalar.bat` otra vez (conserva su configuración). |
| Una guía salió **dos veces** o **no salió** | El agente nunca reimprime solo. Si no salió, en el panel de la tienda use **Reimprimir** en ese pedido. |
| El panel dice "**el agente se reinició mientras imprimía**" | Es una protección: no sabe si la guía alcanzó a salir, así que no la repite. Mire si salió; si no, use **Reimprimir**. |
| La impresora se quedó **sin papel o apagada** | Windows acepta el trabajo igual y SumatraPDF no avisa de esto. Cuando la impresora vuelva, el trabajo sale solo desde la cola de Windows; si no, use **Reimprimir**. |
| El panel dice "**No se pudo descargar la guía de MasterShop**" | El sitio de MasterShop no entregó el PDF (o el PC no tiene internet). Revise el internet del PC; en el panel use **Reimprimir** en ese pedido. |
| Aparece **"necesita que inicies sesión en MasterShop"** | Solo modo panel. Doble clic en `Iniciar-Sesion-Panel.bat`, inicie sesión (resuelva la verificación si aparece) y **cierre** esa ventana de Chrome. El agente lo reintenta solo cada 5 minutos. |

### Modo panel (respaldo)

Normalmente el servidor consigue la guía por su cuenta (modo API) y el agente solo la imprime. Si MasterShop dejara de dar la guía por API, en el panel de la tienda se cambia el agente a **modo panel**: entonces el agente abre Chrome (con ventana, usando un perfil propio) y descarga la guía desde la página de MasterShop. Para eso:

1. Doble clic en `Iniciar-Sesion-Panel.bat`, inicie sesión en MasterShop y cierre la ventana de Chrome. Se guarda en un perfil exclusivo del agente (no mezcla sus contraseñas personales).
2. Deje el PC con la sesión de Windows abierta. No cierre la ventana de Chrome que abra el agente.
3. Los pasos y botones que usa el agente **se editan en el panel de la tienda**; no hace falta reinstalar nada.

### Actualizar o desinstalar

- **Actualizar** (por ejemplo, de la 1.0 a la 1.1): extraiga el ZIP nuevo en una carpeta nueva y ejecute `Instalar.bat` de nuevo. Conserva `config.yaml`, el token y el historial. Cuando pregunte por el token, responda **N** (No) para conservarlo. Al terminar, `Diagnostico.bat` debe mostrar la versión 1.1.0.
- **Desinstalar**: `Desinstalar.bat` (en `C:\IzaoAgent`). Le preguntará si borra también los registros y las guías guardadas.

---

## Parte 2. Para quien prepara y mantiene el paquete (técnica)

### Estructura

```
apps/print-agent/
  izao_agent/        código (api, agent, store, printer, panel, supervisor, cli, config, secrets, logging_setup)
  tests/             pytest + servidor falso (fake_server.py) + SumatraPDF falso (fake_sumatra.py)
  packaging/         instalar.ps1, desinstalar.ps1, *.bat, entry.py (PyInstaller)
  scripts/build.ps1  empaquetado -> release/IzaoAgent-<versión>.zip
  config.example.yaml
```

Contrato con el servidor: `docs/integraciones/agente-api.md` (v1). Decisiones: `docs/DECISIONES.md` D-028.

### Cómo funciona (resumen)

- Dos hilos: **latido** cada 30 s y **trabajo** cada 10 s (los intervalos los manda el servidor en `/api/agent/config`). Si el servidor falla, se espera 2x, 4x... hasta 5 min.
- Por trabajo: `claim` -> descarga `GET jobs/{id}/label` (contrato 1.1: si el `claim` trae `label_url`, el PDF se baja directo de `https://cdn.bemaster.com` **sin token**, sin seguir redirecciones, máx. 20 s y 10 MB, y debe empezar por `%PDF-`; un fallo se reintenta en los siguientes ciclos y al agotar 3 intentos se reporta `failed`; el enlace se guarda en `agent.db` para sobrevivir a un reinicio) -> `agent.db` (SQLite) anota el intento **antes** de lanzar SumatraPDF -> `result`.
- **Nunca dos veces**: un trabajo `printing` tras un reinicio se cierra como `failed` ("no se reimprimió por seguridad"); un tiempo agotado de SumatraPDF tampoco se reintenta; si el servidor no recibió el resultado se reintenta el aviso, no la impresión; un trabajo automático para una guía ya impresa no se imprime. Las reimpresiones del panel (`reprint: true`) sí.
- **Vigilante** (`izao-agent supervisor`): reinicia el agente si muere o si no da señales de vida en 10 min. Tarea Programada "Izao Agente de Impresion" al iniciar sesión (con respaldo en la carpeta Inicio).
- **Token**: Administrador de credenciales de Windows (`keyring`, servicio `IzaoAgent`); solo conexiones salientes por HTTPS (http solo hacia 127.0.0.1 para pruebas); los logs (`%LOCALAPPDATA%\IzaoAgent\logs`, rotativos 2 MB x 5) pasan por un filtro que tapa el token y cualquier `Bearer ...`.

### Configuración remota que lee el agente (`print` y `panel` de `/api/agent/config`)

El contrato v1 deja `print` y `panel` como objetos libres; el agente espera esta forma (ver D-028):

```json
"print": { "copies": 1, "print_settings": "noscale" },
"panel": {
  "base_url": "https://<panel de MasterShop>/...",
  "logged_in_selector": "css visible solo con sesión",
  "logged_out_selectors": ["css de la pantalla de login"],
  "challenge_selectors": ["css del reto de Cloudflare"],
  "challenge_title_patterns": ["regex del título del reto"],
  "steps": [
    { "name": "obtener_guia", "enabled": true, "actions": [
      { "op": "goto", "url": "https://<mismo host>/..." },
      { "op": "fill", "selector": "css", "value": "{order_number}" },
      { "op": "click", "selector": "css" },
      { "op": "expect_text", "selector": "css", "value": "{order_number}" },
      { "op": "download", "selector": "css", "timeout_ms": 15000 }
    ]},
    { "name": "confirmar", "enabled": false, "actions": [] }
  ]
}
```

Operaciones permitidas (lista cerrada, sin JavaScript): `goto`, `click`, `fill`, `press`, `select_option`, `wait_for`, `wait_ms`, `expect_text`, `download`. Sustituciones: `{order_number}`, `{job_id}`. Un `goto` solo puede ir al mismo host de `base_url`.

### Probar

```powershell
cd apps\print-agent
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q          # servidor falso + SumatraPDF falso: no imprime nada
```

- Las pruebas del modo panel usan el Chrome instalado (se omiten si no está) contra un "panel" local.
- `tests/test_e2e_proceso.py` arranca el agente real como proceso, solo **lista** las impresoras de Windows.
- Prueba real con papel (manual): instalar, `Prueba-Impresion.bat`, y crear en el panel "Imprimir página de prueba". Para usar la impresora virtual de Windows, active *Microsoft Print to PDF* en Características de Windows y elija ese nombre en `config.yaml` (pedirá dónde guardar el PDF; sirve para ver el contenido, no para operar sin supervisión).

### Empaquetar

1. Descargue **SumatraPDF portable de 64 bits** del sitio oficial (https://www.sumatrapdfreader.org/download-free-pdf-viewer), verifique la huella publicada y déjelo como `vendor\SumatraPDF.exe`.
2. `powershell -ExecutionPolicy Bypass -File scripts\build.ps1` — corre las pruebas, ejecuta PyInstaller (`--onedir`, `izao-agent.exe` + `_internal`, ~140 MB por el controlador de Playwright) y genera `release\IzaoAgent-<versión>.zip` con su SHA-256.
3. Entregue el ZIP al despacho (el exe no está firmado: Windows SmartScreen mostrará el aviso del paso 3 de la instalación; firmarlo con un certificado de código lo elimina).
