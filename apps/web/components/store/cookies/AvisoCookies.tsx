'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clasesBoton } from '@izao/ui';
import { EVENTO_ABRIR_COOKIES, guardarConsentimiento, VARIABLE_ALTO_AVISO, type Elecciones } from '@/lib/store/consentimiento';
import { TCK, type TextosCookies } from '@/lib/store/textos-cookies';
import { useConsentimiento } from './useConsentimiento';

// La ventana de preferencias se baja solo al abrirla: no suma al JS inicial.
const importarPreferencias = () => import('./PreferenciasCookies');
const PreferenciasCookies = dynamic(importarPreferencias, { ssr: false });

interface Props {
  textos: TextosCookies;
  /** Ruta de la política de datos publicada en el país (cubre las cookies); `null` si aún no está publicada. */
  enlacePolitica: string | null;
}

/** ¿Ya se descargó el script de Meta en esta página? Si es así, retirar el consentimiento solo se completa al recargar. */
const scriptDeMetaCargado = (): boolean => Boolean((window as unknown as { __izaoFbScript?: boolean }).__izaoFbScript);

/**
 * Aviso de cookies (§23.2). Franja discreta abajo, SIN bloquear la página: no es un modal, no roba el foco y no tapa nada,
 * porque los botones flotantes (WhatsApp, Iza, subir, barra de compra) suben por encima mientras está visible
 * (`--alto-aviso-cookies`, ver `.sobre-aviso-cookies`). «Aceptar» y «Rechazar» tienen el mismo peso visual. Va al inicio del
 * documento para que quien navega con teclado lo encuentre primero. Sin decisión = no se carga nada de marketing.
 * También abre las preferencias desde el enlace «Cookies» del pie (evento `izao:abrir-cookies`).
 */
export function AvisoCookies({ textos, enlacePolitica }: Props) {
  const estado = useConsentimiento();
  const [preferencias, setPreferencias] = useState(false);
  // Solo se avisa cuando retirar el consentimiento exige recargar para completarse.
  const [recargar, setRecargar] = useState(false);
  const franja = useRef<HTMLElement>(null);
  const visible = estado.listo && !estado.decidido;
  const hayMensaje = recargar && !visible;

  useEffect(() => {
    const abrir = () => {
      setRecargar(false);
      setPreferencias(true);
    };
    window.addEventListener(EVENTO_ABRIR_COOKIES, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_COOKIES, abrir);
  }, []);

  // Alto de lo que ocupa abajo: los botones flotantes se colocan encima (sin tapar nada, sin mover el diseño).
  useEffect(() => {
    const el = franja.current;
    const raiz = document.documentElement;
    if (!el || (!visible && !hayMensaje)) return;
    const medir = () => raiz.style.setProperty(VARIABLE_ALTO_AVISO, `${Math.ceil(el.getBoundingClientRect().height) + 12}px`);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => {
      obs.disconnect();
      raiz.style.removeProperty(VARIABLE_ALTO_AVISO);
    };
  }, [visible, hayMensaje]);

  /** Decisión desde el aviso: se guarda y el foco pasa al contenido (el botón pulsado desaparece). */
  const decidirDesdeAviso = useCallback((e: Elecciones) => {
    guardarConsentimiento(e);
    document.getElementById('contenido')?.focus({ preventScroll: true });
  }, []);

  /** Decisión desde las preferencias: si se retiró marketing con el script ya cargado, avisa que el cambio se completa al recargar. */
  const decidirDesdePreferencias = useCallback((e: Elecciones, retiraMarketing: boolean) => {
    guardarConsentimiento(e);
    setPreferencias(false);
    setRecargar(retiraMarketing && scriptDeMetaCargado());
  }, []);

  const elecciones = { analitica: estado.analitica, marketing: estado.marketing };

  return (
    <>
      {visible || hayMensaje ? (
        <section
          ref={franja}
          aria-label={TCK.ui.region}
          data-testid="aviso-cookies"
          className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-4xl rounded-card border border-line bg-bg p-4 text-ink shadow-elev sm:inset-x-4 lg:bottom-6 lg:p-5"
        >
          {visible ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
              <div className="min-w-0 flex-1">
                <p className="hidden font-display text-xl leading-tight sm:block">{textos.avisoTitulo}</p>
                <p className="text-[0.9375rem] leading-snug text-ink/85 sm:pt-1">
                  {textos.avisoTexto}
                  {enlacePolitica ? (
                    <>
                      {' '}
                      <Link href={enlacePolitica} className="underline underline-offset-4 hover:text-ink">
                        {TCK.aviso.enlace}
                      </Link>
                      .
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
                <button type="button" className={clasesBoton({ variante: 'primario', tamano: 'sm', className: 'flex-1 lg:flex-none' })} onClick={() => decidirDesdeAviso({ analitica: true, marketing: true })}>
                  {TCK.ui.aceptar}
                </button>
                <button type="button" className={clasesBoton({ variante: 'primario', tamano: 'sm', className: 'flex-1 lg:flex-none' })} onClick={() => decidirDesdeAviso({ analitica: false, marketing: false })}>
                  {TCK.ui.rechazar}
                </button>
                <button
                  type="button"
                  className={clasesBoton({ variante: 'texto', tamano: 'sm', className: 'shrink-0' })}
                  aria-haspopup="dialog"
                  onPointerEnter={() => void importarPreferencias()}
                  onFocus={() => void importarPreferencias()}
                  onClick={() => setPreferencias(true)}
                >
                  {TCK.ui.preferencias}
                </button>
              </div>
            </div>
          ) : (
            <div role="status" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.9375rem]">
                {TCK.ui.guardado} {TCK.ui.recargar}
              </p>
              <div className="flex gap-2">
                <button type="button" className={clasesBoton({ variante: 'primario' })} onClick={() => location.reload()}>
                  {TCK.ui.recargarAhora}
                </button>
                <button type="button" className={clasesBoton({ variante: 'secundario' })} onClick={() => setRecargar(false)}>
                  {TCK.ui.cerrar}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
      {preferencias ? (
        <PreferenciasCookies
          abierto
          textos={textos}
          inicial={elecciones}
          enlacePolitica={enlacePolitica}
          onCerrar={() => setPreferencias(false)}
          onGuardar={(e) => decidirDesdePreferencias(e, estado.marketing && !e.marketing)}
        />
      ) : null}
    </>
  );
}
