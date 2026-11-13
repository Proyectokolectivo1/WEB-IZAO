'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import { MAX_MENSAJE_WHATSAPP, type FormularioWhatsappAsesor as Valores } from '@/lib/admin/pagos/whatsapp-asesor';
import { CampoAreaTexto } from './CampoAreaTexto';
import { CampoTexto } from './CampoTexto';

/** «WhatsApp del asesor» del país: número, mensaje inicial y si el botón flotante se muestra en la tienda. */
export function FormularioWhatsappAsesor({
  pais,
  inicial,
  accion,
}: {
  pais: 'CO' | 'EC';
  inicial: Valores;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const ejemplo = inicial.prefijo ? `${inicial.prefijo} 300 123 4567` : '+57 300 123 4567';

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate aria-labelledby="h-whatsapp" data-testid="form-whatsapp-asesor">
      <input type="hidden" name="pais" value={pais} />
      {!estado.ok && estado.mensaje && !estado.errores ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      {estado.ok && estado.mensaje ? (
        <p className="adm-ok" role="status">
          {estado.mensaje}
        </p>
      ) : null}
      <label className="adm-check">
        <input type="checkbox" name="advisor_whatsapp_button_enabled" defaultChecked={inicial.advisor_whatsapp_button_enabled} />
        Mostrar el botón flotante de WhatsApp en la tienda de este país
      </label>
      <CampoTexto
        id={`${pais}-wa-numero`}
        name="advisor_whatsapp"
        etiqueta="WhatsApp del asesor"
        inputMode="tel"
        autoComplete="off"
        defaultValue={inicial.advisor_whatsapp}
        maxLength={40}
        ayuda={`Con el código del país, por ejemplo ${ejemplo}. Se guarda solo con números. Sin número, el botón no aparece. Este mismo número lo usan Iza y el pie de la tienda.`}
        error={errores.advisor_whatsapp}
      />
      <CampoAreaTexto
        id={`${pais}-wa-mensaje`}
        name="advisor_whatsapp_message"
        etiqueta="Mensaje inicial"
        rows={3}
        maxLength={MAX_MENSAJE_WHATSAPP}
        defaultValue={inicial.advisor_whatsapp_message}
        ayuda="Es lo que ya viene escrito cuando la persona abre el chat. Vacío usa el mensaje por defecto de la tienda."
        error={errores.advisor_whatsapp_message}
      />
      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar WhatsApp'}
        </button>
      </div>
    </form>
  );
}
