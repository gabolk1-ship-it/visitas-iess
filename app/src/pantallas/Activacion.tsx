import { useState } from 'react';
import { llamar } from '../lib/api';
import { abrirConPin, crearPin, fijarApiUrl, fijarConfig, pedirPersistencia } from '../lib/db';
import type { ConfigApp } from '../lib/tipos';
import { plataforma } from '../lib/util';

export function Activacion({ alTerminar }: { alTerminar: () => void }) {
  const [url, setUrl] = useState<string>(import.meta.env.VITE_API_URL || '');
  const [codigo, setCodigo] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [aceptado, setAceptado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const activar = async () => {
    setError(null);
    if (!/^\d{6}$/.test(pin)) { setError('El PIN debe tener 6 números.'); return; }
    if (pin !== pin2) { setError('Los PIN no coinciden.'); return; }
    setOcupado(true);
    try {
      const r = await llamar<{ token: string; config: ConfigApp }>('activar',
        { codigo: codigo.trim().toUpperCase(), plataforma: plataforma(), modelo: navigator.userAgent.slice(0, 120) }, { url: url.trim() });
      await fijarApiUrl(url.trim());
      await fijarConfig(r.config);
      await crearPin(pin, r.token);
      await pedirPersistencia();
      alTerminar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="pantalla">
      <h1>Activar este teléfono</h1>
      <p>Use el código de 8 letras que le entregó el administrador. Se usa una sola vez.</p>
      {!import.meta.env.VITE_API_URL && (
        <label>Dirección del servidor<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" /></label>
      )}
      <label>Código de activación<input value={codigo} onChange={(e) => setCodigo(e.target.value)} autoCapitalize="characters" maxLength={8} /></label>
      <label>Cree un PIN de 6 números<input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" maxLength={6} /></label>
      <label>Repita el PIN<input value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" maxLength={6} /></label>
      <div className="aviso-privacidad">
        <strong>Qué toma esta app</strong>
        <p>Cámara y ubicación solo al iniciar y cerrar cada visita, y al registrar entregas. Nunca accede a su galería, contactos ni a su ubicación fuera de las visitas. Los datos se guardan cifrados y se borran del teléfono al enviarse.</p>
        <label className="check"><input type="checkbox" checked={aceptado} onChange={(e) => setAceptado(e.target.checked)} /> Leí y acepto el acuerdo de uso firmado con el IESS</label>
      </div>
      {error && <p className="error">{error}</p>}
      <button disabled={ocupado || !aceptado || codigo.length < 6 || !url} onClick={activar}>{ocupado ? 'Activando…' : 'Activar'}</button>
    </main>
  );
}

export function Desbloqueo({ alAbrir }: { alAbrir: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrar = async () => {
    setOcupado(true);
    setError(null);
    try {
      if (await abrirConPin(pin)) alAbrir();
      else { setError('PIN incorrecto'); setPin(''); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <main className="pantalla centro">
      <h1>Visitas IESS</h1>
      <label>PIN<input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" maxLength={6} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 6) entrar(); }} /></label>
      {error && <p className="error">{error}</p>}
      <button disabled={pin.length !== 6 || ocupado} onClick={entrar}>{ocupado ? 'Abriendo…' : 'Entrar'}</button>
    </main>
  );
}
