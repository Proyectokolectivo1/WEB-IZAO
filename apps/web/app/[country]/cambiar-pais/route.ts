import { NextResponse, type NextRequest } from 'next/server';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';

/**
 * Redirección con `Location` relativa. Detrás de Nginx, `req.url` trae el host interno del contenedor
 * (`0.0.0.0:3000`), así que construir la URL absoluta desde ahí mandaba a la persona a una dirección que no existe.
 * El navegador resuelve la ruta relativa contra el dominio real.
 */
function redirigir(ruta: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: ruta, 'Cache-Control': 'no-store' } });
}

/**
 * `/{país}/cambiar-pais?a=ec&ruta=/perfume/slug`: guarda la cookie `country` y lleva a la misma ruta del otro
 * país si el producto se vende allá (§5.1); en cualquier otro caso, al inicio de ese país.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ country: string }> }) {
  const { country: origen } = await params;
  const destino = req.nextUrl.searchParams.get('a')?.toLowerCase();
  const ruta = req.nextUrl.searchParams.get('ruta') ?? '/';
  if (!esPais(origen) || !esPais(destino)) return redirigir('/');

  let final = `/${destino}`;
  // Solo rutas internas y sin esquemas: nada de redirecciones abiertas.
  if (/^\/[a-z0-9\-/_]*$/i.test(ruta) && !ruta.includes('//') && ruta !== '/') {
    const ficha = /^\/perfume\/([a-z0-9-]+)$/.exec(ruta);
    if (ficha) {
      const visible = await tienda().producto(destino, ficha[1]!).catch(() => null);
      if (visible) final = `/${destino}${ruta}`;
    } else if (/^\/pagina\/[a-z0-9-]+$/.test(ruta)) {
      // Las políticas son propias de cada país: si allá no está publicada, se va al inicio en vez de a una página vacía.
      const hay = await tienda().paginaLegal(destino, ruta.slice('/pagina/'.length)).catch(() => null);
      if (hay) final = `/${destino}${ruta}`;
    } else if (/^\/(catalogo|buscar|categoria|marca|familia|coleccion)(\/[a-z0-9-]+)?$/.test(ruta)) {
      final = `/${destino}${ruta}`;
    }
  }
  const res = redirigir(final);
  res.cookies.set('country', destino, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
