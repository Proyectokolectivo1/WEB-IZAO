---
name: izao-financiacion
description: Úsala al integrar Addi o Sistecrédito en Izao — recargo del 10 %, bloqueo de códigos de descuento, credenciales en el panel, redirección, callbacks y manejo de aprobación o rechazo del crédito.
---

# Addi y Sistecrédito

Referencia: `docs/ESPECIFICACION.md` §12.3, §12.4, §11.

## Antes de codificar

Pedir al dueño la documentación técnica de su contrato con cada entidad y guardarla en `docs/integraciones/`. Los esquemas de credenciales de la especificación son iniciales y se ajustan a esa documentación (`[VERIFICAR]`). Registrar diferencias en `docs/DECISIONES.md`.

## Reglas de negocio

- Recargo: `financing_surcharge_pct[proveedor]` del país (defecto 10), mostrado como línea separada "Cargo por financiación" antes de pagar.
- **No se permiten códigos de descuento.** Si había uno, se retira con aviso; si el cliente vuelve a Wompi o contra entrega, se le ofrece reaplicarlo.
- El monto enviado a la entidad es `total_customer` (con recargo).
- A MasterShop va como `pia` con total = subtotal de productos; el recargo queda en la tienda y en `notes`.

## Flujo

1. Pedido `pendiente_pago`, `payment.purpose = financing`.
2. Crear la solicitud/transacción con el adaptador (cliente, documento, celular, correo, dirección, ítems, monto, referencia = `orders.number`, URLs de retorno y de *callback*).
3. Redirigir a la URL que devuelve la entidad.
4. *Callback*/webhook autenticado según la entidad (credenciales del *callback* en el panel); idempotencia; reconsulta de estado si la API lo permite.
5. Aprobado → `pagado` → `carrier.create`. Rechazado, abandonado o error → `pago_rechazado`, la página de estado ofrece otros métodos.
6. Si no llega callback dentro del TTL, job que consulta el estado antes de expirar.

## Adaptador

Implementar `PaymentProvider` (`createCheckout`, `verifyWebhook`, `fetchStatus`, `testCredentials`). Esquema de credenciales declarado en código, para que el panel muestre los campos correctos.

## Comisión

`fee_pct` configurable por entidad para métricas.

## Pruebas

Ambiente sandbox de cada entidad; *mocks* de aprobado, rechazado, abandonado y callback duplicado; caso 4 y 5 de §11.3.
