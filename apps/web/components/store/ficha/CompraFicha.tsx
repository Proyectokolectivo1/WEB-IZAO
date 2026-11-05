'use client';

import { useEffect, useState } from 'react';
import { varianteDeSku, varianteInicial } from '@/lib/store/ficha-util';
import type { CodigoPais, FichaProducto } from '@/lib/store/types';
import { PanelCompra } from '../catalogo/PanelCompra';
import { BarraFijaMovil, ID_BOTON_AGREGAR } from './BarraFijaMovil';

/** Panel de compra de la ficha más la barra fija de móvil, que comparten la variante elegida. */
export function CompraFicha({ ficha, pais }: { ficha: FichaProducto; pais: CodigoPais }) {
  const [elegida, setElegida] = useState(() => varianteInicial(ficha.variants)?.id ?? null);
  // `?variante={SKU}` (banners, enlaces compartidos): se lee en el navegador para que la ficha siga siendo estática y cacheable.
  const [pedida, setPedida] = useState<string | null>(null);
  useEffect(() => {
    const v = varianteDeSku(ficha.variants, new URLSearchParams(window.location.search).get('variante'));
    if (v) {
      setPedida(v.id);
      setElegida(v.id);
    }
  }, [ficha.variants]);
  return (
    <>
      <PanelCompra ficha={ficha} pais={pais} idBotonAgregar={ID_BOTON_AGREGAR} alElegir={setElegida} varianteIdPedida={pedida} />
      <BarraFijaMovil ficha={ficha} pais={pais} varianteId={elegida} />
    </>
  );
}
