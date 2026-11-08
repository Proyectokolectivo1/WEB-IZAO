import 'server-only';
/**
 * Credenciales de integraciones (§24.1, §26.3) con el cliente de servicio. Reglas:
 *  - Se cifran con `cifrarCredenciales` (AES-256-GCM, formato D-024: AAD proveedor|país|ambiente).
 *  - Nunca se leen `data_encrypted`/`iv` para mostrarlas: las listas solo traen `masked_preview`.
 *  - Una sola credencial activa por proveedor y país (los lectores de pagos, WhatsApp y MasterShop esperan
 *    exactamente una fila activa).
 *  - Toda escritura se audita sin valores secretos (solo los nombres de los campos que cambiaron).
 */
import {
  byteaDesdePostgrest,
  byteaParaPostgrest,
  cifrarCredenciales,
  descifrarCredenciales,
  CredentialCryptoError,
  type ContextoCredencial,
} from '@izao/core/credentials';
import { auditarCambio } from '@/lib/admin/auditoria';
import { activarCredencialIntegracionDb, type ResultadoActivarCredencial } from '@/lib/db/credenciales-integracion';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import type { ErroresCampo, ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import {
  esAmbiente,
  esAmbito,
  paisDb,
  mezclarConGuardados,
  proveedorPorId,
  redactarSecretos,
  validarCredencial,
  vistaPrevia,
  type AmbienteIntegracion,
  type PaisIntegracion,
  type ProveedorPanel,
} from './catalogo';
import type { ModoIntegraciones, Sonda } from './sondas';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
export type ResultadoIntegracion = ResultadoAccion & { errores?: ErroresCampo };

/** Lo único que sale de aquí hacia el navegador. Sin `data_encrypted`, `iv` ni valores. */
export type FilaCredencialPublica = {
  id: string;
  provider: string;
  country_code: string | null;
  environment: AmbienteIntegracion;
  masked_preview: Record<string, string>;
  is_active: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  updated_at: string;
};

const COLUMNAS_PUBLICAS =
  'id, provider, country_code, environment, masked_preview, is_active, last_test_at, last_test_ok, last_test_message, updated_at';

const MSG_CLAVE =
  'Falta la clave de cifrado del servidor (APP_ENCRYPTION_KEY). Pide a quien administra el servidor que la configure.';

export async function listarCredenciales(cliente: Cliente): Promise<FilaCredencialPublica[]> {
  const { data, error } = await cliente
    .from('integration_credentials')
    .select(COLUMNAS_PUBLICAS)
    .order('provider', { ascending: true })
    .order('country_code', { ascending: true })
    .order('environment', { ascending: true });
  if (error) throw new Error(`No se pudieron listar las credenciales: ${error.message}`);
  return (data ?? []) as never;
}

type FilaCifrada = {
  id: string;
  provider: string;
  country_code: string | null;
  environment: string;
  data_encrypted: string;
  iv: string;
  key_version: number;
  is_active?: boolean;
};

function ctxDe(provider: string, pais: string | null, ambiente: AmbienteIntegracion): ContextoCredencial {
  return { provider, country_code: pais, environment: ambiente };
}

async function descifrarFila(clave: string, fila: FilaCifrada): Promise<Record<string, string>> {
  return descifrarCredenciales(clave, ctxDe(fila.provider, fila.country_code, fila.environment as AmbienteIntegracion), {
    data_encrypted: byteaDesdePostgrest(fila.data_encrypted),
    iv: byteaDesdePostgrest(fila.iv),
    key_version: Number(fila.key_version),
  });
}

function camposEscritos(valores: Record<string, string>): string[] {
  return Object.keys(valores).filter((k) => (valores[k] ?? '').trim() !== '');
}

/** Guarda (crea o reemplaza) la credencial de proveedor+país+ambiente. Un secreto en blanco conserva el guardado. */
export async function guardarCredencialBd(
  args: Ctx & {
    clave: string | undefined;
    proveedorId: string;
    pais: string;
    ambiente: string;
    valores: Record<string, string>;
  },
): Promise<ResultadoIntegracion> {
  const { cliente, actor, ip } = args;
  if (!args.clave) return { ok: false, mensaje: MSG_CLAVE };
  const proveedor = proveedorPorId(args.proveedorId);
  if (!proveedor) return { ok: false, mensaje: 'Proveedor no válido.' };
  if (!esAmbito(args.pais) || !esAmbiente(args.ambiente)) {
    return {
      ok: false,
      mensaje: 'Revisa los campos marcados.',
      errores: validarCredencial(proveedor, args.pais, args.ambiente, {}),
    };
  }
  const ambito = args.pais;
  const pais = paisDb(ambito); // `null` = credencial global (sin país)
  const ambiente: AmbienteIntegracion = args.ambiente;

  // El ámbito global es `country_code is null` (un `eq` con null no encuentra nada).
  const consultaPrevia = cliente
    .from('integration_credentials')
    .select('id, provider, country_code, environment, data_encrypted, iv, key_version')
    .eq('provider', proveedor.id);
  const { data: previa, error: errPrevia } = await (pais === null ? consultaPrevia.is('country_code', null) : consultaPrevia.eq('country_code', pais))
    .eq('environment', ambiente)
    .maybeSingle();
  if (errPrevia) return { ok: false, mensaje: traducirErrorBd(errPrevia).mensaje };
  const existente = (previa as FilaCifrada | null) ?? null;

  let guardados: Record<string, string> | null = null;
  const faltaSecreto = proveedor.esquema.fields.some((c) => c.secret && (args.valores[c.key] ?? '').trim() === '');
  if (existente && faltaSecreto) {
    try {
      guardados = await descifrarFila(args.clave, existente);
    } catch (e) {
      if (!(e instanceof CredentialCryptoError)) throw e;
      return {
        ok: false,
        mensaje: 'No se pudo leer lo guardado (la clave de cifrado cambió). Escribe de nuevo todos los secretos.',
      };
    }
  }

  const valores = mezclarConGuardados(proveedor, args.valores, guardados);
  const errores = validarCredencial(proveedor, ambito, ambiente, valores);
  if (Object.keys(errores).length > 0) return { ok: false, mensaje: 'Revisa los campos marcados.', errores };

  const cifrado = await cifrarCredenciales(args.clave, ctxDe(proveedor.id, pais, ambiente), valores);
  const fila = {
    data_encrypted: byteaParaPostgrest(cifrado.data_encrypted),
    iv: byteaParaPostgrest(cifrado.iv),
    key_version: cifrado.key_version,
    masked_preview: vistaPrevia(proveedor, valores),
    // Lo guardado cambió: la última prueba ya no vale.
    last_test_at: null,
    last_test_ok: null,
    last_test_message: null,
  };

  let id: string;
  if (existente) {
    const { error } = await cliente.from('integration_credentials').update(fila).eq('id', existente.id);
    if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };
    id = existente.id;
  } else {
    const { data, error } = await cliente
      .from('integration_credentials')
      .insert({ provider: proveedor.id, country_code: pais, environment: ambiente, is_active: false, ...fila })
      .select('id')
      .single();
    if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };
    id = String((data as { id: string }).id);
  }

  // Si es la primera credencial del proveedor en ese país, queda activa sola.
  let activada = false;
  const consultaActivas = cliente.from('integration_credentials').select('id').eq('provider', proveedor.id);
  const { data: activas, error: errActivas } = await (pais === null ? consultaActivas.is('country_code', null) : consultaActivas.eq('country_code', pais)).eq(
    'is_active',
    true,
  );
  if (!errActivas && ((activas as unknown[] | null) ?? []).length === 0) {
    const { error } = await cliente.from('integration_credentials').update({ is_active: true }).eq('id', id);
    activada = !error;
  }

  await auditarCambio({
    actor,
    accion: existente ? 'integracion.credencial_actualizada' : 'integracion.credencial_creada',
    entidad: 'integration_credentials',
    entidadId: id,
    ip,
    diff: {
      proveedor: proveedor.id,
      pais,
      ambiente,
      campos_cambiados: camposEscritos(args.valores),
      activada_automaticamente: activada,
    },
  });
  return {
    ok: true,
    id,
    mensaje: activada ? 'Credenciales guardadas y activadas.' : 'Credenciales guardadas. Actívalas cuando quieras usarlas.',
  };
}

