import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { useApp } from '../state/store';
import './screens.css';

/**
 * Full-screen preview of the snap just taken: the 240×320 capture fitted to the screen width and
 * centred on black. Close (top-left) drops back to the camera; "Send To" opens the recipient
 * picker, keeping the recipient the camera was opened for.
 */
export function PreviewScreen() {
  const { capture, overlay, setOverlay } = useApp();
  const to = overlay?.type === 'preview' ? overlay.to : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !capture) return;
    canvas.width = capture.width;
    canvas.height = capture.height;
    canvas.getContext('2d')?.putImageData(capture, 0, 0);
  }, [capture]);

  return (
    <div className="preview" data-testid="preview">
      <div className="preview__stage">
        <canvas ref={canvasRef} className="preview__snap" width={240} height={320} role="img" aria-label="Snap preview" />
      </div>
      <button type="button" className="preview__close" aria-label="Close" onClick={() => setOverlay(null)}>
        <Icon name="close" size={28} />
      </button>
      <button type="button" className="preview__send" onClick={() => setOverlay({ type: 'sendto', to })}>
        Send To
        <Icon name="arrow" filled size={20} />
      </button>
    </div>
  );
}
