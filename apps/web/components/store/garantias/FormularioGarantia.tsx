'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icono, clasesBoton } from '@izao/ui';
import { aCodigoCore } from '@/lib/store/pais';
import {
  ACEPTA_ADJUNTOS,
  MAX_BYTES_FOTO,
  MAX_BYTES_VIDEO,
  MAX_DESCRIPCION,
  MAX_FOTOS,
  MIN_DESCRIPCION,
  TIPOS_FOTO,
  TIPOS_VIDEO,
  esquemaGarantia,
  problemaAdjuntos,
  type CampoGarantia,
  type RespuestaGarantia,
} from '@/lib/store/garantias/logica';
import { TG } from '@/lib/store/garantias/textos';
import type { CodigoPais } from '@/lib/store/types';
import { CLASE_CONTROL, Campo, NumeroPaso, propsControl } from '../checkout/Campo';

interface Props {
  pais: CodigoPais;
  motivos: string[];
  diasPlazo: number;
  diasRespuesta: number;
  /** Clave pública de Turnstile (`TURNSTILE_SITE_KEY`); vacía = sin verificación. */
  turnstileKey: string | null;
  enlaceDatos: { href: string; titulo: string } | null;
  /** Enlace `wa.me` al asesor (con mensaje), si el país tiene número. */
  enlaceAsesor: string | null;
}

const MB = 1024 * 1024;
const ORDEN: CampoGarantia[] = ['pedido', 'celular', 'motivo', 'descripcion', 'adjuntos'];
const MIME_FOTO = new Set<string>(TIPOS_FOTO);
const MIME_VIDEO = new Set<string>(TIPOS_VIDEO);

/** Mensaje en lenguaje humano para un código de error de campo (los mismos que devuelve el servidor). */
function mensajeCampo(campo: CampoGarantia, codigo: string): string {
  const e = TG.errores;
  switch (campo) {
    case 'pedido':
      return e.pedido;
    case 'celular':
      return e.celular;
    case 'motivo':
      return e.motivo;
    case 'descripcion':
      return e.descripcion(MIN_DESCRIPCION);
    default:
      return (
        (
          {
            mezcla: e.mezcla,
            muchas_fotos: e.muchasFotos(MAX_FOTOS),
            muchos_videos: e.muchosVideos,
            foto_pesada: e.fotoPesada(MAX_BYTES_FOTO / MB),
            video_pesado: e.videoPesado(MAX_BYTES_VIDEO / MB),
          } as Record<string, string>
        )[codigo] ?? e.tipo
      );
  }
}

interface TurnstileApi {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
const turnstile = (): TurnstileApi | undefined => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/** Formulario público de garantías (§19): pedido, celular, motivo, descripción y hasta 5 fotos o 1 video. */
export function FormularioGarantia({ pais, motivos, diasPlazo, diasRespuesta, turnstileKey, enlaceDatos, enlaceAsesor }: Props) {
  const [valores, setValores] = useState({ pedido: '', celular: '', motivo: '', descripcion: '' });
  const [archivos, setArchivos] = useState<File[]>([]);
  const [errores, setErrores] = useState<Partial<Record<CampoGarantia, string>>>({});
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [listo, setListo] = useState<Extract<RespuestaGarantia, { ok: true }> | null>(null);
  const resumen = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  const confirmacion = useRef<HTMLHeadingElement>(null);
  const token = useRef<string | null>(null);
  const widget = useRef<string | null>(null);
  const contenedorTs = useRef<HTMLDivElement>(null);
  const esquema = useMemo(() => esquemaGarantia(aCodigoCore(pais), motivos), [pais, motivos]);

  // Turnstile: el script se carga solo si hay clave, y el widget solo se ve si Cloudflare pide interacción.
  useEffect(() => {
    if (!turnstileKey || !contenedorTs.current) return;
    const montar = () => {
      const api = turnstile();
      if (!api || !contenedorTs.current || widget.current) return;
      widget.current = api.render(contenedorTs.current, {
        sitekey: turnstileKey,
        appearance: 'interaction-only',
        callback: (t: string) => {
          token.current = t;
        },
        'expired-callback': () => {
          token.current = null;
        },
        'error-callback': () => {
          token.current = null;
        },
      });
    };
    if (turnstile()) montar();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = montar;
      document.head.appendChild(s);
    }
    return () => {
      if (widget.current) turnstile()?.remove(widget.current);
      widget.current = null;
    };
  }, [turnstileKey]);