async function leerPublica(cliente: Cliente, id: string): Promise<FilaCredencialPublica | null> {
  const { data, error } = await cliente.from('integration_credentials').select(COLUMNAS_PUBLICAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la credencial: ${error.message}`);
  return (data as FilaCredencialPublica | null) ?? null;
}

/**
 * Deja esta credencial como la única activa de su proveedor y país con la función `activar_credencial_integracion`
 * (una transacción: apaga la activa anterior y enciende la pedida; el índice único parcial impide dos activas).
 */
export async function activarCredencialBd(
  args: Ctx & { id: string; activar?: (id: string) => Promise<ResultadoActivarCredencial> },
): Promise<ResultadoIntegracion> {
  const { cliente, actor, ip, id } = args;
  const activar = args.activar ?? activarCredencialIntegracionDb;
  const fila = await leerPublica(cliente, id);
  if (!fila) return { ok: false, mensaje: 'Esa credencial ya no existe.' };
  if (fila.is_active) return { ok: true, id, mensaje: 'Esa credencial ya estaba activa.' };

  let r: ResultadoActivarCredencial;
  try {
    r = await activar(id);
  } catch (e) {
    console.error('[integraciones] no se pudo activar la credencial:', e instanceof Error ? e.name : 'error');
    return { ok: false, mensaje: 'No se pudo cambiar la credencial activa. No se hizo ningún cambio.' };
  }
  if (!r.ok) {
    return {
      ok: false,
      mensaje: r.motivo === 'no_existe' ? 'Esa credencial ya no existe.' : 'Identificador de credencial no válido.',
    };
  }
  if (r.estado === 'ya_activa') return { ok: true, id, mensaje: 'Esa credencial ya estaba activa.' };

  await auditarCambio({
    actor,
    accion: 'integracion.credencial_activada',
    entidad: 'integration_credentials',
    entidadId: id,
    ip,
    diff: {
      proveedor: fila.provider,
      pais: fila.country_code,
      ambiente: fila.environment,
      desactivada_id: r.anterior_id,
      desactivada_ambiente: r.anterior_environment,
    },
  });
  return { ok: true, id, mensaje: 'Credencial activada. Las demás de este proveedor y país quedaron inactivas.' };
}

export async function desactivarCredencialBd(args: Ctx & { id: string }): Promise<ResultadoIntegracion> {
  const { cliente, actor, ip, id } = args;
  const fila = await leerPublica(cliente, id);
  if (!fila) return { ok: false, mensaje: 'Esa credencial ya no existe.' };
  if (!fila.is_active) return { ok: true, id, mensaje: 'Esa credencial ya estaba inactiva.' };
  const { error } = await cliente.from('integration_credentials').update({ is_active: false }).eq('id', id);
  if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };
  await auditarCambio({
    actor,
    accion: 'integracion.credencial_desactivada',
    entidad: 'integration_credentials',
    entidadId: id,
    ip,
    diff: { proveedor: fila.provider, pais: fila.country_code, ambiente: fila.environment },
  });
  return { ok: true, id, mensaje: 'Credencial desactivada.' };
}

async function leerCifrada(cliente: Cliente, id: string): Promise<FilaCifrada | null> {
  const { data, error } = await cliente
    .from('integration_credentials')
    .select('id, provider, country_code, environment, data_encrypted, iv, key_version, is_active')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la credencial: ${error.message}`);
  return (data as FilaCifrada | null) ?? null;
}

