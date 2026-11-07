import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashTokenAgente, type TrabajoFila } from './contrato';
import {
  manejarConfig,
  manejarEtiqueta,
  manejarLatido,
  manejarReclamo,
  manejarResultado,
  rutaSegura,
  type AgenteFila,
  type CierreTrabajo,
  type DepsAgente,
  type FuenteAgente,
} from './manejar';

const TOKEN_A = 'tokenA_'.padEnd(40, 'a');
const TOKEN_B = 'tokenB_'.padEnd(40, 'b');
const MEDIA = path.resolve('/srv/izao/media');
const PDF = new TextEncoder().encode('%PDF-1.4\n%etiqueta\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

class FuenteMemoria implements FuenteAgente {
  agentes = new Map<string, AgenteFila & { activo: boolean }>([
    [hashTokenAgente(TOKEN_A), { id: 'ag-a', name: 'PC despacho', mode: 'api', remote_config: {}, activo: true }],
    [hashTokenAgente(TOKEN_B), { id: 'ag-b', name: 'PC respaldo', mode: 'api', remote_config: {}, activo: true }],
  ]);
  latidos: { agenteId: string; datos: unknown }[] = [];
  trabajos = new Map<string, TrabajoFila & { printed_at?: string | null; error?: string | null }>();
  alertas: { orderId: string; payload: Record<string, unknown> }[] = [];
  etiquetas = new Map<string, string>();

  agregar(n: number, p: Partial<TrabajoFila> = {}) {
    const t: TrabajoFila = {
      id: uuid(n), type: 'label', status: 'queued', order_id: `ord-${n}`, shipment_id: `shp-${n}`, order_number: `IZ-CO-${String(n).padStart(6, '0')}`,
      claimed_by_agent: null, claimed_at: null, attempts: 0, requested_by: 'auto', created_at: new Date(Date.UTC(2026, 9, 20, 10, n)).toISOString(), ...p,
    };
    this.trabajos.set(t.id, t);
    return t;
  }
  async agentePorHash(h: string) {
    const a = this.agentes.get(h);
    return a && a.activo ? a : null;
  }
  async guardarLatido(agenteId: string, datos: unknown) {
    this.latidos.push({ agenteId, datos });
  }
  private orden = () => [...this.trabajos.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  async reclamadosPor(agenteId: string, max: number) {
    return this.orden().filter((t) => t.status === 'claimed' && t.claimed_by_agent === agenteId).slice(0, max);
  }
  private disponible(t: TrabajoFila, agenteId: string, vencido: Date) {
    return t.status === 'queued' || (t.status === 'claimed' && t.claimed_by_agent !== agenteId && t.claimed_at !== null && t.claimed_at < vencido.toISOString());
  }
  async candidatos(agenteId: string, max: number, vencido: Date) {
    return this.orden().filter((t) => this.disponible(t, agenteId, vencido)).slice(0, max).map((t) => t.id);
  }
  /** Para simular la carrera: se ejecuta antes del UPDATE condicionado. */
  antesDeReclamar: (() => void) | null = null;
  async reclamar(ids: readonly string[], agenteId: string, ahora: Date, vencido: Date) {
    this.antesDeReclamar?.();
    const r: TrabajoFila[] = [];
    for (const id of ids) {
      const t = this.trabajos.get(id);
      if (t && this.disponible(t, agenteId, vencido)) {
        Object.assign(t, { status: 'claimed', claimed_by_agent: agenteId, claimed_at: ahora.toISOString() });
        r.push({ ...t });
      }
    }
    return r;
  }
  async trabajo(id: string) {
    const t = this.trabajos.get(id);
    return t ? { ...t } : null;
  }
  async cerrar(id: string, agenteId: string, c: CierreTrabajo) {
    const t = this.trabajos.get(id);
    if (!t || t.status !== 'claimed' || t.claimed_by_agent !== agenteId) return false;
    Object.assign(t, c);
    return true;
  }
  async rutaEtiqueta(shipmentId: string) {
    return this.etiquetas.get(shipmentId) ?? null;
  }
  async alertaPedido(orderId: string, payload: Record<string, unknown>) {
    this.alertas.push({ orderId, payload });
  }
}

function escenario() {
  const fuente = new FuenteMemoria();
  const archivos = new Map<string, Uint8Array>();
  const capturas = new Map<string, Uint8Array>();
  let ahora = new Date(Date.UTC(2026, 9, 20, 15, 0, 0));
  const deps: DepsAgente = {
    fuente,
    mediaRoot: MEDIA,
    leerArchivo: async (abs) => archivos.get(abs) ?? null,
    guardarCaptura: async (nombre, b) => {
      capturas.set(nombre, b);
      return `agent-screenshots/${nombre}`;
    },
    ahora: () => ahora,
  };
  return { fuente, archivos, capturas, deps, avanzar: (ms: number) => (ahora = new Date(ahora.getTime() + ms)) };
}

const req = (ruta: string, token: string | null, cuerpo?: unknown, metodo = cuerpo === undefined ? 'GET' : 'POST') =>
  new Request(`https://izaoperfumeria.com${ruta}`, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }) },
    body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
