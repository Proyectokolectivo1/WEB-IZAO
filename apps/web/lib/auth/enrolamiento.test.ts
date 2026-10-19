import { describe, expect, it } from 'vitest';
import {
  CLAVE_ENROLAMIENTO,
  DURACION_VENTANA_ENROLAMIENTO_MS,
  enrolamientoPermitido,
  metadataHabilitarEnrolamiento,
} from './enrolamiento';

const AHORA = 1_800_000_000_000;

describe('ventana de enrolamiento MFA (solo la abre el servicio, no la contraseña)', () => {
  it('sin indicador no se puede inscribir un factor nuevo', () => {
    expect(enrolamientoPermitido(undefined, AHORA)).toBe(false);
    expect(enrolamientoPermitido(null, AHORA)).toBe(false);
    expect(enrolamientoPermitido({}, AHORA)).toBe(false);
  });

  it('con la ventana vigente se permite', () => {
    const meta = metadataHabilitarEnrolamiento(AHORA);
    expect(enrolamientoPermitido(meta, AHORA + 1_000)).toBe(true);
  });

  it('vence exactamente al cumplirse la duración', () => {
    const meta = metadataHabilitarEnrolamiento(AHORA);
    expect(enrolamientoPermitido(meta, AHORA + DURACION_VENTANA_ENROLAMIENTO_MS - 1)).toBe(true);
    expect(enrolamientoPermitido(meta, AHORA + DURACION_VENTANA_ENROLAMIENTO_MS)).toBe(false);
  });

  it('rechaza valores mal formados o de otro tipo', () => {
    expect(enrolamientoPermitido({ [CLAVE_ENROLAMIENTO]: 'mañana' }, AHORA)).toBe(false);
    expect(enrolamientoPermitido({ [CLAVE_ENROLAMIENTO]: true }, AHORA)).toBe(false);
    expect(enrolamientoPermitido({ [CLAVE_ENROLAMIENTO]: null }, AHORA)).toBe(false);
    expect(enrolamientoPermitido({ [CLAVE_ENROLAMIENTO]: {} }, AHORA)).toBe(false);
  });
});
