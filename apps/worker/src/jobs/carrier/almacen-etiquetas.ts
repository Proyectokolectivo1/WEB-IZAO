/**
 * Descarga de etiquetas a `MEDIA_ROOT/labels/{número}.pdf` (§14.5 paso 3). La URL viene de la API de
 * MasterShop: solo `https`, tiempo límite, tope de tamaño y cabecera `%PDF-`. Escritura atómica
 * (archivo temporal + `rename`) para que el agente nunca lea un PDF a medias.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AlmacenEtiquetas } from './fuente.js';

export const MAX_BYTES_ETIQUETA = 10 * 1024 * 1024;
const NUMERO = /^[A-Za-z0-9-]{1,40}$/;

export class ErrorEtiqueta extends Error {
  constructor(motivo: string) {
    super(`etiqueta: ${motivo}`);
    this.name = 'ErrorEtiqueta';
  }
}

export interface OpcionesAlmacen {
  mediaRoot: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function crearAlmacenEtiquetas(o: OpcionesAlmacen): AlmacenEtiquetas {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    async guardar(url, numero) {
      if (!NUMERO.test(numero)) throw new ErrorEtiqueta('número de pedido inválido');
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new ErrorEtiqueta('URL inválida');
      }
      if (u.protocol !== 'https:') throw new ErrorEtiqueta('la URL no es https');
      const res = await doFetch(u.toString(), { redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
      if (!res.ok) throw new ErrorEtiqueta(`HTTP ${res.status}`);
      const declarado = Number(res.headers.get('content-length') ?? '0');
      if (declarado > MAX_BYTES_ETIQUETA) throw new ErrorEtiqueta('demasiado grande');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES_ETIQUETA) throw new ErrorEtiqueta('demasiado grande');
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new ErrorEtiqueta('no es un PDF');
      const relativa = `labels/${numero}.pdf`;
      const dir = join(o.mediaRoot, 'labels');
      await mkdir(dir, { recursive: true });
      const destino = join(dir, `${numero}.pdf`);
      const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporal, bytes);
      await rename(temporal, destino);
      return relativa;
    },
  };
}
