/**
 * Páginas de ejemplo del panel como HTML estático, con las mismas clases y la misma estructura que las páginas reales
 * (pedidos, productos, agente, inicio, métricas, edición de producto). Sirven para medir el diseño adaptable sin sesión
 * de administrador: el panel real exige Supabase Auth + MFA, y el Supabase falso de las pruebas no lo simula.
 *
 * Si cambias el marcado de una de esas páginas, cambia también su ejemplo aquí.
 */
import { modulosVisibles } from '@/lib/auth/permissions';

export type PaginaPanel =
  | 'inicio'
  | 'pedidos'
  | 'productos'
  | 'producto-editar'
  | 'agente'
  | 'metricas'
  | 'clientes'
  | 'gastos'
  | 'garantias'
  | 'listas'
  | 'tablas-cortas';
export const PAGINAS_PANEL: readonly PaginaPanel[] = [
  'inicio',
  'pedidos',
  'productos',
  'producto-editar',
  'agente',
  'metricas',
  'clientes',
  'gastos',
  'garantias',
  'listas',
  'tablas-cortas',
];

const PEDIDOS = [
  ['IZ-10482', 'CO', 'Pendiente de pago', 'Contra entrega', '$ 389.900', 'Medellín', '8 nov 2026, 10:42'],
  ['IZ-10481', 'CO', 'Confirmado', 'Pago completo', '$ 214.000', 'Bogotá D.C.', '8 nov 2026, 9:15'],
  ['IZ-10480', 'EC', 'Enviado', 'Pago completo', 'US$ 62,50', 'Guayaquil', '7 nov 2026, 17:03'],
  ['IZ-10479', 'CO', 'Con novedad', 'Contra entrega', '$ 159.900', 'Cali', '7 nov 2026, 15:48'],
  ['IZ-10478', 'CO', 'Entregado', 'Addi', '$ 478.000', 'Barranquilla', '7 nov 2026, 11:20'],
  ['IZ-10477', 'CO', 'Cancelado', 'Contra entrega', '$ 129.900', 'Bucaramanga', '6 nov 2026, 19:31'],
] as const;

function filaPedido(p: readonly string[]): string {
  return `<tr>
    <td><a href="#" data-fila-pedido>${p[0]}</a></td>
    <td data-etiqueta="País">${p[1]}</td>
    <td data-etiqueta="Estado"><span class="adm-insignia">${p[2]}</span></td>
    <td data-etiqueta="Pago">${p[3]}</td>
    <td data-etiqueta="Total">${p[4]}</td>
    <td data-etiqueta="Ciudad" class="adm-suave">${p[5]}</td>
    <td data-etiqueta="Fecha" class="adm-suave">${p[6]}</td>
  </tr>`;
}

function campoSelect(id: string, etiqueta: string, vacio: string): string {
  return `<div class="adm-campo"><label for="${id}" class="adm-etiqueta">${etiqueta}</label>
    <select id="${id}" class="adm-input"><option value="">${vacio}</option></select></div>`;
}