const latido = { version: '1.0.0', printer: 'Zebra', printer_ok: true, queue_size: 0, last_error: null };

describe('API del agente: autenticación', () => {
  it('sin token, token mal formado, desconocido o inactivo → 401', async () => {
    const { deps, fuente } = escenario();
    expect((await manejarLatido(req('/api/agent/heartbeat', null, latido), deps)).status).toBe(401);
    expect((await manejarLatido(req('/api/agent/heartbeat', 'corto', latido), deps)).status).toBe(401);
    expect((await manejarLatido(req('/api/agent/heartbeat', 'x'.repeat(40), latido), deps)).status).toBe(401);
    fuente.agentes.get(hashTokenAgente(TOKEN_A))!.activo = false;
    expect((await manejarLatido(req('/api/agent/heartbeat', TOKEN_A, latido), deps)).status).toBe(401);
  });

  it('base caída al autenticar → 503 sin detalles', async () => {
    const { deps } = escenario();
    deps.fuente.agentePorHash = async () => {
      throw new Error('ECONNREFUSED 10.0.0.1');
    };
    const r = await manejarLatido(req('/api/agent/heartbeat', TOKEN_A, latido), deps);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('10.0.0.1');
  });
});

describe('heartbeat y config', () => {
  it('guarda versión, impresora y estado; responde la versión de la configuración', async () => {
    const { deps, fuente } = escenario();
    const r = await manejarLatido(req('/api/agent/heartbeat', TOKEN_A, { ...latido, panel_state: 'needs_login' }), deps);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { ok: boolean; config_version: string };
    expect(b.ok).toBe(true);
    expect(fuente.latidos[0]).toMatchObject({ agenteId: 'ag-a', datos: { version: '1.0.0', printer_name: 'Zebra', status_payload: { panel_state: 'needs_login', queue_size: 0 } } });
    const c = (await (await manejarConfig(req('/api/agent/config', TOKEN_A), deps)).json()) as Record<string, unknown>;
    expect(c).toMatchObject({ contract_version: 1, contract_revision: '1.1', config_version: b.config_version, agent: { id: 'ag-a', mode: 'api' }, intervals: { heartbeat_seconds: 30, claim_seconds: 10 }, max_claim: 5, panel: null });
  });

  it('heartbeat con claves extra o tipos malos → 400', async () => {
    const { deps } = escenario();
    expect((await manejarLatido(req('/api/agent/heartbeat', TOKEN_A, { ...latido, token: 'x' }), deps)).status).toBe(400);
    expect((await manejarLatido(req('/api/agent/heartbeat', TOKEN_A, { ...latido, queue_size: -1 }), deps)).status).toBe(400);
    expect((await manejarLatido(req('/api/agent/heartbeat', TOKEN_A, 'no-json'), deps)).status).toBe(400);
  });

  it('config remota: intervalos válidos se respetan, inválidos caen al defecto; cambia config_version', async () => {
    const { deps, fuente } = escenario();
    const v1 = ((await (await manejarConfig(req('/api/agent/config', TOKEN_A), deps)).json()) as { config_version: string }).config_version;
    fuente.agentes.get(hashTokenAgente(TOKEN_A))!.remote_config = { intervals: { claim_seconds: 20, heartbeat_seconds: 1 }, panel: { url: 'https://panel.example' } };
    const c = (await (await manejarConfig(req('/api/agent/config', TOKEN_A), deps)).json()) as Record<string, unknown>;
    expect(c).toMatchObject({ intervals: { claim_seconds: 20, heartbeat_seconds: 30 }, panel: { url: 'https://panel.example' } });
    expect(c.config_version).not.toBe(v1);
  });
});

