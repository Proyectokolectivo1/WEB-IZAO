import type { Metadata } from 'next';
import Link from 'next/link';
import { requerirAdmin } from '@/lib/auth/guard';
import { modulosVisibles } from '@/lib/auth/permissions';

export const metadata: Metadata = { title: 'Inicio' };

export default async function PaginaInicio() {
  const admin = await requerirAdmin({ modulo: 'inicio' });
  const atajos = modulosVisibles(admin.rol).filter((m) => m.id !== 'inicio');

  return (
    <>
      <div className="adm-pila">
        <h1>Hola, {admin.nombre}</h1>
        <p className="adm-suave">Elige un módulo para empezar.</p>
      </div>
      <div className="adm-rejilla">
        {atajos.map((m) => (
          <Link key={m.id} href={m.ruta} className="adm-atajo">
            <strong>{m.etiqueta}</strong>
          </Link>
        ))}
      </div>
    </>
  );
}