type Descifrada = { fila: FilaCifrada; proveedor: ProveedorPanel; valores: Record<string, string> };

async function abrir(
  cliente: Cliente,
  clave: string | undefined,
  id: string,
): Promise<Descifrada | ResultadoIntegracion> {
  if (!clave) return { ok: false, mensaje: MSG_CLAVE };
  const fila = await leerCifrada(cliente, id);
  if (!fila) return { ok: false, mensaje: 'Esa credencial ya no existe.' };
  const proveedor = proveedorPorId(fila.provider);
  if (!proveedor) return { ok: false, mensaje: 'Proveedor no válido.' };
  try {
    return { fila, proveedor, valores: await descifrarFila(clave, fila) };
  } catch (e) {
    if (!(e instanceof CredentialCryptoError)) throw e;
    return {
      ok: false,
      mensaje: 'No se pudo leer lo guardado (la clave de cifrado cambió). Vuelve a guardar las credenciales.',
    };
  }
}

/** "Probar conexión": descifra en memoria, llama a la sonda del proveedor y guarda el resultado. */
export async function probarConexionBd(
  args: Ctx & { clave: string | undefined; id: string; sondas: Record<string, Sonda> },
): Promise<ResultadoIntegracion> {
  const { cliente, actor, ip, id } = args;
  const abierta = await abrir(cliente, args.clave, id);
  if ('ok' in abierta) return abierta;
  const { fila, proveedor, valores } = abierta;
  const sonda = args.sondas[proveedor.id];
  if (!sonda) return { ok: false, mensaje: 'Este proveedor aún no tiene prueba de conexión.' };

  let resultado: { ok: boolean; message: string };
  try {
    resultado = await sonda({
      pais: fila.country_code as PaisIntegracion | null,
      ambiente: fila.environment as AmbienteIntegracion,
      valores,
    });
  } catch (e) {
    console.error(`[integraciones] falló la prueba de ${proveedor.id}: ${e instanceof Error ? e.name : 'error'}`);
    resultado = { ok: false, message: 'La prueba no pudo completarse. Inténtalo de nuevo.' };
  }
  const mensaje = redactarSecretos(resultado.message, proveedor, valores).slice(0, 200);
  const { error } = await cliente
    .from('integration_credentials')
    .update({ last_test_at: new Date().toISOString(), last_test_ok: resultado.ok, last_test_message: mensaje })
    .eq('id', id);
  if (error) console.error('[integraciones] no se guardó el resultado de la prueba:', error.code);
  await auditarCambio({
    actor,
    accion: 'integracion.conexion_probada',
    entidad: 'integration_credentials',
    entidadId: id,
    ip,
    diff: { proveedor: proveedor.id, pais: fila.country_code, ambiente: fila.environment, ok: resultado.ok },
  });
  return resultado.ok ? { ok: true, id, mensaje } : { ok: false, mensaje };
}

