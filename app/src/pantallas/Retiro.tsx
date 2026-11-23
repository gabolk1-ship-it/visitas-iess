import { useState } from 'react';
import Firma from '../componentes/Firma';
import { encolar, guardarPrivado } from '../lib/db';
import { canvasABlob, guardarCifrada } from '../lib/fotos';
import { sincronizar } from '../lib/sync';
import type { Bolsa, Paciente } from '../lib/tipos';
import { uuid } from '../lib/util';

/** El médico revisa lo preparado y firma que lo recibe. Desde aquí el maletín queda a su cargo. */
export default function Retiro({ bolsas, pacientes, alTerminar, alCancelar }: { bolsas: Bolsa[]; pacientes: Paciente[]; alTerminar: () => void; alCancelar: () => void }) {
  const [firma, setFirma] = useState<HTMLCanvasElement | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = bolsas.reduce((s, b) => s + b.items.length, 0);

  const confirmar = async () => {
    if (!firma) return;
    setOcupado(true);
    try {
      const f = await guardarCifrada(await canvasABlob(firma, 0.8));
      for (const b of bolsas) {
        for (const it of b.items) {
          await encolar('movimientos', { id: uuid(), tipo: 'retiro', preparacion_id: it.id, cantidad: it.cantidad, firma_key: f.key, firma_llave: f.llave });
        }
        await guardarPrivado('retiro:' + b.id, true);
      }
      sincronizar();
      alTerminar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="pantalla">
      <h1>Retiro del maletín</h1>
      <p>Revise que cada bolsa contenga exactamente lo listado. Si algo no coincide, no firme y avise a farmacia.</p>
      {bolsas.map((b) => (
        <div className="tarjeta" key={b.id}>
          <strong>{pacientes.find((p) => p.id === b.paciente_id)?.nombre || b.paciente_id}</strong>
          <ul className="items">
            {b.items.map((it) => (
              <li key={it.id}>{it.cantidad} × {it.medicamento} <small>lote {it.lote} · vence {it.vencimiento}</small>{it.controlado && <span className="chip rojo">controlado</span>}</li>
            ))}
          </ul>
        </div>
      ))}
      <Firma texto={`Firmo que recibo ${bolsas.length} bolsa(s) con ${total} medicamento(s).`} alListo={setFirma} />
      {error && <p className="error">{error}</p>}
      <div className="acciones">
        <button className="sec" onClick={alCancelar}>Volver</button>
        <button disabled={!firma || ocupado} onClick={confirmar}>{ocupado ? 'Guardando…' : 'Firmar retiro'}</button>
      </div>
    </main>
  );
}
