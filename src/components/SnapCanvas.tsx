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

const FINISHED = / · (received|stopped)$/;

/**
 * Portrait 240×320 snap painted live from the transport: each `rx:row` for `handle` is one
 * landscape SSTV line, rotated back into portrait column `index`, so the picture fills left to
 * right. A bright scan line marks the paint front until the receive ends or is stopped.
 *
 * It starts from the store's buffer for the handle, so a snap opened mid-receive shows the rows
 * that already arrived, and a saved snap shows at once.
 */
export function SnapCanvas({ handle }: { handle: Handle }) {
  const { transport, snapBuffer, rxLabel } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [front, setFront] = useState(0);
  const [ended, setEnded] = useState(false);
  const finished = FINISHED.test(rxLabel[handle] ?? '');

  useEffect(() => {
    const shared = snapBuffer(handle);
    const buffer = shared ? new ImageData(new Uint8ClampedArray(shared.data), W, H) : blackFrame();
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
  }, [transport, handle, snapBuffer]);

  return (
    <div className="snap-canvas">
      <canvas ref={canvasRef} className="snap-canvas__img" width={W} height={H} aria-label="Snap" role="img" />
      {!ended && !finished && <div className="snap-canvas__scan" style={{ left: `${(front / W) * 100}%` }} />}
    </div>
  );
}
