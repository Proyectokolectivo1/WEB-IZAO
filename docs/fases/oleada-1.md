# Oleada 1 — Contratos

Cierre: 2026-10-19. Equipo: `izao-pagos`, `izao-logistica`, `izao-db`; revisión de `izao-revisor`.

## Hecho

| Área | Entregable | Commits clave |
|---|---|---|
| `packages/core` (`@izao/core`, izao-pagos) | `money` (bigint, `allocate`, half-up, `toSafeNumber`/`fromDbAmount`), `pricing` con los 10 casos de §11.3 literales y propiedades sobre 300 carritos, `order-state` (17 estados + `abandonado`/`expirado → requiere_reembolso`, `en_preparacion → cancelado`), esquemas zod, contratos `PaymentProvider` y `CarrierProvider` | `34a33da` … `ff8a64d`, `394daf6`, `784fde9`, `7c153df` |
| `packages/integrations/mastershop` (izao-logistica) | `buildCarrierLines` (modos de prorrateo y de cargo negativo), `buildCarrierOrder` (§14.3), mapeo de estados §14.6, mock con las trampas de §31.1, cliente con reintentos y límite de uso, adaptador `CarrierProvider`; colección de Postman en `docs/integraciones/` | `263f608`, `a1325f5` … `d4ad217` |
| Base de datos (izao-db) | Funciones atómicas `reservar_stock`/`liberar_stock`/`confirmar_stock`, canje de descuentos, `pedidos_por_vencer`, consentimientos en `orders`, prueba de concurrencia en contenedor; 15 suites pgTAP | `de448f4` … `f63d558` |

Decisiones: `docs/DECISIONES.md` D-022 y D-023.

## Criterios de aceptación (docs/EQUIPO.md §3)

| Criterio | Estado |
|---|---|
| `money`, `pricing` con los 10 casos en verde | Cumplido (core 779 pruebas) |
| `order-state` | Cumplido |
| Esquemas zod | Cumplido; el servidor debe usar `checkoutInputSchemaFor` |
| Interfaces de adaptadores | Cumplido |
| `buildCarrierLines` probado | Cumplido (mastershop 191 pruebas; caso 10 = 75.000 y 50.000; 5.000 carritos) |

## Revisión

Veredicto de `izao-revisor`: cambios requeridos (0 críticos, 3 altos: A1 la sincronización inventaba estados de pago, A2 `pago_rechazado` sin vencer, A3 `manual` siempre disponible). Corregidos con prueba previa; los medios (M1, M3 a M7) y los bajos B1 a B7 también. Verificación final del líder: `turbo run lint typecheck test --force` 15/15 en verde; la colección de Postman sin llaves.

## Pendientes

- **Dueño:** `[VERIFICAR]` con MasterShop (`type_charge` y negativos, `email` null, sandbox, formato de ciudad); revisar si Ecuador activará contra entrega; los pendientes de la Oleada 0 (F0b, `.env`, llaves).
- **Siguiente oleada:** devolver al inventario el stock confirmado al cancelar/devolver; webhook de MasterShop (cuerpo `{eventName, body}`, `id_status` 6 ambiguo, guardar `idProductWebhook`); el panel debe impedir activar contra entrega en `payment_method_settings` con `country_settings.cod_enabled` falso; el job que ejecute las funciones de stock/canje y `pedidos_por_vencer`.
- Suites pgTAP 01 a 12 no se repitieron tras las últimas migraciones; ejecutarlas en el remoto antes del cierre de la Oleada 2.
- Pruebas contra la API real de MasterShop: ninguna (no hay sandbox); la verificación es el pedido real de bajo valor del criterio F5.
