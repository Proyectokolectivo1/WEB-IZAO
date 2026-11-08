/** Encabezado de las secciones de la ficha: título editorial con una pincelada de color debajo; sin números ni filetes. */
export function EncabezadoSeccion({ titulo, id }: { titulo: string; id?: string }) {
  return (
    <div className="mb-8">
      <h2 id={id} className="text-[2rem] leading-[1.05] md:text-5xl">
        {titulo}
      </h2>
      <span aria-hidden="true" className="mt-4 block h-0.5 w-12 rounded-full bg-accent" />
    </div>
  );
}
