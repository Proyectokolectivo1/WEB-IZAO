/**
 * Supabase falso para las pruebas e2e. Solo responde lo que necesita el login del panel:
 *  - POST /auth/v1/token        -> 400 invalid_credentials (siempre)
 *  - POST /rest/v1/audit_log     -> 201
 *  - HEAD|GET /rest/v1/audit_log -> 200 con `content-range: *\/0` (conteo 0)
 * Guarda las peticiones para que las pruebas verifiquen qué recibió "Supabase":
 *  - GET    /__peticiones  -> lista de { metodo, ruta, cuerpo }
 *  - DELETE /__peticiones  -> vacía la lista
 * No abre conexiones salientes.
 */
import http from 'node:http';

const puerto = Number(process.env.E2E_PUERTO_SUPABASE ?? 54399);
let peticiones = [];

function responder(res, estado, cuerpo, cabeceras = {}) {
  const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
  res.writeHead(estado, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto), ...cabeceras });
  res.end(texto);
}

const servidor = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    const cuerpo = Buffer.concat(partes).toString('utf8');
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (pathname === '/__peticiones') {
      if (req.method === 'DELETE') {
        peticiones = [];
        return responder(res, 204);
      }
      return responder(res, 200, peticiones);
    }

    peticiones.push({ metodo: req.method, ruta: req.url, cuerpo });

    if (pathname === '/auth/v1/token' && req.method === 'POST') {
      return responder(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (pathname === '/rest/v1/audit_log') {
      if (req.method === 'POST') return responder(res, 201);
      return responder(res, 200, req.method === 'HEAD' ? undefined : [], { 'content-range': '*/0' });
    }
    return responder(res, 404, { message: 'no existe en el Supabase falso' });
  });
});

servidor.listen(puerto, '127.0.0.1', () => {
  console.log(`Supabase falso escuchando en http://127.0.0.1:${puerto}`);
});
