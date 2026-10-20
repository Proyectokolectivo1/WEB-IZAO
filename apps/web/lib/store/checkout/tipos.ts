/** Tipos compartidos del checkout. Todo es serializable (montos como texto entero en unidad menor). */
import type { CodigoPais } from '../types';

export type MetodoPagoEnLinea = 'wompi' | 'addi' | 'sistecredito';
export type MetodoReal = MetodoPagoEnLinea | 'cod';
/** `manual` = sin pasarela activa: «Finalizar pedido por WhatsApp» (§5.4). */
export type MetodoCheckout = MetodoReal | 'manual';

export interface OpcionGeo {
  id: string;
  name: string;
}

/** Método activo del país tal como lo configura el panel (`payment_method_settings`). */
export interface MetodoActivo {
  method: MetodoReal;
  nombre: string;
  descripcion: string | null;
}

export interface EnlaceLegal {
  slug: string;
  title: string;
}

/** Términos y política de datos vigentes; `version` es `pages.version` de la política de tratamiento de datos. */
export interface PoliticaLegal {
  terminos: EnlaceLegal | null;
  datos: EnlaceLegal | null;
  version: string;
}

/** Lo que el servidor de la página entrega al formulario. Sin secretos ni costos. */
export interface ConfigCheckout {
  pais: CodigoPais;
  /** Contra entrega encendido en `country_settings`. */
  codHabilitado: boolean;
  /** Unidad menor, texto entero. */
  codAbono: string;
  codMinimoRecaudo: string;
  /** `financing_surcharge_pct` tal como llega del jsonb, en texto decimal (`"10"`). */
  recargoFinanciacion: Record<string, string>;
  metodos: MetodoActivo[];
  regiones: OpcionGeo[];
  tiposDocumento: string[];
  terminos: EnlaceLegal | null;
  datos: EnlaceLegal | null;
  /** Versión de la política de datos que se muestra (`orders.data_policy_version`). */
  versionPoliticaDatos: string;
}

/** Valores del formulario. Todo texto: la normalización la hace `logica.ts`. */
export interface ValoresFormulario {
  nombre: string;
  apellido: string;
  celular: string;
  correo: string;
  tipoDocumento: string;
  numeroDocumento: string;
  regionId: string;
  ciudadId: string;
  barrio: string;
  direccion: string;
  complemento: string;
  indicaciones: string;
  metodo: MetodoCheckout | '';
  terminos: boolean;
  whatsapp: boolean;
}

export type CampoFormulario = keyof ValoresFormulario;
export type ErroresFormulario = Partial<Record<CampoFormulario, string>>;
