/**
 * Guarda de las listas del panel en celular: toda tabla de `app/admin` y `components/admin` pasa a tarjetas
 * (`adm-tabla-apilada` + `data-etiqueta` en cada celda que no es el título), salvo las tablas cortas que se listan aquí
 * porque caben en 375 px (las mide `tests/e2e/panel-responsive.spec.ts`, página «tablas-cortas» y «metricas»).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(__dirname, '../..');

/** Tablas que se quedan como tabla: archivo (relativo a apps/web) + inicio de su `<caption>`. */
const TABLAS_CORTAS: ReadonlyArray<{ archivo: string; caption: string }> = [
  { archivo: 'app/admin/(panel)/atributos/[tipo]/page.tsx', caption: '{def.plural}' },
  { archivo: 'app/admin/(panel)/chatbot/page.tsx', caption: 'Meses anteriores' },
  { archivo: 'app/admin/(panel)/sistema/page.tsx', caption: 'Filas por tabla' },
  { archivo: 'components/admin/metricas/SeccionPaisMetricas.tsx', caption: '{titulo}' },
];

function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') ? [ruta] : [];
  });
}

const tablas = [...archivos(path.join(RAIZ, 'app/admin')), ...archivos(path.join(RAIZ, 'components/admin'))].flatMap((ruta) => {
  const rel = path.relative(RAIZ, ruta).split(path.sep).join('/');
  const fuente = fs.readFileSync(ruta, 'utf8');
  return [...fuente.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map((m) => ({
    rel,
    html: m[0],
    caption: /<caption[^>]*>\s*([^<]*?)\s*<\/caption>/.exec(m[0])?.[1] ?? '',
  }));
});

describe('listas del panel en celular', () => {
  it('encuentra las tablas del panel', () => {
    expect(tablas.length).toBeGreaterThan(30);
  });

  it('toda tabla es apilada (tarjetas en celular) o está en la lista de tablas cortas', () => {
    const sueltas = tablas
      .filter((t) => !/^<table[^>]*adm-tabla-apilada/.test(t.html))
      .filter((t) => !TABLAS_CORTAS.some((c) => c.archivo === t.rel && t.caption.startsWith(c.caption)))
      .map((t) => `${t.rel}: «${t.caption}»`);
    expect(sueltas).toEqual([]);
  });

  it('las tablas cortas permitidas siguen existiendo (si cambian, actualiza la lista)', () => {
    for (const c of TABLAS_CORTAS) {
      expect(tablas.some((t) => t.rel === c.archivo && t.caption.startsWith(c.caption)), `${c.archivo}: ${c.caption}`).toBe(true);
    }
  });

  it('en las apiladas cada celda, salvo la del título, lleva data-etiqueta', () => {
    const mal: string[] = [];
    for (const t of tablas.filter((x) => /^<table[^>]*adm-tabla-apilada/.test(x.html))) {
      const cuerpo = t.html.split('</thead>')[1] ?? '';
      const tituloEnTh = /<th\b[^>]*scope="row"/.test(cuerpo);
      const celdas = [...cuerpo.matchAll(/<td\b([^>]*)>/g)].filter((c) => !/colSpan/.test(c[1] ?? ''));
      const sin = celdas.filter((c) => !/data-etiqueta/.test(c[1] ?? '')).length;
      // Sin `<th scope="row">`, exactamente una celda sin etiqueta: la primera, que es el título de la tarjeta.
      if (sin !== (tituloEnTh ? 0 : 1)) mal.push(`${t.rel}: «${t.caption}» (${sin} sin etiqueta)`);
    }
    expect(mal).toEqual([]);
  });
});
