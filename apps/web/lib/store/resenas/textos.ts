/**
 * Microcopy del formulario de reseñas de la ficha (§8.6, §9.6): valores por defecto del seed. Nada aquí afirma
 * originalidad, autenticidad ni afiliación con marcas.
 */
export const TR = {
  abrir: 'Escribe tu reseña',
  cerrar: 'Cerrar',
  titulo: 'Cuéntanos cómo te fue con este aroma',
  intro: 'Tu opinión ayuda a otras personas a elegir. La revisamos antes de publicarla.',
  campos: {
    estrellas: 'Tu calificación',
    nombre: 'Tu nombre',
    ciudad: 'Ciudad (opcional)',
    texto: 'Tu reseña',
    fotos: 'Fotos (opcional)',
    pedido: 'Número de pedido (opcional)',
    celular: 'Celular con el que compraste',
  },
  ayudaNombre: 'Solo mostramos tu nombre y la inicial de tu apellido, por ejemplo «Andrea M.».',
  ayudaTexto: (min: number) => `Mínimo ${min} caracteres. Cuenta cómo huele, cuánto dura y cuándo lo usas.`,
  ayudaFotos: (n: number) => `Hasta ${n} fotos.`,
  verificar: {
    titulo: 'Compra verificada',
    texto: 'Si compraste este aroma con nosotros, escribe tu número de pedido y el celular con el que compraste y marcamos tu reseña como compra verificada.',
  },
  estrellaN: (n: number) => (n === 1 ? '1 estrella' : `${n} estrellas`),
  quitarFoto: (nombre: string) => `Quitar ${nombre}`,
  enviar: 'Enviar mi reseña',
  enviando: 'Enviando…',
  resumenErrores: (n: number) => (n === 1 ? 'Revisa este dato:' : `Revisa estos ${n} datos:`),
  errores: {
    estrellas: 'Elige de 1 a 5 estrellas.',
    nombre: 'Escribe tu nombre.',
    texto: (min: number) => `Cuéntanos con al menos ${min} caracteres.`,
    pedido: 'Escribe el número de pedido completo, o déjalo vacío.',
    celular: 'Escribe un celular válido, o deja vacío el pedido.',
    ciudad: 'Esa ciudad es muy larga.',
    producto: 'No pudimos identificar este aroma. Recarga la página.',
    muchasFotos: (max: number) => `Máximo ${max} fotos.`,
    fotoPesada: (mb: number) => `Cada foto debe pesar menos de ${mb} MB.`,
    tipo: 'Solo aceptamos fotos JPG, PNG, WebP o AVIF.',
    turnstile: 'Confirma que no eres un robot e inténtalo de nuevo.',
  },
  fallas: {
    demasiados: 'Has enviado varias reseñas seguidas. Espera unos minutos e inténtalo de nuevo.',
    bot: 'No pudimos verificar tu envío. Recarga la página e inténtalo de nuevo.',
    error: 'No pudimos guardar tu reseña. Inténtalo de nuevo en un momento; tu texto sigue aquí.',
    red: 'Parece que se cortó la conexión. Revisa tu internet e inténtalo de nuevo.',
  },
  listo: {
    titulo: 'Gracias por tu reseña',
    texto: 'La revisamos y, si todo está en orden, la publicamos en esta ficha.',
  },
  turnstile: 'Verificación de seguridad',
} as const;
