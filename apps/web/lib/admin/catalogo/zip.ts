/**
 * Lectura y escritura mínima de ZIP (suficiente para .xlsx y para el .zip de imágenes por SKU).
 * Solo método 0 (sin comprimir) y 8 (deflate). Sin ZIP64, sin cifrado. Defiende contra "bombas":
 * el tamaño descomprimido se limita por entrada y en total, y la lectura se corta al pasar el límite.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export type EntradaZip = { nombre: string; datos: Buffer };

export type LimitesZip = {
  maxEntradas: number;
  maxBytesEntrada: number;
  maxBytesTotal: number;
};

export class ErrorZip extends Error {}

const FIRMA_EOCD = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/** Extrae los archivos (no carpetas) del ZIP. Lanza `ErrorZip` ante datos dañados o fuera de límites. */
export function leerZip(zip: Buffer, limites: LimitesZip): EntradaZip[] {
  if (zip.length < 22) throw new ErrorZip('El archivo no es un ZIP válido.');
  // El registro final puede estar precedido por un comentario de hasta 65535 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i -= 1) {
    if (zip.readUInt32LE(i) === FIRMA_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErrorZip('El archivo no es un ZIP válido.');
  const total = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  if (total === 0xffff || cursor === 0xffffffff) throw new ErrorZip('ZIP64 no está soportado.');
  if (total > limites.maxEntradas) throw new ErrorZip(`El ZIP tiene más de ${limites.maxEntradas} archivos.`);

  const salida: EntradaZip[] = [];
  let acumulado = 0;
  for (let n = 0; n < total; n += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== FIRMA_CENTRAL) throw new ErrorZip('El ZIP está dañado.');
    const banderas = zip.readUInt16LE(cursor + 8);
    const metodo = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const tamComprimido = zip.readUInt32LE(cursor + 20);
    const tamReal = zip.readUInt32LE(cursor + 24);
    const largoNombre = zip.readUInt16LE(cursor + 28);
    const largoExtra = zip.readUInt16LE(cursor + 30);
    const largoComentario = zip.readUInt16LE(cursor + 32);
    const desplazamiento = zip.readUInt32LE(cursor + 42);
    const nombre = zip.subarray(cursor + 46, cursor + 46 + largoNombre).toString(banderas & 0x800 ? 'utf8' : 'latin1');
    cursor += 46 + largoNombre + largoExtra + largoComentario;

    if (nombre.endsWith('/')) continue; // carpeta
    if (banderas & 1) throw new ErrorZip('El ZIP está cifrado.');
    if (tamReal > limites.maxBytesEntrada) throw new ErrorZip(`"${nombre}" es demasiado grande.`);
    acumulado += tamReal;
    if (acumulado > limites.maxBytesTotal) throw new ErrorZip('El contenido del ZIP es demasiado grande.');

    if (desplazamiento + 30 > zip.length || zip.readUInt32LE(desplazamiento) !== FIRMA_LOCAL) throw new ErrorZip('El ZIP está dañado.');
    const inicio = desplazamiento + 30 + zip.readUInt16LE(desplazamiento + 26) + zip.readUInt16LE(desplazamiento + 28);
    const crudo = zip.subarray(inicio, inicio + tamComprimido);
    let datos: Buffer;
    if (metodo === 0) datos = Buffer.from(crudo);
    else if (metodo === 8) {
      try {
        datos = inflateRawSync(crudo, { maxOutputLength: limites.maxBytesEntrada + 1 });
      } catch {
        throw new ErrorZip(`No se pudo descomprimir "${nombre}".`);
      }
    } else throw new ErrorZip(`Método de compresión no soportado en "${nombre}".`);
    if (datos.length !== tamReal || crc32(datos) !== crc) throw new ErrorZip(`"${nombre}" está dañado.`);
    salida.push({ nombre, datos });
  }
  return salida;
}

/** Crea un ZIP con deflate. Los nombres se guardan en UTF-8. */
export function crearZip(entradas: readonly EntradaZip[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const comprimido = deflateRawSync(e.datos);
    const usarDeflate = comprimido.length < e.datos.length;
    const cuerpo = usarDeflate ? comprimido : e.datos;
    const metodo = usarDeflate ? 8 : 0;
    const crc = crc32(e.datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(FIRMA_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, cuerpo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(FIRMA_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(cuerpo.length, 20);
    central.writeUInt32LE(e.datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);
    desplazamiento += 30 + nombre.length + cuerpo.length;
  }
  const tamCentral = centrales.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(FIRMA_EOCD, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, ...centrales, fin]);
}
