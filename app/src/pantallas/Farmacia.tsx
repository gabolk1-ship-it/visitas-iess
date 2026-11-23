/**
 * Farmacia: prepara una bolsa por paciente a partir de sus órdenes activas (CSV de AS400)
 * y registra lo que vuelve al final del día. Lote y vencimiento se leen de la caja con la cámara.
 */
import { useEffect, useState } from 'react';
import Camara from '../componentes/Camara';
import { llamar } from '../lib/api';
import { encolar, guardarPrivado, leerPrivado } from '../lib/db';
import { canvasABlob, guardarCifrada } from '../lib/fotos';
import { leerCaja } from '../lib/ocr';
import { sincronizar } from '../lib/sync';
import type { Bolsa, FotoCifrada, Orden, Paciente } from '../lib/tipos';
import { horaLocal, hoy, uuid } from '../lib/util';

interface DatosDia { fecha: string; medicos: { id: string; nombre: string }[]; pacientes?: (Paciente & { ordenes: Orden[] })[]; bolsas?: Bolsa[] }

export default function Farmacia() {
  const [fecha, setFecha] = useState(hoy());
  const [medico, setMedico] = useState('');
  const [datos, setDatos] = useState<DatosDia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparando, setPreparando] = useState<(Paciente & { ordenes: Orden[] }) | null>(null);
  const [vista, setVista] = useState<'preparar' | 'devolver'>('preparar');
  const [locales, setLocales] = useState<Record<string, boolean>>({});

  const cargar = async () => {
    setError(null);
    try {
      await sincronizar();
      const r = await llamar<DatosDia>('farmacia_dia', { fecha, medico_id: medico || undefined });
      setDatos(r);
      const loc: Record<string, boolean> = {};
      for (const p of r.pacientes || []) loc[p.id] = !!(await leerPrivado<boolean>(`bolsa:${fecha}:${medico}:${p.id}`));
      setLocales(loc);
    } catch (e) {
      setError((e as Error).message + '. Farmacia necesita conexión para cargar órdenes.');
    }
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fecha, medico]);

  if (preparando) return <PrepararBolsa paciente={preparando} fecha={fecha} medicoId={medico}
    alTerminar={async () => { await guardarPrivado(`bolsa:${fecha}:${medico}:${preparando.id}`, true); setPreparando(null); cargar(); }}
    alCancelar={() => setPreparando(null)} />;

  return (
    <main className="pantalla">
      <h1>Farmacia</h1>
      <label>Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label>Médico
        <select value={medico} onChange={(e) => setMedico(e.target.value)}>
          <option value="">Seleccione…</option>
          {datos?.medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {medico && datos?.pacientes && <>
        <div className="pestanas">
          <button className={vista === 'preparar' ? '' : 'sec'} onClick={() => setVista('preparar')}>Preparar</button>
          <button className={vista === 'devolver' ? '' : 'sec'} onClick={() => setVista('devolver')}>Devoluciones</button>
        </div>
        {vista === 'preparar' && <ul className="lista">
          {datos.pacientes.map((p) => {
            const lista = (datos.bolsas || []).some((b) => b.paciente_id === p.id) || locales[p.id];
            return (
              <li key={p.id} onClick={() => !lista && p.ordenes.length && setPreparando(p)}>
                <div><strong>{p.nombre}</strong><br /><small>{p.ordenes.length} orden(es) activas{p.ordenes.some((o) => o.controlado) ? ' · incluye controlados' : ''}</small></div>
                <span className="chip">{lista ? 'preparada' : p.ordenes.length ? 'preparar' : 'sin órdenes'}</span>
              </li>
            );
          })}
        </ul>}
        {vista === 'devolver' && <Devoluciones bolsas={(datos.bolsas || []).filter((b) => b.estado !== 'preparada')} pacientes={datos.pacientes} medicoId={medico} />}
      </>}
    </main>
  );
}

interface ItemPrep { orden: Orden; incluir: boolean; cantidad: number; foto?: FotoCifrada; lote: string; venc: string; ocr: boolean; receta: string; fotoReceta?: FotoCifrada }

