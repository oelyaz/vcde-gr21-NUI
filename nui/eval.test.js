// nui/eval.test.js
// Unit tests for the evaluation harness in eval.js. The module keeps a single
// shared measurement window, so every test resets it first. We exercise the
// public hooks the controller calls and read the result back via snapshot()
// (the same pure read the live panel uses). Run with: node --test nui/

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  evalFrameStart, evalInference, evalSawSubject, evalAction, evalCommit,
  evalSnapshot, evalReset,
} from "./eval.js";

beforeEach(() => evalReset());

test("a fresh window is empty", () => {
  const r = evalSnapshot();
  assert.equal(r.framesWithSubject, 0);
  assert.equal(r.inferenceMs.n, 0);
  assert.equal(r.latencyMs.n, 0);
  assert.deepEqual(r.actions, {});
  assert.deepEqual(r.commitsPerGesture, {});
});

test("summarise reports count, percentiles and bounds", () => {
  for (const ms of [10, 20, 30, 40, 50]) evalInference(ms);
  const s = evalSnapshot().inferenceMs;
  assert.equal(s.n, 5);
  assert.equal(s.min, 10);
  assert.equal(s.max, 50);
  assert.equal(s.mean, 30);
  assert.equal(s.p50, 30);
  assert.equal(s.p95, 50);
});

test("evalInference drops absurd outliers (>= 1000ms or negative)", () => {
  evalInference(42);
  evalInference(-5);    // dropped
  evalInference(1500);  // dropped
  assert.equal(evalSnapshot().inferenceMs.n, 1);
});

test("evalSawSubject counts only frames with a subject", () => {
  evalSawSubject(true);
  evalSawSubject(false);
  evalSawSubject(true);
  assert.equal(evalSnapshot().framesWithSubject, 2);
});

test("evalAction tallies actions and samples frame-to-action latency", () => {
  evalFrameStart(performance.now()); // sets the frame timestamp first
  evalAction("jump");
  evalAction("jump");
  evalAction("duck");
  const r = evalSnapshot();
  assert.deepEqual(r.actions, { jump: 2, duck: 1 });
  assert.equal(r.latencyMs.n, 3); // one latency sample per dispatched action
});

test("evalCommit counts gestures but ignores None / empty", () => {
  evalCommit("Open_Palm");
  evalCommit("Open_Palm");
  evalCommit("Closed_Fist");
  evalCommit("None"); // ignored
  evalCommit("");      // ignored
  evalCommit(null);    // ignored
  assert.deepEqual(evalSnapshot().commitsPerGesture, { Open_Palm: 2, Closed_Fist: 1 });
});

test("evalReset clears every counter", () => {
  evalFrameStart(performance.now());
  evalInference(30);
  evalSawSubject(true);
  evalAction("jump");
  evalCommit("Victory");
  evalReset();
  const r = evalSnapshot();
  assert.equal(r.inferenceMs.n, 0);
  assert.equal(r.latencyMs.n, 0);
  assert.equal(r.framesWithSubject, 0);
  assert.deepEqual(r.actions, {});
  assert.deepEqual(r.commitsPerGesture, {});
});
