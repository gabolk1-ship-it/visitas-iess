/**
 * Flujo de una visita domiciliaria. Cada paso se guarda cifrado en el teléfono,
 * así la visita sobrevive a un cierre de la app o a quedarse sin batería.
 *
 * Inicio:  QR de la tarjeta del afiliado → GPS en vivo → foto del médico → foto del lugar
 * Entrega: quién recibe → cada medicamento (foto de la caja + lectura de lote) → firma y foto de la entrega
 * Cierre:  GPS en vivo → foto del lugar
 */
import { useEffect, useState } from 'react';
import Camara from '../componentes/Camara';
import Firma from '../componentes/Firma';
import { encolar, guardarPrivado, leerPrivado } from '../lib/db';
import { canvasABlob, guardarCifrada } from '../lib/fotos';
import { obtenerUbicacion } from '../lib/gps';
import { leerCaja } from '../lib/ocr';
import { sincronizar } from '../lib/sync';
import type { Bolsa, ConfigApp, Cuidador, FotoCifrada, ItemAgenda, ItemBolsa, Paciente, Ubicacion } from '../lib/tipos';
import { distanciaM, horaLocal, hoy, normalizarLote, uuid } from '../lib/util';

type Paso = 'inicio' | 'qr' | 'gpsInicio' | 'fotoMedico' | 'fotoLugar' | 'receptor' | 'entregas' | 'acta' | 'gpsCierre' | 'fotoCierre' | 'hecha'
  | 'fallidaMotivo' | 'fallidaGps' | 'fallidaFoto' | 'fallida';

interface Receptor { tipo: 'paciente' | 'cuidador' | 'otro'; nombre: string; cedula: string; parentesco: string; autorizadoControlados: boolean }
interface EntregaLocal { estado: 'entregado' | 'no_entregado'; cantidad?: number; lote?: string; motivo?: string }

export interface VisitaLocal {
  visitaId: string; agendaId: string; paso: Paso; qrOk?: boolean;
  ubicacion?: Ubicacion; fotoMedico?: FotoCifrada; inicioMs?: number;
  receptor?: Receptor; entregas: Record<string, EntregaLocal>; motivo?: string;
}

const MOTIVOS_FALLIDA = ['Paciente ausente', 'Dirección no encontrada', 'Paciente rechazó la visita', 'Paciente hospitalizado', 'Otro'];

interface Props { item: ItemAgenda; paciente: Paciente; cuidadores: Cuidador[]; bolsas: Bolsa[]; conf: ConfigApp; alSalir: () => void }