function pedidos(): string {
  return `<h1>Pedidos</h1>
  <form class="adm-busqueda adm-filtros" role="search">
    <div class="adm-campo"><label for="filtro-q" class="adm-etiqueta">Número de pedido o celular</label>
      <input id="filtro-q" type="search" class="adm-input" /></div>
    ${campoSelect('filtro-estado', 'Estado', 'Todos')}
    ${campoSelect('filtro-pais', 'País', 'Todos')}
    ${campoSelect('filtro-metodo', 'Método de pago', 'Todos')}
    <div class="adm-campo"><label for="filtro-desde" class="adm-etiqueta">Desde</label><input id="filtro-desde" type="date" class="adm-input" /></div>
    <div class="adm-campo"><label for="filtro-hasta" class="adm-etiqueta">Hasta</label><input id="filtro-hasta" type="date" class="adm-input" /></div>
    <button type="submit" class="adm-boton">Filtrar</button>
    <a class="adm-enlace-boton adm-boton-secundario" href="#">Limpiar</a>
  </form>
  <p class="adm-suave adm-chico adm-atajos-teclado">Atajos: <kbd>/</kbd> buscar · <kbd>j</kbd> / <kbd>k</kbd> bajar y subir por la lista · <kbd>Enter</kbd> abrir el pedido</p>
  <div class="adm-tabla-caja">
    <table class="adm-tabla adm-tabla-apilada">
      <caption class="adm-suave">Pedidos más recientes primero</caption>
      <thead><tr><th scope="col">Pedido</th><th scope="col">País</th><th scope="col">Estado</th><th scope="col">Pago</th><th scope="col">Total</th><th scope="col">Ciudad</th><th scope="col">Fecha</th></tr></thead>
      <tbody>${PEDIDOS.map(filaPedido).join('')}</tbody>
    </table>
  </div>
  <nav class="adm-paginacion" aria-label="Paginación"><p class="adm-suave adm-chico">84 resultados · página 1 de 4</p>
    <div class="adm-acciones"><a class="adm-enlace-boton adm-boton-secundario" href="#" rel="next">Siguiente</a></div></nav>`;
}

const PRODUCTOS = [
  ['Eau de parfum Noche Ámbar 100 ml', 'Casa Izao', 'Activo', 'adm-insignia-ok', 3, ['desde $ 189.900', 'Stock 24'], ['desde US$ 52,00', 'Stock 9']],
  ['Eau de toilette Brisa Cítrica 50 ml', 'Casa Izao', 'Borrador', 'adm-insignia-aviso', 2, ['desde $ 129.900', 'Stock 0'], ['Sin precio', 'Stock 0']],
  ['Body mist Flor de Café 250 ml', 'Sin marca', 'Activo', 'adm-insignia-ok', 1, ['desde $ 69.900', 'Stock 41'], ['desde US$ 19,00', 'Stock 12']],
  ['Perfume de ambiente Madera Clara', 'Casa Izao', 'Archivado', '', 1, ['Sin precio', 'Stock 0'], ['Sin precio', 'Stock 0']],
] as const;

function productos(): string {
  const filas = PRODUCTOS.map(
    (p) => `<tr>
      <td><div class="adm-prod-celda"><span class="adm-prod-miniatura" aria-hidden="true"></span>
        <div><a href="#">${p[0]}</a><div class="adm-suave adm-chico">${p[1]}</div></div></div></td>
      <td data-etiqueta="Estado"><span class="adm-insignia ${p[3]}">${p[2]}</span></td>
      <td data-etiqueta="Variantes">${p[4]}</td>
      <td data-etiqueta="Colombia"><div class="adm-celda-pais"><span class="adm-insignia ${p[5][0].startsWith('Sin') ? '' : 'adm-insignia-ok'}">${p[5][0].startsWith('Sin') ? 'Oculto' : 'Visible'}</span>
        <div class="adm-chico">${p[5][0]}</div><div class="adm-suave adm-chico">${p[5][1]}</div></div></td>
      <td data-etiqueta="Ecuador"><div class="adm-celda-pais"><span class="adm-insignia ${p[6][0].startsWith('Sin') ? '' : 'adm-insignia-ok'}">${p[6][0].startsWith('Sin') ? 'Oculto' : 'Visible'}</span>
        <div class="adm-chico">${p[6][0]}</div><div class="adm-suave adm-chico">${p[6][1]}</div></div></td>
    </tr>`,
  ).join('');
  return `<div class="adm-cabecera"><h1>Productos</h1>
    <div class="adm-acciones"><a class="adm-enlace-boton adm-boton-secundario" href="#">Importar</a><a class="adm-enlace-boton" href="#">Nuevo producto</a></div></div>
  <form class="adm-busqueda adm-filtros" role="search">
    <div class="adm-campo"><label for="f-q" class="adm-etiqueta">Buscar</label><input id="f-q" type="search" class="adm-input" /></div>
    ${campoSelect('f-estado', 'Estado', 'Todos')}
    ${campoSelect('f-marca', 'Marca', 'Todas')}
    ${campoSelect('f-pais', 'Visible en', 'Cualquier país')}
    <button type="submit" class="adm-boton">Filtrar</button>
  </form>
  <div class="adm-tabla-caja">
    <table class="adm-tabla adm-tabla-prod adm-tabla-apilada">
      <caption class="adm-suave">Productos, del modificado más recientemente al más antiguo</caption>
      <thead><tr><th scope="col">Producto</th><th scope="col">Estado</th><th scope="col">Variantes</th><th scope="col">Colombia</th><th scope="col">Ecuador</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
  <nav class="adm-paginacion" aria-label="Paginación"><p class="adm-suave adm-chico">188 resultados · página 1 de 8</p>
    <div class="adm-acciones"><a class="adm-enlace-boton adm-boton-secundario" href="#" rel="next">Siguiente</a></div></nav>`;
}

