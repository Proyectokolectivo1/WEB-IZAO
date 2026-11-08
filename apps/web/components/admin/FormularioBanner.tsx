'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import {
  ayudaImagenBanner,
  AYUDA_UBICACION,
  ETIQUETA_DESTINO,
  ETIQUETA_POSICION,
  ETIQUETA_UBICACION,
  NOMBRE_PAIS_BANNER,
  SECCIONES_TIENDA,
  objectPositionDe,
  POSICIONES_FOCALES,
  POSICIONES_TEXTO,
  TAMANO_RECOMENDADO,
  TIPOS_DESTINO,
  UBICACIONES,
  type PaisBanner,
  type TipoDestino,
  type Ubicacion,
} from '@/lib/admin/banners/banners';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { CAJA_UNICA } from '@/lib/store/banners';
import { TEXTOS_SUBIDA } from '@/lib/admin/mensaje-subida';
import { CampoSelect, type OpcionSelect } from './CampoSelect';
import { CampoTexto } from './CampoTexto';
import { SelectorImagen, type ImagenInicial } from './SelectorImagen';

export type ProductoElegido = { id: string; slug: string; name: string; brand: string | null; ruta: string | null };
export type VarianteElegible = { id: string; sku: string; etiqueta: string };

export type ValoresBanner = {
  id?: string;
  country_code: PaisBanner;
  placement: Ubicacion;
  category_id: string;
  alt: string;
  title: string;
  subtitle: string;
  cta_label: string;
  text_position: 'left' | 'center' | 'right';
  text_color: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  destino_tipo: TipoDestino;
  destino_producto: ProductoElegido | null;
  destino_variante_id: string;
  destino_categoria_id: string;
  destino_seccion: string;
  destino_url: string;
};

const RETARDO_BUSQUEDA_MS = 300;

/**
 * Editor de un banner: UNA imagen (se convierte a WebP en varios anchos en el servidor y la tienda la adapta a cada
 * pantalla), punto focal opcional, textos, destino con buscador de productos visibles en el país, vigencia y vista
 * previa en escritorio y móvil. Los banners antiguos con imagen móvil propia la conservan hasta que se quite. El
 * servidor vuelve a validar todo y comprueba que el producto o la categoría sigan visibles.
 */
