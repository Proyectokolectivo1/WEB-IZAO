/**
 * Defensa de entrada de Iza (modelo de amenaza del chat público). Código puro.
 *
 * - `sanearEntrada`: quita caracteres de control, invisibles y de formato (incluido el bloque «tags» de U+E0000, usado para
 *   esconder instrucciones) antes de que el texto llegue al modelo o al historial.
 * - `clasificarEntrada`: detecta, ANTES de gastar una llamada al modelo, los intentos de manipulación conocidos (ignorar
 *   instrucciones, pedir el prompt, jailbreak/roleplay, secretos y costos, delimitadores falsos, texto codificado) y el
 *   scraping del catálogo. Ante un intento responde un texto fijo y cortés, sin modelo. No es la única defensa: lo que se
 *   escape se contiene con la lista blanca de campos de las herramientas, el filtro de salida y el guardarraíl de cifras.
 * - `detectarManipulacion`: la misma lista, para revisar DATOS (descripciones de productos, políticas) contra la inyección
 *   indirecta: una frase que «le habla al asistente» se omite en vez de entregarse al modelo.
 */

export type TipoIntento = 'instrucciones' | 'prompt' | 'jailbreak' | 'secretos' | 'costos' | 'delimitadores' | 'codificacion' | 'cadena_larga' | 'scraping';

export type ClasificacionEntrada = { accion: 'ok' } | { accion: 'rechazar'; tipo: TipoIntento };

/** Caracteres que no se muestran o no son texto: control, formato, separadores de línea/párrafo, tags, selectores, privados. */
// eslint-disable-next-line no-misleading-character-class -- los selectores de variación y similares se quitan a propósito
const INVISIBLES = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029\u180e\u3164\u115f\u1160\uffa0\u{e0000}-\u{e007f}\u{fe00}-\u{fe0f}]/gu;

