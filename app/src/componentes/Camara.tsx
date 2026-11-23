/**
 * Cámara en vivo dentro de la app. No existe opción de subir archivos ni de abrir la galería:
 * la foto es siempre un cuadro capturado en ese momento del visor.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { dibujarConSello } from '../lib/fotos';
import { esMovil } from '../lib/util';

const CAMARAS_VIRTUALES = /virtual|obs|manycam|snap camera|droidcam|epoccam|iriun|xsplit|camo|ndi|mmhmm/i;

interface Props {
  modo?: 'foto' | 'qr';
  frontal?: boolean;
  titulo: string;
  ayuda?: string;
  sello?: () => string[];
  alCapturar?: (c: HTMLCanvasElement) => void | Promise<void>;
  alLeerQr?: (texto: string) => void;
  alCancelar?: () => void;
}

export default function Camara({ modo = 'foto', frontal = false, titulo, ayuda, sello, alCapturar, alLeerQr, alCancelar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<HTMLCanvasElement | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    let raf = 0;
    (async () => {
      if (!esMovil()) { setError('La captura solo funciona desde un teléfono.'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: frontal ? 'user' : 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
        const etiqueta = s.getVideoTracks()[0]?.label || '';
        const dispositivos = await navigator.mediaDevices.enumerateDevices();
        if (CAMARAS_VIRTUALES.test(etiqueta) || dispositivos.some((d) => d.kind === 'videoinput' && CAMARAS_VIRTUALES.test(d.label) && d.label === etiqueta)) {
          s.getTracks().forEach((t) => t.stop());
          setError('Se detectó una cámara virtual. Use la cámara del teléfono.');
          return;
        }
        if (!vivo) { s.getTracks().forEach((t) => t.stop()); return; }
        flujo.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        if (modo === 'qr') {
          const lienzo = document.createElement('canvas');
          const ctx = lienzo.getContext('2d', { willReadFrequently: true })!;
          const ciclo = () => {
            if (!vivo) return;
            if (v.videoWidth) {
              const esc = 640 / Math.max(v.videoWidth, v.videoHeight);
              lienzo.width = Math.round(v.videoWidth * esc);
              lienzo.height = Math.round(v.videoHeight * esc);
              ctx.drawImage(v, 0, 0, lienzo.width, lienzo.height);
              const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
              const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (qr?.data) { navigator.vibrate?.(80); alLeerQr?.(qr.data); return; }
            }
            raf = requestAnimationFrame(ciclo);
          };
          raf = requestAnimationFrame(ciclo);
        }
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError'
          ? 'Permiso de cámara negado. Actívelo en los ajustes del navegador.'
          : 'No se pudo abrir la cámara: ' + (e as Error).message);
      }
    })();
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      flujo.current?.getTracks().forEach((t) => t.stop());
    };
  }, [frontal, modo]);

  const capturar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const lineas = sello ? sello() : [];
    setVista(dibujarConSello(v, v.videoWidth, v.videoHeight, lineas));
  };

  const usar = async () => {
    if (!vista || !alCapturar) return;
    setOcupado(true);
    try { await alCapturar(vista); } finally { setOcupado(false); }
  };

  return (
    <div className="camara">
      <div className="camara-cab">
        <strong>{titulo}</strong>
        {ayuda && <p>{ayuda}</p>}
      </div>
      {error ? <p className="error">{error}</p> : (
        <div className="visor">
          <video ref={video} playsInline muted style={{ display: vista ? 'none' : 'block' }} />
          {vista && <img src={vista.toDataURL('image/jpeg', 0.6)} alt="Vista previa" />}
          {modo === 'qr' && !vista && <div className="marco-qr" />}
        </div>
      )}
      <div className="acciones">
        {alCancelar && <button className="sec" onClick={alCancelar} disabled={ocupado}>Cancelar</button>}
        {modo === 'foto' && !error && !vista && <button onClick={capturar}>Tomar foto</button>}
        {vista && <button className="sec" onClick={() => setVista(null)} disabled={ocupado}>Repetir</button>}
        {vista && <button onClick={usar} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Usar foto'}</button>}
      </div>
    </div>
  );
}
