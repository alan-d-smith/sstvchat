import type { CameraState, ViewfinderState } from '../media/camera';
import { getFilter } from '../media/filters';
import type { SnapFilter } from '../media/filters';
import './Viewfinder.css';

export interface ViewfinderProps {
  cam: Pick<CameraState, 'videoRef' | 'mirrored'>;
  view: Pick<ViewfinderState, 'canvasRef' | 'shows'>;
  filter: SnapFilter;
  className?: string;
}

/**
 * The camera picture: fills its (3:4) parent with the filtered 240×320 canvas from
 * `useViewfinder` — the exact snap the shutter takes. The <video> stays mounted underneath as the
 * frame source; it only shows (with the filter's CSS equivalent) when there is no 2D canvas.
 */
export function Viewfinder({ cam, view, filter, className = '' }: ViewfinderProps) {
  const def = getFilter(filter);
  const video = view.shows === 'video';
  return (
    <div className={`viewfinder ${className}`} aria-hidden="true">
      <video
        ref={cam.videoRef}
        className={`viewfinder__video${video ? ' is-shown' : ''}${cam.mirrored ? ' is-mirrored' : ''}`}
        style={video ? { filter: def.css ?? 'none' } : undefined}
        autoPlay
        muted
        playsInline
      />
      <canvas
        ref={view.canvasRef}
        className={`viewfinder__canvas${view.shows === 'canvas' ? ' is-shown' : ''}${def.crisp ? ' is-crisp' : ''}`}
        width={240}
        height={320}
        data-filter={filter}
      />
    </div>
  );
}
