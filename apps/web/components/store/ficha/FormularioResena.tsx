'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icono } from '@izao/ui';
import { aCodigoCore } from '@/lib/store/pais';
import {
  MAX_BYTES_FOTO_RESENA,
  MAX_CIUDAD,
  MAX_FOTOS_RESENA,
  MAX_NOMBRE,
  MAX_TEXTO,
  MIN_TEXTO,
  TIPOS_FOTO_RESENA,
  esquemaResena,
  problemaFotosResena,
  type CampoResena,
  type RespuestaResena,
} from '@/lib/store/resenas/logica';
import { TR } from '@/lib/store/resenas/textos';
import type { CodigoPais } from '@/lib/store/types';
import { CLASE_CONTROL, Campo, propsControl } from '../checkout/Campo';
import { useTurnstile } from '../useTurnstile';

interface Props {
  pais: CodigoPais;
  productoId: string;
  /** Se pide al abrir el formulario (ver `/api/reviews/config`). */
  turnstileKey: string | null;
}

const MB = 1024 * 1024;
const ORDEN: CampoResena[] = ['estrellas', 'nombre', 'ciudad', 'texto', 'fotos', 'pedido', 'celular', 'producto'];
const MIME = new Set<string>(TIPOS_FOTO_RESENA);
const ETIQUETA: Record<CampoResena, string> = { ...TR.campos, producto: TR.titulo };

function mensajeCampo(campo: CampoResena, codigo: string): string {
  const e = TR.errores;
  switch (campo) {
    case 'estrellas':
      return e.estrellas;
    case 'nombre':
      return e.nombre;
    case 'texto':
      return e.texto(MIN_TEXTO);
    case 'pedido':
      return e.pedido;
    case 'celular':
      return e.celular;
    case 'ciudad':
      return e.ciudad;
    case 'producto':
      return e.producto;
    default:
      return codigo === 'muchas_fotos' ? e.muchasFotos(MAX_FOTOS_RESENA) : codigo === 'foto_pesada' ? e.fotoPesada(MAX_BYTES_FOTO_RESENA / MB) : e.tipo;
  }
}

