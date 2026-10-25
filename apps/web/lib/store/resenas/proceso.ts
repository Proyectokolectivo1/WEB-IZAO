/**
 * Proceso del envío de una reseña (§9.6): comprueba el aroma, decide la «compra verificada» (pedido entregado, celular
 * que coincide y que incluya este aroma), guarda las fotos y crea la reseña en `pending`. Dependencias por
 * `FuenteResenas` para probar el orden y la limpieza.
 *
 * Que el pedido no coincida NO es un error: la reseña entra igual, sin la marca, y la respuesta es la misma.
 */
import type { CountryCode } from '@izao/core/money';
import { nombreCorto, problemaFotosResena, type DatosResena, type RespuestaResena } from './logica';

export interface PedidoResena {
  id: string;
  celularE164: string;
  entregado: boolean;
  /** `true` si alguna línea del pedido es de este aroma. */
  incluyeProducto: boolean;
}

export interface FuenteResenas {
  /** El aroma existe y es visible en el país. */
  productoVisible(pais: CountryCode, productoId: string): Promise<boolean>;
  pedidoPorNumero(pais: CountryCode, numero: string, productoId: string): Promise<PedidoResena | null>;
  /** Reseña igual (mismo aroma, autor y texto) creada desde `desde`: reenvío del formulario. */
  resenaReciente(productoId: string, autor: string, texto: string, desde: Date): Promise<boolean>;
  guardarFoto(buffer: Buffer, nombre: string): Promise<string | null>;
  descartarMedia(ids: string[]): Promise<void>;
  crear(r: {
    pais: CountryCode;
    productoId: string;
    autor: string;
    ciudad: string | null;
    estrellas: number;
    texto: string;
    mediaIds: string[];
    pedidoId: string | null;
    verificada: boolean;
  }): Promise<void>;
}

export interface EntradaResena {
  pais: CountryCode;
  datos: DatosResena;
  fotos: { buffer: Buffer; nombre: string }[];
  ahora: Date;
}

export const VENTANA_REENVIO_RESENA_MS = 10 * 60_000;

export async function procesarResena(fuente: FuenteResenas, e: EntradaResena): Promise<RespuestaResena> {
  const problema = problemaFotosResena(e.fotos.map((f) => ({ tamano: f.buffer.length })));
  if (problema) return { ok: false, motivo: 'campos', campos: { fotos: problema } };
  if (!(await fuente.productoVisible(e.pais, e.datos.producto))) return { ok: false, motivo: 'campos', campos: { producto: 'producto' } };

  const autor = nombreCorto(e.datos.nombre);
  if (await fuente.resenaReciente(e.datos.producto, autor, e.datos.texto, new Date(e.ahora.getTime() - VENTANA_REENVIO_RESENA_MS))) {
    return { ok: true };
  }

  let pedido: PedidoResena | null = null;
  if (e.datos.pedido && e.datos.celular) {
    const p = await fuente.pedidoPorNumero(e.pais, e.datos.pedido, e.datos.producto);
    if (p && p.celularE164 === e.datos.celular && p.entregado && p.incluyeProducto) pedido = p;
  }

  const mediaIds: string[] = [];
  try {
    for (const f of e.fotos) {
      const id = await fuente.guardarFoto(f.buffer, f.nombre);
      if (!id) {
        await fuente.descartarMedia(mediaIds);
        return { ok: false, motivo: 'campos', campos: { fotos: 'tipo' } };
      }
      mediaIds.push(id);
    }
    await fuente.crear({
      pais: e.pais,
      productoId: e.datos.producto,
      autor,
      ciudad: e.datos.ciudad,
      estrellas: e.datos.estrellas,
      texto: e.datos.texto,
      mediaIds,
      pedidoId: pedido?.id ?? null,
      verificada: pedido !== null,
    });
    return { ok: true };
  } catch {
    await fuente.descartarMedia(mediaIds).catch(() => undefined);
    return { ok: false, motivo: 'error' };
  }
}
