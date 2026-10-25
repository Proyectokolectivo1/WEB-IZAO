import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsearRango, resolverRuta, rutaDeVariante, servirArchivoGarantia, tipoDeContenido } from './archivo';

let raiz = '';
const VIDEO = Buffer.from('0123456789'.repeat(10)); // 100 bytes
const FOTO = Buffer.from('RIFFfoto');

beforeAll(async () => {
  raiz = await mkdtemp(path.join(os.tmpdir(), 'izao-media-'));
  await mkdir(path.join(raiz, 'warranty', '2026', '10'), { recursive: true });
  await writeFile(path.join(raiz, 'warranty', '2026', '10', 'v1.mp4'), VIDEO);
  await writeFile(path.join(raiz, 'warranty', '2026', '10', 'f1-400.webp'), FOTO);
  await writeFile(path.join(raiz, 'secreto.txt'), 'no debe salir');
});
afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const mediaVideo = { kind: 'warranty', variants: { video: 'warranty/2026/10/v1.mp4' } };
const mediaFoto = { kind: 'warranty', variants: { '400': 'warranty/2026/10/f1-400.webp' } };

async function leer(cuerpo: ReadableStream | null): Promise<string> {
  if (!cuerpo) return '';
  const partes: Uint8Array[] = [];
  const lector = cuerpo.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    partes.push(value as Uint8Array);
  }
  return Buffer.concat(partes).toString();
}

describe('rutas seguras y tipos', () => {
  it('solo resuelve rutas dentro de la raíz y de tipos permitidos', () => {
    expect(resolverRuta('/srv/media', 'warranty/a.mp4')).toMatch(/warranty[\\/]a\.mp4$/);
    for (const mala of ['../etc/passwd', 'warranty/../../x.mp4', '/etc/passwd', 'warranty/a.txt', '', 'a\0.mp4', 'warranty/script.php']) {
      expect(resolverRuta('/srv/media', mala), mala).toBeNull();
    }
    expect(tipoDeContenido('x.MP4')).toBe('video/mp4');
    expect(tipoDeContenido('x.mov')).toBe('video/quicktime');
    expect(tipoDeContenido('x.webp')).toBe('image/webp');
    expect(tipoDeContenido('x.html')).toBeNull();
  });

  it('elige el archivo según la variante y solo de medios de garantía', () => {
    expect(rutaDeVariante(mediaVideo, 'video')).toBe('warranty/2026/10/v1.mp4');
    expect(rutaDeVariante(mediaFoto, '400')).toBe('warranty/2026/10/f1-400.webp');
    expect(rutaDeVariante(mediaFoto, 'video')).toBeNull();
    expect(rutaDeVariante(mediaFoto, '800')).toBeNull();
    expect(rutaDeVariante(mediaFoto, '../400')).toBeNull();
    expect(rutaDeVariante({ kind: 'product', variants: mediaFoto.variants }, '400')).toBeNull();
    expect(rutaDeVariante(null, '400')).toBeNull();
  });

  it('interpreta los rangos de bytes', () => {
    expect(parsearRango(null, 100)).toBeNull();
    expect(parsearRango('bytes=0-9', 100)).toEqual({ inicio: 0, fin: 9 });
    expect(parsearRango('bytes=90-', 100)).toEqual({ inicio: 90, fin: 99 });
    expect(parsearRango('bytes=-10', 100)).toEqual({ inicio: 90, fin: 99 });
    expect(parsearRango('bytes=50-500', 100)).toEqual({ inicio: 50, fin: 99 });
    for (const malo of ['bytes=100-', 'bytes=9-2', 'bytes=-', 'bytes=-0', 'items=0-1', 'bytes=0-1,5-9']) expect(parsearRango(malo, 100), malo).toBe('invalido');
  });
});

describe('servirArchivoGarantia', () => {
  it('sirve el video completo con su tipo y sin caché compartida', async () => {
    const r = await servirArchivoGarantia({ media: mediaVideo, variante: 'video', rango: null, raiz });
    expect(r.status).toBe(200);
    expect(r.headers).toMatchObject({ 'Content-Type': 'video/mp4', 'Content-Length': '100', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    expect(await leer(r.cuerpo)).toBe(VIDEO.toString());
  });

  it('atiende rangos (206) para que el video pueda adelantarse, y rechaza los imposibles (416)', async () => {
    const r = await servirArchivoGarantia({ media: mediaVideo, variante: 'video', rango: 'bytes=10-19', raiz });
    expect(r.status).toBe(206);
    expect(r.headers).toMatchObject({ 'Content-Range': 'bytes 10-19/100', 'Content-Length': '10' });
    expect(await leer(r.cuerpo)).toBe('0123456789');
    const mal = await servirArchivoGarantia({ media: mediaVideo, variante: 'video', rango: 'bytes=500-', raiz });
    expect(mal.status).toBe(416);
    expect(mal.headers['Content-Range']).toBe('bytes */100');
  });

  it('sirve las fotos como imagen', async () => {
    const r = await servirArchivoGarantia({ media: mediaFoto, variante: '400', rango: null, raiz });
    expect(r.headers['Content-Type']).toBe('image/webp');
    expect(await leer(r.cuerpo)).toBe(FOTO.toString());
  });

  it('404 sin pistas para lo que no existe, no es de garantía o intenta salirse de la raíz', async () => {
    const casos = [
      { media: null, variante: '400' },
      { media: { kind: 'product', variants: mediaFoto.variants }, variante: '400' },
      { media: mediaFoto, variante: '800' },
      { media: { kind: 'warranty', variants: { video: '../secreto.txt' } }, variante: 'video' },
      { media: { kind: 'warranty', variants: { video: 'warranty/2026/10/no-existe.mp4' } }, variante: 'video' },
      { media: { kind: 'warranty', variants: { video: 'warranty/2026/10' } }, variante: 'video' },
    ];
    for (const c of casos) {
      const r = await servirArchivoGarantia({ ...c, rango: null, raiz });
      expect(r.status).toBe(404);
      expect(r.cuerpo).toBeNull();
    }
  });
});