  useEffect(() => {
    if (listo) confirmacion.current?.focus();
  }, [listo]);

  const miniaturas = useMemo(() => archivos.map((f) => (MIME_FOTO.has(f.type) ? URL.createObjectURL(f) : null)), [archivos]);
  useEffect(() => () => miniaturas.forEach((u) => u && URL.revokeObjectURL(u)), [miniaturas]);

  function actualizar(campo: keyof typeof valores, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function validarAdjuntos(lista: File[]): string | null {
    const fotos = lista.filter((f) => MIME_FOTO.has(f.type));
    const videos = lista.filter((f) => MIME_VIDEO.has(f.type));
    if (fotos.length + videos.length !== lista.length) return 'tipo';
    return problemaAdjuntos({ fotos: fotos.map((f) => ({ tamano: f.size })), videos: videos.map((f) => ({ tamano: f.size })) });
  }

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = [...(e.target.files ?? [])];
    e.target.value = '';
    // Un video reemplaza lo anterior; las fotos nuevas se suman a las ya elegidas.
    const soloVideo = nuevos.length > 0 && nuevos.every((f) => MIME_VIDEO.has(f.type));
    const lista = soloVideo ? nuevos.slice(0, 1) : [...archivos.filter((f) => MIME_FOTO.has(f.type)), ...nuevos];
    const problema = validarAdjuntos(lista);
    setErrores((x) => ({ ...x, adjuntos: problema ? mensajeCampo('adjuntos', problema) : undefined }));
    if (!problema) setArchivos(lista);
    else if (problema === 'muchas_fotos') setArchivos(lista.slice(0, MAX_FOTOS));
  }

  function quitar(i: number) {
    setArchivos((a) => a.filter((_, j) => j !== i));
    setErrores((x) => ({ ...x, adjuntos: undefined }));
  }

  async function enviar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (enviando) return;
    setIntentado(true);
    setFalla(null);
    const nuevos: Partial<Record<CampoGarantia, string>> = {};
    const analisis = esquema.safeParse(valores);
    if (!analisis.success) {
      for (const i of analisis.error.issues) {
        const c = String(i.path[0]) as CampoGarantia;
        if (!nuevos[c]) nuevos[c] = mensajeCampo(c, '');
      }
    }
    const problema = validarAdjuntos(archivos);
    if (problema) nuevos.adjuntos = mensajeCampo('adjuntos', problema);
    if (Object.keys(nuevos).length > 0) {
      setErrores(nuevos);
      requestAnimationFrame(() => resumen.current?.focus());
      return;
    }
    if (turnstileKey && !token.current) {
      setFalla(TG.errores.turnstile);
      requestAnimationFrame(() => banner.current?.focus());
      return;
    }

    const cuerpo = new FormData();
    for (const [k, v] of Object.entries(valores)) cuerpo.set(k, v);
    for (const f of archivos) cuerpo.append('adjuntos', f);
    cuerpo.set('sitio_web', '');
    if (token.current) cuerpo.set('cf-turnstile-response', token.current);

