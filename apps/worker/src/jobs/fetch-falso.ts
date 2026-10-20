/** Solo pruebas: `fetch` falso que registra las llamadas a PostgREST y responde según la URL. */
export interface Llamada {
  url: string;
  metodo: string;
  cuerpo: unknown;
  cabeceras: Headers;
}

export function fetchFalso(responder: (l: Llamada) => { status: number; cuerpo?: unknown }) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const l = {
      url: decodeURIComponent(url),
      metodo: init?.method ?? 'GET',
      cuerpo: init?.body ? JSON.parse(String(init.body)) : null,
      cabeceras: new Headers(init?.headers),
    };
    llamadas.push(l);
    const r = responder(l);
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.status });
  }) as typeof fetch;
  return { f, llamadas };
}
