import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { paintRow } from '../sim/rotate';
import type { Handle } from '../sim/transport';
import './SnapCanvas.css';

const W = 240;
const H = 320;

function blackFrame(): ImageData {
  const img = new ImageData(W, H);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return img;
}

/**
 * Portrait 240×320 snap painted live from the transport: each `rx:row` for `handle` is one
 * landscape SSTV line, rotated back into portrait column `index`, so the picture fills left to
 * right. A bright scan line marks the paint front until the receive ends or is stopped.
 *
 * Only rows emitted after mount are painted; a receive resumed part-way (startAt) shows black
 * to the left of the first row that arrives.
 */
export function SnapCanvas({ handle }: { handle: Handle }) {
  const { transport } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [front, setFront] = useState(0);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const buffer = blackFrame();
    const ctx = canvasRef.current?.getContext('2d') ?? null;
    ctx?.putImageData(buffer, 0, 0);
    setFront(0);
    setEnded(false);

    // Several rows can land in one tick (a resumed receive emits its backlog at once): paint
    // every row into the buffer immediately, blit to the canvas once per frame.
    let frame = 0;
    const flush = () => {
      frame = 0;
      ctx?.putImageData(buffer, 0, 0);
    };
    const end = (h: Handle) => {
      if (h === handle) setEnded(true);
    };
    const offs = [
      transport.on('rx:row', (h, index, row) => {
        if (h !== handle) return;
        paintRow(buffer, index, row);
        setFront(index + 1);
        if (!frame) frame = requestAnimationFrame(flush);
      }),
      transport.on('rx:done', end),
      transport.on('rx:cancelled', end),
    ];
    return () => {
      offs.forEach((off) => off());
      if (frame) cancelAnimationFrame(frame);
    };
  }, [transport, handle]);

  return (
    <div className="snap-canvas">
      <canvas ref={canvasRef} className="snap-canvas__img" width={W} height={H} aria-label="Snap" role="img" />
      {!ended && <div className="snap-canvas__scan" style={{ left: `${(front / W) * 100}%` }} />}
    </div>
  );
}
