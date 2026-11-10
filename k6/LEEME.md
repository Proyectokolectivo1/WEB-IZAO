# Pruebas de carga (k6)

Zona de izao-qa. Criterios: catálogo 100 req/s sostenidas, p95 < 120 ms, errores < 1 % (§30 F1, §31.1); checkout 10 req/s (F3).

| Script | Qué mide | Umbrales |
|---|---|---|
| `catalogo.js` | `GET /api/catalog` con país, orden, filtros y cursor | p95 < 120 ms, errores < 1 %, 0 iteraciones perdidas |
| `ficha.js` | `GET /{pais}/perfume/{slug}` | p95 < 300 ms (`P95_MS`), errores < 1 % |
| `paginas.js` | HTML de home, listado, carrito y checkout (60 req/s) | p95 < 300 ms (supuesto), errores < 1 % |
| `checkout.js` | `POST /api/checkout/preview` + `POST /api/checkout` (10 pedidos/s, Wompi) y el límite 429 por IP | p95 < 500 ms (supuesto, `P95_MS`), errores < 1 % |

```bash
# k6 no es dependencia npm: se instala aparte (winget install k6, apt, o docker run grafana/k6).
pnpm --filter @izao/web build && pnpm --filter @izao/web exec next start -p 3100   # servidor con la base de prueba
k6 run -e BASE_URL=http://127.0.0.1:3100 k6/catalogo.js
k6 run -e BASE_URL=http://127.0.0.1:3100 -e PERFIL=humo k6/ficha.js     # 5 req/s por 10 s: valida el script
```

Variables: `BASE_URL` (obligatoria), `PERFIL=humo`, `TASA`, `DURACION`, `P95_MS`, `DATOS=ejemplo|seed` (qué productos usan los filtros y los slugs; `ejemplo` por defecto lee `apps/web/tests/.resultados/ejemplo.json`, que escribe Playwright), `PAIS=co|ec|mixto` (`co` por defecto).

**Sin llaves (build de ejemplo):** `pnpm --filter @izao/web build:e2e && bash k6/soporte/levantar-local.sh` levanta la tienda en `:3110` y un Supabase falso (`soporte/supabase-checkout-falso.mjs`, puerto 38398, `FALSO_LATENCIA_MS` por consulta, 8 ms por defecto). Con eso `catalogo`, `ficha` y `paginas` miden la capa de aplicación y `checkout.js` el recálculo y la validación del pedido, sin base, Redis ni proveedores. Los números con la base real salen en staging (`DATOS=seed`). k6 en Windows sin permisos de administrador: zip portable de GitHub (`k6-v*-windows-amd64.zip`) y verificar su SHA-256 contra `k6-v*-checksums.txt`.

- **Nunca contra producción:** el script se aborta si `BASE_URL` contiene `izaoperfumeria.com`. Corre contra local o staging
  con el seed de 520 productos aplicado y Redis activo (la caché de 60 s forma parte de lo que se mide).
- Los nombres de parámetros de la API están en `lib/comun.js` (`PARAMS`); se ajustan allí cuando izao-tienda los fije.
- Estado: ejecutados el 2026-11-09 contra el build de ejemplo (resultados en `docs/fases/LANZAMIENTO.md` y `docs/fases/F9-qa-co-2026-11-09/k6/`); sin ejecutar contra la base real.
- Resultados: `k6/.resultados/*.json` (ignorado por git); la evidencia aprobada se copia a `docs/fases/`.
