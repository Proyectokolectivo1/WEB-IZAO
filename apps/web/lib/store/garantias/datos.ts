/**
 * Datos de servidor del formulario de garantías (§19). Rol de servicio (RLS niega todo a `anon`): solo se devuelven
 * los ajustes públicos del país. Los ajustes se cachean con la etiqueta `content:{PAÍS}` que invalida el panel al
 * guardar /admin/garantias.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { depurarHtml } from '../html-seguro';
import { usarSupabase } from '../checkout-datos';
import type { CodigoPais } from '../types';
import { resolverMarcadoresGarantia } from './marcadores';
import { TG } from './textos';

export interface AjustesGarantiaPublicos {
  diasPlazo: number;
  diasRespuesta: number;
  motivos: string[];
  instruccionesHtml: string;
  condicionesHtml: string;
}

/** Valores del seed (los mismos por defecto de la tabla) para ver la página sin base de datos. */
const EJEMPLO: AjustesGarantiaPublicos = {
  diasPlazo: 30,
  diasRespuesta: 5,
  motivos: ['El producto llegó dañado', 'El empaque llegó abierto', 'Recibí un producto distinto al que pedí', 'Faltó una unidad de mi pedido'],
  instruccionesHtml: '<p>Ten a la mano tu número de pedido y el celular con el que compraste. Una foto del producto y de su empaque nos ayuda a revisar más rápido.</p>',
  condicionesHtml: '',
};

/** Sin motivos en el panel el formulario ofrece uno genérico, para no bloquear a quien necesita escribir. */
const motivosOGenerico = (m: string[] | null): string[] => {
  const lista = (m ?? []).map((x) => x.trim()).filter(Boolean);
  return lista.length > 0 ? lista : [TG.motivoGenerico];
};

const leer = (pais: CodigoPais) =>
  unstable_cache(
    async (): Promise<AjustesGarantiaPublicos> => {
      const { data, error } = await crearClienteServicio()
        .from('warranty_settings')
        .select('period_days, response_days, reasons, instructions_html, conditions_html')
        .eq('country_code', pais.toUpperCase())
        .maybeSingle();
      if (error) throw new Error(`warranty_settings: ${error.message}`);
      if (!data) return { ...EJEMPLO, motivos: [TG.motivoGenerico], instruccionesHtml: '', condicionesHtml: '' };
      const f = data as { period_days: number; response_days: number; reasons: string[] | null; instructions_html: string; conditions_html: string };
      // Los textos del seed traen `[30]`/`[5]` como marcadores: se reemplazan por lo configurado y no llegan corchetes.
      const marcadores = { diasPlazo: f.period_days, diasRespuesta: f.response_days, rutaFormulario: `/${pais}/garantias` };
      return {
        diasPlazo: f.period_days,
        diasRespuesta: f.response_days,
        motivos: motivosOGenerico(f.reasons),
        instruccionesHtml: resolverMarcadoresGarantia(depurarHtml(f.instructions_html ?? ''), marcadores),
        condicionesHtml: resolverMarcadoresGarantia(depurarHtml(f.conditions_html ?? ''), marcadores),
      };
    },
    ['garantias-ajustes', pais],
    { revalidate: 300, tags: [`content:${pais.toUpperCase()}`] },
  )();

export async function ajustesGarantia(pais: CodigoPais): Promise<AjustesGarantiaPublicos> {
  return usarSupabase() ? leer(pais) : EJEMPLO;
}