/** Texto limpio: NFKC, sin invisibles (se conservan salto de línea y tabulación como espacio) y con espacios colapsados. */
export function sanearEntrada(crudo: string): { texto: string; invisibles: number } {
  const normal = crudo.normalize('NFKC');
  let invisibles = 0;
  const sinInvisibles = normal.replace(/\r\n?/g, '\n').replace(INVISIBLES, (c) => {
    if (c === '\n' || c === '\t') return c;
    invisibles++;
    return '';
  });
  const texto = sinInvisibles.replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { texto, invisibles };
}

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Variante «leet»: 1→i, 0→o, 3→e, 4→a, 5→s, 7→t, @→a, $→s. */
const sinLeet = (t: string) => t.replace(/[013457@$]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' })[c] ?? c);

/** Solo letras, para atrapar «i g n o r a», «i.g.n.o.r.a» y similares. */
const soloLetras = (t: string) => t.replace(/[^a-z]/g, '');

const R = (re: RegExp) => re;

const PATRONES: { tipo: TipoIntento; re: RegExp }[] = [
  // Ignorar o reemplazar instrucciones
  { tipo: 'instrucciones', re: R(/\b(ignora|ignore|olvida|forget|desestima|omite|desobedece|disregard|override|bypass|elude|sobrescribe)\b.{0,50}\b(instruccion(es)?|reglas?|indicacion(es)?|restriccion(es)?|directrices|politicas|limites|filtros|guardarrailes|prompt|rules|instructions|guidelines|restrictions|programacion)\b/s) },
  { tipo: 'instrucciones', re: R(/\b(nuevas?|new|updated|actualizadas?) (instruccion(es)?|reglas|instructions|rules)\b.{0,30}\b(son|are|:|a partir)/s) },
  { tipo: 'instrucciones', re: R(/\b(a partir de (ahora|este momento)|desde ahora|from now on|de ahora en adelante)\b.{0,40}\b(eres|seras|debes|responde|obedece|actua|you are|you will|you must|act)\b/s) },
  { tipo: 'instrucciones', re: R(/\b(el|tu) (desarrollador|dueno|creador|administrador|programador) (me )?(autoriza|ordena|dijo|pidio|permite)|soy (el|tu) (desarrollador|dueno|creador|administrador|admin|programador)|modo (mantenimiento|depuracion|debug|admin|administrador|desarrollador|dios|sudo)|developer mode|debug mode|admin mode|sudo\b/) },
  // Pedir el prompt o la configuración
  { tipo: 'prompt', re: R(/\b(muestra|muestrame|dime|dame|revela|repite|imprime|escribe|copia|pega|traduce|resume|resumeme|cuentame|comparte|lista|enumera|print|show|reveal|repeat|tell|display|output|dump|leak|recita|recite|reproduce|parafrasea|transcribe)\b.{0,40}\b(prompt|system ?message|mensaje (del )?sistema|(tus?|your|las|los) (propias |internas |ocultas |secretas |iniciales |originales )(instrucciones|reglas|ordenes|directrices|indicaciones)|tus? (instrucciones|reglas|ordenes|directrices|indicaciones|configuracion|programacion)|your (instructions|rules|guidelines|configuration|programming)|everything above|above text|texto (de )?arriba)/s) },
  { tipo: 'prompt', re: R(/\b(system ?prompt|prompt (del )?sistema|prompt inicial|initial prompt|hidden prompt|prompt oculto|mensaje de sistema|system message|instrucciones (internas|ocultas|iniciales|originales|del sistema)|texto (que|qu[eé]) (esta|va) (arriba|antes)|what (are|were) your (instructions|rules)|cuales son tus (instrucciones|reglas)|que (instrucciones|reglas|ordenes) (tienes|te dieron|recibiste))\b/) },
  { tipo: 'prompt', re: R(/\b(repite|repeat|escribe|write|empieza|start|comienza)\b.{0,30}\b(todo )?(lo anterior|las palabras|the words|everything|palabra por palabra|verbatim|desde el inicio|from the (start|beginning)|above)\b/s) },
  // Jailbreak y roleplay
  { tipo: 'jailbreak', re: R(/\b(jailbreak|jail break|do anything now|modo dan|stan mode|dude mode|sin (restricciones|filtros|censura|limites|reglas)|without (restrictions|filters|limits|rules)|unfiltered|uncensored|sin ninguna regla|libre de (reglas|restricciones))\b/) },
  { tipo: 'jailbreak', re: R(/\b(actua|actuas|haz de cuenta|finge|fingir|simula|simular|imagina que (eres|eras)|ahora eres|ya no eres|dejas de ser|deja de ser|eres ahora|pretend|act as|roleplay|role play|juega (a|el papel)|interpreta (a|el papel)|you are now|from now you are|no eres iza|olvida que eres)\b.{0,50}\b(sin (reglas|limites|restricciones|filtros)|hacker|desarrollador|administrador|admin|dueno|root|sistema|otro (bot|asistente|ia|chatbot)|gpt|chatgpt|dan\b|ia (libre|sin)|asistente (libre|sin)|iza (libre|sin|mala|maligna)|sin ninguna|evil|malvad|developer|assistant|programador|jefe|ceo|gerente)\b/s) },
  { tipo: 'jailbreak', re: R(/\b(ahora eres|you are now|eres ahora|a partir de ahora eres)\b/) },
  { tipo: 'jailbreak', re: R(/\b(hipoteticamente|en un mundo (donde|en el que)|para una (novela|historia|pelicula|obra)|en esta ficcion|supongamos que no tienes (reglas|limites))\b.{0,80}\b(prompt|instruccion|costo|margen|proveedor|credencial|contrasena|clave)/s) },
  // Secretos e internos
  { tipo: 'secretos', re: R(/\b(dame|dime|muestra|muestrame|comparte|pasame|entregame|revela|lista|enumera|exporta|extrae|show|give|share|reveal|list|export|dump|leak|cual es|cuales son|what is|what are)\b.{0,50}\b(credenciales|contrasenas?|passwords?|api ?keys?|tokens?|secretos?|variables de entorno|env vars?|\.env|service ?role|jwt|base de datos|database|schema|endpoints?|rutas internas|urls? internas?|panel (de )?admin|admin panel|usuarios (del )?(admin|panel|sistema)|correos? de (los )?(admin|empleados)|datos de (otros|los) (clientes|usuarios|pedidos)|pedidos de otros|clientes (de|que)|telefonos? de (los )?clientes)\b/s) },
  { tipo: 'secretos', re: R(/\b(mastershop|master shop|supabase|openrouter|open router|bullmq|redis|contabo|nginx|docker|app_encryption_key|api ?key de|service[_ ]role|hostinger)\b/) },
  { tipo: 'secretos', re: R(/(\/admin|\/api\/|localhost|127\.0\.0\.1|192\.168\.|\.env\b|process\.env|select \* from|drop table|union select|information_schema|pg_catalog)/) },
  // Costos, márgenes, proveedores
  { tipo: 'costos', re: R(/\b(precio de costo|costo de compra|costo (real|unitario|de adquisicion|del producto|de produccion)|cuanto (te )?cuesta (a (izao|ustedes|la tienda)|importar)|a como (lo|los) compran|margen(es)?( de)? (ganancia|utilidad|beneficio|bruto)?|utilidad (bruta|neta|por)|ganancia (por|de la tienda|real)|precio (mayorista|al por mayor|de proveedor|de fabrica|de distribuidor)|wholesale|cost price|profit margin|markup|dropshipping|dropshipper|dropship)\b/) },
  { tipo: 'costos', re: R(/\b(proveedor(es)?|supplier|distribuidor(es)? mayorista|fabricante real|quien (les )?(vende|surte|provee|fabrica)|de donde (compran|traen|importan|sacan)|donde (los|las) (compran|consiguen|fabrican)|sku (de|del) proveedor|codigo (de|del) proveedor|referencia (de|del) proveedor|id (de|del) proveedor)\b.{0,60}\b(cual|quien|nombre|dime|dame|muestra|lista|contacto|telefono|correo|link|enlace|pagina|sitio|web|sku|codigo|referencia|id)\b|\b(cual|quien|dime|dame|muestra|lista)\b.{0,40}\b(proveedor(es)?|supplier|sku (de|del) proveedor)\b/s) },
  // Delimitadores falsos de rol o de sistema
  { tipo: 'delimitadores', re: R(/(<\/?\s*(system|assistant|developer|tool|instructions?|datos_herramienta|prompt|im_start|im_end)\b|\[\/?(inst|sys|system)\]|<<\s*sys\s*>>|<\|\s*(im_start|im_end|system|assistant|endoftext)|^\s*#{1,4}\s*(system|instructions?|sistema|instrucciones)\b|^\s*(system|sistema|assistant|asistente|developer)\s*[:>]|^\s*\[(system|sistema|assistant)\])/m) },
  { tipo: 'delimitadores', re: R(/\bfin (de las )?(instrucciones|del prompt)\b|\bend of (system )?(prompt|instructions)\b|\bnuevo (turno|mensaje) del sistema\b/) },
  // Codificación explícita
  { tipo: 'codificacion', re: R(/\b(decodifica|decodifica esto|decode|descifra|decrypt|base ?64|rot ?13|en hexadecimal|hex ?dump|ejecuta (esto|el siguiente|este) (codigo|script|comando)|eval\(|exec\()/) },
  // Scraping del catálogo
  { tipo: 'scraping', re: R(/\b(lista|listado|enumera|dame|dime|muestrame|muestra|exporta|descarga|pasame|give me|list|dump|export|show me)\b.{0,40}\b(todos|todas|completo|completa|entero|entera|all|full|every|cada)\b.{0,40}\b(productos?|perfumes?|fragancias?|aromas?|precios?|referencias|catalogo|inventario|items|skus?|slugs?|stock)\b/s) },
  { tipo: 'scraping', re: R(/\b(catalogo|inventario|base de datos|lista de precios) (completo|completa|entero|entera|total)\b|\b(todos|all) (los|the) (productos|perfumes|precios|products|prices)\b|\bdel 1 al \d{2,}\b|\bsiguiente pagina\b|\bpagina \d{2,}\b|\bresultados? (del|desde el) \d+ al \d+\b|\boffset\b|\bpaginacion\b/) },
];

const CADENA_LARGA = /\S{81,}/;
const BASE64 = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
/** Bloque opaco (sin guiones: un enlace de producto no es un bloque codificado). */
const OPACO = /[A-Za-z0-9+/]{40,}={0,2}/g;
const HEX = /\b(?:[0-9a-f]{2}[\s:-]?){16,}\b/i;

function decodificarBase64(t: string): string | null {
  const limpio = t.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = Buffer.from(limpio, 'base64');
    if (bin.length < 8) return null;
    const s = bin.toString('utf8');
    // Solo se acepta si es texto casi imprimible (descarta ruido).
    const imprimibles = [...s].filter((c) => /[\p{L}\p{N}\p{P}\p{Zs}]/u.test(c)).length;
    return imprimibles / Math.max(1, [...s].length) > 0.85 ? s : null;
  } catch {
    return null;
  }
}

function variantes(texto: string): string[] {
  const v = new Set<string>([texto]);
  // Escapes tipo %69%67… y i…
  if (/(?:%[0-9a-f]{2}){4,}/i.test(texto)) {
    try {
      v.add(decodeURIComponent(texto));
    } catch {
      /* %XX mal formado */
    }
  }
  if (/(?:\\u[0-9a-f]{4}){4,}/i.test(texto)) v.add(texto.replace(/\\u([0-9a-f]{4})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))));
  if (/(?:&#x?[0-9a-f]+;){4,}/i.test(texto)) {
    v.add(texto.replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d))));
  }
  for (const m of texto.matchAll(BASE64)) {
    const d = decodificarBase64(m[0]);
    if (d) v.add(d);
  }
  // ROT13 de la frase completa (barato; solo se mira si el original no coincidió)
  v.add(texto.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.charCodeAt(0) & 223) - 52) % 26 + (c.charCodeAt(0) & 32) + 65)));
  return [...v];
}

