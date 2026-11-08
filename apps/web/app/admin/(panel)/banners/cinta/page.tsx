import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { leerPais, PestanasPais } from '@/components/admin/PestanasPais';
import { MAX_FRASE, ROTACION_SEGUNDOS } from '@/lib/admin/anuncios/anuncios';
import { leerRotacion, listarAnuncios } from '@/lib/admin/anuncios/servidor';
import { ETIQUETA_UBICACION, NOMBRE_PAIS_BANNER, UBICACIONES } from '@/lib/admin/banners/banners';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { alternarAnuncio, eliminarAnuncio, guardarAnuncio, guardarRotacion, moverAnuncio } from './acciones';

export const metadata: Metadata = { title: 'Cinta superior' };

export default async function CintaSuperior({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'banners' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const cliente = crearClienteServicio();
  const [frases, rotacion] = await Promise.all([listarAnuncios(cliente, pais), leerRotacion(cliente, pais)]);
  const error = typeof sp.error === 'string' ? sp.error : null;
  const activas = frases.filter((f) => f.is_active);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Cinta superior</h1>
      </div>
      <p className="adm-suave">
        Las frases que rotan en la franja oscura de arriba de toda la tienda. Cada país tiene las suyas; lo que cambies se ve en
        pocos minutos. No afirmes originalidad ni certificados.
      </p>
      <PestanasPais base="/admin/banners/cinta" actual={pais} />
      <ul className="adm-pestanas ban-pestanas" aria-label="Sección">
        {UBICACIONES.map((u) => (
          <li key={u}>
            <Link href={`/admin/banners?pais=${pais}&ubicacion=${u}`}>{ETIQUETA_UBICACION[u]}</Link>
          </li>
        ))}
        <li>
          <Link href={`/admin/banners/cinta?pais=${pais}`} aria-current="page">
            Cinta superior
          </Link>
        </li>
      </ul>

      {sp.guardado ? <p className="adm-ok" role="status">Frase guardada.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Frase eliminada.</p> : null}
      {sp.rotacion ? <p className="adm-ok" role="status">Velocidad guardada.</p> : null}
      {error ? <p className="adm-alerta" role="alert">{error}</p> : null}

      <form action={guardarRotacion} className="adm-form ban-ajustes" aria-labelledby="h-rotacion">
        <h2 id="h-rotacion">Velocidad</h2>
        <input type="hidden" name="country_code" value={pais} />
        <div className="adm-campo">
          <label htmlFor="seconds" className="adm-etiqueta">
            Segundos que se queda cada frase ({ROTACION_SEGUNDOS.minimo} a {ROTACION_SEGUNDOS.maximo})
          </label>
          <input id="seconds" name="seconds" className="adm-input" inputMode="numeric" defaultValue={String(rotacion)} />
          <p className="adm-suave adm-chico">Se detiene sola al pasar el cursor. Con una sola frase activa no rota.</p>
        </div>
        <div className="adm-acciones">
          <button type="submit" className="adm-boton">
            Guardar velocidad
          </button>
        </div>
      </form>

      {activas.length > 0 ? (
        <p className="cinta-previa" aria-label="Así se ve la primera frase">
          {activas[0]!.text}
        </p>
      ) : null}

      <h2>Frases de {NOMBRE_PAIS_BANNER[pais]}</h2>
      {frases.length === 0 ? (
        <p className="adm-vacio">Aún no hay frases para {NOMBRE_PAIS_BANNER[pais]}. Agrega la primera abajo.</p>
      ) : (
        <ol className="cinta-lista" aria-label={`Frases de la cinta superior de ${NOMBRE_PAIS_BANNER[pais]}, en orden`}>
          {frases.map((f, i) => (
            <li key={f.id} className="cinta-fila" data-activo={f.is_active}>
              <form action={guardarAnuncio} className="cinta-edicion">
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="country_code" value={pais} />
                <div className="adm-campo">
                  <label htmlFor={`texto-${f.id}`} className="adm-etiqueta">
                    Frase {i + 1}
                  </label>
                  <input id={`texto-${f.id}`} name="text" className="adm-input" defaultValue={f.text} maxLength={MAX_FRASE} required />
                </div>
                <div className="adm-campo">
                  <label htmlFor={`enlace-${f.id}`} className="adm-etiqueta">
                    Enlace (opcional)
                  </label>
                  <input
                    id={`enlace-${f.id}`}
                    name="link_url"
                    className="adm-input"
                    defaultValue={f.link_url ?? ''}
                    placeholder={`/${pais.toLowerCase()}/catalogo`}
                    maxLength={500}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <label className="adm-check">
                  <input type="checkbox" name="is_active" defaultChecked={f.is_active} />
                  Visible en la tienda
                </label>
                <div className="adm-acciones">
                  <button type="submit" className="adm-boton">
                    Guardar frase
                  </button>
                </div>
              </form>
              <div className="cinta-controles">
                <form action={moverAnuncio.bind(null, pais, f.id, 'arriba')}>
                  <button type="submit" className="adm-boton adm-boton-secundario" disabled={i === 0} aria-label={`Subir la frase ${i + 1}`}>
                    ↑
                  </button>
                </form>
                <form action={moverAnuncio.bind(null, pais, f.id, 'abajo')}>
                  <button type="submit" className="adm-boton adm-boton-secundario" disabled={i === frases.length - 1} aria-label={`Bajar la frase ${i + 1}`}>
                    ↓
                  </button>
                </form>
                <form action={alternarAnuncio.bind(null, pais, f.id, !f.is_active)}>
                  <button type="submit" className="adm-boton adm-boton-secundario">
                    {f.is_active ? 'Ocultar' : 'Mostrar'}
                  </button>
                </form>
                <BotonConfirmar
                  etiqueta="Eliminar"
                  mensaje="La frase dejará de mostrarse y no se puede recuperar. Si solo quieres ocultarla un tiempo, usa «Ocultar»."
                  etiquetaConfirmar="Sí, eliminar"
                  accion={eliminarAnuncio.bind(null, pais, f.id)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <form action={guardarAnuncio} className="adm-form ban-ajustes" aria-labelledby="h-nueva-frase">
        <h2 id="h-nueva-frase">Agregar una frase</h2>
        <input type="hidden" name="country_code" value={pais} />
        <input type="hidden" name="is_active" value="on" />
        <div className="adm-campo">
          <label htmlFor="texto-nueva" className="adm-etiqueta">
            Frase
          </label>
          <input id="texto-nueva" name="text" className="adm-input" maxLength={MAX_FRASE} required placeholder="Envío gratis a todo el país" />
        </div>
        <div className="adm-campo">
          <label htmlFor="enlace-nueva" className="adm-etiqueta">
            Enlace (opcional)
          </label>
          <input id="enlace-nueva" name="link_url" className="adm-input" maxLength={500} autoComplete="off" spellCheck={false} placeholder={`/${pais.toLowerCase()}/catalogo`} />
        </div>
        <div className="adm-acciones">
          <button type="submit" className="adm-boton">
            Agregar frase
          </button>
        </div>
      </form>
    </>
  );
}