describe('jobs/claim', () => {
  it('reclama hasta 5 del más antiguo al más nuevo y marca reimpresiones', async () => {
    const { deps, fuente } = escenario();
    for (let i = 1; i <= 7; i++) fuente.agregar(i, i === 2 ? { requested_by: 'admin:u-1' } : {});
    const r = (await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A, {}), deps)).json()) as { jobs: { id: string; reprint: boolean; label_path: string }[] };
    expect(r.jobs.map((j) => j.id)).toEqual([1, 2, 3, 4, 5].map(uuid));
    expect(r.jobs[1]!.reprint).toBe(true);
    expect(r.jobs[0]).toMatchObject({ reprint: false, label_path: `/api/agent/jobs/${uuid(1)}/label`, order_number: 'IZ-CO-000001' });
    expect(fuente.trabajos.get(uuid(1))).toMatchObject({ status: 'claimed', claimed_by_agent: 'ag-a' });
  });

  it('v1.1 (D-051): label_url solo en etiquetas sin copia en el servidor y del CDN de MasterShop', async () => {
    const { deps, fuente } = escenario();
    const cdn = 'https://cdn.bemaster.com/mastershop/files/carriers/coordinadora/guide-pdf/75070783091-standard.pdf';
    fuente.agregar(1, { label_url: cdn, label_local: false });
    fuente.agregar(2, { label_url: cdn, label_local: true });
    fuente.agregar(3, { label_url: 'https://169.254.169.254/latest/meta-data', label_local: false });
    fuente.agregar(4, { label_url: 'http://cdn.bemaster.com/x.pdf', label_local: false });
    fuente.agregar(5, { type: 'test_page', order_id: null, shipment_id: null, order_number: null, label_url: cdn });
    const r = (await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A, {}), deps)).json()) as { jobs: { label_url: string | null }[] };
    expect(r.jobs.map((j) => j.label_url)).toEqual([cdn, null, null, null, null]);
    // El PDF del servidor sigue respondiendo 404 sin copia local: el agente 1.0 no cambia de comportamiento.
    const pdf = await manejarEtiqueta(req(`/api/agent/jobs/${uuid(1)}/label`, TOKEN_A), uuid(1), deps);
    expect(pdf.status).toBe(404);
  });

  it('idempotente tras un reinicio: devuelve primero los que ya tenía, sin duplicar', async () => {
    const { deps, fuente } = escenario();
    for (let i = 1; i <= 3; i++) fuente.agregar(i);
    await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A, { max: 2 }), deps);
    const r = (await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A, { max: 5 }), deps)).json()) as { jobs: { id: string }[] };
    expect(r.jobs.map((j) => j.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it('dos agentes nunca reciben el mismo trabajo (carrera en el UPDATE condicionado)', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1);
    fuente.agregar(2);
    // B reclama el 1 justo entre la lectura de candidatos de A y su UPDATE.
    fuente.antesDeReclamar = () => {
      fuente.antesDeReclamar = null;
      Object.assign(fuente.trabajos.get(uuid(1))!, { status: 'claimed', claimed_by_agent: 'ag-b', claimed_at: new Date().toISOString() });
    };
    const r = (await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A), deps)).json()) as { jobs: { id: string }[] };
    expect(r.jobs.map((j) => j.id)).toEqual([uuid(2)]);
  });

  it('un reclamo de otro agente vencido (> 15 min sin resultado) se puede retomar; uno reciente no', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-b', claimed_at: new Date(Date.UTC(2026, 9, 20, 14, 50)).toISOString() });
    let r = (await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A), deps)).json()) as { jobs: unknown[] };
    expect(r.jobs).toHaveLength(0);
    fuente.trabajos.get(uuid(1))!.claimed_at = new Date(Date.UTC(2026, 9, 20, 14, 40)).toISOString();
    r = (await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A), deps)).json()) as { jobs: unknown[] };
    expect(r.jobs).toHaveLength(1);
  });

  it('cancelados e impresos no se reclaman; max fuera de rango → 400', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { status: 'cancelled' });
    fuente.agregar(2, { status: 'printed', claimed_by_agent: 'ag-a' });
    expect(((await (await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A), deps)).json()) as { jobs: unknown[] }).jobs).toEqual([]);
    expect((await manejarReclamo(req('/api/agent/jobs/claim', TOKEN_A, { max: 6 }), deps)).status).toBe(400);
  });
});

