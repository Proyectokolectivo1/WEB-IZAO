# Pruebas de carga (k6)

Zona de izao-qa. Criterios: catálogo 100 req/s sostenidas, p95 < 120 ms, errores < 1 % (§30 F1, §31.1); checkout 10 req/s (F3).

| Script | Qué mide | Umbrales |
|---|---|---|
| `catalogo.js` | `GET /api/catalog` con país, orden, filtros y cursor | p95 < 120 ms, errores < 1 %, 0 iteraciones perdidas |
| `ficha.js` | `GET /{pais}/perfume/{slug}` | p95 < 300 ms (`P95_MS`), errores < 1 % |

```bash
# k6 no es dependencia npm: se instala aparte (winget install k6, apt, o docker run grafana/k6).
pnpm --filter @izao/web build && pnpm --filter @izao/web exec next start -p 3100   # servidor con la base de prueba
k6 run -e BASE_URL=http://127.0.0.1:3100 k6/catalogo.js
k6 run -e BASE_URL=http://127.0.0.1:3100 -e PERFIL=humo k6/ficha.js     # 5 req/s por 10 s: valida el script
```

Variables: `BASE_URL` (obligatoria), `PERFIL=humo`, `TASA`, `DURACION`, `P95_MS`.

- **Nunca contra producción:** el script se aborta si `BASE_URL` contiene `izaoperfumeria.com`. Corre contra local o staging
  con el seed de 520 productos aplicado y Redis activo (la caché de 60 s forma parte de lo que se mide).
- Los nombres de parámetros de la API están en `lib/comun.js` (`PARAMS`); se ajustan allí cuando izao-tienda los fije.
- Estado: scripts escritos y revisados, **sin ejecutar** (k6 no está instalado y `/api/catalog` aún no existe).
- Resultados: `k6/.resultados/*.json` (ignorado por git); la evidencia aprobada se copia a `docs/fases/`.
- `checkout.js` (10 req/s) se agrega en F3, con los proveedores de pago en mock.
