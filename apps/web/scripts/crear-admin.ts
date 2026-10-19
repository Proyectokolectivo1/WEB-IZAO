/**
 * Crea el primer administrador del panel: usuario en Supabase Auth + fila en
 * `admin_users` (rol `admin`, activo, MFA requerido). Lo ejecuta el dueño una vez.
 *
 * Uso (desde la carpeta apps/web, con el archivo .env.local ya creado):
 *
 *   pnpm crear-admin -- --correo dueno@ejemplo.com --nombre "Nombre Apellido"
 *
 * Variables de entorno que lee: SUPABASE_URL y SUPABASE_SECRET_KEY.
 * La contraseña se pide por teclado sin mostrarla (mínimo 12 caracteres). Para
 * ejecuciones sin teclado puede pasarse en ADMIN_PASSWORD, pero no es lo
 * recomendable: quedaría en el historial del terminal.
 *
 * Es idempotente: si el correo ya existe en Auth, reutiliza ese usuario y solo
 * asegura la fila de `admin_users`. El MFA se inscribe en el primer acceso.
 */
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';

const MIN_CONTRASENA = 12;

function fallar(mensaje: string): never {
  console.error(`\nError: ${mensaje}`);
  process.exit(1);
}

function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim() === '') fallar(`Falta la variable de entorno ${nombre}.`);
  return valor;
}

/** Pregunta por teclado sin mostrar lo que se escribe. */
function preguntarOculto(pregunta: string): Promise<string> {
  return new Promise((resolver) => {
    let silenciar = false;
    const salida = new Writable({
      write(trozo, codificacion, siguiente) {
        if (!silenciar) process.stdout.write(trozo, codificacion);
        siguiente();
      },
    });
    const lector = createInterface({ input: process.stdin, output: salida, terminal: true });
    lector.question(pregunta, (respuesta) => {
      lector.close();
      process.stdout.write('\n');
      resolver(respuesta);
    });
    silenciar = true;
  });
}

async function leerContrasena(): Promise<string> {
  const deEntorno = process.env.ADMIN_PASSWORD;
  if (deEntorno) return deEntorno;
  if (!process.stdin.isTTY) {
    fallar('No hay teclado interactivo. Ejecuta el script desde una terminal.');
  }
  const primera = await preguntarOculto('Contraseña (mínimo 12 caracteres): ');
  const segunda = await preguntarOculto('Repite la contraseña: ');
  if (primera !== segunda) fallar('Las contraseñas no coinciden.');
  return primera;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      correo: { type: 'string' },
      nombre: { type: 'string' },
    },
  });

  const correo = (values.correo ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const nombre = (values.nombre ?? process.env.ADMIN_NAME ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) fallar('Indica un correo válido con --correo.');
  if (nombre.length < 2) fallar('Indica el nombre con --nombre "Nombre Apellido".');

  const url = variable('SUPABASE_URL');
  const llaveSecreta = variable('SUPABASE_SECRET_KEY');

  const contrasena = await leerContrasena();
  if (contrasena.length < MIN_CONTRASENA) {
    fallar(`La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`);
  }

  const supabase = createClient(url, llaveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId: string;
  const creado = await supabase.auth.admin.createUser({
    email: correo,
    password: contrasena,
    email_confirm: true,
    user_metadata: { nombre },
  });

  if (creado.data.user) {
    userId = creado.data.user.id;
    console.log('Usuario creado en Supabase Auth.');
  } else {
    const yaExiste = /already|registered|exists/i.test(creado.error?.message ?? '');
    if (!yaExiste) fallar(`No se pudo crear el usuario: ${creado.error?.message ?? 'error desconocido'}.`);
    // Busca el usuario existente por correo, página por página.
    let encontrado: string | null = null;
    for (let pagina = 1; pagina <= 50 && !encontrado; pagina += 1) {
      const lista = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (lista.error) fallar(`No se pudo consultar Auth: ${lista.error.message}.`);
      encontrado = lista.data.users.find((u) => u.email?.toLowerCase() === correo)?.id ?? null;
      if (lista.data.users.length < 200) break;
    }
    if (!encontrado) fallar('El correo figura como registrado pero no se encontró el usuario.');
    userId = encontrado;
    console.log('El correo ya existía en Supabase Auth; se reutiliza ese usuario.');
  }

  const { error: errorFila } = await supabase.from('admin_users').upsert(
    {
      auth_user_id: userId,
      role: 'admin',
      name: nombre,
      is_active: true,
      mfa_required: true,
    },
    { onConflict: 'auth_user_id' },
  );
  if (errorFila) fallar(`No se pudo registrar en admin_users: ${errorFila.message}.`);

  const { error: errorAuditoria } = await supabase.from('audit_log').insert({
    actor: 'script:crear-admin',
    action: 'admin_creado',
    entity: 'admin_users',
    entity_id: userId,
    diff: { role: 'admin', is_active: true, mfa_required: true },
  });
  if (errorAuditoria) {
    console.warn(`Aviso: no se pudo registrar en la auditoría (${errorAuditoria.message}).`);
  }

  console.log(`\nListo. Administrador "${nombre}" (${correo}) habilitado.`);
  console.log('Entra a /admin/login; en el primer acceso se te pedirá activar el código de 6 dígitos.');
}

main().catch((e: unknown) => {
  fallar(e instanceof Error ? e.message : 'error inesperado');
});