function campo(id: string, etiqueta: string, valor = '', tipo = 'text'): string {
  return `<div class="adm-campo"><label for="${id}" class="adm-etiqueta">${etiqueta}</label><input id="${id}" type="${tipo}" class="adm-input" value="${valor}" /></div>`;
}

function productoEditar(): string {
  const paisVariante = (n: string, pais: string) => `<div class="adm-bloque-pais"><h4>${pais}</h4>
    <label class="adm-check"><input type="checkbox" checked /> Visible en ${pais}</label>
    <div class="adm-fila">${campo(`${n}-p`, 'Precio', '189900', 'number')}${campo(`${n}-s`, 'Stock', '24', 'number')}${campo(`${n}-m`, 'ID de MasterShop', '10442')}</div></div>`;
  const variante = (i: number) => `<div class="adm-variante">
    <div class="adm-variante-cabecera"><strong>Variante ${i}</strong>
      <div class="adm-acciones"><label class="adm-check"><input type="checkbox" checked /> Activa</label>
      <button type="button" class="adm-boton adm-boton-secundario adm-boton-chico">Quitar</button></div></div>
    <div class="adm-fila">${campo(`v${i}-sku`, 'SKU', `IZAO-NOA-10${i}`)}${campo(`v${i}-tam`, 'Tamaño', '100 ml')}</div>
    <div class="adm-paises-variante">${paisVariante(`v${i}c`, 'Colombia')}${paisVariante(`v${i}e`, 'Ecuador')}</div></div>`;
  return `<p class="adm-migas"><a href="#">Productos</a> / Eau de parfum Noche Ámbar 100 ml</p>
  <h1>Eau de parfum Noche Ámbar 100 ml</h1>
  <p class="adm-ok" role="status">Cambios guardados.</p>
  <form class="adm-form adm-ancho-total">
    <fieldset class="adm-fieldset"><legend>Datos básicos</legend>
      <div class="adm-fila">${campo('p-nombre', 'Nombre', 'Eau de parfum Noche Ámbar 100 ml')}${campo('p-slug', 'Dirección (slug)', 'noche-ambar-100')}</div>
      <div class="adm-fila">${campoSelect('p-marca', 'Marca', 'Sin marca')}${campoSelect('p-estado', 'Estado', 'Activo')}</div>
      <div class="adm-campo"><label for="p-desc" class="adm-etiqueta">Descripción</label><textarea id="p-desc" class="adm-input adm-textarea">Notas de ámbar, vainilla y madera tibia.</textarea></div>
    </fieldset>
    <fieldset class="adm-fieldset"><legend>Imágenes</legend>
      <ul class="adm-galeria">${[1, 2, 3]
        .map(
          (n) => `<li><span class="adm-prod-miniatura" style="width:100%;height:9rem" aria-hidden="true"></span><p class="adm-chico adm-suave">Frasco ${n}</p>
          <div class="adm-campo"><label for="rol-${n}" class="adm-etiqueta">Rol</label><select id="rol-${n}" class="adm-input"><option>Principal</option></select></div>
          <div class="adm-acciones"><button type="button" class="adm-boton adm-boton-secundario adm-boton-chico">Subir</button><button type="button" class="adm-boton adm-boton-secundario adm-boton-chico">Bajar</button><button type="button" class="adm-boton adm-boton-secundario adm-boton-chico">Quitar</button></div></li>`,
        )
        .join('')}</ul>
    </fieldset>
    <fieldset class="adm-fieldset"><legend>Variantes</legend>${variante(1)}${variante(2)}
      <div class="adm-acciones"><button type="button" class="adm-boton adm-boton-secundario">Agregar variante</button></div></fieldset>
    <div class="adm-acciones adm-pie-fijo"><button type="submit" class="adm-boton">Guardar cambios</button><a class="adm-enlace-boton adm-boton-secundario" href="#">Cancelar</a></div>
  </form>`;
}