export type WebhookRegistrado = { event_name: string; event_id: number; is_enabled: boolean; registered_at: string };

/** Webhooks de MasterShop ya registrados (sin ids externos ni URL). */
export async function listarWebhooksMasterShop(
  cliente: Cliente,
  ambiente: AmbienteIntegracion,
  pais: PaisIntegracion = 'CO',
): Promise<WebhookRegistrado[]> {
  const { data, error } = await cliente
    .from('integration_webhooks')
    .select('event_name, event_id, is_enabled, registered_at')
    .eq('provider', 'mastershop')
    .eq('country_code', pais)
    .eq('environment', ambiente)
    .order('event_id', { ascending: true });
  if (error) throw new Error(`No se pudieron listar los webhooks: ${error.message}`);
  return (data ?? []) as never;
}

/** "Registrar webhooks" de MasterShop (CO o EC, cada país con su llave) con la llave de la credencial elegida. */
export async function registrarWebhooksBd(
  args: Ctx & {
    clave: string | undefined;
    id: string;
    modo: ModoIntegraciones;
    registrar: (
      apiKey: string,
      ambiente: AmbienteIntegracion,
      opciones: { pais: PaisIntegracion },
    ) => Promise<{ registrados: { idWebhook: number; eventName: string }[] }>;
    secretosExtra?: readonly string[];
  },
): Promise<ResultadoIntegracion> {
  const { cliente, actor, ip, id } = args;
  const abierta = await abrir(cliente, args.clave, id);
  if ('ok' in abierta) return abierta;
  const { fila, proveedor, valores } = abierta;
  if (proveedor.id !== 'mastershop' || (fila.country_code !== 'CO' && fila.country_code !== 'EC')) {
    return { ok: false, mensaje: 'Los webhooks se registran solo para MasterShop en Colombia o Ecuador.' };
  }
  const pais: PaisIntegracion = fila.country_code;
  const ambiente = fila.environment as AmbienteIntegracion;

  if (args.modo === 'mock') {
    return { ok: true, id, mensaje: 'Simulación: no se registró nada en MasterShop (modo de pruebas).' };
  }
  try {
    const r = await args.registrar(valores.api_key ?? '', ambiente, { pais });
    await auditarCambio({
      actor,
      accion: 'integracion.webhooks_registrados',
      entidad: 'integration_credentials',
      entidadId: id,
      ip,
      diff: { proveedor: 'mastershop', pais, ambiente, eventos: r.registrados.map((w) => w.eventName) },
    });
    return {
      ok: true,
      id,
      mensaje:
        r.registrados.length === 0
          ? 'Los webhooks de MasterShop ya estaban registrados.'
          : `Webhooks registrados: ${r.registrados.map((w) => w.eventName).join(', ')}.`,
    };
  } catch (e) {
    const crudo = e instanceof Error ? e.message : 'error';
    console.error(`[integraciones] no se registraron los webhooks: ${e instanceof Error ? e.name : 'error'}`);
    let msg = redactarSecretos(crudo, proveedor, valores);
    for (const s of args.secretosExtra ?? []) if (s.length >= 4) msg = msg.split(s).join('****');
    // Solo se muestran los mensajes propios (configuración y MasterShop); cualquier otro es genérico.
    const propio = e instanceof Error && (e.name === 'MasterShopError' || /^Faltan SITE_URL/.test(crudo));
    return {
      ok: false,
      mensaje: propio
        ? `No se pudieron registrar los webhooks: ${msg.slice(0, 160)}`
        : 'No se pudieron registrar los webhooks. Inténtalo de nuevo.',
    };
  }
}
