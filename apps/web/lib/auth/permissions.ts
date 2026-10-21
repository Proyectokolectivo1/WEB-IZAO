/**
 * Matriz de permisos del panel (§24.3). Tabla única módulo→roles y acción→roles.
 *
 * Es código puro, sin dependencias de servidor ni de navegador: la usan el
 * middleware, los layouts, las Server Actions y las pruebas.
 *
 * Regla: lo que no está en la tabla se niega (denegado por defecto).
 */

export const ROLES = ['admin', 'operator'] as const;
export type Rol = (typeof ROLES)[number];

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  operator: 'Operador',
};

export type ModuloDef = {
  /** Texto de la navegación. */
  etiqueta: string;
  /** Ruta del módulo; es también el primer segmento tras `/admin`. */
  ruta: string;
  /** Roles con acceso al módulo (§24.3). */
  roles: readonly Rol[];
  /**
   * `true` cuando el módulo ya existe en el panel. Los demás aparecen en la
   * tabla (para que las rutas futuras ya estén protegidas) pero no en la
   * navegación hasta que su oleada los construya.
   */
  disponible: boolean;
};

const TODOS: readonly Rol[] = ['admin', 'operator'];
const SOLO_ADMIN: readonly Rol[] = ['admin'];

/** Módulos de §24.1 con los roles de §24.3. */
export const MODULOS = {
  inicio: { etiqueta: 'Inicio', ruta: '/admin', roles: TODOS, disponible: true },
  pedidos: { etiqueta: 'Pedidos', ruta: '/admin/pedidos', roles: TODOS, disponible: true },
  garantias: { etiqueta: 'Garantías', ruta: '/admin/garantias', roles: TODOS, disponible: true },
  agente: {
    etiqueta: 'Agente de impresión',
    ruta: '/admin/agente-impresion',
    roles: TODOS,
    disponible: true,
  },
  dashboard: {
    etiqueta: 'Métricas',
    ruta: '/admin/metricas',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  productos: {
    etiqueta: 'Productos',
    ruta: '/admin/productos',
    roles: SOLO_ADMIN,
    disponible: true,
  },
  categorias: {
    etiqueta: 'Categorías',
    ruta: '/admin/categorias',
    roles: SOLO_ADMIN,
    disponible: true,
  },
  catalogo_auxiliar: {
    etiqueta: 'Marcas y atributos',
    ruta: '/admin/atributos',
    roles: SOLO_ADMIN,
    disponible: true,
  },
  colecciones: {
    etiqueta: 'Colecciones',
    ruta: '/admin/colecciones',
    roles: SOLO_ADMIN,
    disponible: true,
  },
  home: { etiqueta: 'Home', ruta: '/admin/home', roles: SOLO_ADMIN, disponible: false },
  contenido: {
    etiqueta: 'Contenido',
    ruta: '/admin/contenido',
    roles: SOLO_ADMIN,
    disponible: true,
  },
  resenas: { etiqueta: 'Reseñas', ruta: '/admin/resenas', roles: SOLO_ADMIN, disponible: false },
  descuentos: {
    etiqueta: 'Descuentos',
    ruta: '/admin/descuentos',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  influencers: {
    etiqueta: 'Influencers',
    ruta: '/admin/influencers',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  leads: { etiqueta: 'Leads', ruta: '/admin/leads', roles: SOLO_ADMIN, disponible: false },
  gastos: { etiqueta: 'Gastos', ruta: '/admin/gastos', roles: SOLO_ADMIN, disponible: false },
  clientes: {
    etiqueta: 'Clientes',
    ruta: '/admin/clientes',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  chatbot: { etiqueta: 'Chatbot', ruta: '/admin/chatbot', roles: SOLO_ADMIN, disponible: false },
  whatsapp: {
    etiqueta: 'WhatsApp',
    ruta: '/admin/whatsapp',
    roles: SOLO_ADMIN,
    disponible: true,
  },
  pagos: {
    etiqueta: 'Pagos y países',
    ruta: '/admin/pagos',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  integraciones: {
    etiqueta: 'Integraciones',
    ruta: '/admin/integraciones',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  apariencia: {
    etiqueta: 'Apariencia',
    ruta: '/admin/apariencia',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  usuarios: {
    etiqueta: 'Usuarios',
    ruta: '/admin/usuarios',
    roles: SOLO_ADMIN,
    disponible: false,
  },
  sistema: { etiqueta: 'Sistema', ruta: '/admin/sistema', roles: SOLO_ADMIN, disponible: false },
} as const satisfies Record<string, ModuloDef>;

export type ModuloId = keyof typeof MODULOS;

/**
 * Acciones puntuales dentro de un módulo (§24.3). Las Server Actions verifican
 * la acción con `puede()`, no solo el módulo.
 */
export const ACCIONES = {
  'pedidos.ver': TODOS,
  'pedidos.reenviar_cobro': TODOS,
  /** Copiar el link de cobro del abono (`/pagar/{token}`) desde el detalle del pedido (§13.3, §24.1). */
  'pedidos.copiar_link_cobro': TODOS,
  'pedidos.reintentar_envio': TODOS,
  'pedidos.reimprimir': TODOS,
  'pedidos.nota': TODOS,
  'pedidos.cancelar': SOLO_ADMIN,
  'pedidos.marcar_pagado': SOLO_ADMIN,
  'garantias.gestionar': TODOS,
  'agente.ver_estado': TODOS,
  'agente.reimprimir': TODOS,
  'agente.pagina_prueba': TODOS,
  /** El operador ve el contacto del cliente solo dentro del pedido (§24.3, §26.2). */
  'clientes.ver_contacto_desde_pedido': TODOS,
  'clientes.gestionar': SOLO_ADMIN,
  /** Crear, editar, archivar y eliminar en productos, categorías, atributos y colecciones. */
  'catalogo.gestionar': SOLO_ADMIN,
  /** Importar y exportar el catálogo (CSV/Excel) y la carga masiva de imágenes (§24.2). */
  'catalogo.importar': SOLO_ADMIN,
  /** Crear, editar, publicar y eliminar páginas y políticas del sitio (§9.5). */
  'contenido.gestionar': SOLO_ADMIN,
  /** Editar, versionar y enviar a aprobación las plantillas de WhatsApp (§13.2). */
  'whatsapp.plantillas': SOLO_ADMIN,
} as const satisfies Record<string, readonly Rol[]>;

export type AccionId = keyof typeof ACCIONES;

/** ¿El rol puede entrar al módulo? Un rol desconocido nunca puede. */
export function puedeAccederModulo(rol: Rol | null | undefined, modulo: ModuloId): boolean {
  if (!rol || !esRol(rol)) return false;
  return (MODULOS[modulo].roles as readonly Rol[]).includes(rol);
}

/** ¿El rol puede ejecutar la acción? */
export function puede(rol: Rol | null | undefined, accion: AccionId): boolean {
  if (!rol || !esRol(rol)) return false;
  return (ACCIONES[accion] as readonly Rol[]).includes(rol);
}

/** Módulos que el rol ve en la navegación (existentes y permitidos). */
export function modulosVisibles(
  rol: Rol | null | undefined,
): { id: ModuloId; etiqueta: string; ruta: string }[] {
  return (Object.keys(MODULOS) as ModuloId[])
    .filter((id) => MODULOS[id].disponible && puedeAccederModulo(rol, id))
    .map((id) => ({ id, etiqueta: MODULOS[id].etiqueta, ruta: MODULOS[id].ruta }));
}

/**
 * Páginas de `/admin` que no son un módulo de negocio y le sirven a cualquier
 * sesión completa (aviso de falta de permiso).
 */
const RUTAS_COMUNES = new Set(['/admin/sin-permiso']);

/**
 * Módulo al que pertenece una ruta de `/admin/**` o `/api/admin/**`.
 * Devuelve `null` si la ruta no corresponde a ningún módulo conocido: el
 * llamador debe tratarla como solo-administrador (denegado por defecto).
 */
export function moduloDeRuta(pathname: string): ModuloId | null {
  const limpia = normalizar(pathname);
  if (limpia === '/admin' || RUTAS_COMUNES.has(limpia)) return 'inicio';
  const segmento = limpia.split('/')[2];
  if (!segmento) return 'inicio';
  for (const id of Object.keys(MODULOS) as ModuloId[]) {
    const ruta = MODULOS[id].ruta;
    if (ruta === '/admin') continue;
    if (ruta.split('/')[2] === segmento) return id;
  }
  return null;
}

/** ¿Puede el rol ver esta ruta? Las rutas sin módulo exigen rol `admin`. */
export function puedeVerRuta(rol: Rol | null | undefined, pathname: string): boolean {
  if (!rol || !esRol(rol)) return false;
  const modulo = moduloDeRuta(pathname);
  if (modulo === null) return rol === 'admin';
  return puedeAccederModulo(rol, modulo);
}

/**
 * Quita el prefijo `/api` y las barras finales, y descarta los intentos de
 * salirse del árbol (`..`, doble barra) para que no engañen a la comparación.
 */
function normalizar(pathname: string): string {
  let ruta = pathname.split('?')[0] ?? '';
  ruta = ruta.replace(/\/{2,}/g, '/');
  if (ruta.startsWith('/api/admin')) ruta = ruta.slice('/api'.length);
  if (ruta.length > 1) ruta = ruta.replace(/\/+$/, '');
  if (ruta.split('/').includes('..')) return '/admin/__invalida__';
  return ruta;
}
