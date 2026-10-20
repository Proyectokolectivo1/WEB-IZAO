/** Número de WhatsApp del asesor solo con dígitos, o `null` si no tiene un largo razonable (E.164: 8 a 15). */
export function numeroWhatsapp(n: string | null): string | null {
  const d = (n ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Enlace `wa.me` con el mensaje ya redactado; `null` si el panel no tiene número. */
export function enlaceWhatsapp(numero: string | null, mensaje: string): string | null {
  const wa = numeroWhatsapp(numero);
  return wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
}