describe('jobs/{id}/label', () => {
  it('sirve el PDF guardado solo al agente que lo reclamó', async () => {
    const { deps, fuente, archivos } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-a' });
    fuente.etiquetas.set('shp-1', 'labels/IZ-CO-000001.pdf');
    archivos.set(path.resolve(MEDIA, 'labels/IZ-CO-000001.pdf'), PDF);
    const r = await manejarEtiqueta(req(`/api/agent/jobs/${uuid(1)}/label`, TOKEN_A), uuid(1), deps);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toContain('IZ-CO-000001.pdf');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
    expect((await manejarEtiqueta(req(`/api/agent/jobs/${uuid(1)}/label`, TOKEN_B), uuid(1), deps)).status).toBe(404);
  });

  it('no reclamado, id inválido o ruta fuera de labels/ → 404', async () => {
    const { deps, fuente, archivos } = escenario();
    fuente.agregar(1);
    expect((await manejarEtiqueta(req('/x', TOKEN_A), uuid(1), deps)).status).toBe(404);
    expect((await manejarEtiqueta(req('/x', TOKEN_A), '../../etc', deps)).status).toBe(404);
    fuente.agregar(2, { status: 'claimed', claimed_by_agent: 'ag-a' });
    fuente.etiquetas.set('shp-2', '../secretos/x.pdf');
    archivos.set(path.resolve(MEDIA, '../secretos/x.pdf'), PDF);
    expect((await manejarEtiqueta(req('/x', TOKEN_A), uuid(2), deps)).status).toBe(404);
  });

  it('página de prueba: PDF generado por el servidor; lista de empaque: 501', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { type: 'test_page', order_id: null, shipment_id: null, order_number: null, status: 'claimed', claimed_by_agent: 'ag-a' });
    const r = await manejarEtiqueta(req('/x', TOKEN_A), uuid(1), deps);
    expect(r.status).toBe(200);
    const texto = new TextDecoder().decode(await r.arrayBuffer());
    expect(texto.startsWith('%PDF-1.4')).toBe(true);
    expect(texto).toContain('P\\341gina de prueba');
    expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
    fuente.agregar(2, { type: 'packing_list', status: 'claimed', claimed_by_agent: 'ag-a' });
    expect((await manejarEtiqueta(req('/x', TOKEN_A), uuid(2), deps)).status).toBe(501);
  });

  it('rutaSegura solo admite PDFs dentro de MEDIA_ROOT/labels', () => {
    expect(rutaSegura(MEDIA, 'labels/a.pdf')).toBe(path.resolve(MEDIA, 'labels/a.pdf'));
    expect(rutaSegura(MEDIA, 'labels/../media.pdf')).toBeNull();
    expect(rutaSegura(MEDIA, '/etc/passwd')).toBeNull();
    expect(rutaSegura(MEDIA, 'labels/a.exe')).toBeNull();
  });
});