/** Formulario de reseña de la ficha (§9.6): estrellas, nombre, ciudad, texto, hasta 3 fotos y verificación opcional. */
export default function FormularioResena({ pais, productoId, turnstileKey }: Props) {
  const [valores, setValores] = useState({ nombre: '', ciudad: '', texto: '', pedido: '', celular: '' });
  const [estrellas, setEstrellas] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [errores, setErrores] = useState<Partial<Record<CampoResena, string>>>({});
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const resumen = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  const confirmacion = useRef<HTMLHeadingElement>(null);
  const { contenedor, token, reiniciar } = useTurnstile(turnstileKey);
  const esquema = useMemo(() => esquemaResena(aCodigoCore(pais)), [pais]);
  const miniaturas = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos]);
  useEffect(() => () => miniaturas.forEach((u) => URL.revokeObjectURL(u)), [miniaturas]);
  useEffect(() => {
    if (listo) confirmacion.current?.focus();
  }, [listo]);

  function actualizar(campo: keyof typeof valores, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function elegirFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevas = [...(e.target.files ?? [])];
    e.target.value = '';
    const lista = [...fotos, ...nuevas];
    const problema = lista.some((f) => !MIME.has(f.type)) ? 'tipo' : problemaFotosResena(lista.map((f) => ({ tamano: f.size })));
    setErrores((x) => ({ ...x, fotos: problema ? mensajeCampo('fotos', problema) : undefined }));
    if (!problema) setFotos(lista);
    else if (problema === 'muchas_fotos') setFotos(lista.slice(0, MAX_FOTOS_RESENA));
  }

  async function enviar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (enviando) return;
    setIntentado(true);
    setFalla(null);
    const nuevos: Partial<Record<CampoResena, string>> = {};
    const analisis = esquema.safeParse({ producto: productoId, ...valores, estrellas });
    if (!analisis.success) {
      for (const i of analisis.error.issues) {
        const c = String(i.path[0]) as CampoResena;
        if (!nuevos[c]) nuevos[c] = mensajeCampo(c, '');
      }
    }
    if (Object.keys(nuevos).length > 0) {
      setErrores(nuevos);
      requestAnimationFrame(() => resumen.current?.focus());
      return;
    }
    if (turnstileKey && !token.current) {
      setFalla(TR.errores.turnstile);
      requestAnimationFrame(() => banner.current?.focus());
      return;
    }

    const cuerpo = new FormData();
    cuerpo.set('country', pais);
    cuerpo.set('producto', productoId);
    cuerpo.set('estrellas', estrellas);
    for (const [k, v] of Object.entries(valores)) cuerpo.set(k, v);
    for (const f of fotos) cuerpo.append('fotos', f);
    cuerpo.set('sitio_web', '');
    if (token.current) cuerpo.set('cf-turnstile-response', token.current);

    setEnviando(true);
    try {
      const r = await fetch('/api/reviews', { method: 'POST', body: cuerpo });
      const datos = (await r.json()) as RespuestaResena;
      if (datos.ok) {
        setListo(true);
        return;
      }
      if (datos.motivo === 'campos') {
        const c: Partial<Record<CampoResena, string>> = {};
        for (const [campo, codigo] of Object.entries(datos.campos) as [CampoResena, string][]) c[campo] = mensajeCampo(campo, codigo);
        setErrores(c);
        requestAnimationFrame(() => resumen.current?.focus());
      } else {
        setFalla(TR.fallas[datos.motivo]);
        requestAnimationFrame(() => banner.current?.focus());
      }
    } catch {
      setFalla(TR.fallas.red);
      requestAnimationFrame(() => banner.current?.focus());
    } finally {
      reiniciar();
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div data-testid="resena-recibida" className="flex flex-col items-start gap-3 border-t border-ink pt-6">
        <Icono nombre="check" tamano={28} />
        <h3 ref={confirmacion} tabIndex={-1} className="text-3xl outline-none">
          {TR.listo.titulo}
        </h3>
        <p className="max-w-xl text-ink/90">{TR.listo.texto}</p>
      </div>
    );
  }

  const lista = ORDEN.filter((c) => errores[c]);
  const campo = (c: CampoResena) => errores[c];

  return (
    <form onSubmit={enviar} noValidate data-testid="formulario-resena" className="flex flex-col gap-8 border-t border-ink pt-6">
      <div>
        <h3 className="text-3xl">{TR.titulo}</h3>
        <p className="pt-2 text-[0.9375rem] text-ink/80">{TR.intro}</p>
      </div>

      {intentado && lista.length > 0 ? (
        <div ref={resumen} tabIndex={-1} role="alert" className="border border-danger p-4 outline-none">
          <p className="font-semibold">{TR.resumenErrores(lista.length)}</p>
          <ul className="list-disc pl-5 pt-2 text-[0.9375rem]">
            {lista.map((c) => (
              <li key={c}>
                <a href={`#resena-${c}`} className="underline underline-offset-4">
                  {ETIQUETA[c]}
                </a>
                {': '}
                {errores[c]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset id="resena-estrellas" aria-describedby={campo('estrellas') ? 'resena-estrellas-error' : undefined}>
        <legend className="mb-2 text-[0.9375rem] font-medium">{TR.campos.estrellas}</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="relative grid size-12 cursor-pointer place-items-center has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink"
            >
              <input
                type="radio"
                name="estrellas"
                value={String(n)}
                checked={estrellas === String(n)}
                onChange={() => {
                  setEstrellas(String(n));
                  setErrores((e) => ({ ...e, estrellas: undefined }));
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span className="solo-lectores">{TR.estrellaN(n)}</span>
              <Icono nombre="estrella" tamano={28} className={Number(estrellas) >= n ? 'fill-ink' : ''} />
            </label>
          ))}
        </div>
        {campo('estrellas') ? (
          <p id="resena-estrellas-error" className="pt-1.5 text-[0.875rem] text-danger">
            {campo('estrellas')}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id="resena-nombre" etiqueta={TR.campos.nombre} error={campo('nombre')} ayuda={TR.ayudaNombre}>
          <input
            {...propsControl('resena-nombre', campo('nombre'), 'ayuda')}
            name="nombre"
            value={valores.nombre}
            onChange={(e) => actualizar('nombre', e.target.value)}
            autoComplete="name"
            maxLength={MAX_NOMBRE}
            className={CLASE_CONTROL}
          />
        </Campo>
        <Campo id="resena-ciudad" etiqueta={TR.campos.ciudad} error={campo('ciudad')}>
          <input
            {...propsControl('resena-ciudad', campo('ciudad'))}
            name="ciudad"
            value={valores.ciudad}
            onChange={(e) => actualizar('ciudad', e.target.value)}
            autoComplete="address-level2"
            maxLength={MAX_CIUDAD}
            className={CLASE_CONTROL}
          />
        </Campo>
      </div>

      <Campo id="resena-texto" etiqueta={TR.campos.texto} error={campo('texto')} ayuda={TR.ayudaTexto(MIN_TEXTO)}>
        <textarea
          {...propsControl('resena-texto', campo('texto'), 'ayuda')}
          name="texto"
          value={valores.texto}
          onChange={(e) => actualizar('texto', e.target.value)}
          rows={5}
          maxLength={MAX_TEXTO}
          className={`${CLASE_CONTROL} min-h-32 py-3`}
        />
      </Campo>

      <div>
        <Campo id="resena-fotos" etiqueta={TR.campos.fotos} error={campo('fotos')} ayuda={TR.ayudaFotos(MAX_FOTOS_RESENA)}>
          <input
            {...propsControl('resena-fotos', campo('fotos'), 'ayuda')}
            type="file"
            multiple
            accept={TIPOS_FOTO_RESENA.join(',')}
            onChange={elegirFotos}
            className={`${CLASE_CONTROL} py-2.5 file:mr-3 file:border-0 file:bg-transparent file:font-medium file:text-ink`}
          />
        </Campo>
        {fotos.length > 0 ? (
          <ul className="flex flex-wrap gap-3 pt-4">
            {fotos.map((f, i) => (
              <li key={`${f.name}-${i}`} className="relative">
                {/* Vista previa local (blob:): no pasa por el pipeline de imágenes. */}
                <img src={miniaturas[i] ?? ''} alt={f.name} width={96} height={120} className="h-[7.5rem] w-24 rounded-sm border border-line object-cover" />
                <button
                  type="button"
                  onClick={() => setFotos((a) => a.filter((_, j) => j !== i))}
                  aria-label={TR.quitarFoto(f.name)}
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

      <fieldset className="grid gap-5 border border-line p-4 sm:grid-cols-2">
        <legend className="px-2 text-[0.9375rem] font-medium">{TR.verificar.titulo}</legend>
        <p className="text-[0.9375rem] text-ink/80 sm:col-span-2">{TR.verificar.texto}</p>
        <Campo id="resena-pedido" etiqueta={TR.campos.pedido} error={campo('pedido')}>
          <input
            {...propsControl('resena-pedido', campo('pedido'))}
            name="pedido"
            value={valores.pedido}
            onChange={(e) => actualizar('pedido', e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            placeholder={`IZ-${pais.toUpperCase()}-000123`}
            className={CLASE_CONTROL}
          />
        </Campo>
        <Campo id="resena-celular" etiqueta={TR.campos.celular} error={campo('celular')}>
          <input
            {...propsControl('resena-celular', campo('celular'))}
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
      </fieldset>

      {/* Campo trampa: fuera de pantalla y del teclado; las personas no lo ven. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Sitio web
          <input type="text" name="sitio_web" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {turnstileKey ? <div ref={contenedor} aria-label={TR.turnstile} /> : null}

      {falla ? (
        <div ref={banner} tabIndex={-1} role="alert" className="border border-danger p-4 text-[0.9375rem] outline-none">
          {falla}
        </div>
      ) : null}

      <Button type="submit" tamano="lg" disabled={enviando} aria-busy={enviando} className="self-start">
        {enviando ? TR.enviando : TR.enviar}
      </Button>
    </form>
  );
}
