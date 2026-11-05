import type { Metadata } from 'next';
import { FormularioLogin } from '@/components/admin/FormularioLogin';
import { PantallaAcceso } from '@/components/admin/PantallaAcceso';
import { claveSitioCaptcha } from '@/lib/auth/captcha';
import { rutaSiguienteSegura, type MotivoLogin } from '@/lib/auth/decision';

export const metadata: Metadata = { title: 'Ingresar' };

const AVISOS: Record<MotivoLogin, string> = {
  'sin-acceso': 'Esta cuenta no tiene acceso al panel. Consulta con el administrador.',
  'sesion-expirada': 'Tu sesión terminó. Ingresa de nuevo para continuar.',
};

type Props = { searchParams: Promise<{ error?: string; siguiente?: string }> };

export default async function PaginaLogin({ searchParams }: Props) {
  const { error, siguiente } = await searchParams;
  const aviso = error && error in AVISOS ? AVISOS[error as MotivoLogin] : null;
  const destino = rutaSiguienteSegura(siguiente);

  return (
    <PantallaAcceso titulo="Ingresar al panel" descripcion="Usa tu correo y tu contraseña.">
      {aviso ? (
        <p role="status" className="adm-aviso">
          {aviso}
        </p>
      ) : null}
      <FormularioLogin
        claveCaptcha={claveSitioCaptcha(process.env.TURNSTILE_SITE_KEY)}
        {...(destino !== '/admin' ? { siguiente: destino } : {})}
      />
    </PantallaAcceso>
  );
}
