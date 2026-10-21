'use server';

import { revalidatePath } from 'next/cache';
import { registrarWebhooksMasterShop } from '@/app/api/webhooks/mastershop/registro';
import type { ResultadoAccion } from '@/lib/admin/crud/comun';
import { adminDeAccion } from '@/lib/admin/crud/servidor';
import { proveedorPorId } from '@/lib/admin/integraciones/catalogo';
import {
  activarCredencialBd,
  desactivarCredencialBd,
  guardarCredencialBd,
  probarConexionBd,
  registrarWebhooksBd,
} from '@/lib/admin/integraciones/credenciales-servidor';
import { crearSondas, modoIntegraciones } from '@/lib/admin/integraciones/sondas';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refrescar(): void {
  revalidatePath('/admin/integraciones');
}

/** Guarda las credenciales de un proveedor/país/ambiente. Los valores viajan solo hacia el servidor. */
export async function guardarCredencial(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('integraciones', 'integraciones.gestionar');
  if ('error' in entrada) return entrada.error;

  const proveedor = proveedorPorId(String(formData.get('proveedor') ?? ''));
  if (!proveedor) return { ok: false, mensaje: 'Proveedor no válido.' };
  const valores: Record<string, string> = {};
  for (const campo of proveedor.esquema.fields) {
    valores[campo.key] = String(formData.get(`campo_${campo.key}`) ?? '').slice(0, 500);
  }
  const r = await guardarCredencialBd({
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
    clave: process.env.APP_ENCRYPTION_KEY,
    proveedorId: proveedor.id,
    pais: String(formData.get('pais') ?? ''),
    ambiente: String(formData.get('ambiente') ?? ''),
    valores,
  });
  refrescar();
  return r;
}

type ContextoEjecucion = { cliente: ReturnType<typeof crearClienteServicio>; actor: string; ip: string | null };

async function conId(id: string, ejecutar: (a: ContextoEjecucion) => Promise<ResultadoAccion>): Promise<ResultadoAccion> {
  const entrada = await adminDeAccion('integraciones', 'integraciones.gestionar');
  if ('error' in entrada) return entrada.error;
  if (!UUID.test(id)) return { ok: false, mensaje: 'Identificador no válido.' };
  const r = await ejecutar({
    cliente: crearClienteServicio(),
    actor: entrada.admin.userId,
    ip: await ipDelCliente(),
  });
  refrescar();
  return r;
}

export async function activarCredencial(id: string): Promise<ResultadoAccion> {
  return conId(id, (a) => activarCredencialBd({ ...a, id }));
}

export async function desactivarCredencial(id: string): Promise<ResultadoAccion> {
  return conId(id, (a) => desactivarCredencialBd({ ...a, id }));
}

export async function probarConexion(id: string): Promise<ResultadoAccion> {
  return conId(id, (a) =>
    probarConexionBd({
      ...a,
      id,
      clave: process.env.APP_ENCRYPTION_KEY,
      sondas: crearSondas(modoIntegraciones()),
    }),
  );
}

export async function registrarWebhooks(id: string): Promise<ResultadoAccion> {
  return conId(id, (a) =>
    registrarWebhooksBd({
      ...a,
      id,
      clave: process.env.APP_ENCRYPTION_KEY,
      modo: modoIntegraciones(),
      registrar: registrarWebhooksMasterShop,
      secretosExtra: [process.env.MASTERSHOP_WEBHOOK_PATH_SECRET ?? ''],
    }),
  );
}
