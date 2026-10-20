import { describe, expect, it } from 'vitest';
import { jsonLd } from './seo';

describe('jsonLd', () => {
  it('no deja pasar </script> ni <!-- dentro del texto', () => {
    const s = jsonLd({ name: '</script><script>alert(1)</script>', d: '<!-- x -->' });
    expect(s).not.toContain('<');
    expect(s).not.toContain('>');
    expect(s).toContain('\\u003c/script\\u003e');
  });

  it('escapa & y los separadores U+2028/U+2029', () => {
    const s = jsonLd({ a: 'a&b', b: 'x\u2028y\u2029z' });
    expect(s).not.toMatch(/[\u2028\u2029&]/);
  });

  it('sigue siendo JSON equivalente al original', () => {
    const obj = { name: '</script> & <b>', n: [1, 2], t: 'a\u2028b' };
    expect(JSON.parse(jsonLd(obj))).toEqual(obj);
  });
});
