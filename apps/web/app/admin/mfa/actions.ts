'use server';

import { redirect } from 'next/navigation';
import { contarEventos, contarNetos, registrarAuditoria, registrarEvento } from '@/lib/auth/auditoria';
import { evaluarIntento, registrarUnaVez } from '@/lib/auth/bloqueo';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { rutaSiguienteSegura } from '@/lib/auth/decision';
import { esquemaCodigoTotp, type EstadoFormulario } from '@/lib/auth/esquemas';
import { cerrarVentanaEnrolamiento, ventanaEnrolamientoAbierta } from '@/lib/auth/enrolamiento-servidor';
import { requerirSesionParcial } from '@/lib/auth/guard';
import { crearClienteServidor } from '@/lib/auth/supabase/servidor';

const VENTANA_BLOQUEO_MS = 15 * 60 * 1000;
const MAX_FALLOS_MFA = 5;

const MENSAJE_CODIGO = 'El código no es correcto o ya venció. Revisa tu aplicación e inténtalo de nuevo.';
const MENSAJE_NO_DISPONIBLE = 'No pudimos verificar el código en este momento. Inténtalo de nuevo en unos minutos.';
const MENSAJE_SIN_VENTANA =
  'Tu cuenta no tiene habilitada la activación de la verificación en dos pasos, o la habilitación venció. Pide al administrador que la vuelva a habilitar.';
const MENSAJE_BLOQUEO = 'Hubo demasiados intentos. Espera 15 minutos e inténtalo de nuevo.';

export type ResultadoInscripcion =
  | { ok: true; factorId: string; qr: string; secreto: string }
  | { ok: false; error: string };

/**
 * Paso 1 de la inscripción: crea el factor TOTP y devuelve el QR. El secreto
 * TOTP pertenece al propio usuario (lo necesita para su aplicación); no es una
 * credencial de la plataforma.
 */
export async function iniciarInscripcionMfa(): Promise<ResultadoInscripcion> {
  const { userId } = await requerirSesionParcial();
  const supabase = await crearClienteServidor();

  const { data: factores } = await supabase.auth.mfa.listFactors();
  if (factores?.totp.length) {
    // Ya hay un factor verificado: no se inscribe otro sin pasar por el MFA.
    redirect('/admin/mfa/verificar');
  }

  // Solo con la ventana abierta por el servicio: la contraseña sola no basta
  // para registrar un autenticador propio.
  if (!(await ventanaEnrolamientoAbierta())) return { ok: false, error: MENSAJE_SIN_VENTANA };

  // Limpia intentos anteriores que nunca se confirmaron.
  const pendientes = (factores?.all ?? []).filter(
    (f) => f.factor_type === 'totp' && f.status === 'unverified',
  );
  for (const factor of pendientes) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'Izao Perfumería',
    friendlyName: 'Panel Izao',
  });
  if (error || !data) {
    return { ok: false, error: 'No se pudo generar el código QR. Inténtalo de nuevo.' };
  }

  await registrarAuditoria({
    actor: userId,
    accion: 'mfa_inscripcion_iniciada',
    entidadId: userId,
    ip: await ipDelCliente(),
  });
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret };
}

function errorDeCampo(
  resultado: ReturnType<typeof esquemaCodigoTotp.safeParse>,
): EstadoFormulario | null {
  if (resultado.success) return null;
  return { campos: { codigo: resultado.error.issues[0]?.message ?? 'Escribe el código de 6 dígitos.' } };
}

/** Paso 2 de la inscripción: confirma con el primer código de la aplicación. */
export async function confirmarInscripcionMfa(
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const { userId } = await requerirSesionParcial();
  const lectura = esquemaCodigoTotp.safeParse({
    codigo: formData.get('codigo'),
    factorId: formData.get('factorId') ?? undefined,
    siguiente: formData.get('siguiente') ?? undefined,
  });
  const invalido = errorDeCampo(lectura);
  if (invalido) return invalido;
  if (!lectura.success || !lectura.data.factorId) {
    return { error: 'Primero genera el código QR.' };
  }
  const { codigo, factorId } = lectura.data;
  const ip = await ipDelCliente();

  if (!(await ventanaEnrolamientoAbierta())) return { error: MENSAJE_SIN_VENTANA };

  const bloqueo = await controlarIntento(userId, ip);
  if (bloqueo) return bloqueo;

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo });
  if (error) {
    await registrarAuditoria({
      actor: userId,
      accion: 'mfa_fallido',
      entidadId: userId,
      diff: { fase: 'inscripcion' },
      ip,
    });
    return { campos: { codigo: MENSAJE_CODIGO } };
  }

  await registrarAuditoria({
    actor: userId,
    accion: 'mfa_inscrito',
    entidadId: userId,
    diff: { tipo: 'totp' },
    ip,
  });
  await cerrarVentanaEnrolamiento(userId);
  redirect(rutaSiguienteSegura(lectura.data.siguiente));
}

/** Verificación del código en cada inicio de sesión (sube la sesión a aal2). */
export async function verificarMfa(
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const { userId } = await requerirSesionParcial();
  const lectura = esquemaCodigoTotp.safeParse({
    codigo: formData.get('codigo'),
    siguiente: formData.get('siguiente') ?? undefined,
  });
  const invalido = errorDeCampo(lectura);
  if (invalido) return invalido;
  if (!lectura.success) return { error: MENSAJE_CODIGO };
  const ip = await ipDelCliente();

  const bloqueo = await controlarIntento(userId, ip);
  if (bloqueo) return bloqueo;

  const supabase = await crearClienteServidor();
  const { data: factores } = await supabase.auth.mfa.listFactors();
  const factor = factores?.totp[0];
  if (!factor) redirect('/admin/mfa/inscribir');

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: lectura.data.codigo,
  });
  if (error) {
    await registrarAuditoria({
      actor: userId,
      accion: 'mfa_fallido',
      entidadId: userId,
      diff: { fase: 'verificacion' },
      ip,
    });
    return { campos: { codigo: MENSAJE_CODIGO } };
  }

  await registrarAuditoria({
    actor: userId,
    accion: 'mfa_verificado',
    entidadId: userId,
    ip,
  });
  redirect(rutaSiguienteSegura(lectura.data.siguiente));
}

/**
 * Registra el intento ANTES de verificar el código y falla cerrado (ver
 * `evaluarIntento`). Devuelve el estado de error si no se debe continuar.
 */
async function controlarIntento(userId: string, ip: string | null): Promise<EstadoFormulario | null> {
  const desde = new Date(Date.now() - VENTANA_BLOQUEO_MS);
  const resultado = await evaluarIntento({
    registrar: () => registrarEvento({ actor: userId, accion: 'mfa_intento', entidadId: userId, ip }),
    contadores: [
      {
        clave: 'usuario',
        max: MAX_FALLOS_MFA,
        netos: () => contarNetos('mfa_intento', ['mfa_verificado', 'mfa_inscrito'], { desde, actor: userId }),
      },
    ],
  });
  if (resultado.estado === 'error') return { error: MENSAJE_NO_DISPONIBLE };
  if (resultado.estado === 'bloqueado') {
    // Un solo aviso de bloqueo por ventana y por usuario.
    await registrarUnaVez({
      contar: () => contarEventos({ acciones: ['mfa_bloqueado'], desde, actor: userId }),
      registrar: () => registrarEvento({ actor: userId, accion: 'mfa_bloqueado', entidadId: userId, ip }),
    });
    return { error: MENSAJE_BLOQUEO };
  }
  return null;
}
