/**
 * Guardarraíl de cifras de Iza (§20.3: «nunca inventa precios, stock, tiempos ni políticas»). Código puro y determinista.
 *
 * El prompt le pide al modelo usar herramientas, pero un modelo puede responder de memoria. Aquí se extraen del texto que
 * va a salir las cifras comerciales (montos de dinero, porcentajes de descuento o recargo, plazos, existencias exactas,
 * «gratis» y códigos de descuento) y se comparan con lo que devolvieron las herramientas (y el mapa de la tienda) EN ESTE
 * TURNO. Lo que no coincide no sale: el filtro de salida reemplaza la oración.
 *
 * Los montos se comparan en centavos (`bigint`), nunca como `float` (regla 1 del proyecto).
 */

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Montos ───────────────────────────────────────────────────────────────────────────────────────

const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MULT = String.raw`(?:\s?(mil|millones|millon|millón|k|lucas|palos)\b)?`;
const SIMBOLO = String.raw`(?:us\s?\$|usd|cop|\$)`;
const MONEDA_SUFIJO = String.raw`(?:cop|usd|pesos?|d[oó]lares?|dollars?|bucks|\$)(?![\p{L}\d])`;

/** `$ 89.900`, `USD 45,50`, `COP 1.200.000`. */
const RE_PREFIJO = new RegExp(String.raw`${SIMBOLO}\s*(${NUM})${MULT}`, 'giu');
/** `89.900 pesos`, `45,50 USD`, `45 dólares`, `80 mil pesos`. */
const RE_SUFIJO = new RegExp(String.raw`(${NUM})${MULT}(?:\s+de)?\s*${MONEDA_SUFIJO}`, 'giu');
/** `80k`, `80 lucas`: en una charla de ventas son dinero aunque no digan la moneda. */
const RE_ABREVIADO = new RegExp(String.raw`(?<![\p{L}\d.,])(${NUM})\s?(k|lucas|palos)(?![\p{L}\d])`, 'giu');

const NUMEROS_ES =
  'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis\\w+|dieci\\w+|veinte|veinti\\w*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|medio';