export default function Visita({ item, paciente, cuidadores, bolsas, conf, alSalir }: Props) {
  const [v, setV] = useState<VisitaLocal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsTexto, setGpsTexto] = useState('');

  useEffect(() => {
    leerPrivado<VisitaLocal>('visita:' + item.id).then((x) => setV(x || { visitaId: uuid(), agendaId: item.id, paso: 'inicio', entregas: {} }));
  }, [item.id]);

  const guardar = async (cambios: Partial<VisitaLocal>) => {
    const nuevo = { ...v!, ...cambios };
    await guardarPrivado('visita:' + item.id, nuevo);
    setV(nuevo);
    setError(null);
  };

  if (!v) return <main className="pantalla"><p>Cargando…</p></main>;

  const items: (ItemBolsa & { bolsa_id: string })[] = bolsas.flatMap((b) => b.items.map((i) => ({ ...i, bolsa_id: b.id })));
  const sello = (extra: string) => () => [
    `IESS Cotocollao · ${extra} · visita ${v.visitaId.slice(0, 8)}`,
    `${hoy()} ${horaLocal()}`,
    v.ubicacion ? `${v.ubicacion.lat.toFixed(6)}, ${v.ubicacion.lon.toFixed(6)} ±${v.ubicacion.precision} m` : 'sin ubicación'
  ];
  const tomarGps = async (siguiente: Paso) => {
    setGpsTexto('Buscando señal GPS…');
    try {
      const u = await obtenerUbicacion(conf.precisionMaxM, 20000, 3, (l, n) => setGpsTexto(`Lectura ${n}: precisión ${Math.round(l.precision)} m`));
      await guardar({ ubicacion: u, paso: siguiente });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGpsTexto('');
    }
  };
  const evento = (tipo: 'inicio' | 'cierre' | 'fallida', u: Ubicacion, extra: Record<string, unknown>) => encolar('eventos', {
    id: uuid(), visita_id: v.visitaId, agenda_id: item.id, paciente_id: paciente.id, tipo,
    lat: u.lat, lon: u.lon, precision_m: u.precision, lecturas: u.lecturas, hora_tel: new Date().toISOString(), ...extra
  });
  const distancia = v.ubicacion && paciente.lat !== null && paciente.lon !== null
    ? Math.round(distanciaM(v.ubicacion.lat, v.ubicacion.lon, paciente.lat, paciente.lon)) : null;

  const cab = (
    <div className="cab-visita">
      <button className="sec peq" onClick={alSalir}>← Agenda</button>
      <div><strong>{paciente.nombre}</strong><br /><small>{paciente.direccion || paciente.sector}</small></div>
    </div>
  );
  const pie = (
    <>
      {error && <p className="error">{error}</p>}
      {gpsTexto && <p className="nota">{gpsTexto}</p>}
    </>
  );

  switch (v.paso) {
    case 'inicio':
      return (
        <main className="pantalla">{cab}
          {paciente.lat === null && <p className="nota">Primera visita: el domicilio se registrará con la ubicación de inicio.</p>}
          <button onClick={() => guardar({ paso: paciente.qr_codigo ? 'qr' : 'gpsInicio', qrOk: !paciente.qr_codigo ? undefined : false })}>Iniciar visita</button>
          <button className="sec" onClick={() => guardar({ paso: 'fallidaMotivo' })}>No se pudo realizar</button>
          {pie}
        </main>
      );

    case 'qr':
      return (
        <main className="pantalla">{cab}
          <Camara modo="qr" titulo="Escanee la tarjeta del afiliado" ayuda="Pida al paciente o cuidador la tarjeta QR que le entregó el IESS."
            alLeerQr={(t) => {
              if (t.trim() === paciente.qr_codigo) guardar({ qrOk: true, paso: 'gpsInicio' });
              else setError('La tarjeta no corresponde a este paciente. Verifique.');
            }} />
          <button className="sec" onClick={() => guardar({ qrOk: false, paso: 'gpsInicio' })}>El paciente no tiene la tarjeta</button>
          {pie}
        </main>
      );

    case 'gpsInicio':
    case 'gpsCierre':
    case 'fallidaGps': {
      const sig: Paso = v.paso === 'gpsInicio' ? 'fotoMedico' : v.paso === 'gpsCierre' ? 'fotoCierre' : 'fallidaFoto';
      return (
        <main className="pantalla">{cab}
          <h2>Ubicación</h2>
          <p>Se tomarán varias lecturas en este momento. Manténgase en el domicilio, de preferencia al aire libre.</p>
          <button disabled={!!gpsTexto} onClick={() => tomarGps(sig)}>{gpsTexto ? 'Buscando…' : 'Tomar ubicación'}</button>
          {pie}
        </main>
      );
    }

    case 'fotoMedico':
      return (
        <main className="pantalla">{cab}
          {distancia !== null && distancia > conf.geocercaM && <p className="aviso">Está a {distancia} m del domicilio registrado. La visita quedará marcada para revisión.</p>}
          <Camara frontal titulo="Foto del médico" ayuda="Foto de su rostro con la cámara frontal. Solo la ve supervisión." sello={sello('médico')}
            alCapturar={async (c) => { const f = await guardarCifrada(await canvasABlob(c)); await guardar({ fotoMedico: f, paso: 'fotoLugar' }); }} />
          {pie}
        </main>
      );

    case 'fotoLugar':
      return (
        <main className="pantalla">{cab}
          <Camara titulo="Foto del lugar" ayuda="La fachada o la entrada con la numeración visible. Sin personas." sello={sello('inicio')}
            alCapturar={async (c) => {
              const f = await guardarCifrada(await canvasABlob(c));
              await evento('inicio', v.ubicacion!, {
                qr_ok: v.qrOk === true, foto_key: f.key, foto_llave: f.llave, foto_hash: f.hash,
                foto_medico_key: v.fotoMedico?.key, foto_medico_llave: v.fotoMedico?.llave, foto_medico_hash: v.fotoMedico?.hash
              });
              await guardar({ paso: items.length ? 'receptor' : 'gpsCierre', inicioMs: Date.now() });
              sincronizar();
            }} />
          {pie}
        </main>
      );

    case 'receptor':
      return <PasoReceptor paciente={paciente} cuidadores={cuidadores} hayControlados={items.some((i) => i.controlado)} cab={cab}
        alElegir={(r) => guardar({ receptor: r, paso: 'entregas' })} />;

    case 'entregas': {
      const pendientes = items.filter((i) => !v.entregas[i.id]);
      return (
        <main className="pantalla">{cab}
          <h2>Entrega de medicamentos</h2>
          <p className="nota">Recibe: {v.receptor?.nombre} ({v.receptor?.parentesco})</p>
          {items.map((it) => {
            const e = v.entregas[it.id];
            return (
              <div key={it.id} className={'tarjeta' + (e ? ' hecha' : '')}>
                <strong>{it.cantidad} × {it.medicamento}</strong>{it.controlado && <span className="chip rojo">controlado</span>}
                <br /><small>Preparado: lote {it.lote} · vence {it.vencimiento}</small>
                {e && <p className="nota">{e.estado === 'entregado' ? `Entregado: ${e.cantidad} · lote ${e.lote}` : `No entregado: ${e.motivo}`}</p>}
              </div>
            );
          })}
          {pendientes.length > 0
            ? <ItemEntrega key={pendientes[0].id} it={pendientes[0]} v={v} paciente={paciente} receptor={v.receptor!}
              alTerminar={(id, e) => guardar({ entregas: { ...v.entregas, [id]: e } })} />
            : <button onClick={() => guardar({ paso: 'acta' })}>Continuar a la firma</button>}
          {pie}
        </main>
      );
    }

    case 'acta':
      return <PasoActa v={v} cab={cab} alTerminar={() => guardar({ paso: 'gpsCierre' })} />;

    case 'fotoCierre':
      return (
        <main className="pantalla">{cab}
          <Camara titulo="Foto de cierre" ayuda="Otra vez la fachada o la entrada, al salir." sello={sello('cierre')}
            alCapturar={async (c) => {
              const min = v.inicioMs ? (Date.now() - v.inicioMs) / 60000 : 99;
              if (min < conf.visitaMinMin && !confirm(`La visita duró ${Math.round(min)} min. ¿Cerrarla de todas formas? Quedará marcada para revisión.`)) return;
              const f = await guardarCifrada(await canvasABlob(c));
              await evento('cierre', v.ubicacion!, { foto_key: f.key, foto_llave: f.llave, foto_hash: f.hash });
              await guardar({ paso: 'hecha' });
              sincronizar();
            }} />
          {pie}
        </main>
      );

    case 'fallidaMotivo':
      return (
        <main className="pantalla">{cab}
          <h2>¿Por qué no se realizó?</h2>
          {MOTIVOS_FALLIDA.map((m) => <button key={m} className="sec" onClick={() => guardar({ motivo: m, paso: 'fallidaGps' })}>{m}</button>)}
          <button className="sec" onClick={() => guardar({ paso: 'inicio' })}>Volver</button>
        </main>
      );

    case 'fallidaFoto':
      return (
        <main className="pantalla">{cab}
          <Camara titulo="Foto del lugar" ayuda="Fachada o entrada, como constancia del intento." sello={sello('fallida')}
            alCapturar={async (c) => {
              const f = await guardarCifrada(await canvasABlob(c));
              await evento('fallida', v.ubicacion!, { motivo: v.motivo, foto_key: f.key, foto_llave: f.llave, foto_hash: f.hash });
              await guardar({ paso: 'fallida' });
              sincronizar();
            }} />
          {pie}
        </main>
      );

    case 'hecha':
    case 'fallida':
      return (
        <main className="pantalla">{cab}
          <h2>{v.paso === 'hecha' ? 'Visita registrada' : 'Visita fallida registrada'}</h2>
          <p>Los datos se enviarán apenas haya conexión. Puede ver el pendiente en la barra inferior.</p>
          <button onClick={alSalir}>Volver a la agenda</button>
        </main>
      );
  }
}

