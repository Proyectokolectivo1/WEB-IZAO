import { describe, expect, it, vi } from 'vitest';
import { purgarAuditLog } from './purgar-audit-log.js';

const base = { supabaseUrl: 'https://ejemplo.supabase.co/', secretKey: 'llave-de-prueba' };

function respuesta(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status });
}

describe('purgarAuditLog', () => {
  it('llama al RPC con la llave de servicio y el valor por defecto', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(12));
    const n = await purgarAuditLog({ ...base, fetchImpl });
    expect(n).toBe(12);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ejemplo.supabase.co/rest/v1/rpc/purgar_audit_log');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    const cab = init.headers as Record<string, string>;
    expect(cab.apikey).toBe('llave-de-prueba');
    expect(cab.Authorization).toBe('Bearer llave-de-prueba');
  });

  it('acepta un número de días y un conteo como texto (bigint)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta('7'));
    expect(await purgarAuditLog({ ...base, dias: 90, fetchImpl })).toBe(7);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"p_dias":90}');
  });

  it('falla sin filtrar la llave cuando el servidor responde error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta({ message: 'llave-de-prueba rechazada' }, 401));
    const error = await purgarAuditLog({ ...base, fetchImpl }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('purgar_audit_log respondió HTTP 401');
    expect((error as Error).message).not.toContain('llave-de-prueba');
  });

  it('rechaza respuestas inesperadas y configuración faltante', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta({ x: 1 }));
    await expect(purgarAuditLog({ ...base, fetchImpl })).rejects.toThrow('valor inesperado');
    await expect(purgarAuditLog({ supabaseUrl: '', secretKey: 'k' })).rejects.toThrow('SUPABASE_URL');
    await expect(purgarAuditLog({ supabaseUrl: 'https://x.co', secretKey: '' })).rejects.toThrow(
      'SUPABASE_SECRET_KEY',
    );
  });
});
