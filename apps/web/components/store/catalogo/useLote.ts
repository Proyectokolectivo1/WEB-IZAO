'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fusionar, parametrosApi, type ConsultaListado, type LoteListado } from '@/lib/store/lote';
import type { CodigoPais, FiltrosCatalogo, ItemCatalogo } from '@/lib/store/types';

export type EstadoLote = 'listo' | 'cargandoMas' | 'recargando' | 'error';

interface RespuestaApi {
  items: ItemCatalogo[];
  nextCursor: string | null;
  total: number | null;
}

async function pedir(pais: CodigoPais, c: ConsultaListado, fijos: FiltrosCatalogo, cursor: string | null, signal: AbortSignal): Promise<RespuestaApi> {
  const res = await fetch(`/api/catalog?${parametrosApi(pais, c, fijos, cursor)}`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as RespuestaApi;
}

/**
 * Estado del listado infinito: lote actual, carga del siguiente (por cursor, nunca OFFSET) y recarga
 * cuando cambian filtros u orden. Cada recarga cancela lo que estuviera en vuelo.
 */
export function useLote(pais: CodigoPais, fijos: FiltrosCatalogo, inicial: LoteListado, consultaInicial: ConsultaListado) {
  const [lote, setLote] = useState<LoteListado>(inicial);
  const [consulta, setConsulta] = useState<ConsultaListado>(consultaInicial);
  const [estado, setEstado] = useState<EstadoLote>('listo');
  const ref = useRef({ lote, consulta, estado, version: 0, control: null as AbortController | null });
  ref.current.lote = lote;
  ref.current.consulta = consulta;
  ref.current.estado = estado;

  useEffect(() => () => ref.current.control?.abort(), []);

  const cargarMas = useCallback(async () => {
    const r = ref.current;
    if (!r.lote.nextCursor || r.estado !== 'listo') return;
    const version = r.version;
    r.control?.abort();
    const control = new AbortController();
    r.control = control;
    r.estado = 'cargandoMas';
    setEstado('cargandoMas');
    try {
      const json = await pedir(pais, r.consulta, fijos, r.lote.nextCursor, control.signal);
      if (version !== ref.current.version) return;
      setLote((p) => ({ ...p, items: fusionar(p.items, json.items), nextCursor: json.nextCursor }));
      setEstado('listo');
    } catch {
      if (control.signal.aborted || version !== ref.current.version) return;
      setEstado('error');
    }
  }, [pais, fijos]);

  const aplicar = useCallback(
    async (c: ConsultaListado) => {
      const r = ref.current;
      r.version += 1;
      const version = r.version;
      r.control?.abort();
      const control = new AbortController();
      r.control = control;
      r.consulta = c;
      setConsulta(c);
      r.estado = 'recargando';
      setEstado('recargando');
      try {
        const json = await pedir(pais, c, fijos, null, control.signal);
        if (version !== ref.current.version) return;
        setLote({ items: json.items, nextCursor: json.nextCursor, total: json.total });
        setEstado('listo');
      } catch {
        if (control.signal.aborted || version !== ref.current.version) return;
        setEstado('error');
      }
    },
    [pais, fijos],
  );

  /** Reintenta lo último que falló: el siguiente lote, o la recarga si no hay nada cargado. */
  const reintentar = useCallback(() => {
    const r = ref.current;
    r.estado = 'listo';
    setEstado('listo');
    if (r.lote.items.length === 0) void aplicar(r.consulta);
    else void cargarMas();
  }, [aplicar, cargarMas]);

  const restaurar = useCallback((l: LoteListado) => {
    ref.current.version += 1;
    ref.current.control?.abort();
    ref.current.lote = l;
    ref.current.estado = 'listo';
    setLote(l);
    setEstado('listo');
  }, []);

  return { lote, consulta, estado, cargarMas, aplicar, reintentar, restaurar };
}

/** Total de resultados para un borrador de filtros (contador en vivo de la hoja móvil), con cancelación. */
export function useConteoEnVivo(pais: CodigoPais, borrador: ConsultaListado | null, fijos: FiltrosCatalogo): { total: number | null; contando: boolean } {
  const [estado, setEstado] = useState<{ total: number | null; contando: boolean }>({ total: null, contando: false });
  const clave = borrador ? parametrosApi(pais, borrador, fijos).toString() : '';
  useEffect(() => {
    if (!clave) return;
    const control = new AbortController();
    setEstado((e) => ({ ...e, contando: true }));
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog?${clave}&solo_total=1`, { signal: control.signal });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as { total: number | null };
        setEstado({ total: json.total, contando: false });
      } catch {
        if (!control.signal.aborted) setEstado((e) => ({ ...e, contando: false }));
      }
    }, 250);
    return () => {
      clearTimeout(t);
      control.abort();
    };
  }, [clave]);
  return estado;
}
