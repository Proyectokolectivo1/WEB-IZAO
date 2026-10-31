/**
 * Marcadores `[[producto:slug]]` (§20.2). El modelo escribe el marcador dentro de su texto en streaming y puede llegar
 * partido entre fragmentos: este filtro lo retiene hasta tenerlo completo, lo quita del texto que ve la persona y entrega
 * el slug para que el servidor lo valide y mande la tarjeta. Un marcador sin cerrar no se muestra nunca.
 */
const MARCADOR = /^producto:([a-z0-9][a-z0-9-]{0,118})$/i;
/** Un marcador cabe en esto; si `[[` no cierra antes, era texto normal. */
const MAX_MARCADOR = 140;

export interface SalidaFiltro {
  texto: string;
  slugs: string[];
}

export class FiltroMarcadores {
  private buffer = '';

  empujar(delta: string): SalidaFiltro {
    this.buffer += delta;
    let texto = '';
    const slugs: string[] = [];
    for (;;) {
      const ini = this.buffer.indexOf('[[');
      if (ini < 0) {
        // Un `[` suelto al final podría ser el comienzo de `[[`.
        const reserva = this.buffer.endsWith('[') ? 1 : 0;
        texto += this.buffer.slice(0, this.buffer.length - reserva);
        this.buffer = this.buffer.slice(this.buffer.length - reserva);
        break;
      }
      texto += this.buffer.slice(0, ini);
      this.buffer = this.buffer.slice(ini);
      const fin = this.buffer.indexOf(']]');
      if (fin < 0) {
        if (this.buffer.length > MAX_MARCADOR) {
          texto += '[[';
          this.buffer = this.buffer.slice(2);
          continue;
        }
        break; // se espera el resto
      }
      const m = MARCADOR.exec(this.buffer.slice(2, fin).trim());
      if (m?.[1]) slugs.push(m[1].toLowerCase());
      else texto += this.buffer.slice(0, fin + 2);
      this.buffer = this.buffer.slice(fin + 2);
    }
    return { texto, slugs };
  }

  /** Fin de la respuesta: lo retenido que no era un marcador completo se descarta si empieza como uno. */
  cerrar(): SalidaFiltro {
    const resto = this.buffer;
    this.buffer = '';
    return { texto: resto.startsWith('[[') ? '' : resto, slugs: [] };
  }
}
