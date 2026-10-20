import Link from 'next/link';
import { Icono, clasesBoton } from '@izao/ui';
import { enlaceWhatsapp } from '@/lib/store/contacto';
import type { CodigoPais } from '@/lib/store/types';
import { TC } from '@/lib/store/textos-checkout';

interface Props {
  tipo: 'pagado' | 'vencido';
  numero: string;
  pais: CodigoPais;
  whatsappAsesor: string | null;
}

/** Vista informativa de `/pagar/{token}` cuando no hay a dónde redirigir: abono ya pagado o enlace vencido. */
export function EstadoEnlacePago({ tipo, numero, pais, whatsappAsesor }: Props) {
  const t = TC.pagar;
  const pagado = tipo === 'pagado';
  const enlaceAsesor = pagado ? null : enlaceWhatsapp(whatsappAsesor, t.vencido.mensajeAsesor(numero));
  return (
    <section
      aria-labelledby="titulo-pagar"
      data-testid={`pagar-${tipo}`}
      className="mx-auto flex min-h-[50dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20"
    >
      <p className="etiqueta text-ink/70">{TC.pedido.numero(numero)}</p>
      <h1 id="titulo-pagar" className="text-4xl md:text-5xl">
        {pagado ? t.pagado.titulo : t.vencido.titulo}
      </h1>
      <p className="max-w-xl text-lg text-ink/90">{pagado ? t.pagado.texto(numero) : t.vencido.texto(numero)}</p>
      <div className="flex flex-wrap gap-3 pt-2">
        {enlaceAsesor ? (
          <a href={enlaceAsesor} target="_blank" rel="noopener" className={clasesBoton({ tamano: 'lg' })}>
            <Icono nombre="chat" />
            {t.vencido.hablarAsesor}
            <span className="solo-lectores"> {TC.checkout.terminos.nuevaPestana}</span>
          </a>
        ) : null}
        <Link href={`/${pais}/catalogo`} className={clasesBoton({ variante: enlaceAsesor ? 'secundario' : 'primario', tamano: 'lg' })}>
          {t.volver}
        </Link>
      </div>
      {!pagado && !enlaceAsesor ? <p className="text-[0.9375rem] text-ink/80">{t.vencido.sinAsesor}</p> : null}
    </section>
  );
}
