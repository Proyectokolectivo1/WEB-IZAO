/**
 * Avatar ilustrado de Iza (no es una fotografía): trazo fino y planos de color de los tokens del tema. Decorativo
 * (`aria-hidden`); el nombre accesible lo da el botón o el título que lo contiene.
 */
export function AvatarIza({ tamano = 40 }: { tamano?: number }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 48 48" aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="24" cy="24" r="23" className="fill-surface stroke-ink" strokeWidth="1" />
      {/* Cabello */}
      <path d="M11 27c0-10 5-16 13-16s13 6 13 16c-2-5-4-8-8-9-4 3-10 4-18 9Z" className="fill-ink" />
      <path d="M11 27c-1 6 0 10 3 13M37 27c1 6 0 10-3 13" className="fill-none stroke-ink" strokeWidth="2" strokeLinecap="round" />
      {/* Rostro */}
      <path d="M16 26c0-5 3-8 8-8s8 3 8 8-3 10-8 10-8-5-8-10Z" className="fill-bg stroke-ink" strokeWidth="1" />
      <path d="M21 27h.01M27 27h.01" className="stroke-ink" strokeWidth="2" strokeLinecap="round" />
      <path d="M21.5 31.5c1.5 1.3 3.5 1.3 5 0" className="fill-none stroke-ink" strokeWidth="1" strokeLinecap="round" />
      {/* Pendiente: un detalle de acento */}
      <circle cx="16" cy="31" r="1.4" className="fill-accent" />
    </svg>
  );
}
