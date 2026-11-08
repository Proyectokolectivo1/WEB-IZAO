'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Icono, clasesBoton } from '@izao/ui';
import { VIGENCIA, pedirJson } from '@/lib/store/fetcher';
import { formatearPrecio } from '@/lib/store/pais';
import { T } from '@/lib/store/textos';
import { TC, textoBotonPago } from '@/lib/store/textos-checkout';
import { crearPedido } from '@/lib/store/checkout/adaptador';
import { mensajeCodigo } from '@/lib/store/carrito/contrato';
import type { ErrorCheckout } from '@/lib/store/checkout/contrato';
import {
  FORMULARIO_VACIO,
  ORDEN_CAMPOS,
  combinarPolitica,
  erroresDelServidor,
  metodoPorDefecto,
  resumenCheckout,
  resumenConServidor,
} from '@/lib/store/checkout/logica';
import type {
  CampoFormulario,
  ConfigCheckout,
  ErroresFormulario,
  MetodoCheckout,
  OpcionGeo,
  PoliticaLegal,
  ValoresFormulario,
} from '@/lib/store/checkout/tipos';
import { useCarritoAcciones, useCarritoLineas } from '../carrito/CarritoProvider';
import { useVistaPrevia } from '../carrito/useVistaPrevia';
import { Campo, CLASE_CONTROL, propsControl } from './Campo';
import { MetodosPago } from './MetodosPago';
import { ResumenPedido } from './ResumenPedido';

/**
 * La validación usa las reglas de `@izao/core/schemas` (zod): se baja en cuanto la persona toca el formulario
 * (o al enviar, si aún no estaba), no con el JS inicial de la página.
 */
const cargarValidacion = () => import('@/lib/store/checkout/validacion');

const CAMPOS_BORRADOR: readonly CampoFormulario[] = [
  'nombre',
  'apellido',
  'celular',
  'correo',
  'tipoDocumento',
  'numeroDocumento',
  'regionId',
  'ciudadId',
  'barrio',
  'direccion',
  'complemento',
  'indicaciones',
];

const claveBorrador = (pais: string) => `izao:checkout:${pais}`;

function leerBorrador(pais: string): Partial<ValoresFormulario> {
  try {
    const crudo = window.sessionStorage.getItem(claveBorrador(pais));
    const obj: unknown = crudo ? JSON.parse(crudo) : null;
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, string> = {};
    for (const c of CAMPOS_BORRADOR) {
      const v = (obj as Record<string, unknown>)[c];
      if (typeof v === 'string') out[c] = v.slice(0, 500);
    }
    return out as Partial<ValoresFormulario>;
  } catch {
    return {};
  }
}

