import type { Metadata } from 'next';
import Link from 'next/link';
import { FormularioAjustesGarantia } from '@/components/admin/FormularioAjustesGarantia';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { leerAjustesGarantia } from '@/lib/admin/garantias/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { guardarAjustesGarantia } from '../acciones';

export const metadata: Metadata = { title: 'Ajustes de garantías' };

export default async function AjustesGarantias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // El módulo es de ambos roles, pero los ajustes son configuración: solo administrador.
  await requerirAdmin({ modulo: 'garantias', accion: 'garantias.ajustes' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const ajustes = await leerAjustesGarantia(crearClienteServicio(), pais);

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/garantias">Garantías</Link> / Ajustes
      </p>
      <h1>Ajustes de garantías</h1>
      <p className="adm-suave">
        Plazo, tiempo de respuesta, motivos y textos del formulario público <code>/{pais.toLowerCase()}/garantias</code>.
      </p>
      <PestanasPais base="/admin/garantias/ajustes" actual={pais} />
      {sp.guardado ? (
        <p className="adm-ok" role="status">
          Ajustes guardados.
        </p>
      ) : null}
      {ajustes ? (
        <FormularioAjustesGarantia
          key={pais}
          pais={pais}
          accion={guardarAjustesGarantia}
          inicial={{
            period_days: String(ajustes.period_days),
            response_days: String(ajustes.response_days),
            reasons: (ajustes.reasons ?? []).join('\n'),
            instructions_html: ajustes.instructions_html ?? '',
            conditions_html: ajustes.conditions_html ?? '',
          }}
        />
      ) : (
        <p className="adm-vacio">Este país aún no tiene ajustes de garantía. Pide al equipo técnico que corra el seed.</p>
      )}
    </>
  );
}
