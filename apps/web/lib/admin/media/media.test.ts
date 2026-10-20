import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { escribirVariantes, rutaBase } from './guardar';
import { procesarImagen } from './procesar';
import { MAX_BYTES, detectarTipo, validarArchivo } from './validar';

/** Imágenes generadas al vuelo: no hay binarios en el repo. */
async function imagen(ancho: number, alto: number, formato: 'jpeg' | 'png' | 'webp' | 'avif' = 'jpeg', orientacion?: number) {
  let s = sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 180, g: 40, b: 40 } } });
  if (orientacion) s = s.withMetadata({ orientation: orientacion });
  return s.toFormat(formato).toBuffer();
}

describe('validación por magic bytes (no por extensión)', () => {
  it('reconoce JPG, PNG, WebP y AVIF por su contenido', async () => {
    expect(detectarTipo(await imagen(20, 20, 'jpeg'))).toBe('jpeg');
    expect(detectarTipo(await imagen(20, 20, 'png'))).toBe('png');
    expect(detectarTipo(await imagen(20, 20, 'webp'))).toBe('webp');
    expect(detectarTipo(await imagen(20, 20, 'avif'))).toBe('avif');
  });

  it('rechaza un texto o un ejecutable con extensión .jpg', () => {
    const falso = Buffer.from('MZ\x90\x00 esto no es una imagen <script>alert(1)</script>');
    expect(detectarTipo(falso)).toBeNull();
    expect(validarArchivo({ buffer: falso, nombre: 'foto.jpg' })).toEqual({ ok: false, error: 'tipo' });
  });

  it('rechaza un SVG aunque se llame .png', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(validarArchivo({ buffer: svg, nombre: 'logo.png' }).ok).toBe(false);
  });

  it('acepta una imagen real aunque la extensión mienta', async () => {
    const r = validarArchivo({ buffer: await imagen(20, 20, 'png'), nombre: 'foto.dat' });
    expect(r).toEqual({ ok: true, tipo: 'png' });
  });

  it('rechaza más de 15 MB sin intentar decodificar', () => {
    const grande = Buffer.alloc(MAX_BYTES + 1, 0xff);
    expect(validarArchivo({ buffer: grande, nombre: 'a.jpg' })).toEqual({ ok: false, error: 'tamano' });
  });

  it('rechaza un archivo vacío', () => {
    expect(validarArchivo({ buffer: Buffer.alloc(0), nombre: 'a.jpg' }).ok).toBe(false);
  });
});

describe('procesarImagen', () => {
  it('genera 400/800/1600 en WebP para una imagen grande', async () => {
    const r = await procesarImagen({ buffer: await imagen(2400, 1800), recorte45: false });
    expect(r.variantes.map((v) => v.ancho)).toEqual([400, 800, 1600]);
    for (const v of r.variantes) expect(detectarTipo(v.buffer)).toBe('webp');
    expect(r.ancho).toBe(2400);
    expect(r.alto).toBe(1800);
  });

  it('no agranda una imagen pequeña: solo el ancho original', async () => {
    const r = await procesarImagen({ buffer: await imagen(300, 200), recorte45: false });
    expect(r.variantes.map((v) => v.ancho)).toEqual([300]);
    expect(r.variantes[0]?.alto).toBe(200);
  });

  it('con una imagen intermedia usa los anchos que caben y el original', async () => {
    const r = await procesarImagen({ buffer: await imagen(1000, 500), recorte45: false });
    expect(r.variantes.map((v) => v.ancho)).toEqual([400, 800, 1000]);
  });

  it('aplica la rotación EXIF y elimina los metadatos', async () => {
    // Orientación 6: la imagen almacenada de 200x100 se muestra de 100x200.
    const r = await procesarImagen({ buffer: await imagen(200, 100, 'jpeg', 6), recorte45: false });
    expect(r.ancho).toBe(100);
    expect(r.alto).toBe(200);
    const meta = await sharp(r.variantes[0]!.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.width).toBe(100);
  });

  it('recorte 4:5 opcional para producto', async () => {
    const r = await procesarImagen({ buffer: await imagen(2000, 2000), recorte45: true });
    for (const v of r.variantes) expect(Math.abs(v.alto / v.ancho - 1.25)).toBeLessThan(0.01);
  });

  it('LQIP de 16 px en base64', async () => {
    const r = await procesarImagen({ buffer: await imagen(800, 600), recorte45: false });
    expect(r.lqip.startsWith('data:image/webp;base64,')).toBe(true);
    const bytes = Buffer.from(r.lqip.split(',')[1]!, 'base64');
    expect((await sharp(bytes).metadata()).width).toBe(16);
  });

  it('una imagen corrupta con cabecera válida falla con error controlado', async () => {
    const roto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 1)]);
    await expect(procesarImagen({ buffer: roto, recorte45: false })).rejects.toThrow();
  });
});

describe('guardado en MEDIA_ROOT/{kind}/{yyyy}/{mm}/{uuid}-{ancho}.webp', () => {
  let raiz: string | undefined;
  afterAll(async () => {
    if (raiz) await rm(raiz, { recursive: true, force: true });
  });

  it('rutaBase usa kind, año, mes y uuid', () => {
    expect(rutaBase('product', new Date(Date.UTC(2026, 9, 19)), 'abc')).toBe('product/2026/10/abc');
  });

  it('escribe cada variante y devuelve el mapa ancho → ruta relativa', async () => {
    raiz = await mkdtemp(path.join(os.tmpdir(), 'izao-media-'));
    const r = await procesarImagen({ buffer: await imagen(900, 900), recorte45: false });
    const base = rutaBase('banner', new Date(Date.UTC(2026, 0, 5)), 'u1');
    const mapa = await escribirVariantes(raiz, base, r.variantes);
    expect(mapa).toEqual({
      '400': 'banner/2026/01/u1-400.webp',
      '800': 'banner/2026/01/u1-800.webp',
      '900': 'banner/2026/01/u1-900.webp',
    });
    const leido = await readFile(path.join(raiz, mapa['400']!));
    expect(detectarTipo(leido)).toBe('webp');
  });

  it('no permite escapar de MEDIA_ROOT con un base_path malicioso', async () => {
    raiz ??= await mkdtemp(path.join(os.tmpdir(), 'izao-media-'));
    await expect(
      escribirVariantes(raiz, '../../fuera/x', [{ ancho: 10, alto: 10, buffer: Buffer.from('x') }]),
    ).rejects.toThrow(/ruta/i);
  });
});
