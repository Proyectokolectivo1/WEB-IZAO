# MCP de Contabo para Izao

Servidor MCP local que permite a Claude Code operar el VPS de Contabo **por su cuenta y con límites**: ejecutar comandos de despliegue, leer logs, escribir archivos del proyecto y crear snapshots, sin poder tocar los demás proyectos del servidor, apagar la máquina ni ver secretos.

## Qué incluye

| Herramienta | Qué hace | Riesgo |
|---|---|---|
| `vps_policy` | Muestra qué está permitido | Lectura |
| `vps_inventory` | Sistema, memoria, disco, contenedores, puertos, Nginx, proyecto | Lectura |
| `vps_exec` | Ejecuta un comando validado por la política (opción `snapshot_first`) | Escritura limitada |
| `vps_read_file` | Lee archivos de texto en las raíces permitidas | Lectura |
| `vps_write_file` | Escribe archivos (atómico) dentro de `/srv/izao` | Escritura limitada |
| `vps_docker_logs` | Logs de los servicios de Docker Compose del proyecto | Lectura |
| `contabo_instance` | Estado, IP, región y plan de la instancia | Lectura |
| `contabo_snapshots` | Listar, crear y borrar snapshots creados por este MCP | Escritura limitada |
| `contabo_power_action` | Encender/apagar/reiniciar el VPS | **Deshabilitado** por defecto |

### Protecciones

- **Usuario dedicado `izao`** sin contraseña, solo con llave SSH, y `sudo` limitado a `nginx -t`, recarga de Nginx, certbot y abrir 80/443.
- **Verificación de la huella del servidor** (evita conectarse a un equipo suplantado).
- **Política de comandos** (modo `restricted`): solo comandos de lectura, git y Docker Compose del proyecto, contenedores `izao*`, archivos dentro de `/srv/izao` y `/tmp/izao`, scripts de `/srv/izao/app/infra/scripts`.
- **Bloqueado siempre**: apagar o reiniciar, detener servicios, `docker system/volume prune`, `compose down -v`, gestión de usuarios, firewall, SSH, `apt remove/upgrade`, shell de root, leer o escribir `.env`, llaves o certificados privados, listar variables de entorno, `$()`, backticks, `eval`, `source`.
- **Secretos ocultos** en toda salida (llaves de Supabase, Wompi, Meta, OpenRouter, contraseñas en URLs, JWT, llaves privadas).
- **Auditoría** de cada llamada en `tools/contabo-mcp/logs/audit.jsonl` (con secretos ocultos).

Ten presente que el grupo `docker` da privilegios equivalentes a root en el servidor: la política del MCP es la barrera principal, por eso la llave privada solo debe existir en tu PC.

## Instalación (una sola vez)

### 1. Llave SSH para Claude Code (en tu PC)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/izao_claude_code -C izao-claude-code
```

En Windows (PowerShell) el comando es el mismo; la llave queda en `C:\Users\TU_USUARIO\.ssh\`.

### 2. Preparar el VPS (como root, una vez)

Copia el script y ejecútalo con tu llave **pública**:

```bash
scp tools/contabo-mcp/setup-vps.sh root@IP_DEL_VPS:/root/
ssh root@IP_DEL_VPS
bash /root/setup-vps.sh "PEGA_AQUÍ_EL_CONTENIDO_DE_izao_claude_code.pub"
```

El script crea el usuario `izao`, los directorios de `/srv/izao`, el `sudo` limitado y el enlace de Nginx (si hay Nginx en el host). **No toca nada de los otros proyectos.** Al final imprime `VPS_HOST`, `VPS_PORT` y `VPS_HOST_KEY_SHA256`.

### 3. Credenciales de la API de Contabo (opcional, para snapshots)

Panel de Contabo → **API** → copia Client ID y Client Secret, define el API Password. El API User es tu correo de Contabo. El ID de la instancia aparece en el panel.

### 4. Configurar

```bash
cd tools/contabo-mcp
cp .env.example .env      # y llénalo con los datos de los pasos 2 y 3
npm install
npm run build
npm test                  # pruebas de la política
npm run check             # prueba real de SSH y de la API de Contabo
```

### 5. Activar en Claude Code

Abre Claude Code en la raíz del repo. El archivo `.mcp.json` ya declara el servidor `contabo` y `.claude/settings.json` lo habilita y pre-aprueba sus herramientas (salvo `contabo_power_action`, que siempre pregunta). Verifica con `/mcp`: debe aparecer `contabo` conectado.

## Lo que sigue siendo manual (a propósito)

- **Subir secretos al VPS.** Claude Code nunca ve ni escribe el `.env` de producción. Tú lo subes:
  ```bash
  scp .env.production izao@IP_DEL_VPS:/srv/izao/app/.env
  ssh izao@IP_DEL_VPS chmod 600 /srv/izao/app/.env
  ```
- **Encender, apagar o reiniciar el VPS** (afecta a todos tus proyectos): desde el panel de Contabo, o habilitando `CONTABO_ALLOW_POWER_ACTIONS=1` temporalmente.
- **Restaurar un snapshot**: desde el panel de Contabo.
- Cualquier comando que la política bloquee: Claude Code te lo pedirá para que lo ejecutes tú.

## Ajustes

- `VPS_POLICY=open` deja pasar todo lo que no esté en la lista de bloqueo. Úsalo solo puntualmente.
- Raíces, hosts permitidos para `curl` y tiempos máximos se ajustan en `.env` (ver `.env.example`).
- Si cambias el código: `npm run build` y reinicia Claude Code (o `/mcp` → reconectar).
