---
name: izao-diseno-marca
description: Úsala antes de diseñar o maquetar cualquier pantalla, componente, animación o texto visible de la tienda o del panel de Izao, para aplicar la paleta tierra, la tipografía configurable, la voz paisa de lujo, la animación y la accesibilidad.
---

# Diseño y marca de Izao

Referencia: `docs/ESPECIFICACION.md` §8.

## Tokens

Variables CSS en `:root` generadas desde `site_settings` (y `theme_overrides` del país). Tailwind 4 las consume con `@theme`. Nunca escribir un hex en un componente.

| Token | Defecto |
|---|---|
| `--color-bg` | `#FDFBF7` |
| `--color-surface` | `#EADCC9` |
| `--color-accent` | `#CBA8A8` |
| `--color-muted` | `#8E7564` |
| `--color-ink` | `#382E2B` |
| `--color-success` | `#5E7A5A` |
| `--color-danger` | `#A4483B` |

Contraste: texto de cuerpo siempre `ink`; `muted` solo ≥ 18 px; `accent` nunca como color de texto sobre claro. Botón primario `ink` con texto `bg`.

## Tipografía

Seis parejas de §8.2 autohospedadas con `next/font`, expuestas como `--font-display` y `--font-body`. La elegida en el panel se aplica con una clase en `<html>`. Escala base configurable (15–18 px). Etiquetas pequeñas en versalitas con `letter-spacing: .14em`.

## Que no parezca hecho por IA

- Composición editorial, aire generoso, asimetría controlada, líneas de 1 px, numeración de secciones (01, 02…).
- Prohibido: degradados morados, *glassmorphism*, brillos, emojis en títulos, íconos de relleno, *pills* enormes en todo, textos genéricos de relleno.
- Íconos de línea fina (Phosphor *light*), tamaño consistente.
- Radios 2–6 px.
- Todo texto visible viene del panel o del *seed*.

## Voz

Cercana, paisa y de lujo, sin exagerar el regionalismo. Frases cortas. Ejemplos en §8.6. Errores en lenguaje humano con la acción a seguir; nunca códigos técnicos al cliente.

## Animación (`motion`)

- Entrada al viewport: opacidad 0→1 y `y` 16→0, 500 ms, `cubic-bezier(.2,.7,.2,1)`, escalonado 60 ms, una sola vez.
- Solo `transform` y `opacity`. Ninguna animación causa CLS ni bloquea interacción.
- `prefers-reduced-motion`: solo opacidad.

## Responsive

Breakpoints 360/768/1024/1280/1536. Grilla 2/3/4/5 columnas. Diseñar primero móvil. Táctil mínimo 44×44 px.

## Accesibilidad (WCAG 2.2 AA)

Teclado completo, foco visible (anillo `ink` 2 px), `alt` obligatorio, labels y errores asociados, modales con foco atrapado y `Esc`, `aria-live` para el carrito y los totales del checkout.

## Antes de entregar una pantalla

Revisar en 360 px, 768 px y 1440 px; Lighthouse accesibilidad ≥ 95; contraste de cada combinación usada.
