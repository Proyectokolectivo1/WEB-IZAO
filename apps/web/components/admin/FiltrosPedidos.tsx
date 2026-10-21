import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_METODO_PAGO } from '@/lib/admin/pedidos/etiquetas';
import { METODOS_PEDIDO, PAISES_PEDIDO, type FiltrosPedido } from '@/lib/admin/pedidos/filtros';
import { ORDER_STATUSES } from '@izao/core/order-state';
import { CampoSelect } from './CampoSelect';

export const ID_BUSQUEDA_PEDIDOS = 'filtro-q';

/** Filtros de la lista de pedidos por GET: todo queda en la URL (compartible y sin JavaScript). */
export function FiltrosPedidos({ filtros }: { filtros: FiltrosPedido }) {
  return (
    <form className="adm-busqueda adm-filtros" role="search" method="get" action="/admin/pedidos">
      <div className="adm-campo">
        <label htmlFor={ID_BUSQUEDA_PEDIDOS} className="adm-etiqueta">
          Número de pedido o celular
        </label>
        <input
          id={ID_BUSQUEDA_PEDIDOS}
          name="q"
          type="search"
          className="adm-input"
          defaultValue={filtros.q}
          maxLength={100}
          autoComplete="off"
          inputMode="search"
        />
      </div>
      <CampoSelect
        id="filtro-estado"
        name="estado"
        etiqueta="Estado"
        vacio="Todos"
        defaultValue={filtros.estado}
        opciones={ORDER_STATUSES.map((s) => ({ valor: s, etiqueta: ETIQUETA_ESTADO_PEDIDO[s] ?? s }))}
      />
      <CampoSelect
        id="filtro-pais"
        name="pais"
        etiqueta="País"
        vacio="Todos"
        defaultValue={filtros.pais}
        opciones={PAISES_PEDIDO.map((p) => ({ valor: p, etiqueta: p === 'CO' ? 'Colombia' : 'Ecuador' }))}
      />
      <CampoSelect
        id="filtro-metodo"
        name="metodo"
        etiqueta="Método de pago"
        vacio="Todos"
        defaultValue={filtros.metodo}
        opciones={METODOS_PEDIDO.map((m) => ({ valor: m, etiqueta: ETIQUETA_METODO_PAGO[m] ?? m }))}
      />
      <div className="adm-campo">
        <label htmlFor="filtro-desde" className="adm-etiqueta">
          Desde
        </label>
        <input id="filtro-desde" name="desde" type="date" className="adm-input" defaultValue={filtros.desde} />
      </div>
      <div className="adm-campo">
        <label htmlFor="filtro-hasta" className="adm-etiqueta">
          Hasta
        </label>
        <input id="filtro-hasta" name="hasta" type="date" className="adm-input" defaultValue={filtros.hasta} />
      </div>
      <button type="submit" className="adm-boton">
        Filtrar
      </button>
      <a className="adm-enlace-boton adm-boton-secundario" href="/admin/pedidos">
        Limpiar
      </a>
    </form>
  );
}
