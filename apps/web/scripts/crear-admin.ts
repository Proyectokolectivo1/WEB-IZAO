/**
 * Crea un usuario del panel: usuario en Supabase Auth + fila en `admin_users`
 * (por defecto rol `admin`, activo, MFA requerido). Lo ejecuta el dueño.
 *
 * Uso (desde la carpeta apps/web, con el archivo .env.local ya creado):
 *
 *   pnpm crear-admin -- --correo dueno@ejemplo.com --nombre "Nombre Apellido"
 *
 * Indicadores opcionales:
 *   --rol admin|operator     Rol al crear; en un usuario existente, cambia el rol.
 *   --activar                Reactiva una fila de admin_users desactivada.
 *   --confirmar-existente    Confirma sin preguntar que se reemplace la contraseña
 *                            de un correo que ya existe (para ejecuciones sin teclado).
 *
 * Variables de entorno que lee: SUPABASE_URL y SUPABASE_SECRET_KEY.
 * La contraseña se pide por teclado sin mostrarla (mínimo 12 caracteres). Para
 * ejecuciones sin teclado puede pasarse en ADMIN_PASSWORD, pero no es lo
 * recomendable: quedaría en el historial del terminal.
 *
 * Si el correo ya existe en Auth, el script lo avisa y pide confirmación
 * explícita; con ella fija la contraseña escrita. NUNCA cambia `role` ni
 * `is_active` de una fila existente sin --rol / --activar.
 */
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { metadataHabilitarEnrolamiento } from '../lib/auth/enrolamiento';
import { esRol } from '../lib/auth/permissions';
import { planearAdmin, type FilaActual } from './crear-admin-plan';

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

function preguntar(pregunta: string): Promise<string> {
  const lector = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolver) => {
    lector.question(pregunta, (respuesta) => {
      lector.close();
      resolver(respuesta);
    });
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
      rol: { type: 'string' },
      activar: { type: 'boolean', default: false },
      'confirmar-existente': { type: 'boolean', default: false },
    },
  });

  const correo = (values.correo ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const nombre = (values.nombre ?? process.env.ADMIN_NAME ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) fallar('Indica un correo válido con --correo.');
  if (nombre.length < 2) fallar('Indica el nombre con --nombre "Nombre Apellido".');
  if (values.rol !== undefined && !esRol(values.rol)) fallar('--rol debe ser admin u operator.');
  const rol = values.rol !== undefined && esRol(values.rol) ? values.rol : undefined;

  const url = variable('SUPABASE_URL');
  const llaveSecreta = variable('SUPABASE_SECRET_KEY');
  const supabase = createClient(url, llaveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ¿Existe ya el correo en Auth?
  let existente: string | null = null;
  for (let pagina = 1; pagina <= 50 && !existente; pagina += 1) {
    const lista = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (lista.error) fallar(`No se pudo consultar Auth: ${lista.error.message}.`);
    existente = lista.data.users.find((u) => u.email?.toLowerCase() === correo)?.id ?? null;
    if (lista.data.users.length < 200) break;
  }

  let filaActual: FilaActual | null = null;
  if (existente) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('role, is_active, name, mfa_required')
      .eq('auth_user_id', existente)
      .maybeSingle();
    if (error) fallar(`No se pudo leer admin_users: ${error.message}.`);
    filaActual = (data as FilaActual | null) ?? null;
    console.log(`\nEl correo ${correo} YA EXISTE en Supabase Auth.`);
    console.log(
      filaActual
        ? `En admin_users figura con rol "${filaActual.role}" y está ${filaActual.is_active ? 'activo' : 'DESACTIVADO'}.`
        : 'No tiene fila en admin_users.',
    );
  }

  let confirmar = values['confirmar-existente'] === true;
  if (existente && !confirmar && process.stdin.isTTY) {
    const r = await preguntar('¿Reemplazar su contraseña por la que escribas ahora? Escribe SI para confirmar: ');
    confirmar = r.trim().toUpperCase() === 'SI';
  }

  const plan = planearAdmin({
    nombre,
    existeEnAuth: existente !== null,
    filaActual,
    confirmarExistente: confirmar,
    ...(rol ? { rol } : {}),
    ...(values.activar ? { activar: true } : {}),
  });
  if (plan.tipo === 'error') fallar(plan.mensaje);

  const contrasena = await leerContrasena();
  if (contrasena.length < MIN_CONTRASENA) {
    fallar(`La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`);
  }

  let userId: string;
  if (plan.crearUsuario) {
    const creado = await supabase.auth.admin.createUser({
      email: correo,
      password: contrasena,
      email_confirm: true,
      user_metadata: { nombre },
      app_metadata: metadataHabilitarEnrolamiento(Date.now()),
    });
    if (!creado.data.user) {
      fallar(`No se pudo crear el usuario: ${creado.error?.message ?? 'error desconocido'}.`);
    }
    userId = creado.data.user.id;
    console.log('Usuario creado en Supabase Auth.');
  } else {
    userId = existente as string;
    if (plan.fijarContrasena) {
      const { error } = await supabase.auth.admin.updateUserById(userId, { password: contrasena });
      if (error) fallar(`No se pudo fijar la contraseña: ${error.message}.`);
      console.log('Contraseña reemplazada en Supabase Auth.');
    }
    if (plan.habilitarEnrolamiento) {
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        app_metadata: metadataHabilitarEnrolamiento(Date.now()),
      });
      if (error) fallar(`No se pudo habilitar la activación del MFA: ${error.message}.`);
    }
  }

  if (plan.fila.accion === 'insertar') {
    const { error } = await supabase.from('admin_users').insert({ auth_user_id: userId, ...plan.fila.valores });
    if (error) fallar(`No se pudo registrar en admin_users: ${error.message}.`);
    console.log('Fila creada en admin_users.');
  } else if (plan.fila.accion === 'actualizar') {
    const { error } = await supabase.from('admin_users').update(plan.fila.valores).eq('auth_user_id', userId);
    if (error) fallar(`No se pudo actualizar admin_users: ${error.message}.`);
    console.log(`admin_users actualizado: ${Object.keys(plan.fila.valores).join(', ')}.`);
  } else {
    console.log('admin_users no se modificó.');
  }
  for (const aviso of plan.avisos) console.warn(`Aviso: ${aviso}`);

  const { error: errorAuditoria } = await supabase.from('audit_log').insert({
    actor: 'script:crear-admin',
    action: plan.crearUsuario ? 'admin_creado' : 'admin_contrasena_reemplazada',
    entity: 'admin_users',
    entity_id: userId,
    diff: plan.fila.accion === 'ninguna' ? null : { fila: plan.fila.accion, ...plan.fila.valores },
  });
  if (errorAuditoria) {
    console.warn(`Aviso: no se pudo registrar en la auditoría (${errorAuditoria.message}).`);
  }

  console.log(`\nListo: ${nombre} (${correo}).`);
  console.log('Entra a /admin/login; si aún no tiene verificación en dos pasos, podrá activarla durante las próximas 24 horas.');
  console.log('Si esa ventana vence, vuelve a ejecutar este script para reabrirla.');
}

main().catch((e: unknown) => {
  fallar(e instanceof Error ? e.message : 'error inesperado');
});
