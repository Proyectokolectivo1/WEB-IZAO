import { claveCarrito } from '@/lib/store/carrito/logica';

/**
 * Script en línea de las páginas del bolso y del checkout: si el bolso guardado en el navegador está vacío, marca
 * `<html data-bolso="vacio">` ANTES del primer pintado; el CSS (`.bolso-previo`, en globals.css) muestra entonces el estado
 * vacío que luego pinta React con el mismo aspecto. Si hay productos o falla la lectura, no hace nada y se ve el marcador de carga.
 * Es un componente de servidor: un `<script>` creado en el cliente no se ejecutaría.
 */
const CODIGO = `try{var r=localStorage.getItem(${JSON.stringify(claveCarrito(''))}+location.pathname.split('/')[1]);var d=r&&JSON.parse(r);if(!(d&&d.lineas&&d.lineas.length))document.documentElement.setAttribute('data-bolso','vacio')}catch(e){document.documentElement.setAttribute('data-bolso','vacio')}`;

export function ScriptBolsoVacio() {
  return <script dangerouslySetInnerHTML={{ __html: CODIGO }} />;
}