function PasoReceptor({ paciente, cuidadores, hayControlados, cab, alElegir }: {
  paciente: Paciente; cuidadores: Cuidador[]; hayControlados: boolean; cab: JSX.Element; alElegir: (r: Receptor) => void;
}) {
  const [otro, setOtro] = useState(false);
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [parentesco, setParentesco] = useState('');
  const cedulaPaciente = /^\d{10}$/.test(paciente.codigo_afiliado) ? paciente.codigo_afiliado : '';
  return (
    <main className="pantalla">{cab}
      <h2>¿Quién recibe?</h2>
      {hayControlados && <p className="aviso">Hay medicamentos controlados: solo pueden entregarse al paciente o a un cuidador autorizado.</p>}
      {!otro && <>
        <button onClick={() => alElegir({ tipo: 'paciente', nombre: paciente.nombre, cedula: cedulaPaciente, parentesco: 'paciente', autorizadoControlados: true })}>El paciente</button>
        {cuidadores.map((c) => (
          <button key={c.id} className="sec" onClick={() => alElegir({ tipo: 'cuidador', nombre: c.nombre, cedula: c.cedula, parentesco: c.parentesco, autorizadoControlados: c.autorizado_controlados })}>
            {c.nombre} ({c.parentesco}){c.autorizado_controlados ? ' · autorizado controlados' : ''}
          </button>
        ))}
        <button className="sec" onClick={() => setOtro(true)}>Otra persona</button>
      </>}
      {otro && <>
        <label>Nombre completo<input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label>Cédula<input value={cedula} inputMode="numeric" maxLength={10} onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))} /></label>
        <label>Parentesco o relación<input value={parentesco} onChange={(e) => setParentesco(e.target.value)} /></label>
        <button disabled={nombre.length < 5 || cedula.length !== 10 || !parentesco}
          onClick={() => alElegir({ tipo: 'otro', nombre, cedula, parentesco, autorizadoControlados: false })}>Continuar</button>
        <button className="sec" onClick={() => setOtro(false)}>Volver</button>
      </>}
    </main>
  );
}