const NUMEROS_EN = 'one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';
/** Montos escritos con palabras («ochenta mil pesos», «veinte dólares»): no se pueden verificar, se tratan como no confirmados. */
const RE_PALABRAS = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:${NUMEROS_ES})(?:\s+(?:y\s+)?(?:${NUMEROS_ES}))*\s+(?:mil|millones|mill[oó]n)(?![\p{L}])|(?:${NUMEROS_ES}|${NUMEROS_EN})(?:\s+(?:y\s+|and\s+)?(?:${NUMEROS_ES}|${NUMEROS_EN}))*\s+(?:pesos|d[oó]lares?|dollars?)(?![\p{L}])|mil\s+(?:pesos|d[oó]lares?)(?![\p{L}]))`,
  'iu',
);

/** Texto → montos en centavos como cadena (`"8990000"`). `palabras` es verdadero si hay un monto escrito con letras. */
export function extraerMontos(texto: string): { centavos: Set<string>; palabras: boolean } {
  const t = texto.normalize('NFKC');
  const centavos = new Set<string>();
  for (const re of [RE_PREFIJO, RE_SUFIJO, RE_ABREVIADO]) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) {
      const c = aCentavos(m[1] ?? '', m[2]);
      if (c !== null) centavos.add(c.toString());
    }
  }
  return { centavos, palabras: RE_PALABRAS.test(t) };
}

function multiplicador(m: string | undefined): bigint {
  const k = sinTildes(m ?? '');
  if (k === 'mil' || k === 'k' || k === 'lucas' || k === 'palos') return 1000n;
  if (k === 'millones' || k === 'millon') return 1_000_000n;
  return 1n;
}

/** `89.900` → 8990000n; `45,50` → 4550n; `1,5 millones` → 150000000n. `null` si el número no tiene forma. */
export function aCentavos(numero: string, mult?: string): bigint | null {
  const n = interpretarNumero(numero);
  if (!n) return null;
  const digitos = n.entero + n.fraccion;
  const escala = 10n ** BigInt(n.fraccion.length);
  return (BigInt(digitos) * 100n * multiplicador(mult)) / escala;
}

/** Separa un número escrito con puntos y comas en parte entera y decimal (máximo 2 decimales). */
export function interpretarNumero(numero: string): { entero: string; fraccion: string } | null {
  if (!/^\d[\d.,]*$/.test(numero)) return null;
  const punto = numero.lastIndexOf('.');
  const coma = numero.lastIndexOf(',');
  let entero = numero;
  let fraccion = '';
  if (punto >= 0 && coma >= 0) {
    const dec = Math.max(punto, coma);
    entero = numero.slice(0, dec).replace(/[.,]/g, '');
    fraccion = numero.slice(dec + 1);
  } else if (punto >= 0 || coma >= 0) {
    const sep = punto >= 0 ? '.' : ',';
    const partes = numero.split(sep);
    const ultima = partes[partes.length - 1] ?? '';
    const miles = partes.length > 2 || (ultima.length === 3 && (partes[0] ?? '').length <= 3 && partes[0] !== '0');
    if (miles) entero = partes.join('');
    else {
      entero = partes[0] ?? '';
      fraccion = ultima;
    }
  }
  if (!/^\d+$/.test(entero) || (fraccion !== '' && !/^\d{1,2}$/.test(fraccion))) return null;
  return { entero, fraccion };
}

// ── Porcentajes, plazos, existencias, «gratis», códigos ───────────────────────────────────────────

const RE_PCT = /(\d+(?:[.,]\d+)?)\s?(?:%|por\s?ciento|porciento|percent)/giu;
const CONTEXTO_PCT = /descuent|rebaj|ahorr|recarg|inter[eé]s|financ|promo|oferta|\boff\b|cuota|dto/iu;

const RE_PLAZO = /(\d{1,3})(?:\s?(?:a|-|–|y|o|hasta)\s?(\d{1,3}))?\s*(d[ií]as?|horas?|semanas?|meses|mes|a[nñ]os?)/giu;
const CONTEXTO_PLAZO = /env[ií]o|entrega|llega|despach|garant|devol|retract|plazo|demora|tarda|abono|reembols|cobro|enviamos|recib/iu;

const RE_UNIDADES = /(\d{1,4})\s+(?:unidades|unds?\.?|piezas|frascos|existencias)/giu;
const CONTEXTO_STOCK = /quedan|queda\b|hay\b|tenemos|tengo|disponibles?|stock|inventario|existencias|restan|[uú]ltimas/iu;

const RE_GRATIS = /gratis|gratuit|sin\s+(?:costo|cargo)|no\s+(?:tiene|cobra\w*|cuesta)\s+(?:costo|cargo)/iu;
const CONTEXTO_ENVIO = /env[ií]o|domicilio|flete|despacho|entrega|transporte/iu;

const RE_CODIGO = /(?:c[oó]digo|cup[oó]n|code)\s+(?:de\s+descuento\s+|promocional\s+)?[:«"“'`]*\s*([A-Z0-9][A-Z0-9_-]{2,23})(?![\p{L}\d])/gu;

const unidadPlazo = (u: string) => {
  const k = sinTildes(u);
  return k.startsWith('dia') ? 'dia' : k.startsWith('hora') ? 'hora' : k.startsWith('semana') ? 'semana' : k.startsWith('mes') ? 'mes' : 'anio';
};
const normalizarPct = (n: string) => {
  const x = interpretarNumero(n);
  return x ? `${BigInt(x.entero)}${x.fraccion && /[1-9]/.test(x.fraccion) ? `.${x.fraccion.replace(/0+$/, '')}` : ''}` : null;
};

// ── Datos permitidos (lo que las herramientas devolvieron en el turno) ────────────────────────────

export class DatosPermitidos {
  readonly montos = new Set<string>();
  readonly porcentajes = new Set<string>();
  readonly plazos = new Set<string>();
  readonly codigos = new Set<string>();
  readonly hosts = new Set<string>();
  /** Montos que escribió la persona (solo se aceptan al repetir su presupuesto, no como precio de la tienda). */
  readonly montosUsuario = new Set<string>();
  /** Alguna fuente del turno dice que algo es gratis (p. ej. el valor de envío del panel). */
  hayGratis = false;

