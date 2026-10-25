import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioCategoriaGasto } from '@/components/admin/FormularioCategoriaGasto';
import { esPauta } from '@/lib/admin/gastos/gastos';
import { listarCategoriasGasto } from '@/lib/admin/gastos/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarCategoriaGasto, guardarCategoriaGasto } from '../acciones';

export const metadata: Metadata = { title: 'Categorías de gastos' };

export default async function CategoriasGastos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'gastos', accion: 'gastos.gestionar' });
  const sp = await searchParams;
  const categorias = await listarCategoriasGasto(crearClienteServicio());

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/gastos">Gastos</Link> / Categorías
      </p>
      <h1>Categorías de gastos</h1>
      <p className="adm-suave">
        Las categorías marcadas como pauta publicitaria cuentan para el ROAS del dashboard. Las del sistema no se pueden
        eliminar, y una categoría con gastos tampoco.
      </p>
      {sp.guardado ? <p className="adm-ok" role="status">Categoría guardada.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Categoría eliminada.</p> : null}

      <section aria-labelledby="h-nueva">
        <h2 id="h-nueva">Nueva categoría</h2>
        <FormularioCategoriaGasto accion={guardarCategoriaGasto} etiquetaBoton="Crear categoría" />
      </section>

      <section aria-labelledby="h-lista">
        <h2 id="h-lista">Categorías</h2>
        <ul className="adm-lista-simple">
          {categorias.map((c) => (
            <li key={c.id} className="adm-tarjeta">
              <p>
                <code>{c.slug}</code>{' '}
                {c.is_system ? <span className="adm-insignia">Del sistema</span> : null}{' '}
                {esPauta(c.slug) ? <span className="adm-insignia adm-insignia-ok">Pauta</span> : null}
              </p>
              <FormularioCategoriaGasto id={c.id} nombre={c.name} accion={guardarCategoriaGasto} etiquetaBoton="Guardar nombre" />
              {c.is_system ? null : (
                <BotonConfirmar
                  etiqueta="Eliminar"
                  mensaje="Se borra la categoría. Solo es posible si no tiene gastos."
                  etiquetaConfirmar="Sí, eliminar"
                  accion={eliminarCategoriaGasto.bind(null, c.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
