// nui/eval.js
// Tiny, self-contained evaluation harness for the NUI controller. It records a
// few honest runtime metrics, enough to back up the evaluation with real numbers:
//   • per-frame processing latency  (camera frame grab to game action dispatch)
//   • how often each gesture is committed (recognition activity per class)
//   • how many game actions fire, split by type (jump / duck / restart)
//   • how many frames actually contained a hand / body (subject present)
//
// Deliberately minimal: no UI, no storage, no dependencies. The controller calls
// a handful of one-line hooks; everything else is read back from the browser
// console after a session:
//
//     window.nuiEval.report()   // prints a summary + returns it as an object
//     window.nuiEval.reset()    // start a fresh measurement window
//
// Scope note, no false precision: a passive harness can time the pipeline and
// count events, but it cannot know what the user meant. True recognition and
// false-trigger rates need a small structured trial (do a gesture a few times,
// then hold still for a fixed window) using these same counters.

const latencyMs = [];                  // per-frame processing latency samples
const commits   = Object.create(null); // committed gesture name → count
const actions   = Object.create(null); // game action (jump/duck/restart) → count
let framesWithSubject = 0;             // frames where a hand/body was present
let frameTs   = 0;                     // grab time of the frame being processed
let startedAt = 0;                     // first frame timestamp (session start)

// Called once per fresh camera frame, with the frame's grab timestamp
// (performance.now() taken just before inference in the recognition loop).
export function evalFrameStart(ts) {
  if (!startedAt) startedAt = ts;
  frameTs = ts;
}

// Whether this frame contained a subject (a hand for the gesture path, a body
// for the pose path).
export function evalSawSubject(present) {
  if (present) framesWithSubject++;
}

// A game action was dispatched this frame; sample the frame-to-action latency.
export function evalAction(name) {
  actions[name] = (actions[name] || 0) + 1;
  if (frameTs) {
    const dt = performance.now() - frameTs;
    if (dt >= 0 && dt < 1000) latencyMs.push(dt); // drop absurd outliers
  }
}

// A debounced gesture became the stable gesture (one recognition event).
export function evalCommit(name) {
  if (name && name !== "None") commits[name] = (commits[name] || 0) + 1;
}

function summarise(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const at = p => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const round = x => Math.round(x * 10) / 10;
  return {
    n: s.length, mean: round(mean), p50: round(at(0.5)),
    p95: round(at(0.95)), min: round(s[0]), max: round(s[s.length - 1]),
  };
}

// Print a copy-pasteable summary and return it. Run this in the console after a
// short session to feed real numbers into the evaluation chart.
export function evalReport() {
  const durationSec = startedAt ? Math.round((performance.now() - startedAt) / 100) / 10 : 0;
  const report = {
    durationSec,
    framesWithSubject,
    latencyMs: summarise(latencyMs),
    actions: { ...actions },
    commitsPerGesture: { ...commits },
  };
  if (typeof console !== "undefined") {
    console.group("%cNUI eval report", "color:#0071e3;font-weight:bold");
    console.log(`Dauer ${durationSec}s · Frames mit Subjekt ${framesWithSubject}`);
    if (report.latencyMs.n) console.table({ "Latenz Frame-Aktion (ms)": report.latencyMs });
    console.table(report.commitsPerGesture);
    console.table(report.actions);
    console.groupEnd();
  }
  return report;
}

// Clear all counters to start a fresh measurement window.
export function evalReset() {
  latencyMs.length = 0;
  framesWithSubject = 0;
  frameTs = 0;
  startedAt = 0;
  for (const k in commits) delete commits[k];
  for (const k in actions) delete actions[k];
}

// Expose a console workflow so a session can be measured with zero extra UI.
if (typeof window !== "undefined") {
  window.nuiEval = { report: evalReport, reset: evalReset };
}
