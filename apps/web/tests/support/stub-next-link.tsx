/** Sustituto de `next/link` para armar el panel en el navegador sin el enrutador de Next (solo pruebas). */
import type { AnchorHTMLAttributes } from 'react';

export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
