'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { buscarAdminPorId } from '@/lib/auth/admin-users';
import { contarFallos, huellaDeCorreo, registrarAuditoria } from '@/lib/auth/auditoria';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { RUTA_MFA_INSCRIBIR, RUTA_MFA_VERIFICAR, rutaSiguienteSegura } from '@/lib/auth/decision';
import { esProduccion, secretoSesion } from '@/lib/auth/env';
import { esquemaLogin, type EstadoFormulario } from '@/lib/auth/esquemas';
import { crearMarca, NOMBRE_COOKIE_MARCA, opcionesCookieMarca } from '@/lib/auth/marca-sesion';
import { esRol } from '@/lib/auth/permissions';
import { crearClienteServidor } from '@/lib/auth/supabase/servidor';

const VENTANA_BLOQUEO_MS = 15 * 60 * 1000;
const MAX_FALLOS_POR_CORREO = 5;
const MAX_FALLOS_POR_IP = 15;

const MENSAJE_CREDENCIALES = 'El correo o la contraseña no son correctos.';
const MENSAJE_BLOQUEO = 'Hubo demasiados intentos. Espera 15 minutos e inténtalo de nuevo.';
const MENSAJE_SIN_ACCESO = 'Esta cuenta no tiene acceso al panel. Consulta con el administrador.';

export async function iniciarSesion(
  _anterior: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const lectura = esquemaLogin.safeParse({
    correo: formData.get('correo'),
    contrasena: formData.get('contrasena'),
    siguiente: formData.get('siguiente') ?? undefined,
  });
  if (!lectura.success) {
    const campos: NonNullable<EstadoFormulario['campos']> = {};
    for (const problema of lectura.error.issues) {
      const campo = problema.path[0];
      if ((campo === 'correo' || campo === 'contrasena') && !campos[campo]) {
        campos[campo] = problema.message;
      }
    }
    return { campos };
  }
  const { correo, contrasena } = lectura.data;
  const siguiente = rutaSiguienteSegura(lectura.data.siguiente);

  const ip = await ipDelCliente();
  const huella = huellaDeCorreo(correo);
  const desde = new Date(Date.now() - VENTANA_BLOQUEO_MS);
  const [fallosCorreo, fallosIp] = await Promise.all([
    contarFallos({ accion: 'login_fallido', desde, huella }),
    ip ? contarFallos({ accion: 'login_fallido', desde, ip }) : Promise.resolve(0),
  ]);
  if (fallosCorreo >= MAX_FALLOS_POR_CORREO || fallosIp >= MAX_FALLOS_POR_IP) {
    await registrarAuditoria({
      actor: 'anonimo',
      accion: 'login_bloqueado',
      diff: { huella_correo: huella },
      ip,
    });
    return { error: MENSAJE_BLOQUEO };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: contrasena,
  });

  if (error || !data.user) {
    await registrarAuditoria({
      actor: 'anonimo',
      accion: 'login_fallido',
      diff: { huella_correo: huella, motivo: 'credenciales' },
      ip,
    });
    return { error: MENSAJE_CREDENCIALES };
  }

  const userId = data.user.id;
  const admin = await buscarAdminPorId(userId);
  if (!admin || !admin.isActive || !esRol(admin.role)) {
    await registrarAuditoria({
      actor: userId,
      accion: 'login_denegado',
      entidadId: userId,
      diff: { huella_correo: huella, motivo: admin ? 'usuario_inactivo' : 'sin_fila_admin' },
      ip,
    });
    await supabase.auth.signOut();
    return { error: MENSAJE_SIN_ACCESO };
  }

  const almacen = await cookies();
  almacen.set(
    NOMBRE_COOKIE_MARCA,
    await crearMarca(userId, Date.now(), secretoSesion()),
    opcionesCookieMarca(esProduccion()),
  );

  await registrarAuditoria({
    actor: userId,
    accion: 'login_exitoso',
    entidadId: userId,
    diff: { paso: 'contrasena', rol: admin.role },
    ip,
  });

  const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const destino = nivel?.nextLevel === 'aal2' ? RUTA_MFA_VERIFICAR : RUTA_MFA_INSCRIBIR;
  redirect(siguiente === '/admin' ? destino : `${destino}?siguiente=${encodeURIComponent(siguiente)}`);
}
