/**
 * Proveedor de prueba: responde sin red cuando el panel aún no tiene credencial de OpenRouter (desarrollo y primeros
 * despliegues). Sigue el mismo camino que un modelo real —pide `buscar_productos`, lee el resultado y recomienda con el
 * marcador `[[producto:slug]]`— para que el widget, las tarjetas y el presupuesto se puedan probar de punta a punta.
 * Sus textos son de demostración y nunca afirman originalidad ni afiliación con marcas.
 */
import type { EventoLLM, LLMProvider, MensajeLLM, SolicitudLLM } from './llm';

const estimar = (t: string) => Math.max(1, Math.ceil(t.length / 4));
const ultimo = (m: MensajeLLM[], rol: MensajeLLM['role']) => [...m].reverse().find((x) => x.role === rol);

export function crearMock(): LLMProvider {
  return {
    nombre: 'mock',
    async *completar(s: SolicitudLLM): AsyncGenerator<EventoLLM> {
      const entrada = s.mensajes.map((m) => ('content' in m ? (m.content ?? '') : '')).join(' ');
      const tokensIn = estimar(entrada);
      const ult = s.mensajes[s.mensajes.length - 1];
      let texto: string;

      if (ult?.role === 'tool') {
        let slugs: string[] = [];
        try {
          const r = JSON.parse(ult.content) as { productos?: { slug: string }[] };
          slugs = (r.productos ?? []).slice(0, 2).map((p) => p.slug);
        } catch {
          /* resultado sin forma de lista */
        }
        texto = slugs.length
          ? `Con mucho gusto, mira estas opciones que creo que te van a gustar. ${slugs.map((x) => `[[producto:${x}]]`).join(' ')}`
          : 'Un momentico: no encontré algo que coincida. Si quieres, un asesor te ayuda a elegir.';
      } else {
        const u = ultimo(s.mensajes, 'user');
        const pregunta = (u && 'content' in u ? u.content : '') ?? '';
        if (/pedido|gu[ií]a|envi[oó]/i.test(pregunta)) {
          texto = 'Con gusto te ayudo con tu pedido. Escríbeme el número de pedido y el celular con el que compraste.';
        } else {
          yield { tipo: 'herramientas', llamadas: [{ id: 'mock_1', nombre: 'buscar_productos', argumentos: JSON.stringify({ texto: /fresc|dulc|floral|amader|c[ií]tric|cuero|vainilla/i.exec(pregunta)?.[0] ?? '', limite: 3 }) }] };
          yield { tipo: 'fin', uso: { tokensIn, tokensOut: 12, costoMicros: 0n } };
          return;
        }
      }

      for (const palabra of texto.split(/(?<= )/)) yield { tipo: 'texto', delta: palabra };
      yield { tipo: 'fin', uso: { tokensIn, tokensOut: estimar(texto), costoMicros: 0n } };
    },
  };
}
