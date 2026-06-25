// nui/filters.test.js
// Unit tests for the pure math + feature helpers in filters.js. No DOM, no
// MediaPipe – these functions are deterministic, so they are the part of the
// front-end that is actually worth unit-testing. Run with: node --test nui/
//   (or: npm test)

import test from "node:test";
import assert from "node:assert/strict";

import { clamp, dist2, lowpass, OneEuro, handFeatures } from "./filters.js";

test("clamp keeps values inside [lo, hi]", () => {
  assert.equal(clamp(5, 0, 10), 5);   // within range, unchanged
  assert.equal(clamp(-3, 0, 10), 0);  // below low bound
  assert.equal(clamp(42, 0, 10), 10); // above high bound
  assert.equal(clamp(0, 0, 10), 0);   // on the boundary
});

test("dist2 is the Euclidean distance of a 3-4-5 triangle", () => {
  assert.equal(dist2({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(dist2({ x: 1, y: 1 }, { x: 1, y: 1 }), 0);
});

test("lowpass blends new and previous by alpha", () => {
  assert.equal(lowpass(1, 10, 0), 10);  // alpha 1 -> take the new value
  assert.equal(lowpass(0, 10, 3), 3);   // alpha 0 -> keep the previous value
  assert.equal(lowpass(0.5, 10, 0), 5); // alpha 0.5 -> the average
});

test("OneEuro returns the first sample unchanged", () => {
  const f = new OneEuro(1, 0, 1);
  assert.equal(f.filter(0.7, 0), 0.7);
});

test("OneEuro converges to a constant input", () => {
  const f = new OneEuro(1, 0.1, 1);
  let y;
  for (let i = 1; i <= 60; i++) y = f.filter(0.5, i / 60); // ~1s of steady input
  assert.ok(Math.abs(y - 0.5) < 1e-6, `expected ~0.5, got ${y}`);
});

test("OneEuro.reset clears internal state", () => {
  const f = new OneEuro(1, 0.1, 1);
  f.filter(0.2, 0);
  f.filter(0.9, 1 / 60);
  f.reset();
  // After reset the next call behaves like a first sample again.
  assert.equal(f.filter(0.33, 0), 0.33);
});

// Build a minimal 21-landmark hand where only the indices handFeatures reads
// (0, 4, 5, 6, 8, 9) carry meaningful coordinates.
function makeHand() {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  lm[0] = { x: 0.0,  y: 0.0  }; // wrist
  lm[9] = { x: 0.0,  y: 0.10 }; // index MCP  -> hand size = 0.10
  lm[5] = { x: 0.0,  y: 0.20 };
  lm[6] = { x: 0.0,  y: 0.30 };
  lm[8] = { x: 0.10, y: 0.30 }; // index tip
  lm[4] = { x: 0.10, y: 0.35 }; // thumb tip
  return lm;
}

test("handFeatures derives normalised, hand-size-invariant features", () => {
  const f = handFeatures(makeHand());
  const close = (a, b) => Math.abs(a - b) < 1e-3;

  assert.equal(f.nx, 0.10);                     // index fingertip x
  assert.equal(f.ny, 0.30);                     // index fingertip y
  assert.ok(close(f.pinch, 0.5), `pinch ${f.pinch}`);       // 0.05 / 0.10
  assert.ok(close(f.idxReach, Math.hypot(0.10, 0.30) / 0.10),
    `idxReach ${f.idxReach}`);                                // ~3.162
  assert.ok(close(f.angle, 90), `angle ${f.angle}`);         // perpendicular vectors
});

test("handFeatures never divides by zero for a degenerate hand", () => {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  const f = handFeatures(lm); // all points coincident
  for (const v of Object.values(f)) assert.ok(Number.isFinite(v));
});