function ItemEntrega({ it, v, paciente, receptor, alTerminar }: {
  it: ItemBolsa & { bolsa_id: string }; v: VisitaLocal; paciente: Paciente; receptor: Receptor; alTerminar: (id: string, e: EntregaLocal) => Promise<void>;
}) {
  const [fase, setFase] = useState<'menu' | 'camara' | 'leyendo' | 'form' | 'noEntrega'>('menu');
  const [foto, setFoto] = useState<FotoCifrada | null>(null);
  const [lote, setLote] = useState('');
  const [venc, setVenc] = useState('');
  const [leidoAuto, setLeidoAuto] = useState(false);
  const [cantidad, setCantidad] = useState(it.cantidad);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bloqueado = it.controlado && !receptor.autorizadoControlados;
  const coincide = lote && normalizarLote(lote) === normalizarLote(it.lote);
  const vencido = venc && venc < hoy();

  if (bloqueado && fase === 'menu') {
    return (
      <div className="tarjeta resaltada">
        <p className="aviso">{it.medicamento} es controlado y {receptor.nombre} no está autorizado para recibirlo. Debe volver a farmacia.</p>
        <button onClick={() => alTerminar(it.id, { estado: 'no_entregado', motivo: 'Receptor no autorizado para controlados' })}>Entendido</button>
      </div>
    );
  }

  if (fase === 'camara') {
    return <Camara titulo={'Caja de ' + it.medicamento} ayuda="Encuadre el lado donde están impresos el lote y el vencimiento."
      sello={() => [`IESS Cotocollao · entrega · visita ${v.visitaId.slice(0, 8)}`, `${hoy()} ${horaLocal()}`]}
      alCancelar={() => setFase('menu')}
      alCapturar={async (c) => {
        setFase('leyendo');
        const [f, l] = await Promise.all([
          canvasABlob(c).then(guardarCifrada),
          leerCaja(c).catch(() => ({ lote: null, vencimiento: null, texto: '' }))
        ]);
        setFoto(f);
        setLote(l.lote || '');
        setVenc(l.vencimiento || '');
        setLeidoAuto(!!(l.lote || l.vencimiento));
        setFase('form');
      }} />;
  }

  if (fase === 'leyendo') return <div className="tarjeta"><p>Leyendo lote y vencimiento…</p></div>;

  if (fase === 'noEntrega') {
    return (
      <div className="tarjeta resaltada">
        <label>¿Por qué no se entrega {it.medicamento}?<input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
        <div className="acciones">
          <button className="sec" onClick={() => setFase('menu')}>Volver</button>
          <button disabled={motivo.length < 4} onClick={() => alTerminar(it.id, { estado: 'no_entregado', motivo })}>Confirmar</button>
        </div>
      </div>
    );
  }

  if (fase === 'form' && foto) {
    const guardar = async () => {
      if (vencido) { setError('Producto vencido: no se puede entregar.'); return; }
      if (cantidad > it.cantidad) { setError('No puede entregar más de lo preparado.'); return; }
      if (!coincide && motivo.length < 4) { setError('El lote no coincide con lo preparado: explique el motivo.'); return; }
      await encolar('entregas', {
        id: uuid(), visita_id: v.visitaId, paciente_id: paciente.id, bolsa_id: it.bolsa_id, preparacion_id: it.id, orden_id: it.orden_id,
        medicamento_codigo: it.medicamento_codigo, lote_leido: lote, venc_leido: venc, cantidad, motivo,
        foto_key: foto.key, foto_llave: foto.llave, foto_hash: foto.hash, ocr_confirmado: leidoAuto
      });
      await alTerminar(it.id, { estado: 'entregado', cantidad, lote });
    };
    return (
      <div className="tarjeta resaltada">
        <strong>{it.medicamento}</strong>
        <p className="nota">{leidoAuto ? 'Revise lo que leyó la cámara y corrija si hace falta.' : 'No se pudo leer la caja: escriba lote y vencimiento.'}</p>
        <label>Lote<input value={lote} onChange={(e) => setLote(e.target.value.toUpperCase())} /></label>
        <p className={coincide ? 'ok' : 'aviso'}>{coincide ? '✓ Coincide con lo preparado' : `No coincide con lo preparado (${it.lote})`}</p>
        <label>Vencimiento<input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} /></label>
        {vencido && <p className="error">Producto vencido: no se puede entregar.</p>}
        <label>Cantidad entregada (máximo {it.cantidad})<input type="number" min={0} max={it.cantidad} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} /></label>
        {(!coincide || cantidad < it.cantidad) && <label>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>}
        {error && <p className="error">{error}</p>}
        <div className="acciones">
          <button className="sec" onClick={() => setFase('camara')}>Otra foto</button>
          <button disabled={!lote || !venc || !!vencido} onClick={guardar}>Registrar entrega</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tarjeta resaltada">
      <p>Siguiente: <strong>{it.cantidad} × {it.medicamento}</strong></p>
      <div className="acciones">
        <button className="sec" onClick={() => setFase('noEntrega')}>No se entrega</button>
        <button onClick={() => setFase('camara')}>Fotografiar caja</button>
      </div>
    </div>
  );
}