function guardarBorrador(pais: string, v: ValoresFormulario): void {
  try {
    const out: Record<string, string> = {};
    for (const c of CAMPOS_BORRADOR) out[c] = String(v[c]);
    window.sessionStorage.setItem(claveBorrador(pais), JSON.stringify(out));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

function borrarBorrador(pais: string): void {
  try {
    window.sessionStorage.removeItem(claveBorrador(pais));
    window.sessionStorage.removeItem(`izao:codigo:${pais}`);
  } catch {
    /* nada */
  }
}

type EstadoCiudades = 'inactivo' | 'cargando' | 'listo' | 'error';

function mensajeError(e: ErrorCheckout | 'red' | 'invalida'): string {
  const E = TC.checkout.erroresServidor;
  if (e === 'red') return E.red;
  if (e === 'invalida') return E.generico;
  switch (e.error) {
    case 'RATE_LIMITED':
      return E.demasiados;
    case 'STOCK_CHANGED':
      return E.stock;
    case 'METHOD_UNAVAILABLE':
      return E.metodo;
    case 'CODE_REJECTED':
      return `${E.codigo} ${mensajeCodigo(e.reason ?? null)}`;
    case 'SHIPPING_LOCATION_INVALID':
      return E.ubicacion;
    case 'CHECKOUT_IN_PROGRESS':
      return E.enProceso;
    case 'IDEMPOTENCY_CONFLICT':
      return E.conflicto;
    case 'DATA_POLICY_OUTDATED':
      return E.politica;
    case 'UNAVAILABLE':
      return E.sinServicio;
    case 'INVALID_INPUT':
      return E.revisa;
    default:
      return E.generico;
  }
}

/** `esqueleto`: caja de carga armada por el servidor (ver `PaginaCarrito`); no suma JavaScript. */
export function FormularioCheckout({ config, esqueleto }: { config: ConfigCheckout; esqueleto?: ReactNode }) {
  const pais = config.pais;
  const router = useRouter();
  const { lineas, listo } = useCarritoLineas();
  const { reemplazar } = useCarritoAcciones();
  const [valores, setValores] = useState<ValoresFormulario>({ ...FORMULARIO_VACIO, metodo: metodoPorDefecto(config) });
  const vista = useVistaPrevia(valores.metodo || null);
  const [errores, setErrores] = useState<ErroresFormulario>({});
  const [intentado, setIntentado] = useState(false);
  const [ciudades, setCiudades] = useState<OpcionGeo[]>([]);
  const [estadoCiudades, setEstadoCiudades] = useState<EstadoCiudades>('inactivo');
  const [enviando, setEnviando] = useState(false);
  const [terminado, setTerminado] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [resumenAbierto, setResumenAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Páginas legales y versión de la política que se muestran; cambian si el servidor avisa que la política se actualizó.
  const [legal, setLegal] = useState<PoliticaLegal>({ terminos: config.terminos, datos: config.datos, version: config.versionPoliticaDatos });
  const [politicaNueva, setPoliticaNueva] = useState(false);
  /** Última región pedida: si llega la respuesta de otra anterior, se descarta. */
  const regionPedida = useRef('');
  const resumenErrores = useRef<HTMLDivElement>(null);
  const bannerError = useRef<HTMLDivElement>(null);
  const claveIdem = useRef<string | null>(null);
  const hidratado = useRef(false);

  const precio = useCallback((v: bigint | string) => formatearPrecio(v, pais), [pais]);

  // Borrador de la sesión (sin método ni consentimientos) y método inicial.
  useEffect(() => {
    const b = leerBorrador(pais);
    setValores((v) => ({ ...v, ...b }));
    hidratado.current = true;
  }, [pais]);

  useEffect(() => {
    if (hidratado.current) guardarBorrador(pais, valores);
  }, [pais, valores]);

  const cargarCiudades = useCallback(
    async (regionId: string) => {
      regionPedida.current = regionId;
      if (!regionId) {
        setCiudades([]);
        setEstadoCiudades('inactivo');
        return;
      }
      setEstadoCiudades('cargando');
      try {
        // Cacheado en el fetcher (1 h por región) y compartido si dos pedidos coinciden.
        const datos = await pedirJson<{ ciudades?: OpcionGeo[] }>(`/${pais}/checkout/ciudades?region=${encodeURIComponent(regionId)}`, VIGENCIA.ciudades);
        if (regionPedida.current !== regionId) return;
        setCiudades(Array.isArray(datos.ciudades) ? datos.ciudades : []);
        setEstadoCiudades('listo');
      } catch {
        if (regionPedida.current !== regionId) return;
        setCiudades([]);
        setEstadoCiudades('error');
      }
    },
    [pais],
  );

  // Si el borrador trae región, se traen sus ciudades.
  useEffect(() => {
    void cargarCiudades(valores.regionId);
  }, [valores.regionId, cargarCiudades]);

  const actualizar = useCallback(<K extends CampoFormulario>(campo: K, valor: ValoresFormulario[K]) => {
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((e) => {
      if (!e[campo]) return e;
      const resto = { ...e };
      delete resto[campo];
      return resto;
    });
  }, []);

  const metodoElegido: MetodoCheckout | null = valores.metodo || null;
  const descuentoServidor = useMemo(
    () => (vista.codigoAplicado && vista.descuento > 0n ? { codigo: vista.codigoAplicado, monto: vista.descuento.toString() } : null),
    [vista.codigoAplicado, vista.descuento],
  );
  const totalesServidor = vista.totales?.llave === vista.llaveActual ? vista.totales.datos : null;
  const resumen = useMemo(() => {
    const local = resumenCheckout(lineas, config, metodoElegido, descuentoServidor, new Date());
    const r = totalesServidor ? resumenConServidor(local, totalesServidor, vista.subtotal, vista.descuento, metodoElegido) : local;
    return vista.codigoRetirado ? { ...r, codigoRetirado: true } : r;
  }, [lineas, config, metodoElegido, descuentoServidor, totalesServidor, vista.subtotal, vista.descuento, vista.codigoRetirado]);

  // Método por defecto: el primero del panel que esté disponible; si el elegido deja de estarlo, se cambia.
  useEffect(() => {
    if (config.metodos.length === 0 || lineas.length === 0) return;
    const disponible = (m: MetodoCheckout | '') => (m ? resumen.disponibilidad[m as keyof typeof resumen.disponibilidad]?.disponible !== false : false);
    if (valores.metodo && disponible(valores.metodo)) return;
    const primero = config.metodos.find((m) => disponible(m.method));
    setValores((v) => ({ ...v, metodo: primero ? primero.method : '' }));
  }, [config.metodos, lineas.length, resumen, valores.metodo]);

  const esContraEntrega = valores.metodo === 'cod';

  // Aviso de ajustes del servidor (precio o existencias distintas).
  useEffect(() => {
    if (vista.ajuste) setAviso(vista.ajuste === 'agotado' ? TC.checkout.agotadoQuitado : TC.checkout.ajusteServidor);
  }, [vista.ajuste]);

  /**
   * El servidor dijo que la política de datos cambió: se toma su versión vigente, se recargan las páginas legales, se
   * desmarca la aceptación y se pide aceptar de nuevo. El bolso y los datos del formulario no se tocan.
   */
  async function alinearPolitica(versionServidor: string | null) {
    setValores((v) => ({ ...v, terminos: false }));
    setPoliticaNueva(true);
    setLegal((l) => combinarPolitica(l, versionServidor, null));
    try {
      const nueva = await pedirJson<Partial<PoliticaLegal>>(`/${pais}/checkout/politica`, { init: { cache: 'no-store' } });
      setLegal((l) => combinarPolitica(l, versionServidor, nueva));
    } catch {
      /* sin red: se conserva lo que ya había; el próximo envío vuelve a validar en el servidor */
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando || terminado) return;
    setIntentado(true);
    setErrorGeneral(null);
    const { validarFormulario, armarCuerpo } = await cargarValidacion();
    const errs = validarFormulario(valores, config);
    if (Object.keys(errs).length > 0) {
      setErrores(errs);
      requestAnimationFrame(() => resumenErrores.current?.focus());
      return;
    }
    if (lineas.length === 0 || !valores.metodo) return;
    if (!resumen.metodoDisponible) {
      setErrorGeneral(TC.checkout.erroresServidor.metodo);
      requestAnimationFrame(() => bannerError.current?.focus());
      return;
    }
    setEnviando(true);
    claveIdem.current ??= crypto.randomUUID();
    const cuerpo = armarCuerpo(valores, { ...config, versionPoliticaDatos: legal.version }, lineas, vista.codigoAplicado, claveIdem.current);
    const r = await crearPedido(cuerpo);

    if (r.tipo === 'creado') {
      setTerminado(true);
      borrarBorrador(pais);
      reemplazar([]);
      // El cobro en la pasarela lo muestra la página del pedido cuando exista su enlace.
      router.push(`/${pais}/pedido/${r.pedido.public_token}`);
      return;
    }

    setEnviando(false);
    if (r.tipo === 'error') {
      const { error } = r;
      // Rechazo definitivo: la próxima vez es otro intento con otra clave de idempotencia (salvo «en proceso»).
      if (error.error !== 'CHECKOUT_IN_PROGRESS') claveIdem.current = null;
      setErrores(erroresDelServidor(error.issues));
      if (error.error === 'SHIPPING_LOCATION_INVALID') setErrores({ ciudadId: TC.checkout.erroresServidor.ubicacion });
      if (error.error === 'STOCK_CHANGED' && error.lines) {
        const cambios = error.lines;
        reemplazar(
          lineas
            .map((l) => {
              const s = cambios.find((x) => x.variant_id === l.variantId);
              return s ? { ...l, cantidad: Math.min(l.cantidad, s.max_quantity) } : l;
            })
            .filter((l) => l.cantidad > 0),
        );
      }
      if (error.error === 'CODE_REJECTED') vista.quitarCodigo();
      if (error.error === 'DATA_POLICY_OUTDATED') void alinearPolitica(error.current_version ?? null);
      setIntentado(true);
      setErrorGeneral(mensajeError(error));
    } else {
      // Sin respuesta clara: se conserva la clave para que un reintento no duplique el pedido.
      setErrorGeneral(mensajeError(r.tipo === 'red' ? 'red' : 'invalida'));
    }
    requestAnimationFrame(() => bannerError.current?.focus());
  }

  // ---- Estados vacíos -------------------------------------------------------------------------------------------

  const vacio = (
    <>
      <Icono nombre="bolso" tamano={32} />
      <p className="font-display text-3xl">{TC.checkout.vacioTitulo}</p>
      <p className="max-w-md text-ink/80">{TC.checkout.vacioTexto}</p>
      <Link href={`/${pais}/catalogo`} className={clasesBoton({ variante: 'secundario' })}>
        {T.carrito.verAromas}
      </Link>
    </>
  );

  if (!listo) {
    // Ver `PaginaCarrito`: con el bolso vacío el estado vacío sale en el primer pintado (script en línea + CSS), sin esperar a hidratar.
    return (
      <div className="min-h-[40vh]" aria-busy="true">
        <p className="solo-lectores bolso-cargando" role="status">
          {TC.carrito.cargando}
        </p>
        <div className="bolso-previo flex-col items-start gap-5 py-6">{vacio}</div>
        {esqueleto}
      </div>
    );
  }

  if (terminado) {
    return (
      <div className="flex min-h-[40vh] items-center" role="status">
        <p className="font-display text-3xl">{TC.checkout.boton.redirigiendo}</p>
      </div>
    );
  }

  if (lineas.length === 0) {
    return <div className="flex min-h-[40vh] flex-col items-start gap-5 py-6">{vacio}</div>;
  }

  // ---- Formulario -----------------------------------------------------------------------------------------------

  const campo = (c: CampoFormulario) => errores[c];
  const listaErrores = ORDEN_CAMPOS.filter((c) => errores[c]);
  const etiquetaDe = (c: CampoFormulario): string => {
    const m: Partial<Record<CampoFormulario, string>> = {
      nombre: TC.checkout.campos.nombre,
      apellido: TC.checkout.campos.apellido,
      celular: TC.checkout.campos.celular,
      correo: TC.checkout.campos.correo,
      tipoDocumento: TC.checkout.campos.tipoDocumento,
      numeroDocumento: TC.checkout.campos.numeroDocumento,
      regionId: TC.checkout.campos.region[pais],
      ciudadId: TC.checkout.campos.ciudad[pais],
      direccion: TC.checkout.campos.direccion,
      metodo: TC.checkout.pasos.pago,
      terminos: TC.checkout.terminos.etiqueta,
      whatsapp: TC.checkout.whatsappAutorizo,
    };
    return m[c] ?? c;
  };
  const idDe = (c: CampoFormulario): string => (c === 'metodo' ? 'metodo-lista' : `campo-${c}`);

  const totalTexto = precio(resumen.total);
  const sinMetodoDisponible = !resumen.metodoDisponible;

  return (
    <form onSubmit={enviar} onFocusCapture={() => void cargarValidacion()} noValidate className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-16 xl:grid-cols-[minmax(0,1fr)_28rem]">
      {/* Resumen: desplegable en móvil, fijo en escritorio. Va primero en el DOM para verlo antes de pagar. */}
      <aside aria-labelledby="titulo-resumen" className="lg:order-2 lg:h-fit lg:sticky lg:top-28">
        <h2 id="titulo-resumen" className="solo-lectores">
          {TC.resumen.titulo}
        </h2>
        <button
          type="button"
          onClick={() => setResumenAbierto((a) => !a)}
          aria-expanded={resumenAbierto}
          aria-controls="panel-resumen"
          className="bloque-calido-acento flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left lg:hidden"
        >
          <span className="flex items-center gap-2">
            <Icono nombre={resumenAbierto ? 'chevronArriba' : 'chevronAbajo'} tamano={18} />
            {resumenAbierto ? TC.resumen.ocultarResumen : TC.resumen.verResumen}
          </span>
          <span className="font-display text-2xl tabular-nums">{totalTexto}</span>
        </button>
        <div id="panel-resumen" className={`${resumenAbierto ? 'block' : 'hidden'} bloque-calido-acento mt-3 p-5 sombra-tierna lg:mt-0 lg:block lg:p-7`}>
          <p className="etiqueta hidden pb-4 lg:block">{TC.resumen.titulo}</p>
          <ResumenPedido
            lineas={lineas}
            resumen={resumen}
            esContraEntrega={esContraEntrega}
            precio={precio}
            codigo={vista.codigo}
            revisando={vista.revisando}
            onAplicar={vista.aplicar}
            onQuitar={vista.quitarCodigo}
          />
        </div>
      </aside>

      <div className="flex flex-col gap-6 lg:order-1">
        {aviso ? (
          <p role="status" className="rounded-card bg-surface px-4 py-3 text-[0.9375rem]">
            {aviso}
          </p>
        ) : null}

        {intentado && listaErrores.length > 0 ? (
          <div ref={resumenErrores} tabIndex={-1} role="alert" className="rounded-card border border-danger p-4 outline-none">
            <p className="font-semibold">{TC.checkout.errores.resumen(listaErrores.length)}</p>
            <ul className="list-disc pl-5 pt-2 text-[0.9375rem]">
              {listaErrores.map((c) => (
                <li key={c}>
                  <a href={`#${idDe(c)}`} className="underline underline-offset-4">
                    {etiquetaDe(c)}
                  </a>
                  {': '}
                  {errores[c]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Contacto */}
        <section aria-labelledby="paso-contacto" className="bloque-calido p-5 sm:p-8">
          <h2 id="paso-contacto" className="text-3xl">
            {TC.checkout.pasos.contacto}
          </h2>
          <p className="pt-2 text-[0.9375rem] text-ink/80">{TC.checkout.ayudaContacto}</p>
          <div className="grid gap-5 pt-6 sm:grid-cols-2">
            <Campo id="campo-nombre" etiqueta={TC.checkout.campos.nombre} error={campo('nombre')}>
              <input
                {...propsControl('campo-nombre', campo('nombre'))}
                name="nombre"
                value={valores.nombre}
                onChange={(e) => actualizar('nombre', e.target.value)}
                autoComplete="given-name"
                maxLength={120}
                className={CLASE_CONTROL}
              />
            </Campo>
            <Campo id="campo-apellido" etiqueta={TC.checkout.campos.apellido} error={campo('apellido')}>
              <input
                {...propsControl('campo-apellido', campo('apellido'))}
                name="apellido"
                value={valores.apellido}
                onChange={(e) => actualizar('apellido', e.target.value)}
                autoComplete="family-name"
                maxLength={120}
                className={CLASE_CONTROL}
              />
            </Campo>
            <Campo id="campo-celular" etiqueta={TC.checkout.campos.celular} error={campo('celular')}>
              <input
                {...propsControl('campo-celular', campo('celular'))}
                name="celular"
                type="tel"
                inputMode="tel"
                value={valores.celular}
                onChange={(e) => actualizar('celular', e.target.value)}
                autoComplete="tel-national"
                maxLength={30}
                className={CLASE_CONTROL}
              />
            </Campo>
            <Campo id="campo-correo" etiqueta={TC.checkout.campos.correo} error={campo('correo')}>
              <input
                {...propsControl('campo-correo', campo('correo'))}
                name="correo"
                type="email"
                inputMode="email"
                value={valores.correo}
                onChange={(e) => actualizar('correo', e.target.value)}
                autoComplete="email"
                maxLength={254}
                spellCheck={false}
                className={CLASE_CONTROL}
              />
            </Campo>
          </div>
        </section>

        {/* Documento */}
        <section aria-labelledby="paso-documento" className="bloque-calido p-5 sm:p-8">
          <h2 id="paso-documento" className="text-3xl">
            {TC.checkout.pasos.documento}
          </h2>
          <p className="pt-2 text-[0.9375rem] text-ink/80">{TC.checkout.ayudaDocumento}</p>
          <div className="grid gap-5 pt-6 sm:grid-cols-2">
            <Campo id="campo-tipoDocumento" etiqueta={TC.checkout.campos.tipoDocumento} error={campo('tipoDocumento')}>
              <select
                {...propsControl('campo-tipoDocumento', campo('tipoDocumento'))}
                name="tipoDocumento"
                value={valores.tipoDocumento}
                onChange={(e) => actualizar('tipoDocumento', e.target.value)}
                className={CLASE_CONTROL}
              >
                <option value="">{TC.checkout.campos.tipoDocumento}</option>
                {config.tiposDocumento.map((t) => (
                  <option key={t} value={t}>
                    {TC.checkout.documentos[t] ?? t}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="campo-numeroDocumento" etiqueta={TC.checkout.campos.numeroDocumento} error={campo('numeroDocumento')}>
              <input
                {...propsControl('campo-numeroDocumento', campo('numeroDocumento'))}
                name="numeroDocumento"
                value={valores.numeroDocumento}
                onChange={(e) => actualizar('numeroDocumento', e.target.value)}
                autoComplete="off"
                maxLength={40}
                className={CLASE_CONTROL}
              />
            </Campo>
          </div>
        </section>

        {/* Entrega */}
        <section aria-labelledby="paso-entrega" className="bloque-calido p-5 sm:p-8">
          <h2 id="paso-entrega" className="text-3xl">
            {TC.checkout.pasos.entrega}
          </h2>
          <div className="grid gap-5 pt-6 sm:grid-cols-2">
            <Campo id="campo-regionId" etiqueta={TC.checkout.campos.region[pais]} error={campo('regionId')}>
              <select
                {...propsControl('campo-regionId', campo('regionId'))}
                name="region"
                value={valores.regionId}
                onChange={(e) => {
                  actualizar('regionId', e.target.value);
                  actualizar('ciudadId', '');
                }}
                autoComplete="address-level1"
                className={CLASE_CONTROL}
              >
                <option value="">{TC.checkout.seleccione[pais]}</option>
                {config.regiones.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              id="campo-ciudadId"
              etiqueta={TC.checkout.campos.ciudad[pais]}
              error={campo('ciudadId')}
              ayuda={estadoCiudades === 'cargando' ? TC.checkout.cargandoCiudades : undefined}
            >
              <select
                {...propsControl('campo-ciudadId', campo('ciudadId'), estadoCiudades === 'cargando' ? 'x' : undefined)}
                name="ciudad"
                value={valores.ciudadId}
                onChange={(e) => actualizar('ciudadId', e.target.value)}
                disabled={!valores.regionId || estadoCiudades === 'cargando'}
                autoComplete="address-level2"
                className={CLASE_CONTROL}
              >
                <option value="">{valores.regionId ? TC.checkout.seleccioneCiudad[pais] : TC.checkout.primeroRegion[pais]}</option>
                {ciudades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {estadoCiudades === 'error' ? (
                <p className="pt-1.5 text-[0.875rem] text-danger" role="alert">
                  {TC.checkout.errorCiudades}{' '}
                  <button type="button" className="underline underline-offset-4" onClick={() => void cargarCiudades(valores.regionId)}>
                    {TC.checkout.reintentar}
                  </button>
                </p>
              ) : null}
            </Campo>
            <Campo id="campo-barrio" etiqueta={TC.checkout.campos.barrio}>
              <input
                {...propsControl('campo-barrio')}
                name="barrio"
                value={valores.barrio}
                onChange={(e) => actualizar('barrio', e.target.value)}
                autoComplete="off"
                maxLength={120}
                className={CLASE_CONTROL}
              />
            </Campo>
            <Campo id="campo-direccion" etiqueta={TC.checkout.campos.direccion} error={campo('direccion')}>
              <input
                {...propsControl('campo-direccion', campo('direccion'))}
                name="direccion"
                value={valores.direccion}
                onChange={(e) => actualizar('direccion', e.target.value)}
                autoComplete="address-line1"
                maxLength={200}
                className={CLASE_CONTROL}
              />
            </Campo>
            <Campo id="campo-complemento" etiqueta={TC.checkout.campos.complemento}>
              <input
                {...propsControl('campo-complemento')}
                name="complemento"
                value={valores.complemento}
                onChange={(e) => actualizar('complemento', e.target.value)}
                autoComplete="address-line2"
                maxLength={120}
                className={CLASE_CONTROL}
              />
            </Campo>
            <Campo id="campo-indicaciones" etiqueta={TC.checkout.campos.indicaciones} className="sm:col-span-2">
              <textarea
                {...propsControl('campo-indicaciones')}
                name="indicaciones"
                rows={3}
                value={valores.indicaciones}
                onChange={(e) => actualizar('indicaciones', e.target.value)}
                maxLength={500}
                className={`${CLASE_CONTROL} py-3`}
              />
            </Campo>
          </div>
        </section>

        {/* Pago */}
        <section aria-labelledby="paso-pago" className="bloque-calido p-5 sm:p-8">
          <h2 id="paso-pago" className="text-3xl">
            {TC.checkout.pasos.pago}
          </h2>
          <div className="pt-6" id="metodo-lista">
            <MetodosPago
              config={config}
              resumen={resumen}
              valor={valores.metodo}
              error={campo('metodo')}
              onElegir={(m) => actualizar('metodo', m)}
              precio={precio}
            />
          </div>
        </section>

        {/* Confirmar */}
        <section aria-labelledby="paso-confirmar" className="bloque-calido-acento p-5 sm:p-8">
          <h2 id="paso-confirmar" className="text-3xl">
            {TC.checkout.pasos.confirmar}
          </h2>
          <div className="flex flex-col gap-4 pt-6">
            <div>
              <label className="flex cursor-pointer items-start gap-3" htmlFor="campo-terminos">
                <input
                  {...propsControl('campo-terminos', campo('terminos'))}
                  type="checkbox"
                  checked={valores.terminos}
                  onChange={(e) => actualizar('terminos', e.target.checked)}
                  className="mt-0.5 size-6 shrink-0 accent-ink"
                />
                <span className="text-[0.9375rem]">
                  {legal.terminos && legal.datos ? (
                    <>
                      {TC.checkout.terminos.antes}
                      <a href={`/${pais}/pagina/${legal.terminos.slug}`} target="_blank" rel="noopener" className="underline underline-offset-4">
                        {TC.checkout.terminos.terminos}
                        <span className="solo-lectores"> {TC.checkout.terminos.nuevaPestana}</span>
                      </a>
                      {TC.checkout.terminos.medio}
                      <a href={`/${pais}/pagina/${legal.datos.slug}`} target="_blank" rel="noopener" className="underline underline-offset-4">
                        {TC.checkout.terminos.datos}
                        <span className="solo-lectores"> {TC.checkout.terminos.nuevaPestana}</span>
                      </a>
                      .
                    </>
                  ) : (
                    TC.checkout.terminos.sinEnlaces
                  )}
                </span>
              </label>
              {politicaNueva && !valores.terminos ? (
                <p id="campo-terminos-nueva" role="status" className="pl-9 pt-1.5 text-[0.875rem] text-ink">
                  {TC.checkout.terminos.actualizada}
                </p>
              ) : null}
              {campo('terminos') ? (
                <p id="campo-terminos-error" className="pl-9 pt-1.5 text-[0.875rem] text-danger">
                  {campo('terminos')}
                </p>
              ) : null}
            </div>
            <div>
              <label className="flex cursor-pointer items-start gap-3" htmlFor="campo-whatsapp">
                <input
                  {...propsControl('campo-whatsapp', campo('whatsapp'))}
                  type="checkbox"
                  checked={valores.whatsapp}
                  onChange={(e) => actualizar('whatsapp', e.target.checked)}
                  className="mt-0.5 size-6 shrink-0 accent-ink"
                />
                <span className="text-[0.9375rem]">{esContraEntrega ? TC.checkout.whatsappAutorizo : TC.checkout.whatsappAutorizoOpcional}</span>
              </label>
              {campo('whatsapp') ? (
                <p id="campo-whatsapp-error" className="pl-9 pt-1.5 text-[0.875rem] text-danger">
                  {campo('whatsapp')}
                </p>
              ) : null}
            </div>
          </div>

          {errorGeneral ? (
            <div ref={bannerError} tabIndex={-1} role="alert" className="mt-6 rounded-card border border-danger p-4 text-[0.9375rem] outline-none">
              {errorGeneral}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3">
            <p className="flex items-baseline justify-between gap-4" aria-live="polite">
              <span className="etiqueta">{TC.resumen.total}</span>
              <span className="font-display text-3xl tabular-nums">{totalTexto}</span>
            </p>
            {esContraEntrega ? (
              <p className="flex items-baseline justify-between gap-4 text-[0.9375rem]">
                <span>{TC.resumen.abono}</span>
                <span className="tabular-nums">{precio(resumen.abono)}</span>
              </p>
            ) : null}
            <Button type="submit" tamano="lg" bloque disabled={enviando || sinMetodoDisponible || (config.metodos.length > 0 && !valores.metodo)} aria-busy={enviando}>
              {enviando ? TC.checkout.boton.enviando : textoBotonPago(metodoElegido)}
            </Button>
            <p className="flex items-center gap-2 text-[0.875rem] text-ink/80">
              <Icono nombre="escudo" tamano={16} />
              {TC.checkout.notaSeguridad}
            </p>
            <Link href={`/${pais}/carrito`} className={clasesBoton({ variante: 'texto', className: 'self-start' })}>
              {TC.checkout.volverBolso}
            </Link>
          </div>
        </section>
      </div>
    </form>
  );
}
