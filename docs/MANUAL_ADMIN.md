# Manual del panel de administración

Guía para quien opera el panel de Izao. Se amplía con cada módulo que se entrega.

## Primer acceso

Estos pasos los hace el dueño una sola vez, en su computador, para crear el primer administrador y probar el ingreso real. El código del panel nunca guarda llaves: se leen del archivo `.env.local`, que no se sube a git.

### 1. Crear `apps/web/.env.local`

Crea el archivo `apps/web/.env.local` con estas variables (los valores salen de Supabase, proyecto `wyxjmlgrcjclelbrluvd`, en Project Settings > API Keys):

```
SUPABASE_URL=https://wyxjmlgrcjclelbrluvd.supabase.co
SUPABASE_PUBLISHABLE_KEY=<llave publicable>
SUPABASE_SECRET_KEY=<llave secreta>
APP_ENCRYPTION_KEY=<32 bytes en base64>
```

- `SUPABASE_SECRET_KEY` da acceso total a la base: solo va en este archivo y en el `.env` del servidor. No se comparte ni se pega en chats.
- `APP_ENCRYPTION_KEY` se genera con: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. El panel la valida al arrancar (debe ser base64 de exactamente 32 bytes; si no, el ingreso falla con un mensaje claro) y de ella deriva, con HKDF, una subllave distinta para firmar la marca de sesión de 12 h y las huellas de correo. Si se cambia, todas las sesiones abiertas se cierran. Para producción usa una distinta de la de pruebas.

### 2. Crear el primer administrador

Desde la carpeta `apps/web`:

```
pnpm crear-admin -- --correo tu-correo@ejemplo.com --nombre "Tu Nombre"
```

El script pide la contraseña dos veces sin mostrarla (mínimo 12 caracteres). Crea el usuario en Supabase Auth, lo registra en `admin_users` como administrador activo con MFA requerido y deja una entrada en la auditoría. Si el correo ya existe en Auth, el script lo avisa, muestra su rol y estado actuales y pide que escribas SI antes de reemplazar su contraseña por la que digitaste (sin interacción: `--confirmar-existente`). Nunca cambia el rol ni reactiva a un usuario desactivado por su cuenta: para eso hay que indicarlo con `--rol admin|operator` o `--activar`. Sin esos indicadores, `admin_users` queda como estaba.

### 3. Ingresar y activar la verificación en dos pasos

1. Desde la raíz del repositorio ejecuta `pnpm --filter @izao/web dev` y abre `http://localhost:3000/admin`.
2. Te lleva a `/admin/login`. Escribe tu correo y tu contraseña.
3. Como aún no tienes verificación en dos pasos, aparece "Activa la verificación en dos pasos". Pulsa "Generar código QR", escanéalo con una aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Aegis) y escribe el código de 6 dígitos. Guarda la clave de texto que se muestra debajo del QR en un lugar seguro: sirve para recuperar el acceso si pierdes el teléfono.
4. Entras al inicio del panel. Desde ese momento, cada ingreso pide la contraseña y un código nuevo.

### 4. Qué comprobar

| Prueba | Resultado esperado |
|---|---|
| Abrir `/admin` sin haber ingresado | Te lleva a `/admin/login` |
| Contraseña incorrecta | "El correo o la contraseña no son correctos." |
| 5 contraseñas incorrectas seguidas con el mismo correo | Bloqueo de 15 minutos |
| Ingresar sin completar el código | No se puede abrir ningún módulo; vuelve a la pantalla del código |
| Código incorrecto | "El código no es correcto o ya venció." |
| Ingresar con el código correcto | Ves el inicio con Pedidos, Garantías y Agente de impresión |
| Botón "Cerrar sesión" | Vuelve al login |
| Abrir `/api/health` sin haber ingresado | Responde sin pedir ingreso |
| Sesión de más de 12 horas | Pide ingresar de nuevo |

### 5. Probar el rol de operador

Ahora mismo no existe aún el módulo Usuarios. Para probar al operador:

1. En Supabase > Authentication > Users, crea un usuario con correo y contraseña (marca "Auto Confirm User").
2. En Supabase > SQL Editor ejecuta, cambiando el identificador por el del usuario creado:

   ```sql
   insert into admin_users (auth_user_id, role, name, is_active, mfa_required)
   values ('<id del usuario>', 'operator', 'Operador de prueba', true, true);
   ```
3. Ingresa con ese usuario, activa su verificación en dos pasos y comprueba que solo ve Pedidos, Garantías y Agente de impresión, y que `/admin/productos` o `/admin/usuarios` lo llevan a "No tienes permiso para esta sección".

### 6. Revisar la auditoría

En Supabase > SQL Editor:

```sql
select created_at, actor, action, ip, diff
from audit_log
where entity = 'sesion_admin'
order by created_at desc
limit 20;
```

Verás `login_exitoso`, `login_fallido`, `login_denegado`, `login_bloqueado`, `mfa_inscripcion_iniciada`, `mfa_inscrito`, `mfa_verificado`, `mfa_fallido`, `mfa_bloqueado` y `logout`. Nunca se guardan contraseñas ni códigos; el correo de un intento fallido se guarda solo como una huella irreversible.

### 7. Desactivar a un usuario

Mientras no exista el módulo Usuarios: en SQL Editor, `update admin_users set is_active = false where auth_user_id = '<id>';`. El usuario pierde el acceso en su siguiente clic.

## Límites de ingreso que debe configurar el dueño en Supabase

El panel bloquea 15 minutos después de 5 contraseñas incorrectas por correo (15 por IP) y de 5 códigos incorrectos por usuario. Ese bloqueo falla cerrado: si no se puede registrar o contar el intento, el ingreso se niega con "No pudimos verificar tu ingreso".

Pero la llave publicable de Supabase es pública por diseño, así que cualquiera puede llamar directamente a `/auth/v1/token` (contraseña) y a `/auth/v1/factors/.../verify` (código) sin pasar por el panel. El bloqueo de la aplicación no cubre ese camino. Por eso, en Supabase (proyecto `wyxjmlgrcjclelbrluvd`) revisa:

1. **Authentication > Rate Limits**: baja al mínimo razonable los límites de inicio de sesión (sign-ups and sign-ins), de verificación de tokens y de verificación MFA, que Supabase aplica por IP.
2. **Authentication > Attack Protection**: activa la protección con CAPTCHA (Cloudflare Turnstile) para el inicio de sesión. Cuando se active, el formulario del panel deberá enviar el token del CAPTCHA; avísale al equipo para que lo incorpore.
3. **Authentication > Sign In / Providers > Email**: exige contraseñas de al menos 12 caracteres y activa la protección contra contraseñas filtradas si tu plan la ofrece.
4. Usa siempre contraseñas largas y únicas para las cuentas del panel: el segundo factor protege, pero no debe ser la única barrera.

Pendientes de otros equipos (no los hace el dueño):

- Regla `limit_req` de Nginx para `/admin/login` y `/admin/mfa/*` (la configura infraestructura).
- Límite de intentos con Redis en el login, el checkout y los formularios (§26.1): tarea futura. Cuando exista, se suma al bloqueo actual, que se queda como segunda barrera.

## Notas técnicas para el equipo

- Todo el flujo de autenticación ocurre en el servidor (Server Actions); el navegador no recibe la llave secreta ni la de servicio.
- El middleware protege `/admin/**` y `/api/admin/**`. No afecta a `/api/health` ni a la tienda.
- La tabla de permisos está en `apps/web/lib/auth/permissions.ts`. Cada módulo nuevo se agrega ahí y sus páginas y Server Actions llaman a `requerirAdmin({ modulo, accion })` de `apps/web/lib/auth/guard.ts`.
- La Política de seguridad de contenido (CSP) de Nginx debe permitir `img-src data:` en `/admin`: el código QR del MFA llega como imagen en `data:`.
