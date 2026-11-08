/**
 * Textos de la elección de sede y de las páginas «en preparación»: valores por defecto del seed (§8.6). Van aparte de
 * `textos.ts` para que el JS de todas las pantallas no cargue lo que solo usa la ventana de sede (que se baja en reposo).
 * Las líneas de envío y de pago de cada país se editan en el panel (espacios `sede_envio` y `sede_pago`, campo cuerpo).
 */
export const TP = {
  sede: {
    rotulo: 'Tu sede',
    titulo: '¿Desde dónde nos visitas?',
    bajada: 'Elige tu país y te mostramos precios, envíos y formas de pago de allá.',
    nota: 'Puedes cambiarlo cuando quieras desde el pie de la página.',
    ariaGrupo: 'Países disponibles',
    estasAqui: 'Estás aquí',
    entrar: (pais: string) => `Entrar a ${pais}`,
    llevando: (pais: string) => `Te llevamos a ${pais}…`,
    cerrar: 'Cerrar',
    cambiar: (pais: string) => `Tu país: ${pais}. Cambiar de país`,
    paises: {
      co: { nombre: 'Colombia', moneda: 'Pesos colombianos · COP', envio: 'Envíos a toda Colombia', pago: 'Pago contra entrega o en línea' },
      ec: { nombre: 'Ecuador', moneda: 'Dólares · USD', envio: 'Envíos a todo Ecuador', pago: 'Cierras tu pedido por WhatsApp con tu asesor' },
    },
  },
  /** Página que existe en el otro país y aquí todavía no está publicada. */
  preparando: {
    titulo: (pais: string) => `Estamos preparando esta información para ${pais}`,
    texto: (titulo: string) => `«${titulo}» todavía no está lista para tu país. Mientras la terminamos, escríbenos y te contamos lo que necesites.`,
    sinWhatsapp: 'Mientras la terminamos, vuelve al catálogo o escríbenos desde el pie de la página.',
    whatsapp: 'Escríbenos por WhatsApp',
    mensaje: (titulo: string) => `Hola, quisiera saber sobre: ${titulo}`,
    volver: 'Volver al catálogo',
  },
} as const;
