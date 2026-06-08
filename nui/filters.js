// nui/filters.js
// Pure math + feature helpers shared across the controller, cursor, explorer
// and playground. No DOM, no runtime state, just functions.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// One pole of a low-pass filter.
export function lowpass(alpha, x, prev) { return alpha * x + (1 - alpha) * prev; }

// Compact 1-Euro filter: an adaptive low-pass whose cutoff rises with speed.
// strong smoothing when the hand is still, low lag when it moves fast.
export class OneEuro {
  constructor(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this.xPrev = null; this.dxPrev = 0; this.tPrev = null; }
  _alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, tSec) {
    if (this.tPrev == null) { this.tPrev = tSec; this.xPrev = x; return x; }
    let dt = tSec - this.tPrev; if (!(dt > 0)) dt = 1 / 60;
    this.tPrev = tSec;
    const dx    = (x - this.xPrev) / dt;
    const dxHat = lowpass(this._alpha(this.dCutoff, dt), dx, this.dxPrev);
    this.dxPrev = dxHat;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const xHat   = lowpass(this._alpha(cutoff, dt), x, this.xPrev);
    this.xPrev   = xHat;
    return xHat;
  }
}

// Hand features shared by every continuous consumer (cursor, explorer,
// playground). All distances are normalised by hand size (wrist 0 ↔ index MCP 9)
// so they are invariant to how close the hand is to the camera.
//   nx, ny  - index fingertip (landmark 8) position, normalised [0,1]
//   pinch   - thumb tip 4 to index tip 8 distance, divided by hand size
//   angle   - index-finger bend at the PIP joint (landmark 6), in degrees
//   idxReach - index tip 8 to wrist 0 distance, divided by hand size: large when the index
//             is extended ("pointing"), small when the hand is curled (fist), the
//             posture gate for the cursor + pinch.
export function handFeatures(lm) {
  const handSize = dist2(lm[0], lm[9]) || 1e-3;
  const pinch    = dist2(lm[4], lm[8]) / handSize;     // thumb tip to index tip
  const idxReach = dist2(lm[8], lm[0]) / handSize;     // index tip to wrist
  const ax = lm[5].x - lm[6].x, ay = lm[5].y - lm[6].y;
  const bx = lm[8].x - lm[6].x, by = lm[8].y - lm[6].y;
  const dot = ax * bx + ay * by;
  const mag = (Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1e-3;
  const angle = Math.acos(clamp(dot / mag, -1, 1)) * 180 / Math.PI;
  return { nx: lm[8].x, ny: lm[8].y, pinch, angle, idxReach };
}
