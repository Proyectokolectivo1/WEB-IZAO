# Tus pendientes (guía paso a paso, sin programar)

Regla de oro: **nunca pegues una clave en el chat ni en un archivo que no sea el indicado aquí.** Los archivos `.env` están protegidos y no se suben a internet.

Cómo abrir un archivo: clic derecho sobre el archivo en el Explorador de Windows → "Abrir con" → Bloc de notas. Si no existe, copia el archivo `.env.example` de la misma carpeta, pégalo en esa carpeta y cámbiale el nombre como se indica (sin la palabra `example`).

---

## 1. Conectar el VPS de Contabo (para que yo despliegue)

**1.1 Cambia las claves que pegaste en el chat.** Entra a Contabo → API y genera un nuevo *Client Secret* y un nuevo *API Password*. Las anteriores quedaron escritas en la conversación.

**1.2 Archivo:** `C:\Proyectos\WEB-IZAO\tools\contabo-mcp\.env`
(copia `.env.example` de esa carpeta y renómbralo a `.env`). Llena estas líneas:

```
VPS_HOST=169.58.102.153
VPS_PORT=22
VPS_USER=izao
VPS_SSH_KEY_PATH=C:/Users/Usuario/.ssh/izao_claude_code
VPS_HOST_KEY_SHA256=   (lo imprime el paso 1.4)
CONTABO_CLIENT_ID=      (el de tu panel Contabo → API)
CONTABO_CLIENT_SECRET=  (el nuevo)
CONTABO_API_USER=       (tu correo de Contabo)
CONTABO_API_PASSWORD=   (el nuevo)
CONTABO_INSTANCE_ID=    (el número de tu VPS en el panel de Contabo)
CONTABO_ALLOW_POWER_ACTIONS=0
```

**1.3 Crear la llave de acceso.** Abre PowerShell y pega:
```
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\izao_claude_code -C izao-claude-code
```
(Enter dos veces para dejar la contraseña vacía.) Se crean dos archivos en `C:\Users\Usuario\.ssh\`; el que termina en `.pub` es el que se sube al servidor.

**1.4 Preparar el servidor (una sola vez).** En PowerShell, dentro de `C:\Proyectos\WEB-IZAO`:
```
scp tools\contabo-mcp\setup-vps.sh root@169.58.102.153:/root/
ssh root@169.58.102.153
```
Ya dentro del servidor, pega (cambia el texto entre comillas por el contenido del archivo `.pub`):
```
bash /root/setup-vps.sh "CONTENIDO_DEL_ARCHIVO_izao_claude_code.pub"
```
Al final imprime `VPS_HOST_KEY_SHA256=...`: cópialo al `.env` del paso 1.2. Este paso no toca tus otros proyectos del servidor.

**1.5 Instalar y probar el MCP.** En PowerShell:
```
cd C:\Proyectos\WEB-IZAO\tools\contabo-mcp
npm install
npm run build
npm run check
```
Luego reinicia Claude Code abierto en `C:\Proyectos\WEB-IZAO` y avísame: yo hago el inventario y el despliegue.

---

## 2. Claves de Supabase (base de datos)

Dónde sacarlas: supabase.com → tu proyecto `wyxjmlgrcjclelbrluvd` → *Project Settings* → *API* (URL, llave publicable, llave secreta) y *Database* → *Connection string* (para `DATABASE_URL`).

**Archivo A (tu PC, panel local):** `C:\Proyectos\WEB-IZAO\apps\web\.env.local` (copia de `apps\web\.env.example`):
```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
APP_ENCRYPTION_KEY=
```
Para `APP_ENCRYPTION_KEY` abre PowerShell y pega esto; copia el resultado:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Guarda esa clave también en un lugar seguro: si se pierde, las credenciales cifradas del panel no se pueden leer.

**Archivo B (servidor):** `C:\Proyectos\WEB-IZAO\infra\.env` (copia de `infra\.env.example`). Es el que se sube al VPS; llénalo con los mismos valores de Supabase, más:
- `NODE_ENV=production`, `SITE_URL=https://izaoperfumeria.com`, `APP_URL` igual.
- `DATABASE_URL`, `REDIS_URL` (te lo dejo definido yo cuando despliegue), `AGENT_TOKEN_PEPPER` y `MASTERSHOP_WEBHOOK_PATH_SECRET` (texto aleatorio largo, 32+ caracteres).
- Si un valor tiene `$`, `#` o espacios, ponlo entre comillas simples `'así'`.
- Déjalos vacíos en el VPS: `MASTERSHOP_MODO` e `INTEGRACIONES_MODO`.

