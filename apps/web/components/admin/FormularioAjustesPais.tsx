'use client';

import { useActionState } from 'react';
import { ESTADO_INICIAL, type ResultadoAccion } from '@/lib/admin/crud/comun';
import type { FormularioPais } from '@/lib/admin/pagos/ajustes-servidor';
import { CampoTexto } from './CampoTexto';

/** Ajustes del país: contra entrega, recargo de financiación, tiempos, horario silencioso y alertas. */
export function FormularioAjustesPais({
  pais,
  moneda,
  inicial,
  accion,
}: {
  pais: 'CO' | 'EC';
  moneda: 'COP' | 'USD';
  inicial: FormularioPais;
  accion: (previo: ResultadoAccion, datos: FormData) => Promise<ResultadoAccion>;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const errores = estado.ok ? {} : (estado.errores ?? {});
  const unidad = moneda === 'COP' ? 'COP, sin decimales' : 'USD, hasta 2 decimales';

  return (
    <form action={enviar} className="adm-form adm-form-ancho" noValidate>
      <input type="hidden" name="pais" value={pais} />
      {!estado.ok && estado.mensaje ? (
        <p className="adm-alerta" role="alert">
          {estado.mensaje}
        </p>
      ) : null}
      {estado.ok && estado.mensaje ? (
        <p className="adm-ok" role="status">
          {estado.mensaje}
        </p>
      ) : null}

      <fieldset className="adm-fieldset">
        <legend>Contra entrega</legend>
        <label className="adm-check">
          <input type="checkbox" name="cod_enabled" defaultChecked={inicial.cod_enabled} />
          Contra entrega habilitada en este país
        </label>
        {errores.cod_enabled ? <p className="adm-error-campo">{errores.cod_enabled}</p> : null}
        <CampoTexto
          id="cod_deposit_amount"
          name="cod_deposit_amount"
          etiqueta={`Abono (${unidad})`}
          inputMode="decimal"
          defaultValue={inicial.cod_deposit_amount}
          error={errores.cod_deposit_amount}
        />
        <CampoTexto
          id="cod_min_collect_amount"
          name="cod_min_collect_amount"
          etiqueta={`Recaudo mínimo (${unidad})`}
          inputMode="decimal"
          defaultValue={inicial.cod_min_collect_amount}
          ayuda="Valor mínimo que debe cobrar la transportadora al entregar."
          error={errores.cod_min_collect_amount}
        />
        <CampoTexto
          id="cod_link_ttl_hours"
          name="cod_link_ttl_hours"
          etiqueta="Vigencia del link de pago del abono (horas)"
          inputMode="numeric"
          defaultValue={inicial.cod_link_ttl_hours}
          ayuda="Pasado este tiempo sin pago, el pedido se marca como abandonado y se libera el stock."
          error={errores.cod_link_ttl_hours}
        />
        <CampoTexto
          id="cod_reminder_hours"
          name="cod_reminder_hours"
          etiqueta="Recordatorios (horas después de crear el pedido)"
          defaultValue={inicial.cod_reminder_hours}
          ayuda="Separadas por comas, p. ej. 3, 12, 21. Déjalo vacío para no enviar recordatorios."
          error={errores.cod_reminder_hours}
        />
        <div className="adm-fila">
          <CampoTexto
            id="cod_quiet_hours_start"
            name="cod_quiet_hours_start"
            etiqueta="Horario silencioso: desde"
            type="time"
            defaultValue={inicial.cod_quiet_hours_start}
            error={errores.cod_quiet_hours_start}
          />
          <CampoTexto
            id="cod_quiet_hours_end"
            name="cod_quiet_hours_end"
            etiqueta="Horario silencioso: hasta"
            type="time"
            defaultValue={inicial.cod_quiet_hours_end}
            error={errores.cod_quiet_hours_end}
          />
        </div>
        <p className="adm-suave adm-chico">
          En ese horario no se envían recordatorios por WhatsApp: se corren al final del horario si todavía queda al menos una hora de vigencia.
        </p>
        <CampoTexto
          id="cod_resend_max"
          name="cod_resend_max"
          etiqueta="Máximo de reenvíos manuales del cobro por pedido"
          inputMode="numeric"
          defaultValue={inicial.cod_resend_max}
          ayuda="0 = no se permite reenviar el cobro desde el pedido."
          error={errores.cod_resend_max}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Recargo de financiación (%)</legend>
        <div className="adm-fila">
          <CampoTexto
            id="surcharge_addi"
            name="surcharge_addi"
            etiqueta="Addi"
            inputMode="decimal"
            defaultValue={inicial.surcharge_addi}
            error={errores.surcharge_addi}
          />
          <CampoTexto
            id="surcharge_sistecredito"
            name="surcharge_sistecredito"
            etiqueta="Sistecrédito"
            inputMode="decimal"
            defaultValue={inicial.surcharge_sistecredito}
            error={errores.surcharge_sistecredito}
          />
        </div>
        <p className="adm-suave adm-chico">Vacío = sin recargo. El cálculo lo hace el servidor al crear el pedido.</p>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Tiempos de reserva</legend>
        <CampoTexto
          id="pending_payment_ttl_minutes"
          name="pending_payment_ttl_minutes"
          etiqueta="Tiempo para pagar en línea (minutos)"
          inputMode="numeric"
          defaultValue={inicial.pending_payment_ttl_minutes}
          error={errores.pending_payment_ttl_minutes}
        />
        <CampoTexto
          id="manual_order_ttl_hours"
          name="manual_order_ttl_hours"
          etiqueta="Reserva de pedidos de pago manual (horas)"
          inputMode="numeric"
          defaultValue={inicial.manual_order_ttl_hours}
          error={errores.manual_order_ttl_hours}
        />
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Moneda y transportadora</legend>
        {pais === 'CO' ? (
          <input type="hidden" name="fx_rate_to_cop" value="" />
        ) : (
          <CampoTexto
            id="fx_rate_to_cop"
            name="fx_rate_to_cop"
            etiqueta="Tasa de cambio (pesos colombianos por 1 USD)"
            inputMode="decimal"
            defaultValue={inicial.fx_rate_to_cop}
            ayuda="Solo se usa para consolidar las métricas en pesos. Vacío = pendiente de definir."
            error={errores.fx_rate_to_cop}
          />
        )}
        <CampoTexto
          id="carrier_wallet_low_balance"
          name="carrier_wallet_low_balance"
          etiqueta={`Alerta de saldo bajo de la billetera de la transportadora (${unidad})`}
          inputMode="decimal"
          defaultValue={inicial.carrier_wallet_low_balance}
          ayuda={
            inicial.tiene_transportadora
              ? `Se avisa cuando el saldo baja de este valor. Vacío = sin alerta.${inicial.saldo_billetera ? ` Último saldo leído: ${inicial.saldo_billetera}.` : ''}`
              : 'Este país aún no tiene transportadora conectada.'
          }
          error={errores.carrier_wallet_low_balance}
        />
      </fieldset>

      <div className="adm-acciones">
        <button type="submit" className="adm-boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar ajustes del país'}
        </button>
      </div>
    </form>
  );
}
