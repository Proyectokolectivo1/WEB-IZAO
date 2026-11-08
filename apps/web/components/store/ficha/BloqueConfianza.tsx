import { Icono, IzaoImage, type NombreIcono } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { EspacioContenido } from '@/lib/store/types';

export interface Beneficio {
  icono: NombreIcono;
  titulo: string | null;
  texto: string | null;
}

/**
 * Bloque de confianza (§7.6): envío gratis, pago contra entrega, garantía… Los textos y los íconos salen de la
 * sección `benefits` de `home_sections` del país (editable en el panel); los medios de pago, del espacio `medios_de_pago`.
 * Si el panel no tiene nada cargado, el bloque no se pinta.
 */
export function BloqueConfianza({ beneficios, medios }: { beneficios: Beneficio[]; medios: EspacioContenido | null }) {
  if (beneficios.length === 0 && !medios?.media) return null;
  return (
    <section aria-labelledby="confianza-titulo" data-testid="confianza" className="rounded-card bg-surface/50 p-5 sm:p-6">
      <h2 id="confianza-titulo" className="pb-4 text-[1.375rem] leading-tight">
        {T.confianza.titulo}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {beneficios.map((b) => (
          <li key={b.titulo} className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-bg/80">
              <Icono nombre={b.icono} tamano={22} />
            </span>
            <div>
              <p className="text-[0.9375rem] font-semibold">{b.titulo}</p>
              {b.texto ? <p className="text-[0.875rem]">{b.texto}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {medios?.media ? (
        <div className="mt-5 w-56">
          <p className="solo-lectores">{T.footer.medios}</p>
          <IzaoImage media={medios.media} alt={medios.title ?? T.footer.medios} sizes="224px" proporcion={5} redondeo="none" />
        </div>
      ) : null}
    </section>
  );
}