describe('jobs/{id}/result', () => {
  it('printed: cierra el trabajo; repetirlo es 200 duplicado; luego failed es 409', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-a' });
    const r1 = await manejarResultado(req('/x', TOKEN_A, { status: 'printed', attempts: 1 }), uuid(1), deps);
    expect(await r1.json()).toEqual({ ok: true, duplicado: false });
    expect(fuente.trabajos.get(uuid(1))).toMatchObject({ status: 'printed', attempts: 1, printed_at: '2026-10-20T15:00:00.000Z' });
    expect(await (await manejarResultado(req('/x', TOKEN_A, { status: 'printed' }), uuid(1), deps)).json()).toEqual({ ok: true, duplicado: true });
    expect((await manejarResultado(req('/x', TOKEN_A, { status: 'failed', error: 'x' }), uuid(1), deps)).status).toBe(409);
    expect(fuente.trabajos.get(uuid(1))!.status).toBe('printed');
  });

  it('failed: guarda error, suma intentos, guarda la captura y alerta en el pedido', async () => {
    const { deps, fuente, capturas } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-a', attempts: 1 });
    const r = await manejarResultado(
      req('/x', TOKEN_A, { status: 'failed', attempts: 3, error: 'SumatraPDF código 1', screenshot_png_base64: Buffer.from(PNG).toString('base64') }),
      uuid(1),
      deps,
    );
    expect(r.status).toBe(200);
    const t = fuente.trabajos.get(uuid(1))!;
    expect(t).toMatchObject({ status: 'failed', attempts: 4 });
    expect(t.error).toMatch(/^SumatraPDF código 1 \[captura: agent-screenshots\/.+\.png\]$/);
    expect(capturas.size).toBe(1);
    expect(fuente.alertas[0]).toMatchObject({ orderId: 'ord-1', payload: { motivo: 'impresion_fallida', print_job_id: uuid(1), intentos: 4 } });
  });

  it('validaciones: failed sin error, captura que no es PNG, trabajo de otro agente o no reclamado', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-a' });
    expect((await manejarResultado(req('/x', TOKEN_A, { status: 'failed' }), uuid(1), deps)).status).toBe(400);
    expect((await manejarResultado(req('/x', TOKEN_A, { status: 'failed', error: 'x', screenshot_png_base64: Buffer.from('hola').toString('base64') }), uuid(1), deps)).status).toBe(400);
    expect((await manejarResultado(req('/x', TOKEN_B, { status: 'printed' }), uuid(1), deps)).status).toBe(409);
    fuente.agregar(2);
    expect((await manejarResultado(req('/x', TOKEN_A, { status: 'printed' }), uuid(2), deps)).status).toBe(409);
    expect((await manejarResultado(req('/x', TOKEN_A, { status: 'printed' }), uuid(9), deps)).status).toBe(404);
    expect(fuente.trabajos.get(uuid(1))!.status).toBe('claimed');
  });

  it('dos reportes simultáneos iguales: el segundo es duplicado, no error', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-a' });
    const [a, b] = await Promise.all([
      manejarResultado(req('/x', TOKEN_A, { status: 'printed' }), uuid(1), deps),
      manejarResultado(req('/x', TOKEN_A, { status: 'printed' }), uuid(1), deps),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const cuerpos = (await Promise.all([a.json(), b.json()])) as { duplicado: boolean }[];
    expect(cuerpos.filter((c) => c.duplicado)).toHaveLength(1);
  });

  it('cuerpo demasiado grande → 413', async () => {
    const { deps, fuente } = escenario();
    fuente.agregar(1, { status: 'claimed', claimed_by_agent: 'ag-a' });
    const enorme = { status: 'failed', error: 'x', screenshot_png_base64: 'A'.repeat(3 * 1024 * 1024 + 10) };
    expect((await manejarResultado(req('/x', TOKEN_A, enorme), uuid(1), deps)).status).toBe(413);
  });
});
