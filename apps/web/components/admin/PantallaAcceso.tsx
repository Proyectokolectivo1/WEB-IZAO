import type { ReactNode } from 'react';

/** Marco común de las pantallas de acceso: login y MFA. */
export function PantallaAcceso({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children: ReactNode;
}) {
  return (
    <main className="adm-acceso">
      <section className="adm-tarjeta" aria-labelledby="titulo-acceso">
        <p className="adm-marca">Izao Perfumería · Panel</p>
        <div className="adm-pila">
          <h1 id="titulo-acceso">{titulo}</h1>
          {descripcion ? <p className="adm-suave">{descripcion}</p> : null}
        </div>
        {children}
      </section>
    </main>
  );
}
