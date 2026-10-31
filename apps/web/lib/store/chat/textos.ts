/**
 * Microcopy del widget de Iza (§8.6, §20.1): valores por defecto del seed. La bienvenida por país, las instrucciones y el
 * presupuesto salen de `chat_settings` (panel /admin/chatbot). Nada aquí afirma originalidad, autenticidad ni afiliación
 * con marcas (regla 7).
 */
export const TI = {
  nombre: 'Iza',
  lanzador: 'Habla con Iza',
  panelTitulo: 'Iza, tu asesora',
  cerrar: 'Cerrar el chat',
  bienvenidaDefecto: 'Hola, soy Iza, tu asesora de Izao. Cuéntame para quién es el perfume y te muestro opciones.',
  sugerencias: ['Para regalar', 'Aromas frescos', '¿Cómo funciona el contra entrega?'],
  sugerenciasEtiqueta: 'Preguntas frecuentes',
  escribe: 'Escribe tu mensaje',
  enviar: 'Enviar',
  contador: (n: number, max: number) => `${n} de ${max}`,
  pensando: 'Iza está escribiendo…',
  anuncioRespuesta: 'Iza respondió',
  asesor: 'Hablar con un asesor',
  asesorNota: '(se abre en otra pestaña)',
  mensajeAsesor: (contexto: string) => `Hola, vengo del chat con Iza.${contexto ? ` Quería saber: ${contexto}` : ''}`,
  tarjeta: { comprar: 'Comprar', agregado: 'Agregado al bolso', verDetalle: 'Ver detalle', agotado: 'Agotado por ahora', verOpciones: 'Elegir presentación' },
  productoActual: (nombre: string) => `Ahora estás viendo ${nombre}. Pregúntame lo que quieras de este aroma.`,
  preguntaProducto: '¿Qué me puedes contar de este aroma?',
  estados: {
    agotado: 'Iza está descansando un momentico. Un asesor te atiende por WhatsApp.',
    desactivado: 'Iza no está disponible ahora. Un asesor te atiende por WhatsApp.',
    limite: 'Has escrito muchos mensajes seguidos. Espera unos minutos o habla con un asesor.',
    sesionLlena: 'Llegamos al límite de esta conversación. Un asesor puede seguir contigo por WhatsApp.',
    entradaLarga: (max: number) => `Tu mensaje es muy largo; escríbelo en menos de ${max} caracteres.`,
    bot: 'No pudimos verificar tu conexión. Recarga la página e inténtalo de nuevo.',
    error: 'Algo no salió bien. Inténtalo de nuevo o habla con un asesor.',
    red: 'Se cortó la conexión. Revisa tu internet e inténtalo de nuevo.',
  },
} as const;
