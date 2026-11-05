import type { ReactNode } from 'react';
import { CLASES_FUENTES_PREVIA } from '@/lib/tipografia/fuentes-previa';
import '../../apariencia.css';

/** Las variables `--fuente-*` de la vista previa del selector solo existen en esta sección del panel. */
export default function LayoutApariencia({ children }: { children: ReactNode }) {
  return <div className={CLASES_FUENTES_PREVIA}>{children}</div>;
}
