import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { escribirVariantes } from './guardar';
import { ErrorImagen, LIMITE_PIXELES_PANEL, LIMITE_PIXELES_PUBLICO, mensajeErrorImagen, procesarImagen } from './procesar';
import { SemaforoOcupado, crearSemaforo } from './semaforo';

/** PNG de un solo color: pesa pocos KB aunque tenga decenas de megapíxeles (bomba de descompresión). */
const bomba = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } })
    .png({ compressionLevel: 9 })
    .toBuffer();

describe('límite de píxeles de entrada', () => {
  it('un PNG de 10000x10000 de pocos KB se rechaza sin decodificarlo (panel y público)', async () => {
    const png = await bomba(10_000, 10_000);
    expect(png.length).toBeLessThan(1_000_000);
    for (const origen of ['panel', 'publico'] as const) {
      const falla = await procesarImagen({ buffer: png, recorte45: false, origen }).catch((e) => e);
      expect(falla).toBeInstanceOf(ErrorImagen);
      expect((falla as ErrorImagen).codigo).toBe('demasiado_grande');
      expect(mensajeErrorImagen(falla)).toMatch(/píxeles/);
    }
  }, 60_000);

  it('lo público tiene un límite menor que el panel y es el que rige por defecto', async () => {
    expect(LIMITE_PIXELES_PUBLICO).toBeLessThan(LIMITE_PIXELES_PANEL);
    // 5600x5000 = 28 MP: entre ambos límites.
    const png = await bomba(5_600, 5_000);
    const falla = await procesarImagen({ buffer: png, recorte45: false }).catch((e) => e);
    expect((falla as ErrorImagen).codigo).toBe('demasiado_grande');
  }, 60_000);

  it('el mensaje de un archivo ilegible es genérico', () => {
    expect(mensajeErrorImagen(new Error('x'))).toMatch(/No se pudo leer/);
  });
});

describe('recorte 4:5 y rotación en un solo pipeline', () => {
  it('con EXIF 6 las dimensiones salen giradas y el recorte es 4:5', async () => {
    const jpg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#a33' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const r = await procesarImagen({ buffer: jpg, recorte45: false, origen: 'panel' });
    expect([r.ancho, r.alto]).toEqual([800, 1200]);
    const c = await procesarImagen({ buffer: jpg, recorte45: true, origen: 'panel' });
    expect([c.ancho, c.alto]).toEqual([800, 1000]);
    expect(c.variantes.at(-1)?.alto).toBe(1000);
  });
});

describe('semáforo de procesos simultáneos', () => {
  it('el tercero espera hasta que se libera un turno', async () => {
    const s = crearSemaforo(2);
    const a = await s.adquirir(100);
    await s.adquirir(100);
    let entro = false;
    const tercero = s.adquirir(1000).then((l) => {
      entro = true;
      return l;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(entro).toBe(false);
    expect(s.enCola).toBe(1);
    a();
    await tercero;
    expect(entro).toBe(true);
    expect(s.activas).toBe(2);
  });

  it('agota la espera con un error claro y no deja turnos colgados', async () => {
    const s = crearSemaforo(1);
    const l = await s.adquirir(50);
    await expect(s.adquirir(30)).rejects.toBeInstanceOf(SemaforoOcupado);
    expect(s.enCola).toBe(0);
    l();
    l(); // liberar dos veces no abre un turno de más
    expect(s.activas).toBe(0);
    const otra = await s.adquirir(30);
    await expect(s.adquirir(10)).rejects.toBeInstanceOf(SemaforoOcupado);
    otra();
  });
});

describe('un UUID nunca se sobrescribe', () => {
  let raiz: string | undefined;
  afterAll(async () => {
    if (raiz) await rm(raiz, { recursive: true, force: true });
  });

  it('escribir dos veces la misma ruta falla y conserva el primer archivo, sin dejar temporales', async () => {
    raiz = await mkdtemp(path.join(os.tmpdir(), 'izao-media-wx-'));
    const v = (txt: string) => [{ ancho: 10, alto: 10, buffer: Buffer.from(txt) }];
    await escribirVariantes(raiz, 'product/2026/01/u9', v('primero'));
    await expect(escribirVariantes(raiz, 'product/2026/01/u9', v('segundo'))).rejects.toThrow();
    expect((await readFile(path.join(raiz, 'product/2026/01/u9-10.webp'))).toString()).toBe('primero');
    expect(await readdir(path.join(raiz, 'product/2026/01'))).toEqual(['u9-10.webp']);
  });
});
