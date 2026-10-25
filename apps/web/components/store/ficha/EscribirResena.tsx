'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Button } from '@izao/ui';
import { TR } from '@/lib/store/resenas/textos';
import type { CodigoPais } from '@/lib/store/types';

// El formulario (zod, fotos, Turnstile) solo se descarga cuando alguien quiere escribir: la ficha no paga ese JS.
const FormularioResena = dynamic(() => import('./FormularioResena'), { ssr: false });

/** Botón «Escribe tu reseña» de la ficha: abre el formulario (§9.6). */
export function EscribirResena({ pais, productoId }: { pais: CodigoPais; productoId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState<string | null>(null);

  async function abrir() {
    setAbierto(true);
    try {
      const r = await fetch('/api/reviews/config');
      const d = (await r.json()) as { turnstileKey?: string | null };
      setClave(d.turnstileKey ?? null);
    } catch {
      setClave(null);
    }
  }

  return (
    <div className="pt-10">
      {abierto ? (
        <FormularioResena pais={pais} productoId={productoId} turnstileKey={clave} />
      ) : (
        <Button type="button" variante="secundario" onClick={abrir} data-testid="escribir-resena">
          {TR.abrir}
        </Button>
      )}
    </div>
  );
}
