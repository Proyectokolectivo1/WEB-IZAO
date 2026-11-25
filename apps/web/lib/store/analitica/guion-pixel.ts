/**
 * Guion en línea del Meta Pixel (§23.2). Define la cola `fbq` al instante y el tag `fbevents.js` solo se descarga tras
 * el evento `load` (no compite con el LCP). Los eventos anteriores (`init`, `PageView`, `ViewContent`…) quedan en la cola
 * de `fbq` y se envían al cargar. Todo va con `trackSingle` sobre el Pixel del país: así, aunque hubiera dos pixeles
 * iniciados en el mismo documento, nunca se cruzan los eventos.
 *
 * El id se valida (solo dígitos) y se serializa con `JSON.stringify`: no hay forma de inyectar código por la credencial.
 */
import { esPixelId } from '@izao/meta-pixel';

export const ORIGEN_FBEVENTS = 'https://connect.facebook.net/en_US/fbevents.js';

export function guionPixel(pixelId: string): string {
  if (!esPixelId(pixelId)) throw new Error('Pixel ID inválido');
  const id = JSON.stringify(pixelId);
  return (
    `(function(w,d){var id=${id};` +
    `if(!w.fbq){var n=w.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};` +
    `if(!w._fbq)w._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];` +
    `var c=function(){var s=d.createElement('script');s.async=!0;s.src=${JSON.stringify(ORIGEN_FBEVENTS)};` +
    `var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s,x)};` +
    `if(d.readyState==='complete')setTimeout(c,0);else w.addEventListener('load',function(){setTimeout(c,0)})}` +
    `w.__izaoPixelId=id;w.fbq('init',id);w.fbq('trackSingle',id,'PageView')})(window,document);`
  );
}

/** Imagen del `<noscript>` del código base de Meta: PageView sin JavaScript para el Pixel del país. */
export function urlNoscript(pixelId: string): string {
  if (!esPixelId(pixelId)) throw new Error('Pixel ID inválido');
  return `https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`;
}
