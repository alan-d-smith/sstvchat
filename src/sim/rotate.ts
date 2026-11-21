// Snaps are portrait 240x320; Robot36 transmits 320x240 landscape rotated 90 deg CW.
// Landscape pixel (x, y) = portrait pixel (px = y, py = 319 - x), so landscape row i = portrait column i.

const PW = 240;
const PH = 320;

export function rotateCW(p: ImageData): ImageData {
  const out = new ImageData(PH, PW);
  for (let y = 0; y < PW; y++) {
    for (let x = 0; x < PH; x++) {
      const s = ((PH - 1 - x) * PW + y) * 4;
      const d = (y * PH + x) * 4;
      out.data[d] = p.data[s];
      out.data[d + 1] = p.data[s + 1];
      out.data[d + 2] = p.data[s + 2];
      out.data[d + 3] = p.data[s + 3];
    }
  }
  return out;
}

/** Inverse of rotateCW for one landscape row: writes row `index` (320 px RGBA) into portrait column `index`. */
export function paintRow(target: ImageData, index: number, row: Uint8ClampedArray): void {
  for (let x = 0; x < PH; x++) {
    const d = ((PH - 1 - x) * PW + index) * 4;
    const s = x * 4;
    target.data[d] = row[s];
    target.data[d + 1] = row[s + 1];
    target.data[d + 2] = row[s + 2];
    target.data[d + 3] = row[s + 3];
  }
}
