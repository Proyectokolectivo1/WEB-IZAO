'use client';

import { useEffect, useState } from 'react';
import { VIGENCIA, pedirJson } from '@/lib/store/fetcher';
import type { CodigoPais, FichaProducto } from '@/lib/store/types';

const memoria = new Map<string, Promise<FichaProducto | null>>();

/** Pide la ficha una sola vez por producto (la vista rápida y «Agregar» comparten la respuesta). */
export function pedirFicha(pais: CodigoPais, slug: string): Promise<FichaProducto | null> {
  const clave = `${pais}/${slug}`;
  let p = memoria.get(clave);
  if (!p) {
    p = pedirJson<FichaProducto>(`/api/catalog/product?country=${pais}&slug=${encodeURIComponent(slug)}`, VIGENCIA.producto).catch(() => null);
    memoria.set(clave, p);
    void p.then((f) => {
      if (!f) memoria.delete(clave); // no recordar fallos
    });
  }
  return p;
}

export function useFicha(pais: CodigoPais, slug: string, activo: boolean) {
  const [ficha, setFicha] = useState<FichaProducto | null>(null);
  const [estado, setEstado] = useState<'inactivo' | 'cargando' | 'listo' | 'error'>('inactivo');
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    setEstado('cargando');
    pedirFicha(pais, slug).then((f) => {
      if (!vivo) return;
      setFicha(f);
      setEstado(f ? 'listo' : 'error');
    });
    return () => {
      vivo = false;
    };
  }, [pais, slug, activo]);
  return { ficha, estado };
}