export function FormularioBanner({
  inicial,
  categorias,
  escritorio,
  movil,
  focal,
  variantesIniciales,
  buscarProductos,
  cargarVariantes,
  accion,
  volverHref,
}: {
  inicial: ValoresBanner;
  categorias: readonly OpcionSelect[];
  escritorio: ImagenInicial;
  /** Solo banners antiguos: la imagen móvil propia que se subió antes (los nuevos no la tienen). */
  movil: ImagenInicial;
  /** Punto focal guardado; `disponible: false` si la base aún no tiene las columnas (no se ofrece el selector). */
  focal: { disponible: boolean; x: number; y: number };
  variantesIniciales: readonly VarianteElegible[];
  buscarProductos: (pais: string, q: string) => Promise<ProductoElegido[]>;
  cargarVariantes: (pais: string, productId: string) => Promise<VarianteElegible[]>;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
  volverHref: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const pais = inicial.country_code;

  const [ubicacion, setUbicacion] = useState<Ubicacion>(inicial.placement);
  const [imgDesktop, setImgDesktop] = useState<ImagenInicial>(escritorio);
  const [movilAntigua, setMovilAntigua] = useState<ImagenInicial>(movil);
  const [focalX, setFocalX] = useState(focal.x);
  const [focalY, setFocalY] = useState(focal.y);
  const [alt, setAlt] = useState(inicial.alt);
  const [titulo, setTitulo] = useState(inicial.title);
  const [subtitulo, setSubtitulo] = useState(inicial.subtitle);
  const [boton, setBoton] = useState(inicial.cta_label);
  const [posicion, setPosicion] = useState(inicial.text_position);
  const [color, setColor] = useState(inicial.text_color);
  const [destino, setDestino] = useState<TipoDestino>(inicial.destino_tipo);
  const [producto, setProducto] = useState<ProductoElegido | null>(inicial.destino_producto);
  const [variantes, setVariantes] = useState<readonly VarianteElegible[]>(variantesIniciales);
  const [varianteId, setVarianteId] = useState(inicial.destino_variante_id);

  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ProductoElegido[]>([]);
  const [buscando, iniciarBusqueda] = useTransition();
  const [sinResultados, setSinResultados] = useState(false);
  const pedido = useRef(0);

  // Búsqueda con espera: un servidor llamado por cada letra sería un desperdicio.
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados([]);
      setSinResultados(false);
      return;
    }
    const mio = ++pedido.current;
    const t = setTimeout(() => {
      iniciarBusqueda(async () => {
        const r = await buscarProductos(pais, texto);
        if (mio !== pedido.current) return; // llegó tarde: ya hay una búsqueda más nueva
        setResultados(r);
        setSinResultados(r.length === 0);
      });
    }, RETARDO_BUSQUEDA_MS);
    return () => clearTimeout(t);
  }, [q, pais, buscarProductos]);

  function elegir(p: ProductoElegido) {
    setProducto(p);
    setVarianteId('');
    setQ('');
    setResultados([]);
    setVariantes([]);
    void cargarVariantes(pais, p.id).then(setVariantes);
  }

  const colorTexto = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : 'var(--adm-texto)';
  const alineacion = posicion === 'center' ? 'center' : posicion === 'right' ? 'flex-end' : 'flex-start';
  const textoAlineado = posicion;

  // Proporciones REALES de la tienda por pantalla (celular, tablet, escritorio) para la ubicación elegida.
  const [cajaMovil, cajaTablet, cajaEscritorio] = CAJA_UNICA[ubicacion].cajas;

  const previa = (img: ImagenInicial, razon: number, etiqueta: string, posicion_: string) => (
    <figure style={{ margin: 0 }}>
      <div className="ban-previa" style={{ aspectRatio: String(razon) }}>
        {img?.ruta ? (
          <img src={`/media/${img.ruta}`} alt="" style={{ objectPosition: posicion_ }} />
        ) : (
          <div className="ban-previa-vacia">Sin imagen</div>
        )}
        {titulo || subtitulo || boton ? (
          <div className="ban-previa-texto" style={{ color: colorTexto, alignItems: alineacion, textAlign: textoAlineado }}>
            {subtitulo ? <small>{subtitulo}</small> : null}
            {titulo ? <strong>{titulo}</strong> : null}
            {boton ? <span className="ban-previa-boton">{boton}</span> : null}
          </div>
        ) : null}
      </div>
      <figcaption className="adm-suave adm-chico">{etiqueta}</figcaption>
    </figure>
  );

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      {inicial.id ? <input type="hidden" name="id" value={inicial.id} /> : null}
      <input type="hidden" name="country_code" value={pais} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      <p className="adm-aviso">
        Este banner es solo para <strong>{NOMBRE_PAIS_BANNER[pais]}</strong>. Para otro país, crea otro banner allí.
      </p>

      <fieldset className="adm-fieldset">
        <legend>Dónde se muestra</legend>
        <CampoSelect
          id="placement"
          name="placement"
          etiqueta="Ubicación"
          opciones={UBICACIONES.map((u) => ({ valor: u, etiqueta: ETIQUETA_UBICACION[u] }))}
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value as Ubicacion)}
          ayuda={AYUDA_UBICACION[ubicacion]}
          error={errores.placement}
        />
        {ubicacion === 'category' ? (
          <CampoSelect
            id="category_id"
            name="category_id"
            etiqueta="Categoría"
            vacio="Elige una categoría"
            opciones={categorias}
            defaultValue={inicial.category_id}
            error={errores.category_id}
          />
        ) : null}
        <label className="adm-check">
          <input type="checkbox" name="is_active" defaultChecked={inicial.is_active} />
          Activo (visible en la tienda dentro de su vigencia)
        </label>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Imagen del banner</legend>
        <p className="adm-suave adm-chico">{ayudaImagenBanner(ubicacion)}</p>
        <CampoTexto
          id="alt"
          name="alt"
          etiqueta="Texto alternativo"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          maxLength={200}
          ayuda={TEXTOS_SUBIDA.ayudaAltBanner}
          error={errores.alt}
        />
        <SelectorImagen
          nombre="desktop_media_id"
          etiqueta="Archivo de imagen"
          kind="banner"
          inicial={escritorio}
          altControlado={alt}
          idCampoAlt="alt"
          anchoVista={800}
          alCambiar={setImgDesktop}
          ayuda={`Recomendado ${TAMANO_RECOMENDADO[ubicacion]}.`}
          error={errores.desktop_media_id}
        />
        {movilAntigua ? (
          <div className="ban-movil-antigua">
            <input type="hidden" name="mobile_media_id" value={movilAntigua.id} />
            {movilAntigua.ruta ? <img src={`/media/${movilAntigua.ruta}`} alt="" width={48} height={60} /> : null}
            <p className="adm-chico">
              Este banner conserva una imagen móvil aparte, subida antes. Ya no hace falta: la tienda adapta la imagen principal al celular.
            </p>
            <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setMovilAntigua(null)}>
              Quitar imagen móvil
            </button>
          </div>
        ) : null}
        {errores.mobile_media_id ? <p className="adm-error-campo">{errores.mobile_media_id}</p> : null}
      </fieldset>

      {focal.disponible ? (
        <fieldset className="adm-fieldset ban-focal">
          <legend>Zona importante de la imagen (opcional)</legend>
          <p className="adm-suave adm-chico">
            En pantallas angostas la imagen se recorta a los lados. Marca la zona que siempre debe verse; si no eliges, se usa el centro.
          </p>
          <input type="hidden" name="focal_x" value={focalX} />
          <input type="hidden" name="focal_y" value={focalY} />
          <div className="ban-focal-rejilla" role="radiogroup" aria-label="Zona importante de la imagen">
            {POSICIONES_FOCALES.map((p) => {
              const activa = p.x === focalX && p.y === focalY;
              return (
                <button
                  key={`${p.x}-${p.y}`}
                  type="button"
                  role="radio"
                  aria-checked={activa}
                  aria-label={p.etiqueta}
                  title={p.etiqueta}
                  className="ban-focal-celda"
                  data-activa={activa ? 'true' : undefined}
                  onClick={() => {
                    setFocalX(p.x);
                    setFocalY(p.y);
                  }}
                />
              );
            })}
          </div>
          {errores.focal_x || errores.focal_y ? <p className="adm-error-campo">{errores.focal_x ?? errores.focal_y}</p> : null}
        </fieldset>
      ) : null}

      <fieldset className="adm-fieldset">
        <legend>Texto sobre la imagen (opcional)</legend>
        <div className="ban-dos">
          <CampoTexto id="title" name="title" etiqueta="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} error={errores.title} />
          <CampoTexto id="subtitle" name="subtitle" etiqueta="Subtítulo" value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} maxLength={200} error={errores.subtitle} />
          <CampoTexto id="cta_label" name="cta_label" etiqueta="Texto del botón" value={boton} onChange={(e) => setBoton(e.target.value)} maxLength={40} error={errores.cta_label} />
          <CampoSelect
            id="text_position"
            name="text_position"
            etiqueta="Posición del texto"
            opciones={POSICIONES_TEXTO.map((p) => ({ valor: p, etiqueta: ETIQUETA_POSICION[p] }))}
            value={posicion}
            onChange={(e) => setPosicion(e.target.value as typeof posicion)}
          />
          <CampoTexto
            id="text_color"
            name="text_color"
            etiqueta="Color del texto (opcional)"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#382E2B"
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            ayuda="Vacío = el color de texto de la tienda. Verifica que se lea sobre la imagen."
            error={errores.text_color}
          />
        </div>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Adónde lleva al hacer clic</legend>
        <CampoSelect
          id="destino_tipo"
          name="destino_tipo"
          etiqueta="Destino"
          opciones={TIPOS_DESTINO.map((t) => ({ valor: t, etiqueta: ETIQUETA_DESTINO[t] }))}
          value={destino}
          onChange={(e) => setDestino(e.target.value as TipoDestino)}
          error={errores.destino_tipo}
        />

        {destino === 'producto' ? (
          <div className="adm-pila">
            <input type="hidden" name="destino_producto_id" value={producto?.id ?? ''} />
            <input type="hidden" name="destino_variante_id" value={varianteId} />
            {producto ? (
              <div className="ban-elegido">
                {producto.ruta ? <img src={`/media/${producto.ruta}`} alt="" width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : null}
                <span>
                  <strong>{producto.name}</strong>
                  {producto.brand ? <span className="adm-suave"> · {producto.brand}</span> : null}
                </span>
                <button type="button" className="adm-boton adm-boton-secundario" onClick={() => setProducto(null)}>
                  Cambiar producto
                </button>
              </div>
            ) : (
              <div className="adm-campo">
                <label htmlFor="buscar-producto" className="adm-etiqueta">
                  Buscar producto visible en {NOMBRE_PAIS_BANNER[pais]}
                </label>
                <input
                  id="buscar-producto"
                  type="search"
                  className="adm-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Escribe al menos 2 letras del nombre"
                  autoComplete="off"
                  aria-describedby="buscar-producto-estado"
                />
                <p id="buscar-producto-estado" className="adm-suave adm-chico" role="status">
                  {buscando ? 'Buscando…' : sinResultados ? 'No hay productos visibles con ese nombre en este país.' : ''}
                </p>
                {resultados.length > 0 ? (
                  <ul className="ban-resultados">
                    {resultados.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="ban-resultado" onClick={() => elegir(p)}>
                          {p.ruta ? <img src={`/media/${p.ruta}`} alt="" /> : <span aria-hidden="true" style={{ width: '2.5rem' }} />}
                          <span>
                            <strong>{p.name}</strong>
                            {p.brand ? <span className="adm-suave"> · {p.brand}</span> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
            {errores.destino_producto_id ? <p className="adm-error-campo">{errores.destino_producto_id}</p> : null}
            {producto ? (
              <div className="adm-campo">
                <label htmlFor="variante-destino" className="adm-etiqueta">
                  Variante (opcional)
                </label>
                <select id="variante-destino" className="adm-input" value={varianteId} onChange={(e) => setVarianteId(e.target.value)}>
                  <option value="">Sin variante: la ficha abre con la presentación por defecto</option>
                  {variantes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.etiqueta}
                    </option>
                  ))}
                </select>
                {errores.destino_variante_id ? <p className="adm-error-campo">{errores.destino_variante_id}</p> : null}
                <p className="adm-suave adm-chico">El cliente llega a la ficha del producto, lista para agregar al carrito.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {destino === 'categoria' ? (
          <CampoSelect
            id="destino_categoria_id"
            name="destino_categoria_id"
            etiqueta="Categoría"
            vacio="Elige una categoría"
            opciones={categorias}
            defaultValue={inicial.destino_categoria_id}
            error={errores.destino_categoria_id}
          />
        ) : null}

        {destino === 'seccion' ? (
          <CampoSelect
            id="destino_seccion"
            name="destino_seccion"
            etiqueta="Sección"
            vacio="Elige una sección"
            opciones={SECCIONES_TIENDA.map((s) => ({ valor: s.clave, etiqueta: s.etiqueta }))}
            defaultValue={inicial.destino_seccion}
            error={errores.destino_seccion}
            ayuda="La página baja sola hasta esa parte (por ejemplo, las reseñas del inicio o la lista de productos del catálogo)."
          />
        ) : null}

        {destino === 'url' ? (
          <CampoTexto
            id="destino_url"
            name="destino_url"
            etiqueta="Dirección"
            defaultValue={inicial.destino_url}
            placeholder={`/${pais.toLowerCase()}/catalogo`}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            ayuda={`Una ruta de la tienda que empiece por / (por ejemplo /${pais.toLowerCase()}/coleccion/hot-sale) o una dirección https://.`}
            error={errores.destino_url}
          />
        ) : null}
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Vigencia (hora de Colombia, opcional)</legend>
        <div className="ban-dos">
          <CampoTexto id="starts_at" name="starts_at" type="datetime-local" etiqueta="Empieza" defaultValue={inicial.starts_at} error={errores.starts_at} />
          <CampoTexto id="ends_at" name="ends_at" type="datetime-local" etiqueta="Termina" defaultValue={inicial.ends_at} error={errores.ends_at} />
        </div>
        <p className="adm-suave adm-chico">Sin fechas, el banner se muestra mientras esté activo.</p>
      </fieldset>

      <section aria-labelledby="h-previa-banner">
        <h3 id="h-previa-banner">Vista previa</h3>
        <div className="ban-previas">
          {previa(imgDesktop, cajaEscritorio!.ratio, 'Escritorio', objectPositionDe(focalX, focalY))}
          {previa(imgDesktop, cajaTablet!.ratio, 'Tablet (recorte a los lados)', objectPositionDe(focalX, focalY))}
          {movilAntigua
            ? previa(movilAntigua, 4 / 5, 'Celular (imagen aparte)', '50% 50%')
            : previa(imgDesktop, cajaMovil!.ratio, 'Celular (recorte a los lados)', objectPositionDe(focalX, focalY))}
        </div>
      </section>

      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar banner'}
        </button>
        <Link href={volverHref} className="adm-enlace-boton adm-boton-secundario">
          Volver
        </Link>
      </div>
    </form>
  );
}