function PrepararBolsa({ paciente, fecha, medicoId, alTerminar, alCancelar }: {
  paciente: Paciente & { ordenes: Orden[] }; fecha: string; medicoId: string; alTerminar: () => void; alCancelar: () => void;
}) {
  const [items, setItems] = useState<ItemPrep[]>(paciente.ordenes.map((o) => ({ orden: o, incluir: true, cantidad: o.cantidad, lote: '', venc: '', ocr: false, receta: o.receta_especial || '' })));
  const [camara, setCamara] = useState<{ i: number; tipo: 'caja' | 'receta' | 'bolsa' } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambiar = (i: number, c: Partial<ItemPrep>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const sello = (t: string) => () => [`IESS Cotocollao · farmacia · ${t}`, `${hoy()} ${horaLocal()}`];

  const faltantes = items.filter((x) => x.incluir).filter((x) =>
    !x.foto || !x.lote || !x.venc || x.venc < hoy() || x.cantidad < 1 || x.cantidad > x.orden.cantidad ||
    (x.orden.controlado && (!x.receta || !x.fotoReceta)));

  if (camara) {
    const it = items[camara.i];
    return (
      <main className="pantalla">
        <Camara titulo={camara.tipo === 'bolsa' ? 'Foto del contenido de la bolsa' : camara.tipo === 'receta' ? 'Receta especial' : 'Caja de ' + it.orden.medicamento}
          ayuda={camara.tipo === 'caja' ? 'Encuadre el lote y el vencimiento impresos.' : camara.tipo === 'bolsa' ? 'Todos los medicamentos juntos, antes de cerrar la bolsa.' : 'La receta completa y legible.'}
          sello={sello(camara.tipo)} alCancelar={() => setCamara(null)}
          alCapturar={async (c) => {
            if (camara.tipo === 'bolsa') {
              const f = await guardarCifrada(await canvasABlob(c));
              await guardarBolsa(f);
              return;
            }
            if (camara.tipo === 'receta') {
              cambiar(camara.i, { fotoReceta: await guardarCifrada(await canvasABlob(c)) });
              setCamara(null);
              return;
            }
            setLeyendo(true);
            setCamara(null);
            const [f, l] = await Promise.all([canvasABlob(c).then(guardarCifrada), leerCaja(c).catch(() => ({ lote: null, vencimiento: null, texto: '' }))]);
            cambiar(camara.i, { foto: f, lote: l.lote || '', venc: l.vencimiento || '', ocr: !!(l.lote || l.vencimiento) });
            setLeyendo(false);
          }} />
      </main>
    );
  }

  async function guardarBolsa(fotoBolsa: FotoCifrada) {
    try {
      const bolsaId = uuid();
      await encolar('bolsas', { id: bolsaId, fecha, medico_id: medicoId, paciente_id: paciente.id, foto_key: fotoBolsa.key, foto_llave: fotoBolsa.llave, foto_hash: fotoBolsa.hash });
      for (const x of items.filter((y) => y.incluir)) {
        await encolar('preparaciones', {
          id: uuid(), bolsa_id: bolsaId, orden_id: x.orden.orden_id, medicamento_codigo: x.orden.medicamento_codigo, medicamento: x.orden.medicamento,
          lote: x.lote, vencimiento: x.venc, cantidad: x.cantidad, controlado: x.orden.controlado, receta_especial: x.receta,
          receta_foto_key: x.fotoReceta?.key, receta_foto_llave: x.fotoReceta?.llave,
          foto_key: x.foto!.key, foto_llave: x.foto!.llave, foto_hash: x.foto!.hash, ocr_confirmado: x.ocr
        });
      }
      await sincronizar();
      alTerminar();
    } catch (e) {
      setError((e as Error).message);
      setCamara(null);
    }
  }

  return (
    <main className="pantalla">
      <h1>Bolsa de {paciente.nombre}</h1>
      {leyendo && <p className="nota">Leyendo lote y vencimiento…</p>}
      {items.map((x, i) => (
        <div key={x.orden.orden_id} className={'tarjeta' + (x.incluir ? '' : ' apagada')}>
          <label className="check"><input type="checkbox" checked={x.incluir} onChange={(e) => cambiar(i, { incluir: e.target.checked })} />
            <strong>{x.orden.medicamento}</strong>{x.orden.controlado && <span className="chip rojo">controlado</span>}</label>
          {x.incluir && <>
            <label>Cantidad (orden: {x.orden.cantidad})<input type="number" min={1} max={x.orden.cantidad} value={x.cantidad} onChange={(e) => cambiar(i, { cantidad: Number(e.target.value) })} /></label>
            <button className={x.foto ? 'sec peq' : 'peq'} onClick={() => setCamara({ i, tipo: 'caja' })}>{x.foto ? 'Repetir foto de la caja' : 'Fotografiar caja'}</button>
            {x.foto && <>
              <label>Lote<input value={x.lote} onChange={(e) => cambiar(i, { lote: e.target.value.toUpperCase() })} /></label>
              <label>Vencimiento<input type="date" value={x.venc} onChange={(e) => cambiar(i, { venc: e.target.value })} /></label>
              {x.venc && x.venc < hoy() && <p className="error">Vencido: no se puede preparar.</p>}
            </>}
            {x.orden.controlado && <>
              <label>N.º de receta especial<input value={x.receta} onChange={(e) => cambiar(i, { receta: e.target.value })} /></label>
              <button className={x.fotoReceta ? 'sec peq' : 'peq'} onClick={() => setCamara({ i, tipo: 'receta' })}>{x.fotoReceta ? 'Repetir foto de receta' : 'Fotografiar receta especial'}</button>
            </>}
          </>}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      <div className="acciones">
        <button className="sec" onClick={alCancelar}>Volver</button>
        <button disabled={faltantes.length > 0 || !items.some((x) => x.incluir) || leyendo} onClick={() => setCamara({ i: 0, tipo: 'bolsa' })}>Foto de la bolsa y guardar</button>
      </div>
      {faltantes.length > 0 && <p className="nota">Faltan datos en {faltantes.length} medicamento(s).</p>}
    </main>
  );
}

/** Conteo a ciegas de lo que vuelve: farmacia cuenta sin ver cuánto se entregó; el servidor cuadra. */
function Devoluciones({ bolsas, pacientes, medicoId }: { bolsas: Bolsa[]; pacientes: Paciente[]; medicoId: string }) {
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [hechos, setHechos] = useState<Record<string, boolean>>({});
  const [fotoPara, setFotoPara] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const h: Record<string, boolean> = {};
      for (const b of bolsas) for (const it of b.items) h[it.id] = !!(await leerPrivado<boolean>('devuelto:' + it.id));
      setHechos(h);
    })();
  }, [bolsas]);

  if (fotoPara) {
    return <Camara titulo="Foto de lo devuelto" ayuda="Las cajas devueltas, con el lote visible." sello={() => ['IESS Cotocollao · devolución', `${hoy()} ${horaLocal()}`]}
      alCancelar={() => setFotoPara(null)}
      alCapturar={async (c) => {
        try {
          const f = await guardarCifrada(await canvasABlob(c));
          await encolar('movimientos', { id: uuid(), tipo: 'devolucion', preparacion_id: fotoPara, cantidad: conteos[fotoPara] || 0, medico_id: medicoId, firma_key: f.key, firma_llave: f.llave });
          await guardarPrivado('devuelto:' + fotoPara, true);
          setHechos((h) => ({ ...h, [fotoPara]: true }));
          setFotoPara(null);
          sincronizar();
        } catch (e) { setError((e as Error).message); setFotoPara(null); }
      }} />;
  }

  if (!bolsas.length) return <p>No hay bolsas retiradas para devolver.</p>;
  return (
    <div>
      <p className="nota">Cuente lo que el médico devuelve sin mirar lo entregado. El cuadre se calcula en el servidor.</p>
      {error && <p className="error">{error}</p>}
      {bolsas.map((b) => (
        <div className="tarjeta" key={b.id}>
          <strong>{pacientes.find((p) => p.id === b.paciente_id)?.nombre}</strong>
          {b.items.map((it) => (
            <div key={it.id} className="fila-item">
              <span>{it.medicamento} <small>lote {it.lote}</small></span>
              {hechos[it.id] ? <span className="chip">registrado</span> : <>
                <input type="number" min={0} max={it.cantidad} placeholder="0" value={conteos[it.id] ?? ''} onChange={(e) => setConteos((c) => ({ ...c, [it.id]: Number(e.target.value) }))} />
                <button className="peq" disabled={conteos[it.id] === undefined} onClick={async () => {
                  if (!conteos[it.id]) {
                    await guardarPrivado('devuelto:' + it.id, true);
                    setHechos((h) => ({ ...h, [it.id]: true }));
                  } else setFotoPara(it.id);
                }}>{conteos[it.id] ? 'Foto y registrar' : 'Nada vuelve'}</button>
              </>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
