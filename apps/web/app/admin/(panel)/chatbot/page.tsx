import type { Metadata } from 'next';
import Link from 'next/link';
import { FormularioChatbot } from '@/components/admin/FormularioChatbot';
import {
  ETIQUETA_ESTADO_PRESUPUESTO,
  bienvenidaDe,
  estadoPresupuesto,
  formatoUsdMicros,
  mesActual,
  microsATexto,
  usoPresupuestoBp,
} from '@/lib/admin/chatbot/chatbot';
import { conversionDelChat, consumoReciente, hayCredencialOpenRouter, leerAjustesChat } from '@/lib/admin/chatbot/servidor';
import { porcentajeBp } from '@/lib/admin/formato';
import { hoyBogota, leerFiltroFechas } from '@/lib/admin/metricas/filtros';
import { FiltroFechas } from '@/components/admin/FiltroFechas';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { guardarAjustesChat } from './acciones';

export const metadata: Metadata = { title: 'Chatbot' };

export default async function PaginaChatbot({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'chatbot', accion: 'chatbot.gestionar' });
  const sp = await searchParams;
  const ahora = new Date();
  const fechas = leerFiltroFechas(sp, ahora, 'ultimos_7_dias');
  const cliente = crearClienteServicio();
  const [ajustes, credencial, consumo, conversion] = await Promise.all([
    leerAjustesChat(cliente),
    hayCredencialOpenRouter(cliente),
    consumoReciente(cliente),
    conversionDelChat(cliente, fechas.rango),
  ]);

  if (!ajustes) {
    return (
      <>
        <h1>Chatbot</h1>
        <p className="adm-vacio">Aún no existen los ajustes de Iza. Pide al equipo técnico que corra el seed.</p>
      </>
    );
  }
  const mes = mesActual(ahora);
  const delMes = consumo.find((c) => c.month === mes);
  const gastado = delMes?.costo ?? 0n;
  const presupuesto = ajustes.monthly_budget_usd_micros;
  const estado = estadoPresupuesto(gastado, presupuesto, ajustes.degrade_at_pct);
  const uso = usoPresupuestoBp(gastado, presupuesto);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Chatbot</h1>
        <Link href="/admin/chatbot/conversaciones" className="adm-enlace-boton adm-boton-secundario">
          Ver conversaciones
        </Link>
      </div>
      {sp.guardado ? <p className="adm-ok" role="status">Ajustes guardados.</p> : null}
      {!credencial ? (
        <p className="adm-alerta" role="alert">
          Falta la credencial de OpenRouter. Sin ella Iza no puede responder: <Link href="/admin/integraciones">configúrala en Integraciones</Link>.
        </p>
      ) : null}

      <section aria-labelledby="h-consumo">
        <h2 id="h-consumo">Consumo del mes</h2>
        <p>
          <strong>{formatoUsdMicros(gastado)}</strong> de {formatoUsdMicros(presupuesto)} ({porcentajeBp(uso)}) ·{' '}
          {delMes?.mensajes ?? 0} respuestas
        </p>
        <p className={estado === 'normal' ? 'adm-suave' : 'adm-alerta'} role={estado === 'normal' ? undefined : 'status'}>
          {ETIQUETA_ESTADO_PRESUPUESTO[estado]}
        </p>
        {consumo.length > 1 ? (
          <div className="adm-tabla-caja">
            <table className="adm-tabla">
              <caption className="adm-suave">Meses anteriores</caption>
              <thead>
                <tr>
                  <th scope="col">Mes</th>
                  <th scope="col">Costo</th>
                  <th scope="col">Respuestas</th>
                </tr>
              </thead>
              <tbody>
                {consumo
                  .filter((c) => c.month !== mes)
                  .map((c) => (
                    <tr key={c.month}>
                      <th scope="row">{c.month.slice(0, 7)}</th>
                      <td>{formatoUsdMicros(c.costo)}</td>
                      <td>{c.mensajes}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="h-conversion">
        <h2 id="h-conversion">Conversión</h2>
        <FiltroFechas base="/admin/chatbot" filtro={fechas} hoy={hoyBogota(ahora)} />
        <p>
          {conversion.convertidas} de {conversion.sesiones} conversaciones terminaron en pedido ({porcentajeBp(conversion.bp)}).{' '}
          <Link href={`/admin/chatbot/conversaciones?${new URLSearchParams({ convertida: 'si', desde: fechas.rango.desde, hasta: fechas.rango.hasta }).toString()}`}>
            Ver las que compraron
          </Link>
        </p>
        <p className="adm-suave adm-chico">
          Una conversación cuenta como convertida cuando el visitante que chateó hizo un pedido en esa sesión.
        </p>
      </section>

      <section aria-labelledby="h-ajustes">
        <h2 id="h-ajustes">Ajustes</h2>
        <FormularioChatbot
          accion={guardarAjustesChat}
          inicial={{
            is_enabled: ajustes.is_enabled,
            model_primary: ajustes.model_primary ?? '',
            model_fallback: ajustes.model_fallback ?? '',
            presupuesto: microsATexto(presupuesto),
            degrade_at_pct: String(ajustes.degrade_at_pct),
            extra_instructions: ajustes.extra_instructions ?? '',
            welcome_CO: bienvenidaDe(ajustes.welcome_message, 'CO'),
            welcome_EC: bienvenidaDe(ajustes.welcome_message, 'EC'),
            max_output_tokens: String(ajustes.max_output_tokens),
            history_turns: String(ajustes.history_turns),
            max_input_chars: String(ajustes.max_input_chars),
            max_messages_per_session: String(ajustes.max_messages_per_session),
          }}
        />
      </section>
    </>
  );
}
