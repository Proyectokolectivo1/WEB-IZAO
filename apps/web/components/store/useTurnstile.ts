'use client';

import { useCallback, useEffect, useRef } from 'react';

interface TurnstileApi {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
const api = (): TurnstileApi | undefined => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/**
 * Cloudflare Turnstile para los formularios públicos (§26.1). El script se carga solo si hay clave y el widget solo se
 * ve si Cloudflare pide interacción. `contenedor` va en un `<div>` que se renderiza cuando hay clave; `token.current`
 * trae el último token vigente (si el contenedor aparece después, p. ej. dentro de un diálogo, pasar `listo`) y `reiniciar()` pide otro (cada token vale una vez).
 */
export function useTurnstile(siteKey: string | null, listo = true) {
  const contenedor = useRef<HTMLDivElement>(null);
  const token = useRef<string | null>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !listo || !contenedor.current) return;
    const montar = () => {
      const t = api();
      if (!t || !contenedor.current || widget.current) return;
      widget.current = t.render(contenedor.current, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (v: string) => {
          token.current = v;
        },
        'expired-callback': () => {
          token.current = null;
        },
        'error-callback': () => {
          token.current = null;
        },
      });
    };
    if (api()) montar();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = montar;
      document.head.appendChild(s);
    }
    return () => {
      if (widget.current) api()?.remove(widget.current);
      widget.current = null;
      token.current = null;
    };
  }, [siteKey, listo]);

  const reiniciar = useCallback(() => {
    token.current = null;
    if (widget.current) api()?.reset(widget.current);
  }, []);

  return { contenedor, token, reiniciar };
}
