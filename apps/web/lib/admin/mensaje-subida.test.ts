import { describe, expect, it } from 'vitest';
import {
  ALT_MINIMO,
  TEXTOS_SUBIDA,
  altSuficiente,
  enviarSubida,
  esCodigoTecnico,
  mensajeAltListo,
  mensajeAltPendiente,
  mensajeDeSubida,
  mensajeSinConexion,
} from './mensaje-subida';

const CODIGOS = ['sin-sesion', 'sin-acceso', 'sin-permiso', 'sesion-expirada'];

describe('mensajeDeSubida', () => {
  it('401 y sin-sesion: sesión vencida con enlace al login, sin el código', () => {
    for (const entrada of [
      { status: 401, cuerpo: { error: 'sin-sesion' } },
      { status: 401, cuerpo: null },
      { status: 200, cuerpo: { error: 'sin-sesion' } },
    ]) {
      const r = mensajeDeSubida(entrada);
      expect(r.texto).toBe('Tu sesión venció. Vuelve a entrar al panel y sube la imagen de nuevo.');
      expect(r.requiereLogin).toBe(true);
    }
  });

  it('403: acceso y permiso', () => {
    expect(mensajeDeSubida({ status: 403, cuerpo: { error: 'sin-permiso' } })).toEqual({ texto: TEXTOS_SUBIDA.sinPermiso, requiereLogin: false });
    expect(mensajeDeSubida({ status: 403, cuerpo: { error: 'sin-acceso' } })).toEqual({ texto: TEXTOS_SUBIDA.sinAcceso, requiereLogin: false });
    expect(mensajeDeSubida({ status: 403, cuerpo: null }).texto).toBe(TEXTOS_SUBIDA.sinPermiso);
  });

  it('ningún código técnico llega al texto', () => {
    for (const codigo of CODIGOS) {
      for (const status of [200, 400, 401, 403, 500]) {
        const { texto } = mensajeDeSubida({ status, cuerpo: { error: codigo }, archivo: 'foto.png' });
        expect(texto).not.toContain(codigo);
        expect(texto.startsWith('foto.png: ')).toBe(true);
      }
    }
  });

  it('413, 415, 429 y 5xx sin cuerpo (HTML de Nginx)', () => {
    expect(mensajeDeSubida({ status: 413, cuerpo: null }).texto).toBe(TEXTOS_SUBIDA.pesado);
    expect(mensajeDeSubida({ status: 415, cuerpo: null }).texto).toBe(TEXTOS_SUBIDA.formato);
    expect(mensajeDeSubida({ status: 429, cuerpo: null }).texto).toBe(TEXTOS_SUBIDA.muchosIntentos);
    for (const status of [500, 502, 503, 504]) expect(mensajeDeSubida({ status, cuerpo: null }).texto).toBe(TEXTOS_SUBIDA.servidor);
    expect(mensajeDeSubida({ status: 400, cuerpo: null }).texto).toBe(TEXTOS_SUBIDA.generico);
    expect(mensajeDeSubida({}).texto).toBe(TEXTOS_SUBIDA.generico);
  });

  it('respeta el texto humano que ya devolvió la API', () => {
    expect(mensajeDeSubida({ status: 413, cuerpo: { error: 'La imagen supera los 15 MB.' } }).texto).toBe('La imagen supera los 15 MB.');
    expect(mensajeDeSubida({ status: 400, cuerpo: { error: 'No se pudo leer la imagen. Prueba con otro archivo.' } }).texto).toBe(
      'No se pudo leer la imagen. Prueba con otro archivo.',
    );
  });

  it('«Revisa los datos.» con campos usa el primer mensaje del campo', () => {
    const r = mensajeDeSubida({ status: 400, cuerpo: { error: 'Revisa los datos.', campos: { alt: 'Describe la imagen (mínimo 3 caracteres).' } } });
    expect(r.texto).toBe('Describe la imagen (mínimo 3 caracteres).');
  });

  it('un código desconocido cae al texto del estado HTTP', () => {
    expect(mensajeDeSubida({ status: 500, cuerpo: { error: 'boom_interno' } }).texto).toBe(TEXTOS_SUBIDA.servidor);
    expect(mensajeDeSubida({ status: 400, cuerpo: { error: 'x' } }).texto).toBe(TEXTOS_SUBIDA.generico);
  });

  it('antepone el nombre del archivo solo si se indica', () => {
    expect(mensajeDeSubida({ status: 401, cuerpo: null, archivo: 'AVT-100_1.png' }).texto).toBe(`AVT-100_1.png: ${TEXTOS_SUBIDA.sesionVencida}`);
    expect(mensajeDeSubida({ status: 401, cuerpo: null }).texto).not.toContain(':');
  });

  it('terminar en la pantalla de acceso es sesión vencida; las cargas de archivos hablan de «el archivo»', () => {
    expect(mensajeDeSubida({ status: 200, cuerpo: null, terminoEnLogin: true }).requiereLogin).toBe(true);
    expect(mensajeDeSubida({ status: 401, cuerpo: null, tipo: 'archivo' }).texto).toBe(TEXTOS_SUBIDA.sesionVencidaArchivo);
  });

  it('sin conexión', () => {
    expect(mensajeSinConexion().texto).toBe(TEXTOS_SUBIDA.sinConexion);
    expect(mensajeSinConexion('a.jpg').texto).toBe(`a.jpg: ${TEXTOS_SUBIDA.sinConexion}`);
  });
});