  /** Texto libre de una fuente de confianza del servidor (resultado de herramienta o mapa de la tienda). */
  agregarTexto(texto: string): void {
    const { centavos } = extraerMontos(texto);
    for (const c of centavos) this.montos.add(c);
    for (const m of texto.matchAll(RE_PCT)) {
      const p = normalizarPct(m[1] ?? '');
      if (p) this.porcentajes.add(p);
    }
    for (const m of texto.matchAll(RE_PLAZO)) {
      const u = unidadPlazo(m[3] ?? '');
      for (const n of [m[1], m[2]]) if (n) this.plazos.add(`${Number(n)}|${u}`);
    }
    if (RE_GRATIS.test(texto) && /gratis|gratuit|sin\s+(?:costo|cargo)/iu.test(texto)) this.hayGratis = true;
    for (const m of texto.matchAll(/https?:\/\/([^\s/"')]+)/giu)) if (m[1]) this.hosts.add(m[1].toLowerCase());
  }

  /** Recorre un resultado de herramienta: textos, porcentajes de campos `*_pct` y el campo `codigo`. */
  agregarResultado(valor: unknown, clave = ''): void {
    if (typeof valor === 'string') {
      if (/pct|porcentaje/i.test(clave)) {
        const p = normalizarPct(valor.replace(/[^\d.,]/g, ''));
        if (p) this.porcentajes.add(p);
      }
      if (clave === 'codigo' && /^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(valor)) this.codigos.add(valor);
      this.agregarTexto(valor);
    } else if (typeof valor === 'number') {
      if (/pct|porcentaje/i.test(clave)) {
        const p = normalizarPct(String(valor));
        if (p) this.porcentajes.add(p);
      }
    } else if (Array.isArray(valor)) {
      for (const v of valor) this.agregarResultado(v, clave);
    } else if (valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) this.agregarResultado(v, /pct|porcentaje/i.test(clave) ? clave : k);
    }
  }

  agregarMensajeUsuario(texto: string): void {
    for (const c of extraerMontos(texto).centavos) this.montosUsuario.add(c);
  }
}

export type MotivoCifra = 'monto' | 'monto_en_palabras' | 'porcentaje' | 'plazo' | 'unidades' | 'gratis' | 'codigo';

/** Eco legítimo del presupuesto de la persona: «con tu presupuesto de $100.000…». */
const ECO_PRESUPUESTO = /presupuesto|rango|hasta\b|m[aá]ximo|menos de|no m[aá]s de|tope|alrededor de/iu;

/**
 * ¿La oración trae una cifra comercial que no salió de las herramientas de este turno? Devuelve el motivo o `null`.
 * Es deliberadamente estricta: ante la duda se deriva al asesor, no se deja pasar un precio inventado.
 */
export function cifraNoRespaldada(oracion: string, datos: DatosPermitidos): MotivoCifra | null {
  const { centavos, palabras } = extraerMontos(oracion);
  if (palabras) return 'monto_en_palabras';
  for (const c of centavos) {
    if (datos.montos.has(c)) continue;
    if (datos.montosUsuario.has(c) && ECO_PRESUPUESTO.test(oracion)) continue;
    return 'monto';
  }
  if (CONTEXTO_PCT.test(oracion)) {
    for (const m of oracion.matchAll(RE_PCT)) {
      const p = normalizarPct(m[1] ?? '');
      if (p && !datos.porcentajes.has(p)) return 'porcentaje';
    }
  }
  if (CONTEXTO_PLAZO.test(oracion)) {
    for (const m of oracion.matchAll(RE_PLAZO)) {
      const u = unidadPlazo(m[3] ?? '');
      for (const n of [m[1], m[2]]) if (n && !datos.plazos.has(`${Number(n)}|${u}`)) return 'plazo';
    }
  }
  if (CONTEXTO_STOCK.test(oracion) && new RegExp(RE_UNIDADES.source, 'iu').test(oracion)) return 'unidades';
  if (RE_GRATIS.test(oracion) && CONTEXTO_ENVIO.test(oracion) && !datos.hayGratis) return 'gratis';
  for (const m of oracion.matchAll(RE_CODIGO)) {
    if (m[1] && !datos.codigos.has(m[1])) return 'codigo';
  }
  return null;
}

/** Hay alguna cifra comercial en el texto (para decidir si un mensaje pide datos que exigen herramienta). */
export function pideDatoComercial(mensaje: string): boolean {
  return /precio|cu[aá]nto|cuesta|vale\b|valor|costo|descuento|promo|oferta|env[ií]o|entrega|demora|tarda|stock|disponib|quedan|pago|pagar|cuotas?|abono|contra\s?entrega|garant[ií]a|devoluci|retracto|cobran|recargo/iu.test(mensaje);
}