**Subir el archivo B al VPS (lo haces tú, yo no puedo):** en PowerShell, desde `C:\Proyectos\WEB-IZAO`:
```
scp infra\.env izao@169.58.102.153:/srv/izao/app/infra/.env
ssh izao@169.58.102.153 chmod 600 /srv/izao/app/infra/.env
```

## 3. Crear tu usuario administrador

Cuando ya tengas el Archivo A, en PowerShell dentro de `C:\Proyectos\WEB-IZAO`:
```
pnpm crear-admin -- --correo TU_CORREO --nombre "Tu Nombre"
```
Te pedirá una contraseña; al entrar al panel (`/admin`) tendrás 24 horas para activar la verificación en dos pasos con una app como Google Authenticator.

## 4. Seguridad en Supabase (en la web de Supabase)

En supabase.com → tu proyecto → *Authentication*:
- *Rate Limits*: déjalos bajos (por ejemplo 5 intentos por hora).
- *Attack Protection* → activa CAPTCHA con Cloudflare Turnstile (te piden las claves del punto 5).

## 5. Claves de Turnstile (anti-robots)

dash.cloudflare.com → *Turnstile* → *Add site* → dominio `izaoperfumeria.com`. Copia la clave de sitio y la secreta a `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` en el Archivo B (y en Supabase, punto 4).

## 6. Credenciales de los proveedores (se pegan en el PANEL, no en archivos)

Entra a `https://izaoperfumeria.com/admin` (en local `http://localhost:3000/admin`) → menú **Integraciones**. Cada una tiene su formulario y el botón "Probar conexión". Se guardan cifradas.

| Proveedor | Qué necesitas | Dónde se pega |
|---|---|---|
| Wompi (CO) | llave pública, privada, secreto de eventos y de integridad | Integraciones → Wompi |
| WhatsApp (Meta) | token, ID de número, ID de cuenta, secreto de la app | Integraciones → WhatsApp |
| MasterShop | token de la API | Integraciones → MasterShop |
| Addi | Client ID y Secret (sandbox y producción) | Integraciones → Addi |
| OpenRouter (Iza) | API key | Integraciones → OpenRouter (aún en construcción) |
| Sistecrédito | **envíame su documentación técnica** (yo no inventé nada) | pendiente |

Además, en *Pagos y países* defines métodos de pago activos y la tasa de cambio COP/USD.

## 7. Correo (acuse de garantías, alertas, respaldo de cobro)

Elige proveedor (Resend, Amazon SES o el SMTP de tu hosting) y dime cuál. Con sus datos llena en el Archivo B: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `ADMIN_ALERT_EMAIL`.

## 8. Backups cifrados

Crea el par de llaves en tu PC (PowerShell): `age-keygen -o C:\Users\Usuario\izao-backup.key`. La línea que dice `public key: age1...` va en `BACKUP_AGE_RECIPIENT` del Archivo B. **El archivo `izao-backup.key` guárdalo fuera del servidor** (USB o gestor de contraseñas): sin él no se pueden restaurar los backups.

## 9. Contenido de la tienda

- **Logo, favicon y colores:** panel → *Apariencia*.
- **Banners, pop-ups, textos del inicio:** panel → *Home* y *Contenido*.
- **Productos reales con fotos e ID de MasterShop:** panel → *Productos* → Importar (Excel).
- **Datos legales** (razón social, NIT, dirección, políticas): panel → *Contenido* → páginas legales. Mientras queden marcadores `[COMPLETAR]` las páginas no se pueden publicar.

## 10. GitHub

Crea el repositorio vacío `WEB-IZAO` en tu cuenta y dime la URL; yo conecto `origin`. El primer `push` lo autorizas tú.

## 11. Limpieza

Borra o mueve el archivo con la clave vieja que está en `D:\WEB IZAO REACT` (contiene la contraseña de la API de Contabo).

---

**Orden recomendado:** 1 → 2 → 3 → 4 y 5 → 6 → 7 y 8 → 9 → 10 → 11.
Cuando termines el punto 1.5, avísame y empiezo con el inventario y el despliegue en el VPS.
