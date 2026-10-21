import type { Metadata } from 'next';
import { FormularioAjustesPais } from '@/components/admin/FormularioAjustesPais';
import { FormularioMetodoPago } from '@/components/admin/FormularioMetodoPago';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { ETIQUETA_METODO, MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { leerAjustes } from '@/lib/admin/pagos/ajustes-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { guardarAjustesPais, guardarMetodo } from './acciones';

export const metadata: Metadata = { title: 'Pagos y países' };

export default async function PaginaPagos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'pagos' });
  const pais = leerPais((await searchParams).pais);
  const moneda = MONEDA_PAIS[pais];
  const { pais: ajustes, metodos } = await leerAjustes(crearClienteServicio(), pais);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Pagos y países</h1>
      </div>
      <p className="adm-suave">
        Todo lo comercial es por país. Los montos se escriben en {moneda === 'COP' ? 'pesos colombianos' : 'dólares'}; el
        servidor recalcula precios, recargos y abonos al crear cada pedido.
      </p>
      <PestanasPais base="/admin/pagos" actual={pais} />

      <section aria-labelledby="h-ajustes">
        <h2 id="h-ajustes">Ajustes del país</h2>
        {ajustes ? (
          // `key` por país: al cambiar de pestaña el formulario se reinicia con sus valores.
          <FormularioAjustesPais key={pais} pais={pais} moneda={moneda} inicial={ajustes} accion={guardarAjustesPais} />
        ) : (
          <p className="adm-vacio">Este país aún no tiene ajustes cargados. Pide al equipo técnico que corra el seed.</p>
        )}
      </section>

      <section aria-labelledby="h-metodos">
        <h2 id="h-metodos">Métodos de pago</h2>
        <p className="adm-suave">
          La contra entrega solo se puede activar si está habilitada en los ajustes del país. Cada método necesita además
          sus credenciales activas en Integraciones.
        </p>
        {metodos.length === 0 ? (
          <p className="adm-vacio">Este país aún no tiene métodos de pago cargados.</p>
        ) : (
          metodos.map((m) => (
            <FormularioMetodoPago
              key={`${pais}-${m.method}`}
              pais={pais}
              moneda={moneda}
              etiqueta={ETIQUETA_METODO[m.method]}
              inicial={m}
              accion={guardarMetodo}
            />
          ))
        )}
      </section>
    </>
  );
}
