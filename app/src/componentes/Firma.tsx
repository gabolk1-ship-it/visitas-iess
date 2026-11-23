import { useEffect, useRef, useState } from 'react';

/** Recuadro para firmar con el dedo. Devuelve el trazo como lienzo PNG. */
export default function Firma({ alListo, texto }: { alListo: (c: HTMLCanvasElement | null) => void; texto: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hayTrazo, setHayTrazo] = useState(false);
  const cb = useRef(alListo);
  cb.current = alListo;

  useEffect(() => {
    const c = ref.current!;
    const escala = window.devicePixelRatio || 1;
    c.width = c.clientWidth * escala;
    c.height = c.clientHeight * escala;
    const ctx = c.getContext('2d')!;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    let dibujando = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const abajo = (e: PointerEvent) => { dibujando = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const mover = (e: PointerEvent) => { if (!dibujando) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setHayTrazo(true); };
    const arriba = () => { dibujando = false; };
    c.addEventListener('pointerdown', abajo);
    c.addEventListener('pointermove', mover);
    c.addEventListener('pointerup', arriba);
    c.addEventListener('pointercancel', arriba);
    return () => {
      c.removeEventListener('pointerdown', abajo);
      c.removeEventListener('pointermove', mover);
      c.removeEventListener('pointerup', arriba);
      c.removeEventListener('pointercancel', arriba);
    };
  }, []);

  useEffect(() => { cb.current(hayTrazo ? ref.current : null); }, [hayTrazo]);

  const limpiar = () => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
    setHayTrazo(false);
  };

  return (
    <div className="firma">
      <p className="nota">{texto}</p>
      <canvas ref={ref} />
      <button className="sec peq" onClick={limpiar}>Borrar firma</button>
    </div>
  );
}
