/**
 * Descarga de etiquetas a `MEDIA_ROOT/labels/{número}.pdf` (§14.5 paso 3). La URL viene de la API de
 * MasterShop: solo `https`, tiempo límite, tope de tamaño y cabecera `%PDF-`. Escritura atómica
 * (archivo temporal + `rename`) para que el agente nunca lea un PDF a medias.
 *
 * El CDN de las etiquetas (CloudFront, `cdn.bemaster.com`) responde 403 a peticiones sin `User-Agent` (D-044): se envía
 * siempre uno propio. Un 403/404 también puede ser una etiqueta aún no publicada; `ErrorEtiqueta` es reintentable y
 * `carrier.poll_label` vuelve a intentar cada 2 min hasta su tope.
 *
 * Solo hosts de `HOSTS_ETIQUETA_MASTERSHOP` (sin SSRF); tampoco se siguen redirecciones a otro host. Si el CDN bloquea
 * la IP del VPS (403 aun con User-Agent, D-051), `guardarEtiqueta` deja la impresión al agente con la URL pública.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOSTS_ETIQUETA_MASTERSHOP, urlEtiquetaSegura } from '@izao/mastershop';
import type { AlmacenEtiquetas } from './fuente.js';

export const MAX_BYTES_ETIQUETA = 10 * 1024 * 1024;
const NUMERO = /^[A-Za-z0-9-]{1,40}$/;
export const USER_AGENT_ETIQUETAS = 'IzaoPerfumeria-Worker/1.0 (+https://izaoperfumeria.com)';

export class ErrorEtiqueta extends Error {
  /** HTTP del CDN, si respondió; `null` en errores de validación o de red. */
  readonly status: number | null;
  constructor(motivo: string, status: number | null = null) {
    super(`etiqueta: ${motivo}`);
    this.name = 'ErrorEtiqueta';
    this.status = status;
  }
}

/** El CDN rechazó la descarga desde este servidor (403): la puede descargar el agente desde su PC (D-051). */
export function esBloqueoEtiqueta(e: unknown): boolean {
  return e instanceof ErrorEtiqueta && e.status === 403;
}

export interface OpcionesAlmacen {
  mediaRoot: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  /** Hosts permitidos (por defecto los del CDN de MasterShop; el modo simulado pasa el del *mock*). */
  hostsPermitidos?: readonly string[];
}

export function crearAlmacenEtiquetas(o: OpcionesAlmacen): AlmacenEtiquetas {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    async guardar(url, numero) {
      if (!NUMERO.test(numero)) throw new ErrorEtiqueta('número de pedido inválido');
      const hosts = o.hostsPermitidos ?? HOSTS_ETIQUETA_MASTERSHOP;
      const segura = urlEtiquetaSegura(url, hosts);
      if (segura === null) throw new ErrorEtiqueta('URL no permitida (solo https del CDN de MasterShop)');
      const res = await doFetch(segura, {
        redirect: 'follow',
        headers: { 'user-agent': o.userAgent ?? USER_AGENT_ETIQUETAS, accept: 'application/pdf, application/octet-stream;q=0.9, */*;q=0.8' },
        signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
      });
      if (res.url && urlEtiquetaSegura(res.url, hosts) === null) throw new ErrorEtiqueta('redirección a un host no permitido');
      if (!res.ok) throw new ErrorEtiqueta(`HTTP ${res.status}`, res.status);
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