describe('esCodigoTecnico', () => {
  it('distingue códigos de frases', () => {
    expect(esCodigoTecnico('sin-sesion')).toBe(true);
    expect(esCodigoTecnico('mfa_pendiente')).toBe(true);
    expect(esCodigoTecnico('Falta el archivo.')).toBe(false);
    expect(esCodigoTecnico('La imagen supera los 15 MB.')).toBe(false);
  });
});

function respuesta(status: number, cuerpo: unknown, extra: { redirected?: boolean; url?: string } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: extra.redirected ?? false,
    url: extra.url ?? 'https://izaoperfumeria.com/api/admin/media',
    json: async () => {
      if (cuerpo === undefined) throw new SyntaxError('no es JSON');
      return cuerpo;
    },
  };
}

describe('enviarSubida', () => {
  const datos = new FormData();

  it('401 sin-sesion: devuelve el mensaje humano, no el código', async () => {
    const r = await enviarSubida('/api/admin/media', datos, { archivo: 'a.png', peticion: async () => respuesta(401, { error: 'sin-sesion' }) });
    expect(r).toEqual({ ok: false, fallo: { texto: `a.png: ${TEXTOS_SUBIDA.sesionVencida}`, requiereLogin: true } });
  });

  it('red caída', async () => {
    const r = await enviarSubida('/api/admin/media', datos, {
      peticion: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(r).toEqual({ ok: false, fallo: { texto: TEXTOS_SUBIDA.sinConexion, requiereLogin: false } });
  });

  it('respuesta HTML de Nginx (413) y redirección al login', async () => {
    const a = await enviarSubida('/x', datos, { peticion: async () => respuesta(413, undefined) });
    expect(a.ok === false && a.fallo.texto).toBe(TEXTOS_SUBIDA.pesado);
    const b = await enviarSubida('/x', datos, {
      peticion: async () => respuesta(200, undefined, { redirected: true, url: 'https://izaoperfumeria.com/admin/login?next=%2Fadmin' }),
    });
    expect(b.ok === false && b.fallo.requiereLogin).toBe(true);
  });

  it('éxito: devuelve el cuerpo; 2xx sin lo esperado es fallo', async () => {
    const ok = await enviarSubida<{ id: string }>('/x', datos, { valida: (c) => Boolean(c.id), peticion: async () => respuesta(201, { id: 'm1' }) });
    expect(ok).toEqual({ ok: true, cuerpo: { id: 'm1' } });
    const mal = await enviarSubida<{ id: string }>('/x', datos, { valida: (c) => Boolean(c.id), peticion: async () => respuesta(201, {}) });
    expect(mal.ok).toBe(false);
  });
});

describe('texto alternativo pendiente', () => {
  it('exige 3 caracteres sin contar espacios de los lados', () => {
    expect(ALT_MINIMO).toBe(3);
    expect(altSuficiente('')).toBe(false);
    expect(altSuficiente('  ab  ')).toBe(false);
    expect(altSuficiente(' abc ')).toBe(true);
  });

  it('avisa con el nombre del archivo y sin tono de error ni códigos', () => {
    expect(mensajeAltPendiente(['frasco.png'])).toBe('Falta una descripción corta para subir "frasco.png".');
    expect(mensajeAltPendiente(['a.png', 'b.png'])).toBe('Falta una descripción corta para subir 2 archivos.');
    expect(mensajeAltListo(['frasco.png'])).toBe('"frasco.png" está listo para subir.');
    expect(mensajeAltListo(['a.png', 'b.png'])).toBe('2 archivos listos para subir.');
    for (const t of [mensajeAltPendiente(['x.png']), TEXTOS_SUBIDA.altGuia, TEXTOS_SUBIDA.ayudaAlt]) {
      expect(esCodigoTecnico(t)).toBe(false);
      expect(t).not.toMatch(/error|inválid|obligatori/i);
    }
  });
});
