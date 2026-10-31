import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormularioCredencial, type CampoCredencial } from '@/components/admin/FormularioCredencial';
import { ETIQUETA_AMBIENTE, ambitosDe, esAmbiente, esAmbito, paisDb, proveedorPorId } from '@/lib/admin/integraciones/catalogo';
import { listarCredenciales } from '@/lib/admin/integraciones/credenciales-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { guardarCredencial } from '../acciones';

export const metadata: Metadata = { title: 'Credenciales de integración' };

export default async function PaginaCredencial({
  params,
  searchParams,
}: {
  params: Promise<{ proveedor: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'integraciones' });
  const proveedor = proveedorPorId((await params).proveedor);
  const sp = await searchParams;
  const pais = Array.isArray(sp.pais) ? sp.pais[0] : sp.pais;
  const ambiente = Array.isArray(sp.ambiente) ? sp.ambiente[0] : sp.ambiente;
  if (!proveedor || !esAmbito(pais) || !esAmbiente(ambiente)) notFound();
  if (!ambitosDe(proveedor).includes(pais) || !proveedor.esquema.environments.includes(ambiente)) notFound();

  const filas = await listarCredenciales(crearClienteServicio());
  const existente = filas.find((f) => f.provider === proveedor.id && f.country_code === paisDb(pais) && f.environment === ambiente);
  // Solo la vista enmascarada llega al navegador; los campos públicos se muestran tal cual.
  const campos: CampoCredencial[] = proveedor.esquema.fields.map((c) => ({
    key: c.key,
    label: c.label,
    secret: c.secret,
    required: c.required,
    help: c.help,
    valor: c.secret ? '' : (existente?.masked_preview[c.key] ?? ''),
    guardado: c.secret ? (existente?.masked_preview[c.key] ?? null) : null,
  }));

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/integraciones">Integraciones</Link> / {proveedor.nombre}
      </p>
      <div className="adm-cabecera">
        <h1>
          {proveedor.nombre} · {pais === 'global' ? 'Todo el sitio' : pais === 'CO' ? 'Colombia' : 'Ecuador'} · {ETIQUETA_AMBIENTE[ambiente]}
        </h1>
      </div>
      <FormularioCredencial
        proveedor={proveedor.id}
        pais={pais}
        ambiente={ambiente}
        campos={campos}
        existe={Boolean(existente)}
        accion={guardarCredencial}
        volverHref="/admin/integraciones"
      />
    </>
  );
}
