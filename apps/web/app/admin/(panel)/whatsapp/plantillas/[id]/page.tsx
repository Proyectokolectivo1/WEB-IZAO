import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { FormularioPlantilla } from '@/components/admin/FormularioPlantilla';
import {
  ETIQUETA_CLAVE,
  ETIQUETA_ESTADO_META,
  textoDeEjemplo,
  type ClavePlantilla,
  type EstadoMeta,
} from '@/lib/admin/whatsapp/etiquetas';
import { validarCampos } from '@/lib/admin/whatsapp/plantillas';
import { obtenerPlantilla } from '@/lib/admin/whatsapp/plantillas-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { crearVersion, enviarAAprobacion, guardarBorrador } from '../acciones';

export const metadata: Metadata = { title: 'Plantilla de WhatsApp' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarPlantilla({ params }: { params: Promise<{ id: string }> }) {
  await requerirAdmin({ modulo: 'whatsapp' });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const p = await obtenerPlantilla(crearClienteServicio(), id);
  if (!p) notFound();

  const etiqueta = ETIQUETA_CLAVE[p.key as ClavePlantilla] ?? p.key;
  const editable = p.meta_status === 'draft';

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/whatsapp/plantillas">Plantillas de WhatsApp</Link> / {etiqueta}
      </p>
      <h1>
        {etiqueta} · versión {p.version} ({p.country_code})
      </h1>
      <p>
        <span className={p.meta_status === 'approved' ? 'adm-insignia adm-insignia-ok' : 'adm-insignia'}>
          {ETIQUETA_ESTADO_META[p.meta_status as EstadoMeta] ?? p.meta_status}
        </span>{' '}
        {p.is_active ? <span className="adm-insignia adm-insignia-ok">En uso</span> : null}
      </p>
      {p.meta_status === 'rejected' ? (
        <p className="adm-alerta" role="alert">
          Meta rechazó esta versión{p.meta_rejection_reason ? `. Motivo: ${p.meta_rejection_reason}` : '.'} Crea una versión nueva,
          corrige el texto y envíala otra vez.
        </p>
      ) : null}
      {p.meta_status === 'paused' ? (
        <p className="adm-aviso" role="status">
          Meta pausó esta plantilla. Mientras esté pausada no se envía; crea una versión nueva si hay que cambiar el texto.
        </p>
      ) : null}
      {p.meta_status === 'pending' ? (
        <p className="adm-aviso" role="status">
          En revisión de Meta. La aprobación suele tardar de minutos a 24 horas; el estado se actualiza solo.
        </p>
      ) : null}

      {editable ? (
        <FormularioPlantilla
          accion={guardarBorrador}
          accionEnvio={enviarAAprobacion.bind(null, p.id)}
          nombreMeta={p.meta_template_name}
          problemasIniciales={validarCampos(p)}
          inicial={{
            id: p.id,
            language: p.language,
            body_text: p.body_text,
            footer_text: p.footer_text ?? '',
            button_text: p.button_text ?? '',
            button_url: p.button_url ?? '',
            variables_map: p.variables_map,
          }}
        />
      ) : (
        <section className="adm-form-ancho" aria-label="Contenido de la plantilla">
          <p className="adm-suave adm-chico">
            Nombre en Meta: <strong>{p.meta_template_name}</strong> · idioma {p.language}. Una plantilla enviada a Meta no se
            edita.
          </p>
          <div className="adm-previa">
            <p style={{ whiteSpace: 'pre-wrap' }}>{textoDeEjemplo(p.body_text, p.variables_map)}</p>
            {p.footer_text ? <p className="adm-suave adm-chico">{p.footer_text}</p> : null}
            {p.button_text ? (
              <p>
                <strong>{p.button_text}</strong>
              </p>
            ) : null}
          </div>
          <p className="adm-suave adm-chico">Los datos de la vista previa son de ejemplo.</p>
          <BotonConfirmar
            etiqueta="Crear versión nueva"
            mensaje="Se crea un borrador con este mismo texto para que lo edites y lo envíes a Meta. Esta versión sigue como está."
            etiquetaConfirmar="Sí, crear versión nueva"
            peligro={false}
            accion={crearVersion.bind(null, p.id)}
          />
        </section>
      )}
    </>
  );
}
