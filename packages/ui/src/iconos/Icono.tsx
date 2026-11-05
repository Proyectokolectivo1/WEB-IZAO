import type { SVGProps } from 'react';

/**
 * Íconos de línea fina (trazo 1.25 en rejilla de 24). Set propio para no cargar una librería entera.
 * Cada entrada son trazos `d` de un `<path>`.
 */
const TRAZOS = {
  buscar: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M20.5 20.5 16 16'],
  bolso: ['M5 8h14l-1 12H6L5 8Z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  corazon: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z'],
  ojo: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  cerrar: ['M6 6l12 12M18 6 6 18'],
  mas: ['M12 5v14M5 12h14'],
  menos: ['M5 12h14'],
  chevronAbajo: ['M6 9.5l6 6 6-6'],
  chevronArriba: ['M6 14.5l6-6 6 6'],
  chevronIzquierda: ['M14.5 6l-6 6 6 6'],
  chevronDerecha: ['M9.5 6l6 6-6 6'],
  filtro: ['M4 7h9M17 7h3M4 17h3M11 17h9', 'M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z', 'M9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'],
  usuario: ['M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z', 'M5 20c0-3.9 3.1-6 7-6s7 2.1 7 6'],
  menu: ['M4 7h16M4 12h16M4 17h10'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  flechaArriba: ['M12 19V5M6 11l6-6 6 6'],
  mundo: [
    'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z',
    'M3.5 12h17',
    'M12 3.5c2.8 2.6 2.8 14.4 0 17M12 3.5c-2.8 2.6-2.8 14.4 0 17',
  ],
  estrella: ['M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.2 7.2 18.9l1-5.4-4-3.8 5.4-.7L12 4Z'],
  chat: ['M4 19l1.2-3.7A8 8 0 1 1 8 18l-4 1Z'],
  hoja: ['M5 19C5 10 10 5 19 5c0 9-5 14-14 14Z', 'M5 19l8-8'],
  flor: ['M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', 'M12 9.5V4M12 20v-5.5M9.5 12H4M20 12h-5.5'],
  gota: ['M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5Z'],
  camion: [
    'M2.5 6.5h11v9h-11z',
    'M13.5 9.5h4l3 3v3h-7',
    'M7 16.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z',
    'M17 16.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z',
  ],
  escudo: ['M12 3.5l7 2.5v5.5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-2.5Z', 'M9 12l2.2 2.2L15.2 10'],
  tarjeta: ['M3.5 6.5h17v11h-17z', 'M3.5 10.5h17'],
  caja: ['M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9Z', 'M3.5 7.5 12 11.5l8.5-4M12 11.5v9'],
  reloj: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v4l3 2'],
  papelera: ['M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7'],
  pausa: ['M9 6v12M15 6v12'],
  reproducir: ['M8 5.5v13l10.5-6.5L8 5.5Z'],
  ordenar: ['M8 5v14M8 19l-3-3M8 19l3-3', 'M16 19V5M16 5l-3 3M16 5l3 3'],
} as const satisfies Record<string, readonly string[]>;

export type NombreIcono = keyof typeof TRAZOS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  nombre: NombreIcono;
  /** Lado en px. Por defecto 20 (consistente en toda la tienda). */
  tamano?: number;
  /** Texto accesible; si falta, el ícono es decorativo (`aria-hidden`). */
  titulo?: string;
}

export function Icono({ nombre, tamano = 20, titulo, ...resto }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={tamano}
      height={tamano}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      focusable="false"
      {...resto}
    >
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
