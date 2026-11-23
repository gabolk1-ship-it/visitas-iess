/**
 * Visor de supervisión: las fotos se descargan cifradas desde R2 y se descifran
 * solo en este navegador, con la frase secreta de supervisión. Nada legible pasa por el servidor.
 */
import { useEffect, useState } from 'react';
import { llamar } from '../lib/api';
import { abrirPrivada, descifrarDeSupervision, type PrivadaCifrada } from '../lib/cripto';
import { hoy } from '../lib/util';

type Fila = Record<string, string>;
interface DatosVisor {
  llavePrivadaCifrada: PrivadaCifrada | null;
  visitas: (Fila & { medico: string; paciente: { nombre: string; codigo_afiliado: string; lat: string; lon: string } | null })[];
  eventos: Fila[]; entregas: Fila[]; actas: Fila[]; alertas: Fila[]; preparaciones: Fila[]; bolsas: Fila[];
}

export default function Visor() {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [frase, setFrase] = useState('');
  const [privada, setPrivada] = useState<CryptoKey | null>(null);
  const [datos, setDatos] = useState<DatosVisor | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await llamar<DatosVisor>('visor', { desde, hasta });
      if (!privada) {
        if (!r.llavePrivadaCifrada) throw new Error('Falta LLAVE_PRIVADA_CIFRADA en la pestaña Config.');
        try { setPrivada(await abrirPrivada(r.llavePrivadaCifrada, frase)); }
        catch { throw new Error('Frase secreta incorrecta'); }
      }
      setDatos(r);
      setSel(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  };

  if (sel && datos && privada) return <DetalleVisita id={sel} datos={datos} privada={privada} alVolver={() => setSel(null)} />;

  const visitas = (datos?.visitas || []).slice().sort((a, b) => Number(a.puntaje || 0) - Number(b.puntaje || 0));
  return (
    <main className="pantalla ancha">
      <h1>Visor de supervisión</h1>
      <div className="filtros">
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {!privada && <label>Frase secreta de supervisión<input type="password" value={frase} onChange={(e) => setFrase(e.target.value)} /></label>}
        <button disabled={cargando || (!privada && frase.length < 8)} onClick={cargar}>{cargando ? 'Cargando…' : 'Ver visitas'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {datos && <>
        <p className="nota">{visitas.length} visita(s). Ordenadas de menor a mayor puntaje de confianza.</p>
        <table className="tabla">
          <thead><tr><th>Inicio</th><th>Médico</th><th>Paciente</th><th>Estado</th><th>Min</th><th>Distancia</th><th>Puntaje</th><th>Banderas</th></tr></thead>
          <tbody>
            {visitas.map((v) => (
              <tr key={v.id} onClick={() => setSel(v.id)} className={Number(v.puntaje) < 60 ? 'bajo' : Number(v.puntaje) < 80 ? 'medio' : ''}>
                <td>{v.inicio}</td><td>{v.medico}</td><td>{v.paciente?.nombre}</td><td>{v.estado}</td>
                <td>{v.duracion_min}</td><td>{v.distancia_inicio_m ? v.distancia_inicio_m + ' m' : '—'}</td>
                <td><strong>{v.puntaje}</strong></td><td><small>{v.banderas.replace(/,/g, ', ').replace(/_/g, ' ')}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}
    </main>
  );
}

function Foto({ titulo, k, llave, urls, privada }: { titulo: string; k?: string; llave?: string; urls: Record<string, string>; privada: CryptoKey }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    if (!k || !llave || !urls[k]) return;
    (async () => {
      try {
        const r = await fetch(urls[k]);
        if (!r.ok) throw new Error(String(r.status));
        const claro = await descifrarDeSupervision(await r.arrayBuffer(), llave, privada);
        url = URL.createObjectURL(new Blob([claro], { type: 'image/jpeg' }));
        setSrc(url);
      } catch { setError(true); }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [k, llave, urls, privada, titulo]);
  if (!k) return null;
  return (
    <figure className="foto">
      {src ? <img src={src} alt={titulo} /> : <div className="foto-vacia">{error ? 'No disponible (¿aún no se sube?)' : 'Descifrando…'}</div>}
      <figcaption>{titulo}</figcaption>
    </figure>
  );
}

function DetalleVisita({ id, datos, privada, alVolver }: { id: string; datos: DatosVisor; privada: CryptoKey; alVolver: () => void }) {
  const v = datos.visitas.find((x) => x.id === id)!;
  const eventos = datos.eventos.filter((e) => e.visita_id === id);
  const entregas = datos.entregas.filter((e) => e.visita_id === id);
  const actas = datos.actas.filter((a) => a.visita_id === id);
  const alertas = datos.alertas.filter((a) => a.visita_id === id);
  const preps = datos.preparaciones.filter((p) => entregas.some((e) => e.preparacion_id === p.id));
  const bolsas = datos.bolsas.filter((b) => entregas.some((e) => e.bolsa_id === b.id));
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const claves = [
      ...eventos.flatMap((e) => [e.foto_key, e.foto_medico_key]), ...entregas.map((e) => e.foto_key),
      ...actas.flatMap((a) => [a.foto_key, a.firma_key]), ...preps.map((p) => p.foto_key), ...bolsas.map((b) => b.foto_key)
    ].filter(Boolean);
    if (!claves.length) return;
    (async () => {
      const todas: Record<string, string> = {};
      for (let i = 0; i < claves.length; i += 50) {
        const r = await llamar<{ urls: Record<string, string> }>('firmar', { metodo: 'GET', claves: claves.slice(i, i + 50) });
        Object.assign(todas, r.urls);
      }
      setUrls(todas);
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const mapa = (lat: string, lon: string) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
  return (
    <main className="pantalla ancha">
      <button className="sec peq" onClick={alVolver}>← Lista</button>
      <h1>{v.paciente?.nombre} · {v.inicio}</h1>
      <p>Médico: {v.medico} · Estado: {v.estado} · Duración: {v.duracion_min || '—'} min · Puntaje: <strong>{v.puntaje}</strong></p>
      {v.motivo_fallida && <p>Motivo: {v.motivo_fallida}</p>}
      {v.paciente?.lat && <p><a href={mapa(v.paciente.lat, v.paciente.lon)} target="_blank" rel="noreferrer">Domicilio registrado en el mapa</a></p>}
      {alertas.length > 0 && <div className="tarjeta resaltada"><strong>Alertas</strong>
        <ul>{alertas.map((a) => <li key={a.id}>{a.severidad} · {a.tipo.replace(/_/g, ' ')} · {a.detalle} · <em>{a.estado}</em></li>)}</ul>
        <small>El estado y la justificación se gestionan en la pestaña Alertas de la hoja.</small></div>}
      <h2>Eventos</h2>
      {eventos.map((e) => (
        <div className="tarjeta" key={e.id}>
          <strong>{e.tipo}</strong> · {e.hora_real ? new Date(e.hora_real).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : ''} · ±{e.precision_m} m · QR: {e.qr_ok} · reloj {e.desfase_s}s
          {' '}<a href={mapa(e.lat, e.lon)} target="_blank" rel="noreferrer">ver en mapa</a>
          <div className="galeria">
            <Foto titulo="Médico" k={e.foto_medico_key} llave={e.foto_medico_llave} urls={urls} privada={privada} />
            <Foto titulo="Lugar" k={e.foto_key} llave={e.foto_llave} urls={urls} privada={privada} />
          </div>
        </div>
      ))}
      {entregas.length > 0 && <h2>Entregas</h2>}
      {entregas.map((e) => {
        const p = preps.find((x) => x.id === e.preparacion_id);
        return (
          <div className="tarjeta" key={e.id}>
            <strong>{p?.medicamento || e.medicamento_codigo}</strong> · {e.cantidad} u. · lote leído {e.lote_leido} / preparado {p?.lote} ·
            {' '}<span className={e.lote_ok === 'SI' ? 'ok' : 'error'}>{e.lote_ok === 'SI' ? 'coincide' : 'NO coincide'}</span>
            {e.motivo && <> · motivo: {e.motivo}</>}
            <div className="galeria">
              <Foto titulo="Caja en farmacia" k={p?.foto_key} llave={p?.foto_llave} urls={urls} privada={privada} />
              <Foto titulo="Caja en domicilio" k={e.foto_key} llave={e.foto_llave} urls={urls} privada={privada} />
            </div>
          </div>
        );
      })}
      {bolsas.length > 0 && <div className="galeria">{bolsas.map((b) => <Foto key={b.id} titulo="Bolsa preparada" k={b.foto_key} llave={b.foto_llave} urls={urls} privada={privada} />)}</div>}
      {actas.map((a) => (
        <div className="tarjeta" key={a.id}>
          <strong>Acta</strong> · {a.receptor_nombre} · C.I. {a.receptor_cedula} · {a.parentesco} · registro: {a.receptor_autorizado}
          <div className="galeria">
            <Foto titulo="Firma" k={a.firma_key} llave={a.firma_llave} urls={urls} privada={privada} />
            <Foto titulo="Entrega" k={a.foto_key} llave={a.foto_llave} urls={urls} privada={privada} />
          </div>
        </div>
      ))}
    </main>
  );
}