function coincide(texto: string): TipoIntento | null {
  const base = sinTildes(texto);
  const leet = sinLeet(base);
  for (const candidato of base === leet ? [base] : [base, leet]) {
    for (const p of PATRONES) if (p.re.test(candidato)) return p.tipo;
  }
  // Letras separadas («i g n o r a   t u s   i n s t r u c c i o n e s»).
  const junto = soloLetras(leet);
  if (/(ignoratusinstrucciones|ignoralasinstrucciones|ignoratodaslasinstrucciones|ignoreallpreviousinstructions|ignorepreviousinstructions|muestratuprompt|revelatuprompt|dimetuprompt|systemprompt|olvidatusreglas)/.test(junto)) return 'instrucciones';
  return null;
}

/** ¿El texto intenta manipular al asistente? (`tipo`) — sirve para el mensaje de la persona y para datos de la base. */
export function detectarManipulacion(texto: string): TipoIntento | null {
  for (const v of variantes(texto)) {
    const t = coincide(v);
    if (t) return t;
  }
  return null;
}

export function clasificarEntrada(mensaje: string): ClasificacionEntrada {
  const texto = mensaje.trim();
  if (!texto) return { accion: 'ok' };
  const tipo = detectarManipulacion(texto);
  if (tipo) return { accion: 'rechazar', tipo };
  // Bloques opacos: un solo «token» larguísimo, base64 que no decodifica a texto, o volcado hexadecimal.
  if (CADENA_LARGA.test(texto)) return { accion: 'rechazar', tipo: 'cadena_larga' };
  for (const m of texto.matchAll(OPACO)) {
    if (m[0].length >= 40 && /\d/.test(m[0]) && /[A-Za-z]/.test(m[0])) return { accion: 'rechazar', tipo: 'codificacion' };
  }
  if (HEX.test(texto)) return { accion: 'rechazar', tipo: 'codificacion' };
  return { accion: 'ok' };
}
