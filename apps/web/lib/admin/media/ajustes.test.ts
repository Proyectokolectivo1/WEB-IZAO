import { describe, expect, it } from 'vitest';
import { AJUSTES_MEDIA_POR_DEFECTO, ajustesAJson, bytesMaximos, normalizarAjustesMedia, validarAjustesMedia } from './ajustes';

describe('ajustes de imagen', () => {
  it('sin datos o con basura toma los valores por defecto', () => {
    expect(normalizarAjustesMedia(null)).toEqual(AJUSTES_MEDIA_POR_DEFECTO);
    expect(normalizarAjustesMedia('x')).toEqual(AJUSTES_MEDIA_POR_DEFECTO);
    expect(normalizarAjustesMedia({ webp_quality: 'alta', max_mb: 0 })).toEqual(AJUSTES_MEDIA_POR_DEFECTO);
    expect(normalizarAjustesMedia({ webp_quality: 100, max_mb: 99 })).toEqual(AJUSTES_MEDIA_POR_DEFECTO);
  });

  it('lee calidad y peso máximo guardados', () => {
    const a = normalizarAjustesMedia({ webp_quality: 72, max_mb: '10' });
    expect(a).toEqual({ calidad: 72, maxMb: 10 });
    expect(bytesMaximos(a)).toBe(10 * 1024 * 1024);
    expect(ajustesAJson(a)).toEqual({ webp_quality: 72, max_mb: 10 });
  });

  it('validar: rangos por campo', () => {
    expect(validarAjustesMedia({ calidad: '85', maxMb: '12' })).toEqual({ ok: true, ajustes: { calidad: 85, maxMb: 12 } });
    const mal = validarAjustesMedia({ calidad: '20', maxMb: '40' });
    expect(mal.ok).toBe(false);
    if (!mal.ok) expect(Object.keys(mal.errores).sort()).toEqual(['calidad', 'maxMb']);
    expect(validarAjustesMedia({ calidad: '', maxMb: '5' }).ok).toBe(false);
  });
});
