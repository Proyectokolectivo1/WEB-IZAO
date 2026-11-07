import { describe, expect, it } from 'vitest';
import { urlEtiquetaSegura } from './labels';

const REAL = 'https://cdn.bemaster.com/mastershop/files/carriers/coordinadora/guide-pdf/75070783091-standard.pdf';

describe('urlEtiquetaSegura', () => {
  it('acepta la URL del CDN de MasterShop', () => {
    expect(urlEtiquetaSegura(REAL)).toBe(REAL);
    expect(urlEtiquetaSegura('https://CDN.bemaster.com:443/a.pdf#x')).toBe('https://cdn.bemaster.com/a.pdf');
  });

  it.each([
    ['http', 'http://cdn.bemaster.com/a.pdf'],
    ['otro host', 'https://evil.example.com/a.pdf'],
    ['subdominio engañoso', 'https://cdn.bemaster.com.evil.com/a.pdf'],
    ['credenciales', 'https://u:p@cdn.bemaster.com/a.pdf'],
    ['puerto', 'https://cdn.bemaster.com:8443/a.pdf'],
    ['IP interna', 'https://169.254.169.254/latest'],
    ['file', 'file:///etc/passwd'],
    ['vacía', ''],
    ['no texto', 42],
    ['demasiado larga', `https://cdn.bemaster.com/${'a'.repeat(3000)}`],
  ])('rechaza %s', (_n, url) => {
    expect(urlEtiquetaSegura(url)).toBeNull();
  });

  it('admite otra lista de hosts (mock)', () => {
    expect(urlEtiquetaSegura('https://labels.example.com/G1.pdf', ['labels.example.com'])).toBe('https://labels.example.com/G1.pdf');
    expect(urlEtiquetaSegura(REAL, ['labels.example.com'])).toBeNull();
  });
});