function agente(): string {
  const cola = [
    ['Etiqueta', 'IZ-10482', 'Impresa', 'Automática', '8 nov 2026, 10:44:12', '—'],
    ['Etiqueta', 'IZ-10479', 'Falló', 'Panel', '7 nov 2026, 15:50:03', 'La impresora no responde'],
    ['Página de prueba', '—', 'Impresa', 'Panel', '6 nov 2026, 8:02:41', '—'],
  ];
  return `<h1>Agente de impresión</h1>
  <div class="adm-tabla-caja"><table class="adm-tabla adm-tabla-apilada"><caption class="adm-suave">Agentes registrados</caption>
    <thead><tr><th scope="col">Agente</th><th scope="col">Estado</th><th scope="col">Último latido</th><th scope="col">Impresora</th><th scope="col">Versión</th><th scope="col">Modo</th><th scope="col">En cola</th><th scope="col">Último error</th></tr></thead>
    <tbody><tr><td><a href="#">PC de despacho</a></td>
      <td data-etiqueta="Estado"><span class="adm-insignia adm-insignia-ok">En línea</span></td>
      <td data-etiqueta="Último latido" class="adm-suave">8 nov 2026, 10:47:55</td>
      <td data-etiqueta="Impresora">Zebra ZD220</td><td data-etiqueta="Versión" class="adm-suave">1.4.2</td>
      <td data-etiqueta="Modo">Panel de MasterShop</td><td data-etiqueta="En cola">0</td><td data-etiqueta="Último error" class="adm-suave">—</td></tr></tbody></table></div>
  <section class="adm-form-ancho"><h2>Página de prueba</h2>
    <p class="adm-suave">Manda una hoja de prueba a la impresora para comprobar que todo está conectado.</p>
    <button type="button" class="adm-boton">Imprimir página de prueba</button></section>
  <section><h2>Últimos trabajos de impresión</h2>
    <div class="adm-tabla-caja"><table class="adm-tabla adm-tabla-apilada"><caption class="adm-suave">Más recientes primero</caption>
      <thead><tr><th scope="col">Tipo</th><th scope="col">Pedido</th><th scope="col">Estado</th><th scope="col">Origen</th><th scope="col">Creado</th><th scope="col">Detalle</th><th scope="col">Acciones</th></tr></thead>
      <tbody>${cola
        .map(
          (c) => `<tr><td>${c[0]}</td><td data-etiqueta="Pedido">${c[1]}</td>
          <td data-etiqueta="Estado"><span class="adm-insignia ${c[2] === 'Falló' ? 'adm-insignia-aviso' : ''}">${c[2]}</span></td>
          <td data-etiqueta="Origen" class="adm-suave">${c[3]}</td><td data-etiqueta="Creado" class="adm-suave">${c[4]}</td>
          <td data-etiqueta="Detalle" class="adm-suave">${c[5]}</td>
          <td data-etiqueta="Acciones">${c[0] === 'Etiqueta' ? '<button type="button" class="adm-boton adm-boton-secundario adm-boton-chico">Reimprimir</button>' : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div></section>`;
}

function metricas(): string {
  const kpi = (e: string, v: string, d: string) =>
    `<li class="met-kpi"><span class="met-kpi-etiqueta adm-suave">${e}</span><strong class="met-kpi-valor">${v}</strong><span class="met-kpi-var" data-sentido="sube" data-costo="no">${d}</span></li>`;
  return `<h1>Métricas</h1>
  <form class="adm-busqueda adm-filtros adm-filtro-fechas"><div class="adm-campo"><label for="m-d" class="adm-etiqueta">Desde</label><input id="m-d" type="date" class="adm-input" /></div>
    <div class="adm-campo"><label for="m-h" class="adm-etiqueta">Hasta</label><input id="m-h" type="date" class="adm-input" /></div>
    <button type="submit" class="adm-boton">Aplicar</button></form>
  <section class="met-pais"><h2>Colombia</h2>
    <ul class="met-kpis">${kpi('Ingresos', '$ 12.480.900', '+8 %')}${kpi('Utilidad neta', '$ 3.126.400', '+5 %')}${kpi('Pedidos', '84', '+12 %')}${kpi('Ticket promedio', '$ 148.582', '-2 %')}${kpi('Costo de envíos', '$ 1.204.000', '+3 %')}${kpi('Garantías', '$ 189.900', '0 %')}</ul>
    <div class="met-dos"><div><h3>Ventas por día</h3><svg class="met-svg" viewBox="0 0 400 120" role="img" aria-label="Ventas por día"><polyline fill="none" stroke="currentColor" stroke-width="2" points="0,90 60,70 120,80 180,40 240,55 300,30 360,45 400,20" /></svg></div>
    <div class="adm-tabla-caja"><table class="adm-tabla"><caption class="adm-suave">Top de ciudades</caption><thead><tr><th scope="col">Ciudad</th><th scope="col" class="adm-num">Pedidos</th><th scope="col" class="adm-num">Ingresos</th></tr></thead>
    <tbody><tr><td>Medellín</td><td class="adm-num">31</td><td class="adm-num">$ 4.612.000</td></tr><tr><td>Bogotá D.C.</td><td class="adm-num">22</td><td class="adm-num">$ 3.390.500</td></tr></tbody></table></div></div>
  </section>`;
}

function clientes(): string {
  const filas = [
    ['Mariana Restrepo Valencia', '', 'CO', 'mariana.restrepo.valencia.compras@correo-ejemplo-largo.com', '+573001234567', '8 nov 2026'],
    ['Andrés Villacís', '', 'EC', 'andres@correo-ejemplo.com', '+593991234567', '7 nov 2026'],
    ['Cliente anonimizado', ' Anonimizado', 'CO', '—', '—', '2 nov 2026'],
  ];
  return `<h1>Clientes</h1>
  <form class="adm-busqueda adm-filtros" role="search">
    <div class="adm-campo"><label for="c-q" class="adm-etiqueta">Nombre, correo o celular</label><input id="c-q" type="search" class="adm-input" /></div>
    ${campoSelect('c-pais', 'País', 'Todos')}
    <button type="submit" class="adm-boton">Buscar</button>
  </form>
  <div class="adm-tabla-caja"><table class="adm-tabla adm-tabla-apilada"><caption class="adm-suave">Clientes más recientes primero</caption>
    <thead><tr><th scope="col">Cliente</th><th scope="col">País</th><th scope="col">Correo</th><th scope="col">Celular</th><th scope="col">Desde</th></tr></thead>
    <tbody>${filas
      .map(
        (c) => `<tr><td><a href="#">${c[0]}</a>${c[1] ? `<span class="adm-insignia">${c[1]}</span>` : ''}</td>
      <td data-etiqueta="País">${c[2]}</td><td data-etiqueta="Correo" class="adm-suave">${c[3]}</td>
      <td data-etiqueta="Celular" class="adm-suave">${c[4]}</td><td data-etiqueta="Desde" class="adm-suave">${c[5]}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function gastos(): string {
  const filas = [
    ['2026-11-07', 'Empaques', 'Cajas y papel de seda para el despacho de la semana, factura del proveedor de Medellín', 'Manual', '$ 184.000', true],
    ['2026-11-06', 'Pasarela', 'Comisión Wompi', 'Automático', '$ 12.480', false],
    ['2026-11-05', 'Publicidad', '—', 'Meta Ads', '$ 350.000', false],
  ];
  return `<h1>Gastos</h1>
  <form class="adm-busqueda adm-filtros">
    ${campoSelect('g-cat', 'Categoría', 'Todas')}
    <div class="adm-campo"><label for="g-d" class="adm-etiqueta">Desde</label><input id="g-d" type="date" class="adm-input" /></div>
    <div class="adm-campo"><label for="g-h" class="adm-etiqueta">Hasta</label><input id="g-h" type="date" class="adm-input" /></div>
    <button type="submit" class="adm-boton">Filtrar</button>
  </form>
  <div class="adm-tabla-caja"><table class="adm-tabla adm-tabla-apilada"><caption class="adm-suave">Gastos más recientes primero</caption>
    <thead><tr><th scope="col">Fecha</th><th scope="col">Categoría</th><th scope="col">Descripción</th><th scope="col">Origen</th><th scope="col">Valor</th></tr></thead>
    <tbody>${filas
      .map(
        (g) => `<tr><td><a href="#">${g[0]}</a></td><td data-etiqueta="Categoría">${g[1]}</td>
      <td data-etiqueta="Descripción" class="adm-suave">${g[2]}${g[5] ? '<span class="adm-insignia"> Comprobante</span>' : ''}</td>
      <td data-etiqueta="Origen"><span class="adm-insignia">${g[3]}</span></td><td data-etiqueta="Valor">${g[4]}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function garantias(): string {
  const filas = [
    ['GAR-0042', 'Laura Gómez Hernández', '+573157654321', 'Frasco llegó con la tapa rota y el producto derramado dentro de la caja', 'En revisión', true, '—', '$ 0'],
    ['GAR-0041', 'Juan Pérez', '+573001112233', 'Producto equivocado', 'Resuelta', false, 'Reenvío', '$ 18.900'],
  ];
  return `<h1>Garantías</h1>
  <form class="adm-busqueda adm-filtros">
    ${campoSelect('ga-estado', 'Estado', 'Todos')}
    ${campoSelect('ga-pais', 'País', 'Todos')}
    <button type="submit" class="adm-boton">Filtrar</button>
  </form>
  <div class="adm-tabla-caja"><table class="adm-tabla adm-tabla-apilada"><caption class="adm-suave">Solicitudes más recientes primero</caption>
    <thead><tr><th scope="col">Caso</th><th scope="col">Cliente</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col">Solución</th><th scope="col">Costo asumido</th><th scope="col">Recibida</th></tr></thead>
    <tbody>${filas
      .map(
        (g) => `<tr><td><a href="#">${g[0]}</a></td>
      <td data-etiqueta="Cliente">${g[1]}<span class="adm-suave adm-chico"> · ${g[2]}</span></td>
      <td data-etiqueta="Motivo">${g[3]}</td>
      <td data-etiqueta="Estado"><span class="adm-insignia">${g[4]}</span>${g[5] ? '<span class="adm-insignia adm-insignia-aviso"> Respuesta vencida</span>' : ''}</td>
      <td data-etiqueta="Solución" class="adm-suave">${g[6]}</td><td data-etiqueta="Costo asumido">${g[7]}</td>
      <td data-etiqueta="Recibida" class="adm-suave">7 nov 2026, 9:30</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

/** Una tabla apilada de ejemplo. `tituloFila`: la primera celda va como `<th scope="row">` (título de la tarjeta). */
function tablaApilada(titulo: string, cabeceras: readonly string[], filas: readonly (readonly string[])[], tituloFila = false): string {
  const etiquetas = tituloFila ? cabeceras.slice(1) : cabeceras;
  return `<div class="adm-tabla-caja"><table class="adm-tabla adm-tabla-apilada"><caption class="adm-suave">${titulo}</caption>
    <thead><tr>${cabeceras.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>
    <tbody>${filas
      .map(
        (f) =>
          `<tr>${f
            .map((celda, i) => {
              if (tituloFila && i === 0) return `<th scope="row">${celda}</th>`;
              const n = tituloFila ? i - 1 : i;
              return `<td${i > 0 ? ` data-etiqueta="${etiquetas[n]}"` : ''}>${celda}</td>`;
            })
            .join('')}</tr>`,
      )
      .join('')}</tbody></table></div>`;
}

const ACCIONES_ORDEN =
  '<div class="adm-acciones"><button type="button" class="adm-boton adm-boton-secundario">Subir</button><button type="button" class="adm-boton adm-boton-secundario">Bajar</button><button type="button" class="adm-boton adm-boton-secundario">Quitar</button></div>';

/** Listas del panel que pasan a tarjetas en celular (mismo marcado que las páginas reales). */
function listas(): string {
  return `<h1>Listas del panel</h1>
  ${tablaApilada(
    'Leads más recientes primero',
    ['Contacto', 'País', 'Pop-up', 'Código', 'Mercadeo', 'Compró', 'Fecha'],
    [
      ['laura.gomez.hernandez@correo-ejemplo.com <span class="adm-suave adm-chico"> · +573157654321 · instagram / bio</span>', 'CO', 'Bienvenida 10 %', 'BIENVENIDA10', 'Sí', '<a href="#">Ver pedido</a>', '8 nov 2026, 10:42'],
      ['—', 'EC', '—', '—', 'No', '<span class="adm-suave">No</span>', '7 nov 2026, 17:03'],
    ],
  )}
  ${tablaApilada('Códigos de descuento', ['Código', 'Descuento', 'Estado', 'Usos', 'Origen', 'Iza'], [
    ['<a href="#">VERANO2026</a>', '15 %', '<span class="adm-insignia adm-insignia-ok">Vigente</span>', '12 / 100', 'Manual', 'Sí'],
  ])}
  ${tablaApilada('Usuarios del panel', ['Nombre', 'Correo', 'Rol', 'Estado', 'Verificación en 2 pasos', 'Último ingreso'], [
    ['<a href="#">Operadora de bodega</a>', 'operadora.bodega@correo-ejemplo.com', 'Operador', '<span class="adm-insignia adm-insignia-ok">Activo</span>', '<span class="adm-insignia adm-insignia-aviso">Pendiente</span>', '8 nov 2026, 7:58'],
  ])}
  ${tablaApilada('Eventos más recientes primero', ['Cuándo', 'Quién', 'Acción', 'Sobre', 'Detalle'], [
    ['8 nov 2026, 10:42', 'Dueña de Izao <span class="adm-suave adm-chico"> · 190.25.10.44</span>', '<code>discount_code.update</code>', 'discount_codes · 3f9a2c1d-77b0', 'usage_limit_total: 100 → 150; is_active: true → false; valid_until: 2026-12-31 → 2027-01-15'],
  ])}
  ${tablaApilada(
    'Ventas por influencer',
    ['Influencer', 'Pedidos', 'Ventas brutas', 'Entregados', 'Devueltos', 'Ingresos confirmados', 'Ticket promedio', 'Comisión'],
    [['<a href="#">Camila Ortega</a><span class="adm-suave"> @camilaortega.perfumes</span>', '14<span class="adm-suave"> (12 pagados)</span>', '$ 2.184.000', '10', '1', '$ 1.920.500', '$ 182.000', '$ 192.050<span class="adm-suave"> (10 %)</span>']],
  )}
  ${tablaApilada(
    'Credenciales de Wompi en Colombia',
    ['Ambiente', 'Guardado', 'Estado', 'Última prueba', 'Acciones'],
    [
      [
        'Producción',
        '<ul style="list-style:none;padding:0;margin:0"><li><span class="adm-suave">Llave pública: </span><code>pub_prod_••••••••8f2a</code></li><li><span class="adm-suave">Secreto de eventos: </span><code>••••••••c91d</code></li></ul>',
        '<span class="adm-insignia adm-insignia-ok">Activa</span>',
        'Hace 2 h · correcta',
        '<div class="adm-acciones"><a class="adm-enlace-boton" href="#">Editar</a><button type="button" class="adm-boton adm-boton-secundario">Probar conexión</button><button type="button" class="adm-boton adm-boton-secundario">Desactivar</button></div>',
      ],
    ],
    true,
  )}
  ${tablaApilada('Destacados de Colombia, de primero a último', ['#', 'Producto', 'En la tienda', 'Acciones'], [
    ['1', 'Perfume árabe de ejemplo con nombre largo 100 ml', '<span class="adm-insignia adm-insignia-ok">Visible</span>', ACCIONES_ORDEN],
  ])}
  ${tablaApilada('Códigos de la influencer', ['Código', 'Usos', 'Enlace de referido'], [
    ['<a href="#">CAMILA10</a>', '31', '<code class="adm-copiable">https://izaoperfumeria.com/co?ref=CAMILA10&amp;utm_source=influencer</code>'],
  ])}
  ${tablaApilada('Ventas por día', ['Día', 'Pedidos pagados', 'Ventas brutas', 'Ingresos confirmados'], [
    ['2026-11-07', '9', '$ 1.482.900', '$ 1.390.000'],
    ['2026-11-06', '7', '$ 1.104.000', '$ 1.020.400'],
  ], true)}
  ${tablaApilada('Pedidos del cliente', ['Pedido', 'Estado', 'Total', 'Fecha'], [
    ['<a href="#">IZ-10482</a>', '<span class="adm-insignia">Pendiente de pago</span>', '$ 389.900', '8 nov 2026, 10:42'],
  ])}`;
}

/** Tablas de 2 o 3 columnas que se quedan como tabla porque caben en 375 px (ver `tablasApiladas.test.ts`). */
function tablasCortas(): string {
  return `<h1>Tablas cortas</h1>
  <div class="adm-tabla-caja"><table class="adm-tabla"><caption class="adm-suave">Aromas</caption>
    <thead><tr><th scope="col">Nombre</th><th scope="col">URL</th><th scope="col" class="adm-num">Orden</th></tr></thead>
    <tbody><tr><td><a href="#">Oriental amaderada</a></td><td class="adm-suave">oriental-amaderada-intensa</td><td class="adm-num">12</td></tr></tbody></table></div>
  <div class="adm-tabla-caja"><table class="adm-tabla"><caption class="adm-suave">Meses anteriores</caption>
    <thead><tr><th scope="col">Mes</th><th scope="col">Costo</th><th scope="col">Respuestas</th></tr></thead>
    <tbody><tr><th scope="row">2026-10</th><td>US$ 3,421</td><td>1.284</td></tr></tbody></table></div>
  <div class="adm-tabla-caja"><table class="adm-tabla"><caption class="adm-suave">Filas por tabla</caption>
    <thead><tr><th scope="col">Tabla</th><th scope="col">Filas</th></tr></thead>
    <tbody><tr><th scope="row">Pedidos</th><td>12.480</td></tr></tbody></table></div>`;
}

export function htmlPaginaPanel(pagina: PaginaPanel): string {
  switch (pagina) {
    case 'inicio':
      return `<div class="adm-pila"><h1>Hola, Dueña de Izao</h1><p class="adm-suave">Elige un módulo para empezar.</p></div>
        <div class="adm-rejilla">${modulosVisibles('admin')
          .filter((m) => m.id !== 'inicio')
          .map((m) => `<a href="#" class="adm-atajo"><strong>${m.etiqueta}</strong></a>`)
          .join('')}</div>`;
    case 'pedidos':
      return pedidos();
    case 'productos':
      return productos();
    case 'producto-editar':
      return productoEditar();
    case 'agente':
      return agente();
    case 'metricas':
      return metricas();
    case 'clientes':
      return clientes();
    case 'gastos':
      return gastos();
    case 'garantias':
      return garantias();
    case 'listas':
      return listas();
    case 'tablas-cortas':
      return tablasCortas();
  }
}
