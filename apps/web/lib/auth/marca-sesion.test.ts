import { describe, expect, it } from 'vitest';
import { DURACION_SESION_MS } from './decision';
import { crearMarca, marcaVigente } from './marca-sesion';

// Secretos de prueba, sin relación con ninguna llave real.
const SECRETO = Buffer.alloc(32, 3).toString('base64');
const OTRO_SECRETO = Buffer.alloc(32, 4).toString('base64');
const AHORA = 1_800_000_000_000;

describe('marca de sesión de 12 h', () => {
  it('acepta una marca recién creada', async () => {
    const marca = await crearMarca('u1', AHORA, SECRETO);
    expect(await marcaVigente(marca, 'u1', AHORA + 1_000, SECRETO)).toBe(true);
  });

  it('acepta la marca justo antes de las 12 h y la rechaza a las 12 h', async () => {
    const marca = await crearMarca('u1', AHORA, SECRETO);
    expect(await marcaVigente(marca, 'u1', AHORA + DURACION_SESION_MS - 1, SECRETO)).toBe(true);
    expect(await marcaVigente(marca, 'u1', AHORA + DURACION_SESION_MS, SECRETO)).toBe(false);
  });

  it('rechaza la marca de otro usuario', async () => {
    const marca = await crearMarca('u1', AHORA, SECRETO);
    expect(await marcaVigente(marca, 'u2', AHORA, SECRETO)).toBe(false);
  });

  it('rechaza una marca firmada con otro secreto', async () => {
    const marca = await crearMarca('u1', AHORA, OTRO_SECRETO);
    expect(await marcaVigente(marca, 'u1', AHORA, SECRETO)).toBe(false);
  });

  it('rechaza una marca con la fecha alterada para extender la sesión', async () => {
    const marca = await crearMarca('u1', AHORA, SECRETO);
    const firma = marca.split('.')[1];
    const alterada = `${AHORA + DURACION_SESION_MS}.${firma}`;
    expect(await marcaVigente(alterada, 'u1', AHORA + DURACION_SESION_MS + 1, SECRETO)).toBe(false);
  });

  it('rechaza valores vacíos, mal formados o con fecha futura', async () => {
    expect(await marcaVigente(undefined, 'u1', AHORA, SECRETO)).toBe(false);
    expect(await marcaVigente('', 'u1', AHORA, SECRETO)).toBe(false);
    expect(await marcaVigente('abc', 'u1', AHORA, SECRETO)).toBe(false);
    expect(await marcaVigente('abc.def', 'u1', AHORA, SECRETO)).toBe(false);
    expect(await marcaVigente(`${AHORA}.a.b`, 'u1', AHORA, SECRETO)).toBe(false);
    const futura = await crearMarca('u1', AHORA + 3_600_000, SECRETO);
    expect(await marcaVigente(futura, 'u1', AHORA, SECRETO)).toBe(false);
  });
});
