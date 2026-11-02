'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Component, type ReactNode } from 'react';
import { Button, clasesBoton } from '@izao/ui';
import { T } from '@/lib/store/textos';
import type { CodigoPais } from '@/lib/store/types';

/** Pide de nuevo la página al servidor y vuelve a pintar el contenido. */
function Reintentar({ alReintentar }: { alReintentar: () => void }) {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        router.refresh();
        alReintentar();
      }}
    >
      {T.listado.reintentar}
    </Button>
  );
}

interface Props {
  pais: CodigoPais;
  children: ReactNode;
}
interface Estado {
  fallo: boolean;
}

/**
 * Límite de error de la tienda por país. Sustituye a los `error.tsx` de `app/[country]` y de la ficha: cualquier `error.tsx`
 * a nivel de layout hace que, en Next 15.5.28 con el build de producción, ~1 % de las cargas (hasta 15 % con la máquina
 * cargada) terminen en el error #418 de hidratación y React re-renderice todo el layout (medido: mismo layout sin `error.tsx`
 * = 0 de 750 cargas; con `error.tsx` vacío = 16 %). Un límite propio dentro del layout no tiene ese efecto (docs/DECISIONES.md, D-039).
 * Atrapa los errores de render de la página (también los del servidor, que llegan al cliente en el flujo RSC).
 */
export class LimiteError extends Component<Props, Estado> {
  override state: Estado = { fallo: false };

  static getDerivedStateFromError(): Estado {
    return { fallo: true };
  }

  override componentDidCatch(error: Error) {
    console.error(`[tienda] error de interfaz: ${error.name}`);
  }

  override render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex min-h-[50dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20">
        <h1 className="text-4xl">{T.errores.generico}</h1>
        <div className="flex flex-wrap gap-3">
          <Reintentar alReintentar={() => this.setState({ fallo: false })} />
          <Link href={`/${this.props.pais}/catalogo`} className={clasesBoton({ variante: 'secundario' })}>
            {T.ficha.verAromas}
          </Link>
        </div>
      </div>
    );
  }
}