function PasoActa({ v, cab, alTerminar }: { v: VisitaLocal; cab: JSX.Element; alTerminar: () => void }) {
  const [firma, setFirma] = useState<HTMLCanvasElement | null>(null);
  const [firmaGuardada, setFirmaGuardada] = useState<FotoCifrada | null>(null);
  const entregados = Object.values(v.entregas).filter((e) => e.estado === 'entregado');
  if (!entregados.length) {
    return (
      <main className="pantalla">{cab}
        <p>No se entregó ningún medicamento en esta visita.</p>
        <button onClick={alTerminar}>Continuar al cierre</button>
      </main>
    );
  }
  if (!firmaGuardada) {
    return (
      <main className="pantalla">{cab}
        <h2>Acta de recepción</h2>
        <Firma texto={`${v.receptor!.nombre} (C.I. ${v.receptor!.cedula || 's/n'}) declara recibir ${entregados.reduce((s, e) => s + (e.cantidad || 0), 0)} unidad(es) de medicamentos.`} alListo={setFirma} />
        <button disabled={!firma} onClick={async () => setFirmaGuardada(await guardarCifrada(await canvasABlob(firma!, 0.8)))}>Guardar firma</button>
      </main>
    );
  }
  return (
    <main className="pantalla">{cab}
      <Camara titulo="Foto de la entrega" ayuda="Los medicamentos entregados sobre la mesa o en manos del receptor. Sin rostros."
        sello={() => [`IESS Cotocollao · acta · visita ${v.visitaId.slice(0, 8)}`, `${hoy()} ${horaLocal()}`]}
        alCapturar={async (c) => {
          const f = await guardarCifrada(await canvasABlob(c));
          await encolar('actas', {
            id: uuid(), visita_id: v.visitaId, receptor_nombre: v.receptor!.nombre, receptor_cedula: v.receptor!.cedula, parentesco: v.receptor!.parentesco,
            firma_key: firmaGuardada.key, firma_llave: firmaGuardada.llave, foto_key: f.key, foto_llave: f.llave, foto_hash: f.hash
          });
          alTerminar();
        }} />
    </main>
  );
}
