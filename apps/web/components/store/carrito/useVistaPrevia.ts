'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { descartarReferido, referidoParaAplicar } from '@/lib/store/atribucion/referido';
import { SERVIDOR_DISPONIBLE, pedirVistaPrevia } from '@/lib/store/carrito/adaptador';
import { mensajeCodigo, type RespuestaVistaPrevia } from '@/lib/store/carrito/contrato';
import { vistaPrevia } from '@/lib/store/carrito/vista';
import { T } from '@/lib/store/textos';
import { TC } from '@/lib/store/textos-checkout';
import { useCarritoAcciones, useCarritoLineas } from './CarritoProvider';

export interface EstadoCodigo {
  texto: string;
  estado: 'aplicado' | 'rechazado' | 'sin-servicio';
  mensaje: string;
}

const claveCodigo = (pais: string) => `izao:codigo:${pais}`;

function leerCodigo(pais: string): string | null {
  try {
    const v = window.sessionStorage.getItem(claveCodigo(pais));
    return v && /^[A-Z0-9_-]{1,40}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function guardarCodigo(pais: string, valor: string | null): void {
  try {
    if (valor) window.sessionStorage.setItem(claveCodigo(pais), valor);
    else window.sessionStorage.removeItem(claveCodigo(pais));
  } catch {
    /* sin almacenamiento: el código vive solo en memoria */
  }
}

/**
 * Vista previa con el servidor para las páginas de carrito y checkout: precios y existencias vigentes, descuento del
 * código y ajustes al bolso. Mientras el endpoint no exista (`SERVIDOR_DISPONIBLE`), el subtotal es el local y no hay
 * descuento. El código aplicado se recuerda en `sessionStorage` para llegar igual al checkout.
 */
export function useVistaPrevia(metodo: string | null = null) {
  const { pais, reemplazar } = useCarritoAcciones();
  const { lineas, listo } = useCarritoLineas();
  const [codigo, setCodigo] = useState<EstadoCodigo | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [descuentoServidor, setDescuentoServidor] = useState<bigint | null>(null);
  const [subtotalServidor, setSubtotalServidor] = useState<bigint | null>(null);
  const [totales, setTotales] = useState<{ llave: string; datos: NonNullable<RespuestaVistaPrevia['totals']> } | null>(null);
  const [retirado, setRetirado] = useState(false);
  const [ajuste, setAjuste] = useState<null | 'ajustado' | 'agotado'>(null);
  const lineasRef = useRef(lineas);
  lineasRef.current = lineas;
  const codigoRef = useRef<string | null>(null);

  // Código del enlace de referido (`?ref=`) que se puso solo: si el servidor lo rechaza, se retira sin avisar.
  const referidoAuto = useRef<string | null>(null);

  // Código recordado de la sesión, o el del enlace de referido (la primera vista previa lo vuelve a validar).
  useEffect(() => {
    const g = leerCodigo(pais);
    if (g) {
      setCodigo({ texto: g, estado: 'aplicado', mensaje: TC.resumen.codigoAplicado(g) });
      return;
    }
    const ref = referidoParaAplicar(pais);
    if (ref) {
      referidoAuto.current = ref;
      setCodigo({ texto: ref, estado: 'aplicado', mensaje: TC.resumen.codigoAplicado(ref) });
    }
  }, [pais]);

  const llaveLineas = lineas.map((l) => `${l.variantId}:${l.cantidad}`).join('|');
  const llaveCodigo = codigo?.estado === 'aplicado' ? codigo.texto : null;
  codigoRef.current = codigo?.texto ?? null;

  useEffect(() => {
    if (!listo || lineasRef.current.length === 0) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await pedirVistaPrevia(pais, lineasRef.current, llaveCodigo, ctl.signal, metodo);
        if (!r) {
          setSubtotalServidor(null);
          setDescuentoServidor(null);
          setTotales(null);
          return;
        }
        setTotales(r.totals ? { llave: `${metodo ?? ''}|${llaveLineas}|${llaveCodigo ?? ''}`, datos: r.totals } : null);
        setRetirado(r.code?.status === 'withdrawn');
        setSubtotalServidor(BigInt(r.subtotal));
        setDescuentoServidor(BigInt(r.discount));
        let cambio = false;
        let quitado = false;
        const actualizadas = lineasRef.current
          .map((l) => {
            const s = r.lines.find((x) => x.variant_id === l.variantId);
            if (!s) return l;
            if (s.unit_price !== l.precio || s.max_quantity < l.cantidad) cambio = true;
            return { ...l, precio: s.unit_price, tachado: s.compare_at, cantidad: Math.min(l.cantidad, Math.max(s.max_quantity, 1)) };
          })
          .filter((l) => {
            const agotada = r.lines.find((x) => x.variant_id === l.variantId)?.max_quantity === 0;
            if (agotada) quitado = true;
            return !agotada;
          });
        if (quitado) cambio = true;
        if (cambio) {
          setAjuste(quitado ? 'agotado' : 'ajustado');
          reemplazar(actualizadas);
        }
        if (r.code?.status === 'rejected') {
          guardarCodigo(pais, null);
          if (referidoAuto.current === r.code.code) {
            referidoAuto.current = null;
            setCodigo(null);
            setDescuentoServidor(null);
          } else {
            setCodigo({ texto: r.code.code, estado: 'rechazado', mensaje: mensajeCodigo(r.code.reason) });
          }
        } else if (r.code?.status === 'applied') {
          setCodigo({ texto: r.code.code, estado: 'aplicado', mensaje: TC.resumen.codigoAplicado(r.code.code) });
        }
      } catch {
        /* sin red o cancelado: se queda el subtotal local */
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [listo, llaveLineas, llaveCodigo, metodo, pais, reemplazar]);

  const aplicar = useCallback(
    async (escrito: string) => {
      const texto = escrito.trim().toUpperCase().slice(0, 40);
      if (!texto || lineasRef.current.length === 0) return;
      setRevisando(true);
      try {
        const r = await pedirVistaPrevia(pais, lineasRef.current, texto);
        if (!r) {
          setCodigo({ texto, estado: 'sin-servicio', mensaje: T.carrito.codigoFalla });
        } else if (r.code?.status === 'applied') {
          guardarCodigo(pais, r.code.code);
          setCodigo({ texto: r.code.code, estado: 'aplicado', mensaje: TC.resumen.codigoAplicado(r.code.code) });
          setDescuentoServidor(BigInt(r.discount));
          setSubtotalServidor(BigInt(r.subtotal));
        } else {
          setCodigo({ texto, estado: 'rechazado', mensaje: mensajeCodigo(r.code?.reason ?? null) });
        }
      } catch {
        setCodigo({ texto, estado: 'sin-servicio', mensaje: T.carrito.codigoFalla });
      } finally {
        setRevisando(false);
      }
    },
    [pais],
  );

  const quitarCodigo = useCallback(() => {
    if (codigoRef.current) descartarReferido(pais, codigoRef.current);
    referidoAuto.current = null;
    guardarCodigo(pais, null);
    setCodigo(null);
    setDescuentoServidor(null);
  }, [pais]);

  const local = vistaPrevia(lineas, pais, new Date());
  const aplicado = codigo?.estado === 'aplicado' ? codigo.texto : null;
  return {
    subtotal: subtotalServidor ?? local.subtotal,
    descuento: aplicado ? (descuentoServidor ?? 0n) : 0n,
    /** Código vigente que se manda al crear el pedido. */
    codigoAplicado: aplicado,
    codigo,
    revisando,
    ajuste,
    aplicar,
    quitarCodigo,
    /** El servidor retiró el código porque el método es de financiación (vuelve al cambiar de método). */
    codigoRetirado: retirado,
    /** Totales del método pedidos al servidor, con la llave (método|bolso|código) para que la pantalla compruebe que siguen vigentes. */
    totales,
    llaveActual: `${metodo ?? ''}|${llaveLineas}|${llaveCodigo ?? ''}`,
    servidorDisponible: SERVIDOR_DISPONIBLE,
  };
}
