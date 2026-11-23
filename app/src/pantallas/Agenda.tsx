import { useCallback, useEffect, useState } from 'react';
import { llamar } from '../lib/api';
import { leerPrivado, guardarPrivado, leerConfig } from '../lib/db';
import { precargarOcr } from '../lib/ocr';
import { sincronizar } from '../lib/sync';
import type { AgendaDia, Bolsa, ConfigApp } from '../lib/tipos';
import { hoy } from '../lib/util';
import Retiro from './Retiro';
import Visita, { type VisitaLocal } from './Visita';

/** Descarga la agenda (con señal) y la guarda cifrada para usarla sin conexión. */
export async function cargarAgenda(fecha: string): Promise<{ datos: AgendaDia | null; desdeCache: boolean }> {
  if (navigator.onLine) {
    try {
      const r = await llamar<AgendaDia & { ok: boolean }>('agenda', { fecha });
      await guardarPrivado('agenda:' + fecha, r);
      return { datos: r, desdeCache: false };
    } catch (e) {
      console.warn(e);
    }
  }
  return { datos: (await leerPrivado<AgendaDia>('agenda:' + fecha)) || null, desdeCache: true };
}

export default function Agenda() {
  const fecha = hoy();
  const [datos, setDatos] = useState<AgendaDia | null>(null);
  const [cache, setCache] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [conf, setConf] = useState<ConfigApp | null>(null);
  const [locales, setLocales] = useState<Record<string, VisitaLocal>>({});
  const [retirados, setRetirados] = useState<Record<string, boolean>>({});
  const [abierta, setAbierta] = useState<string | null>(null);
  const [retirando, setRetirando] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    await sincronizar();
    const r = await cargarAgenda(fecha);
    setDatos(r.datos);
    setCache(r.desdeCache);
    setConf((await leerConfig()) || null);
    if (r.datos) {
      const loc: Record<string, VisitaLocal> = {};
      for (const a of r.datos.agenda) { const v = await leerPrivado<VisitaLocal>('visita:' + a.id); if (v) loc[a.id] = v; }
      setLocales(loc);
      const ret: Record<string, boolean> = {};
      for (const b of r.datos.bolsas) ret[b.id] = b.estado !== 'preparada' || !!(await leerPrivado<boolean>('retiro:' + b.id));
      setRetirados(ret);
    }
    setCargando(false);
  }, [fecha]);

  useEffect(() => { recargar(); }, [recargar]);

  if (cargando && !datos) return <main className="pantalla"><p>Cargando agenda…</p></main>;
  if (!datos) return (
    <main className="pantalla">
      <h1>Agenda {fecha}</h1>
      <p className="error">No hay agenda guardada en el teléfono. Conéctese a internet y actualice.</p>
      <button onClick={recargar}>Actualizar</button>
    </main>
  );

  const porRetirar: Bolsa[] = datos.bolsas.filter((b) => !retirados[b.id]);

  if (retirando) return <Retiro bolsas={porRetirar} pacientes={datos.pacientes} alTerminar={() => { setRetirando(false); precargarOcr(); recargar(); }} alCancelar={() => setRetirando(false)} />;

  if (abierta && conf) {
    const item = datos.agenda.find((a) => a.id === abierta)!;
    return <Visita item={item} conf={conf} paciente={datos.pacientes.find((p) => p.id === item.paciente_id)!}
      cuidadores={datos.cuidadores.filter((c) => c.paciente_id === item.paciente_id)}
      bolsas={datos.bolsas.filter((b) => b.paciente_id === item.paciente_id && retirados[b.id])}
      alSalir={() => { setAbierta(null); recargar(); }} />;
  }

  const estadoDe = (id: string, servidor: string) => {
    const l = locales[id];
    if (l?.paso === 'hecha') return 'realizada';
    if (l?.paso === 'fallida') return 'fallida';
    if (l && l.paso !== 'inicio') return 'en curso';
    return servidor || 'pendiente';
  };

  return (
    <main className="pantalla">
      <div className="fila-tit">
        <h1>Agenda {fecha}</h1>
        <button className="sec peq" onClick={recargar} disabled={cargando}>{cargando ? '…' : 'Actualizar'}</button>
      </div>
      {cache && <p className="nota">Mostrando la agenda guardada en el teléfono (sin conexión).</p>}
      {porRetirar.length > 0 && (
        <div className="tarjeta resaltada">
          <p><strong>{porRetirar.length} bolsa(s)</strong> preparadas en farmacia para hoy.</p>
          <button onClick={() => setRetirando(true)}>Retirar maletín</button>
        </div>
      )}
      {datos.agenda.length === 0 && <p>No tiene visitas asignadas hoy.</p>}
      <ul className="lista">
        {datos.agenda.map((a) => {
          const p = datos.pacientes.find((x) => x.id === a.paciente_id);
          const est = estadoDe(a.id, a.estado);
          return (
            <li key={a.id} onClick={() => setAbierta(a.id)} className={'estado-' + est.replace(' ', '-')}>
              <div><strong>{p?.nombre || a.paciente_id}</strong><br /><small>{p?.direccion || p?.sector} · {a.ventana}</small></div>
              <span className="chip">{est}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
