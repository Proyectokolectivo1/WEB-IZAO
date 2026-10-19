---
name: izao-metricas
description: Úsala al construir el dashboard de métricas de Izao — ingresos, utilidad neta, comisiones de pasarela, costo de envíos, garantías, gastos, top de ciudades, panel por estado de guía, filtros por país y fecha, agregados diarios, Meta Ads y exportación a Excel.
---

# Métricas de Izao

Referencia: `docs/ESPECIFICACION.md` §21 (definiciones exactas), §22, §23.3.

## Reglas

- Las fórmulas de §21.2 son contrato: implementarlas en `packages/core/metrics` como funciones puras y probarlas con un set de pedidos de prueba calculado a mano (`packages/core/metrics/__fixtures__`).
- Zona horaria `America/Bogota`. Atribución por `paid_at` (o `created_at` si no se pagó).
- País CO, EC o Todos. "Todos": cada moneda por separado + consolidado en COP con `fx_rate_to_cop`.
- Ingresos confirmados ≠ ventas brutas: contra entrega cuenta como ingreso al entregarse; devueltos solo aportan el abono.
- Comparación con el periodo anterior equivalente.

## Datos

- `daily_sales_stats` por (fecha, país, método). Recalcular el día afectado con *debounce* de 1 min cuando cambia un pedido (job `metrics.recompute_day`, `jobId` por fecha+país); job nocturno para los últimos 60 días.
- Tops (ciudades, productos, influencers, fuentes UTM) con SQL directo, índices y caché Redis 5 min.
- Tráfico desde `daily_traffic_stats` (contadores Redis volcados cada hora).
- Costos reales de envío desde la billetera de MasterShop (skill `izao-mastershop`); si no han llegado, `shippingRate`; si no, estimado del país, con indicador "estimado".

## Vistas

KPIs, ventas por día, embudo, métodos de pago, panel por estado de guía (cada número abre la lista filtrada de pedidos), top de ciudades con % de devolución, top de productos con utilidad, códigos e influencers, fuentes. Gráficas con una librería ligera (Recharts o visx) usando los tokens de marca.

## Gastos y Meta Ads

CRUD manual con auditoría. Conector Meta Ads: job diario 06:00 (día anterior + re-sincronización de 7 días), gasto por cuenta y día con `external_ref` único. Botón "Sincronizar ahora".

## Excel

`exceljs` en el servidor, en el worker si el rango es grande. Hojas: Resumen, Pedidos, Ciudades, Productos, Métodos de pago, Gastos, Garantías, Influencers. Montos como números con formato de moneda (no texto), encabezados congelados, filtros automáticos.

## Rendimiento

Dashboard completo < 1,5 s para 12 meses. Ninguna consulta del dashboard recorre `orders` completo sin índice.
