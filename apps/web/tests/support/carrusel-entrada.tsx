/**
 * Entrada que esbuild empaqueta para `e2e/carrusel-componentes.spec.ts`: monta en el navegador el `CarruselBanners` REAL de
 * la tienda (con su `Hero`) y el `FormularioCarrusel` REAL del panel, con datos que la tienda de ejemplo no trae (una sola
 * imagen, tiempos distintos). El panel completo exige sesión de administrador, que el Supabase falso no simula.
 */
import { createRoot } from 'react-dom/client';
import { CarruselBanners } from '@/components/store/CarruselBanners';
import { FormularioCarrusel } from '@/components/admin/FormularioCarrusel';
import { esquemaCarrusel } from '@/lib/admin/banners/banners';
import type { Banner } from '@/lib/store/types';

declare global {
  interface Window {
    __CARRUSEL__?: { modo: 'banners' | 'ajustes'; n?: number; segundos?: number; prioritaria?: boolean };
  }
}

const imagen = (n: number) => ({ variants: { '480': `x/b${n}-480.webp`, '1200': `x/b${n}-1200.webp`, '2400': `x/b${n}-2400.webp` }, lqip: null, width: 2400, height: 1000 });

function banners(n: number): Banner[] {
  return Array.from({ length: n }, (_, k) => ({
    id: `b${k + 1}`,
    placement: 'hero' as const,
    imagen_unica: true,
    focal_x: 50,
    focal_y: 50,
    desktop: imagen(k + 1),
    mobile: imagen(k + 1),
    alt: `Banner ${k + 1}`,
    title: null,
    subtitle: null,
    cta_label: null,
    link_url: `/co/catalogo#productos`,
    text_position: 'left' as const,
    text_color: null,
  }));
}

/** Acción del panel simulada con el MISMO esquema zod del servidor. */
async function accionSimulada(_previo: unknown, datos: FormData) {
  const r = esquemaCarrusel.safeParse(Object.fromEntries(datos));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] = i.message;
    return { ok: false as const, mensaje: 'Revisa los campos marcados.', errores };
  }
  window.__GUARDADO__ = r.data;
  return { ok: true as const, mensaje: 'Ajustes del carrusel guardados. Se ven en la tienda en pocos minutos.' };
}

declare global {
  interface Window {
    __GUARDADO__?: unknown;
  }
}

const cfg = window.__CARRUSEL__ ?? { modo: 'banners' as const };
const raiz = createRoot(document.getElementById('raiz')!);
if (cfg.modo === 'ajustes') {
  raiz.render(<FormularioCarrusel pais="CO" segundos={cfg.segundos ?? 6} enCatalogo accion={accionSimulada} />);
} else {
  raiz.render(<CarruselBanners banners={banners(cfg.n ?? 3)} pais="co" segundos={cfg.segundos ?? 6} prioritaria={cfg.prioritaria ?? true} />);
}
