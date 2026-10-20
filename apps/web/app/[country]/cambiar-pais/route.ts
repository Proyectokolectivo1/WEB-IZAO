import { NextResponse, type NextRequest } from 'next/server';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';

/**
 * `/{país}/cambiar-pais?a=ec&ruta=/perfume/slug`: guarda la cookie `country` y lleva a la misma ruta del otro
 * país si el producto se vende allá (§5.1); en cualquier otro caso, al inicio de ese país.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ country: string }> }) {
  const { country: origen } = await params;
  const destino = req.nextUrl.searchParams.get('a')?.toLowerCase();
  const ruta = req.nextUrl.searchParams.get('ruta') ?? '/';
  if (!esPais(origen) || !esPais(destino)) return NextResponse.redirect(new URL('/', req.url));

  let final = `/${destino}`;
  // Solo rutas internas y sin esquemas: nada de redirecciones abiertas.
  if (/^\/[a-z0-9\-/_]*$/i.test(ruta) && !ruta.includes('//') && ruta !== '/') {
    const ficha = /^\/perfume\/([a-z0-9-]+)$/.exec(ruta);
    if (ficha) {
      const visible = await tienda().producto(destino, ficha[1]!).catch(() => null);
      if (visible) final = `/${destino}${ruta}`;
    } else if (/^\/(catalogo|buscar|categoria|marca|familia|coleccion|pagina)(\/[a-z0-9-]+)?$/.test(ruta)) {
      final = `/${destino}${ruta}`;
    }
  }
  const res = NextResponse.redirect(new URL(final, req.url));
  res.cookies.set('country', destino, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
