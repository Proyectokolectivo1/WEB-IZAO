import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { activarPlantillaWhatsAppDb } from './plantillas-whatsapp';

const ID = 'b0000000-0000-0000-0000-0000000024a2';
const ANT = 'b0000000-0000-0000-0000-0000000024a1';

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('activarPlantillaWhatsAppDb', () => {
  it('activada: llama el RPC con id y meta_template_id', async () => {
    const rpc = clienteFalso({ ok: true, estado: 'activada', id: ID, version: 2, anterior_id: ANT, anterior_version: 1 });
    const r = await activarPlantillaWhatsAppDb(ID, 'meta-2');
    expect(rpc).toHaveBeenCalledWith('activar_plantilla_whatsapp', { p_id: ID, p_meta_template_id: 'meta-2' });
    expect(r).toMatchObject({ ok: true, estado: 'activada', anterior_version: 1 });
  });

  it('sin meta_template_id no lo envía; activada sin anterior', async () => {
    const rpc = clienteFalso({ ok: true, estado: 'activada', id: ID, version: 1, anterior_id: null, anterior_version: null });
    await activarPlantillaWhatsAppDb(ID);
    expect(rpc).toHaveBeenCalledWith('activar_plantilla_whatsapp', { p_id: ID });
  });

  it('aprobada_sin_activar y ya_activa pasan tal cual', async () => {
    clienteFalso({ ok: true, estado: 'aprobada_sin_activar', id: ANT, version: 1, activa_id: ID, activa_version: 2 });
    expect(await activarPlantillaWhatsAppDb(ANT)).toMatchObject({ estado: 'aprobada_sin_activar', activa_version: 2 });
    clienteFalso({ ok: true, estado: 'ya_activa', id: ID, version: 2 });
    expect(await activarPlantillaWhatsAppDb(ID)).toMatchObject({ estado: 'ya_activa' });
  });

  it('id que no es UUID: datos_invalidos sin llamar la base', async () => {
    const rpc = clienteFalso(null);
    expect(await activarPlantillaWhatsAppDb('x')).toEqual({ ok: false, motivo: 'datos_invalidos' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('respuesta con forma inesperada o error de la base: ErrorDb', async () => {
    clienteFalso({ ok: true, estado: 'activada', id: ID });
    await expect(activarPlantillaWhatsAppDb(ID)).rejects.toBeInstanceOf(ErrorDb);
    clienteFalso(null, { message: 'permission denied', code: '42501' });
    await expect(activarPlantillaWhatsAppDb(ID)).rejects.toMatchObject({ motivo: 'rpc', codigo: '42501' });
  });
});
