import { useEffect, useState } from 'react';
import { sincronizar, suscribir, type EstadoSync } from '../lib/sync';

/** Barra fija que muestra siempre cuánto falta por enviar. */
export default function BarraSync() {
  const [e, setE] = useState<EstadoSync | null>(null);
  const [linea, setLinea] = useState(navigator.onLine);
  useEffect(() => suscribir(setE), []);
  useEffect(() => {
    const on = () => setLinea(true), off = () => setLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!e) return null;
  const pendiente = e.registros + e.fotos;
  const viejo = e.ultimoEnvio === null && pendiente > 0;
  const clase = pendiente === 0 ? 'ok' : viejo || !linea ? 'aviso' : 'info';
  return (
    <div className={'barra-sync ' + clase} onClick={() => sincronizar()}>
      {!linea && <span>Sin conexión · </span>}
      {e.enviando ? <span>Enviando…</span> : pendiente === 0 ? <span>Todo enviado</span> :
        <span>Pendiente: {e.registros} registro(s), {e.fotos} foto(s). Toque para enviar.</span>}
      {e.error && <span className="err"> · {e.error}</span>}
    </div>
  );
}
