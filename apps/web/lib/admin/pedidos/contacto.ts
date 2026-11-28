/** Enlaces de contacto del cliente a partir del teléfono E.164 guardado en el pedido (solo presentación). */

/** Solo dígitos del E.164 (`+573001234567` → `573001234567`); `null` si no parece un teléfono. */
export function digitosTelefono(e164: string | null | undefined): string | null {
  const d = (e164 ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function enlacesContacto(e164: string | null | undefined): { whatsapp: string; tel: string } | null {
  const d = digitosTelefono(e164);
  return d ? { whatsapp: `https://wa.me/${d}`, tel: `tel:+${d}` } : null;
}

const ETIQUETA_DOCUMENTO: Record<string, string> = { CC: 'CC', CE: 'CE', NIT: 'NIT', PP: 'Pasaporte', TI: 'TI', RUC: 'RUC', CI: 'Cédula' };

export function textoDocumento(tipo: string | null, numero: string | null): string | null {
  const n = numero?.trim();
  if (!n) return null;
  const t = tipo?.trim();
  return t ? `${ETIQUETA_DOCUMENTO[t.toUpperCase()] ?? t} ${n}` : n;
}
