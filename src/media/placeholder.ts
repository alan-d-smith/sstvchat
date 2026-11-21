/** Portrait snap size (3:4). Transmitted rotated 90° CW as a 320×240 Robot36 frame. */
const W = 240;
const H = 320;

interface Palette {
  sky: [string, string];
  sun: string;
  /** far → near */
  hills: [string, string, string];
  cloud: string;
  mast: string;
}

const PALETTES: Palette[] = [
  // sunset
  { sky: ['#FF8A7A', '#FFD9A0'], sun: '#FFF3C4', hills: ['#C77AA6', '#8A4F8E', '#4E3570'], cloud: '#FFE9E0', mast: '#2B1E40' },
  // clear day
  { sky: ['#5BBBF5', '#D6F2FF'], sun: '#FFE066', hills: ['#93D58C', '#4EAE6A', '#2C7A58'], cloud: '#FFFFFF', mast: '#1F3D35' },
  // dusk
  { sky: ['#272A68', '#D0729E'], sun: '#FFD3A3', hills: ['#5E4C8E', '#3B3168', '#201B40'], cloud: '#F3B9CF', mast: '#120F26' },
  // mint morning
  { sky: ['#9EE3CB', '#FDFFB8'], sun: '#FFB06B', hills: ['#6CC5A3', '#3A9A88', '#22666A'], cloud: '#FFFFFF', mast: '#173F42' },
];

/** mulberry32: small deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hillY(x: number, base: number, amp: number, freq: number, phase: number) {
  return base + amp * Math.sin(x * freq + phase) + amp * 0.35 * Math.sin(x * freq * 2.3 + phase * 1.7);
}

/**
 * Draws an original illustrated landscape (sky gradient, sun, clouds, three hill layers and a
 * little radio mast sending signal arcs) into a 240×320 canvas and returns its pixels.
 * The seed picks the palette and the shapes; omit it for a random scene. Browser-only:
 * needs a 2D canvas (jsdom has none, so tests should mock this module).
 */
export function makePlaceholderSnap(seed: number = Math.floor(Math.random() * 1e9)): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('makePlaceholderSnap needs a 2D canvas');

  const r = rng(seed);
  const pal = PALETTES[Math.abs(Math.trunc(seed)) % PALETTES.length];

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
  sky.addColorStop(0, pal.sky[0]);
  sky.addColorStop(1, pal.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Sun with a soft halo.
  const sunX = 50 + r() * 140;
  const sunY = 90 + r() * 50;
  const halo = ctx.createRadialGradient(sunX, sunY, 18, sunX, sunY, 70);
  halo.addColorStop(0, `${pal.sun}AA`);
  halo.addColorStop(1, `${pal.sun}00`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = pal.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
  ctx.fill();

  // Clouds: clusters of round puffs on a flat base.
  ctx.fillStyle = pal.cloud;
  for (let c = 0; c < 3; c++) {
    const cx = r() * W;
    const cy = 30 + r() * 90;
    const s = 0.7 + r() * 0.6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx - 14 * s, cy + 2 * s, 10 * s, 0, Math.PI * 2);
    ctx.arc(cx, cy - 4 * s, 14 * s, 0, Math.PI * 2);
    ctx.arc(cx + 15 * s, cy + 2 * s, 10 * s, 0, Math.PI * 2);
    ctx.rect(cx - 14 * s, cy + 2 * s, 29 * s, 10 * s);
    ctx.fill('nonzero');
  }
  ctx.globalAlpha = 1;

  // Hills, far to near.
  const layers = [
    { base: 200, amp: 14, color: pal.hills[0] },
    { base: 232, amp: 12, color: pal.hills[1] },
    { base: 268, amp: 10, color: pal.hills[2] },
  ].map((l) => ({ ...l, freq: 0.018 + r() * 0.02, phase: r() * Math.PI * 2 }));
  for (const l of layers) {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, hillY(x, l.base, l.amp, l.freq, l.phase));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  // Radio mast on the middle hill, with signal arcs.
  const mid = layers[1];
  const mx = 40 + r() * 160;
  const foot = hillY(mx, mid.base, mid.amp, mid.freq, mid.phase) + 4;
  const top = foot - 74;
  ctx.strokeStyle = pal.mast;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(mx - 11, foot);
  ctx.lineTo(mx, top);
  ctx.lineTo(mx + 11, foot);
  for (let i = 1; i <= 4; i++) {
    const y = foot - (i * (foot - top)) / 5;
    const half = 11 * (1 - i / 5);
    ctx.moveTo(mx - half, y);
    ctx.lineTo(mx + half, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#FF4D5E';
  ctx.beginPath();
  ctx.arc(mx, top - 3, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  for (let i = 1; i <= 3; i++) {
    ctx.globalAlpha = 1 - i * 0.22;
    ctx.beginPath();
    ctx.arc(mx, top - 3, 8 + i * 8, -Math.PI * 0.85, -Math.PI * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, top - 3, 8 + i * 8, -Math.PI * 0.45, -Math.PI * 0.15);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // A winding path down the near hill.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  const px = 60 + r() * 120;
  ctx.moveTo(px, hillY(px, layers[2].base, layers[2].amp, layers[2].freq, layers[2].phase) + 6);
  ctx.bezierCurveTo(px + 40, 290, px - 50, 300, px - 10, H + 10);
  ctx.stroke();

  return ctx.getImageData(0, 0, W, H);
}
