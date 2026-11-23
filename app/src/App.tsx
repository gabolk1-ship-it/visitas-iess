import { useEffect, useState } from 'react';
import BarraSync from './componentes/BarraSync';
import { llamar } from './lib/api';
import { borrarTodo, cerrarSesion, estaActivado, fijarConfig, leerUsuario, sesionAbierta } from './lib/db';
import { iniciarSincronizacion, refrescarConteo } from './lib/sync';
import type { ConfigApp, Usuario } from './lib/tipos';
import { Activacion, Desbloqueo } from './pantallas/Activacion';
import Agenda from './pantallas/Agenda';
import Farmacia from './pantallas/Farmacia';
import Visor from './pantallas/Visor';

type Estado = 'cargando' | 'activar' | 'bloqueado' | 'listo';
const BLOQUEO_INACTIVIDAD_MS = 10 * 60000;

export default function App() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [modulo, setModulo] = useState<'agenda' | 'farmacia' | 'visor' | null>(null);

  const evaluar = async () => {
    if (!(await estaActivado())) return setEstado('activar');
    if (!sesionAbierta()) return setEstado('bloqueado');
    setUsuario((await leerUsuario()) || null);
    setEstado('listo');
    iniciarSincronizacion();
    refrescarConteo();
    // Actualiza umbrales y llave pública si hay señal.
    if (navigator.onLine) llamar<{ config: ConfigApp }>('config').then((r) => fijarConfig(r.config)).catch(() => undefined);
  };
  useEffect(() => { evaluar(); }, []);

  // Bloqueo por inactividad: vuelve a pedir el PIN.
  useEffect(() => {
    if (estado !== 'listo') return;
    let t = setTimeout(bloquear, BLOQUEO_INACTIVIDAD_MS);
    function bloquear() { cerrarSesion(); setEstado('bloqueado'); }
    const reiniciar = () => { clearTimeout(t); t = setTimeout(bloquear, BLOQUEO_INACTIVIDAD_MS); };
    ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, reiniciar));
    return () => { clearTimeout(t); ['pointerdown', 'keydown'].forEach((ev) => window.removeEventListener(ev, reiniciar)); };
  }, [estado]);

  if (estado === 'cargando') return <main className="pantalla centro"><p>Cargando…</p></main>;
  if (estado === 'activar') return <Activacion alTerminar={evaluar} />;
  if (estado === 'bloqueado') return <Desbloqueo alAbrir={evaluar} />;

  const rol = usuario?.rol;
  const elegido = modulo || (rol === 'medico' ? 'agenda' : rol === 'farmacia' ? 'farmacia' : rol === 'supervisor' ? 'visor' : null);

  return (
    <div className="app">
      <header className="barra">
        <span>{usuario?.nombre} · {rol}</span>
        <span>
          {rol === 'admin' && elegido && <button className="sec peq" onClick={() => setModulo(null)}>Menú</button>}
          <button className="sec peq" onClick={() => { cerrarSesion(); setEstado('bloqueado'); }}>Bloquear</button>
        </span>
      </header>
      {elegido === 'agenda' && <Agenda />}
      {elegido === 'farmacia' && <Farmacia />}
      {elegido === 'visor' && <Visor />}
      {!elegido && (
        <main className="pantalla">
          <h1>Administración</h1>
          <button onClick={() => setModulo('farmacia')}>Farmacia</button>
          <button onClick={() => setModulo('visor')}>Visor de supervisión</button>
          <button className="sec" onClick={async () => {
            if (confirm('¿Borrar todos los datos de este teléfono? Lo no enviado se perderá.')) { await borrarTodo(); location.reload(); }
          }}>Desactivar este teléfono</button>
        </main>
      )}
      <BarraSync />
    </div>
  );
}