    setEnviando(true);
    try {
      const r = await fetch(`/${pais}/garantias/enviar`, { method: 'POST', body: cuerpo });
      const datos = (await r.json()) as RespuestaGarantia;
      if (datos.ok) {
        setListo(datos);
        return;
      }
      if (datos.motivo === 'campos') {
        const c: Partial<Record<CampoGarantia, string>> = {};
        for (const [campo, codigo] of Object.entries(datos.campos) as [CampoGarantia, string][]) c[campo] = mensajeCampo(campo, codigo);
        setErrores(c);
        requestAnimationFrame(() => resumen.current?.focus());
      } else {
        setFalla(datos.motivo === 'vencido' ? TG.fallas.vencido(diasPlazo) : TG.fallas[datos.motivo]);
        requestAnimationFrame(() => banner.current?.focus());
      }
    } catch {
      setFalla(TG.fallas.red);
      requestAnimationFrame(() => banner.current?.focus());
    } finally {
      token.current = null;
      if (widget.current) turnstile()?.reset(widget.current);
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <section aria-labelledby="titulo-listo" data-testid="garantia-recibida" className="flex flex-col items-start gap-5 border-t border-ink pt-6">
        <Icono nombre="check" tamano={32} />
        <h2 id="titulo-listo" ref={confirmacion} tabIndex={-1} className="text-3xl outline-none md:text-4xl">
          {TG.listo.titulo}
        </h2>
        <div>
          <p className="etiqueta text-ink/70">{TG.listo.caso}</p>
          <p className="font-display text-4xl tabular-nums" data-testid="garantia-numero">
            {listo.numero}
          </p>
        </div>
        <p className="max-w-xl text-ink/90">{TG.listo.guardar}</p>
        <p className="max-w-xl text-lg">{TG.listo.respuesta(listo.diasRespuesta || diasRespuesta)}</p>
        {listo.repetido ? <p className="max-w-xl text-[0.9375rem] text-ink/80">{TG.listo.repetido}</p> : null}
        <Link href={`/${pais}`} className={clasesBoton({ variante: 'secundario' })}>
          {TG.listo.inicio}
        </Link>
      </section>
    );
  }

  const lista = ORDEN.filter((c) => errores[c]);
  const campo = (c: CampoGarantia) => errores[c];
  const etiquetas: Record<CampoGarantia, string> = TG.campos;

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-12" data-testid="formulario-garantia">
      {intentado && lista.length > 0 ? (
        <div ref={resumen} tabIndex={-1} role="alert" className="border border-danger p-4 outline-none">
          <p className="font-semibold">{TG.resumenErrores(lista.length)}</p>
          <ul className="list-disc pl-5 pt-2 text-[0.9375rem]">
            {lista.map((c) => (
              <li key={c}>
                <a href={`#campo-${c}`} className="underline underline-offset-4">
                  {etiquetas[c]}
                </a>
                {': '}
                {errores[c]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 01 · Pedido */}
      <section aria-labelledby="paso-pedido" className="border-t border-ink pt-5">
        <h2 id="paso-pedido" className="flex items-baseline gap-4 text-3xl">
          <NumeroPaso n="01" />
          {TG.pasos.pedido}
        </h2>
        <div className="grid gap-5 pt-6 sm:grid-cols-2">
          <Campo id="campo-pedido" etiqueta={etiquetas.pedido} error={campo('pedido')} ayuda={`${TG.ayudaPedido}${TG.ejemploPedido(pais)}`}>
            <input
              {...propsControl('campo-pedido', campo('pedido'), 'ayuda')}
              name="pedido"
              value={valores.pedido}
              onChange={(e) => actualizar('pedido', e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              placeholder={TG.ejemploPedido(pais)}
              className={CLASE_CONTROL}
            />
          </Campo>
          <Campo id="campo-celular" etiqueta={etiquetas.celular} error={campo('celular')} ayuda={TG.ayudaCelular}>
            <input
              {...propsControl('campo-celular', campo('celular'), 'ayuda')}
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
        </div>
      </section>

      {/* 02 · Caso */}
      <section aria-labelledby="paso-caso" className="border-t border-ink pt-5">
        <h2 id="paso-caso" className="flex items-baseline gap-4 text-3xl">
          <NumeroPaso n="02" />
          {TG.pasos.caso}
        </h2>
        <div className="grid gap-5 pt-6">
          <Campo id="campo-motivo" etiqueta={etiquetas.motivo} error={campo('motivo')}>
            <select
              {...propsControl('campo-motivo', campo('motivo'))}
              name="motivo"
              value={valores.motivo}
              onChange={(e) => actualizar('motivo', e.target.value)}
              className={CLASE_CONTROL}
            >
              <option value="">{TG.elige}</option>
              {motivos.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="campo-descripcion" etiqueta={etiquetas.descripcion} error={campo('descripcion')} ayuda={TG.ayudaDescripcion(MIN_DESCRIPCION)}>
            <textarea
              {...propsControl('campo-descripcion', campo('descripcion'), 'ayuda')}
              name="descripcion"
              value={valores.descripcion}
              onChange={(e) => actualizar('descripcion', e.target.value)}
              rows={5}
              maxLength={MAX_DESCRIPCION}
              className={`${CLASE_CONTROL} min-h-32 py-3`}
            />
            <p className="pt-1 text-right text-[0.875rem] text-ink/70" aria-hidden="true">
              {TG.contador(valores.descripcion.length, MAX_DESCRIPCION)}
            </p>
          </Campo>
        </div>
      </section>

      {/* 03 · Evidencia */}
      <section aria-labelledby="paso-evidencia" className="border-t border-ink pt-5">
        <h2 id="paso-evidencia" className="flex items-baseline gap-4 text-3xl">
          <NumeroPaso n="03" />
          {TG.pasos.evidencia}
        </h2>
        <div className="pt-6">
          <Campo id="campo-adjuntos" etiqueta={etiquetas.adjuntos} error={campo('adjuntos')} ayuda={TG.adjuntos.ayuda(MAX_FOTOS, MAX_BYTES_VIDEO / MB)}>
            <input
              {...propsControl('campo-adjuntos', campo('adjuntos'), 'ayuda')}
              type="file"
              multiple
              accept={ACEPTA_ADJUNTOS}
              onChange={elegir}
              className={`${CLASE_CONTROL} py-2.5 file:mr-3 file:border-0 file:bg-transparent file:font-medium file:text-ink`}
            />
          </Campo>
          {archivos.length > 0 ? (
            <ul className="flex flex-wrap gap-3 pt-4" aria-label={TG.adjuntos.seleccionados(archivos.length)}>
              {archivos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative">
                  {miniaturas[i] ? (
                    // Vista previa local (blob:): no pasa por el pipeline de imágenes.
                    <img src={miniaturas[i] ?? ''} alt={f.name} width={96} height={120} className="h-[7.5rem] w-24 rounded-sm border border-line object-cover" />
                  ) : (
                    <span className="flex h-[7.5rem] w-24 flex-col items-center justify-center gap-1 rounded-sm border border-line px-1 text-center text-[0.8125rem]">
                      <Icono nombre="ojo" tamano={20} />
                      {TG.adjuntos.video}
                      <span className="line-clamp-2 break-all text-ink/70">{f.name}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => quitar(i)}
                    aria-label={TG.adjuntos.quitar(f.name)}
                    className="absolute -right-3 -top-3 grid size-11 place-items-center"
                  >
                    <span className="grid size-7 place-items-center rounded-full border border-ink bg-bg">
                      <Icono nombre="cerrar" tamano={14} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* Campo trampa: fuera de pantalla y del teclado; las personas no lo ven. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Sitio web
          <input type="text" name="sitio_web" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {turnstileKey ? <div ref={contenedorTs} aria-label={TG.turnstile} /> : null}

      {falla ? (
        <div ref={banner} tabIndex={-1} role="alert" className="border border-danger p-4 text-[0.9375rem] outline-none">
          <p>{falla}</p>
          {enlaceAsesor ? (
            <a href={enlaceAsesor} target="_blank" rel="noopener" className="mt-2 inline-block underline underline-offset-4">
              {TG.asesor}
              <span className="solo-lectores"> {TG.nuevaPestana}</span>
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="submit" tamano="lg" disabled={enviando} aria-busy={enviando} className="self-start">
          {enviando ? TG.enviando : TG.enviar}
        </Button>
        <p role="status" className="min-h-5 text-[0.875rem] text-ink/80">
          {enviando && archivos.length > 0 ? TG.cargando : ''}
        </p>
        <p className="max-w-xl text-[0.875rem] text-ink/80">
          {TG.datos.antes}
          {enlaceDatos ? (
            <Link href={enlaceDatos.href} className="underline underline-offset-4">
              {TG.datos.enlace}
            </Link>
          ) : (
            TG.datos.enlace
          )}
          {TG.datos.despues}
        </p>
      </div>
    </form>
  );
}
