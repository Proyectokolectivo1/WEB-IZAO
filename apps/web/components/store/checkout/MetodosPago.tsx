'use client';

import type { ResumenCheckout } from '@/lib/store/checkout/logica';
import type { ConfigCheckout, MetodoCheckout } from '@/lib/store/checkout/tipos';
import { TC } from '@/lib/store/textos-checkout';

interface Props {
  config: ConfigCheckout;
  resumen: ResumenCheckout;
  valor: MetodoCheckout | '';
  error?: string;
  onElegir: (m: MetodoCheckout) => void;
  precio: (v: bigint | string) => string;
}

/** Formatea «10» → «10 %» y «10.5» → «10,5 %» a partir del texto del panel. */
function pctTexto(pct: string | undefined): string | null {
  if (!pct) return null;
  return pct.replace('.', ',');
}

/** Métodos activos del país, en el orden del panel. Los no disponibles se ven apagados con su razón. */
export function MetodosPago({ config, resumen, valor, error, onElegir, precio }: Props) {
  const enLinea = config.metodos.find((m) => m.method === 'wompi') ?? config.metodos.find((m) => m.method !== 'cod') ?? null;

  if (config.metodos.length === 0) {
    return (
      <div className="rounded-card bg-bg p-4">
        <p className="text-[0.9375rem]">{TC.checkout.metodosVacios}</p>
      </div>
    );
  }

  return (
    <fieldset aria-describedby={error ? 'metodo-error' : undefined} id="metodo">
      <legend className="solo-lectores">{TC.checkout.pasos.pago}</legend>
      <div className="flex flex-col gap-3">
        {config.metodos.map((m) => {
          const d = resumen.disponibilidad[m.method];
          const disponible = d ? d.disponible : true;
          const id = `metodo-${m.method}`;
          const pct = m.method === 'addi' || m.method === 'sistecredito' ? pctTexto(config.recargoFinanciacion[m.method]) : null;
          const razon = !disponible
            ? d?.motivo === 'COD_BELOW_MINIMUM'
              ? TC.checkout.contraEntregaMinimo(enLinea?.nombre ?? null)
              : TC.checkout.metodoNoDisponible
            : null;
          const elegido = valor === m.method;
          return (
            <label
              key={m.method}
              htmlFor={id}
              className={`flex cursor-pointer gap-4 rounded-card border p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
                elegido ? 'border-ink bg-bg sombra-tierna' : 'border-transparent bg-bg/70 hover:bg-bg'
              } ${disponible ? '' : 'cursor-not-allowed opacity-70'}`}
            >
              <input
                id={id}
                type="radio"
                name="metodo"
                value={m.method}
                checked={elegido}
                disabled={!disponible}
                onChange={() => onElegir(m.method)}
                aria-describedby={`${id}-detalle`}
                className="mt-1 size-5 shrink-0 accent-ink"
              />
              <span id={`${id}-detalle`} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold">{m.nombre}</span>
                {m.descripcion ? <span className="text-[0.9375rem] text-ink/80">{m.descripcion}</span> : null}
                {pct ? <span className="text-[0.875rem] text-ink/80">{TC.resumen.recargo(pct)}</span> : null}
                {m.method === 'cod' && disponible ? (
                  <span className="text-[0.875rem] text-ink/80">
                    {TC.resumen.abono}: {precio(config.codAbono)}
                  </span>
                ) : null}
                {razon ? <span className="text-[0.875rem]">{razon}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id="metodo-error" className="pt-2 text-[0.875rem] text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
