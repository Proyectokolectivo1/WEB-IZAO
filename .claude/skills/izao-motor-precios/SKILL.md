---
name: izao-motor-precios
description: Úsala al escribir o cambiar cualquier cálculo de dinero de Izao — subtotal, códigos de descuento, recargo de Addi/Sistecrédito, abono y recaudo de contra entrega, redondeo, o el valor que se envía a MasterShop — y al tocar carrito, checkout o creación de pedidos.
---

# Motor de precios de Izao

Referencia: `docs/ESPECIFICACION.md` §11 y §14.4.

## Dónde vive

`packages/core/pricing/` — funciones puras, sin I/O, sin fechas implícitas (la fecha "ahora" entra como parámetro). Lo usan carrito, checkout y servidor; **el servidor es la fuente de verdad**.

## Orden de cálculo

1. `subtotal = Σ unit_price × quantity`.
2. Código de descuento (máximo uno). Si el método es `addi` o `sistecredito`, **el código se retira** y se devuelve el aviso `DISCOUNT_NOT_ALLOWED_WITH_FINANCING`.
   - `percent`: `roundHalfUp(baseElegible × pct / 100)`, con tope `max_discount_amount`.
   - `fixed`: `min(valor, baseElegible)`.
   - Distribuir en `line_discount` proporcional a cada línea elegible; el residuo a la línea de mayor valor.
3. Recargo (solo financiación): `roundHalfUp(subtotal × pct / 100)`; `pct` de `country_settings.financing_surcharge_pct[proveedor]`.
4. `total_customer = subtotal − discount + surcharge`. Envío siempre 0.
5. Contra entrega: `cod_deposit` del país; `cod_collect = total_customer − cod_deposit`; si `cod_collect < cod_min_collect_amount`, el método queda no disponible con código `COD_BELOW_MINIMUM`.

## Salida

Objeto inmutable con: líneas (con `line_discount`), `subtotal`, `discount`, `surcharge`, `total_customer`, `cod_deposit`, `cod_collect`, `available_methods` (con motivo si alguno está deshabilitado), `messages[]` con códigos estables (el texto en español lo pone la UI).

## Validación de códigos (en servidor)

Activo, vigencia, país, `min_subtotal`, `usage_limit_total`, `usage_limit_per_customer` (clave de cliente = hash de documento + celular + correo normalizados), `applies_to`, exclusiones, `applies_to_sale_items`. Errores con códigos: `CODE_EXPIRED`, `CODE_MIN_SUBTOTAL` (con faltante), `CODE_NOT_APPLICABLE`, `CODE_LIMIT_REACHED`, `CODE_WRONG_COUNTRY`.

## Pruebas obligatorias

Los 10 casos de la tabla §11.3 como pruebas con nombres descriptivos, más:
- Moneda USD con centavos y redondeo medio hacia arriba.
- Código con exclusiones y con `applies_to_sale_items = false`.
- Cambio de método Wompi → Addi → contra entrega en el mismo carrito (el código vuelve al regresar de Addi).
- Propiedad: `total_customer` nunca negativo; `Σ line_discount = discount`; `cod_deposit + cod_collect = total_customer`.

No se integra el checkout hasta que estas pruebas pasen.

## Valor para MasterShop

Función `buildCarrierLines(order, mode)` en el mismo paquete:
- `cod`: total = `cod_collect`. `pia` Wompi: total = `subtotal − discount`. `pia` financiación: total = `subtotal`.
- Modo A: precios reales + `additional_charge` negativo. Modo B: prorrateo entero de la reducción entre líneas, partiendo en cantidad 1 las líneas que no dividan exacto.
- Invariante probada: `Σ price × quantity + Σ additional_charge = total` exacto.
