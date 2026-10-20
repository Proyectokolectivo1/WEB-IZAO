'use client';

import { useState } from 'react';
import { varianteInicial } from '@/lib/store/ficha-util';
import type { CodigoPais, FichaProducto } from '@/lib/store/types';
import { PanelCompra } from '../catalogo/PanelCompra';
import { BarraFijaMovil, ID_BOTON_AGREGAR } from './BarraFijaMovil';

/** Panel de compra de la ficha más la barra fija de móvil, que comparten la variante elegida. */
export function CompraFicha({ ficha, pais }: { ficha: FichaProducto; pais: CodigoPais }) {
  const [elegida, setElegida] = useState(() => varianteInicial(ficha.variants)?.id ?? null);
  return (
    <>
      <PanelCompra ficha={ficha} pais={pais} idBotonAgregar={ID_BOTON_AGREGAR} alElegir={setElegida} />
      <BarraFijaMovil ficha={ficha} pais={pais} varianteId={elegida} />
    </>
  );
}
