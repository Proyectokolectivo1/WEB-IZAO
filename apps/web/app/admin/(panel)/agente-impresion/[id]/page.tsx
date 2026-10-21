import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccionesAgente } from '@/components/admin/GestionAgentes';
import { FormularioConfigAgente } from '@/components/admin/FormularioConfigAgente';
import { camposDesdeConfig } from '@/lib/admin/agentes/esquemas';
import { ETIQUETA_CONEXION } from '@/lib/admin/agentes/estado';
import { conEstado, obtenerAgente } from '@/lib/admin/agentes/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { cambiarEstadoAgente, guardarConfigAgente, rotarToken } from '../acciones';

export const metadata: Metadata = { title: 'Configurar agente' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Bogota' });

export default async function PaginaConfigurarAgente({ params }: { params: Promise<{ id: string }> }) {
  // Solo el administrador configura agentes; el operador solo ve el estado en la lista.
  await requerirAdmin({ modulo: 'agente', accion: 'agente.gestionar' });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const agente = await obtenerAgente(crearClienteServicio(), id);
  if (!agente) notFound();
  const [vista] = conEstado([agente]);
  if (!vista) notFound();

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/agente-impresion">Agente de impresión</Link> / {agente.name}
      </p>
      <div className="adm-cabecera">
        <h1>{agente.name}</h1>
        <span className={vista.conexion === 'en_linea' ? 'adm-insignia adm-insignia-ok' : 'adm-insignia adm-insignia-aviso'}>
          {ETIQUETA_CONEXION[vista.conexion]}
        </span>
      </div>
      <p className="adm-suave">
        Último latido {agente.last_heartbeat_at ? fecha.format(new Date(agente.last_heartbeat_at)) : 'nunca'} · impresora {agente.printer_name ?? '—'} ·
        versión {agente.version ?? '—'}
      </p>

      <section className="adm-form-ancho" aria-labelledby="h-estado">
        <h2 id="h-estado">Estado y token</h2>
        <AccionesAgente
          activo={agente.is_active}
          cambiarEstado={cambiarEstadoAgente.bind(null, agente.id)}
          rotar={rotarToken.bind(null, agente.id)}
        />
      </section>

      <section aria-labelledby="h-config">
        <h2 id="h-config">Configuración remota</h2>
        <FormularioConfigAgente
          inicial={camposDesdeConfig(agente.mode, agente.remote_config)}
          accion={guardarConfigAgente.bind(null, agente.id)}
        />
      </section>
    </>
  );
}
