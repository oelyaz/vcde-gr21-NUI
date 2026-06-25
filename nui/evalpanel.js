// nui/evalpanel.js
// Live read-out for the evaluation harness (nui/eval.js). It turns the numbers
// that eval.js already collects into an on-page panel, so the real per-session
// measurements are visible on the Evaluation page instead of only in the
// browser console. Loaded only where the panel markup exists; a no-op otherwise.
//
// It polls window.nuiEval.snapshot() (a pure, side-effect-free read) on a slow
// timer. The harness fills up while the camera + control run from the global
// dock, so the panel simply mirrors whatever the current session has measured.
//
// window.nuiEval is published by eval.js, which the controller imports from the
// end-of-body dock include. That can load *after* this script, so we never latch
// onto it at init: every tick re-reads window.nuiEval and degrades to the empty
// state until it appears.

const POLL_MS = 600;

const panel = document.getElementById("nui-eval");
if (panel) {
  const el = id => document.getElementById(id);
  const out = {
    dur:     el("nui-eval-dur"),
    frames:  el("nui-eval-frames"),
    inf:     el("nui-eval-inf"),
    lat:     el("nui-eval-lat"),
    actions: el("nui-eval-actions"),
    commits: el("nui-eval-commits"),
  };
  const resetBtn = el("nui-eval-reset");
  const exportBtn = el("nui-eval-export");

  // "p50 / p95 ms" from a summarise() result, or "–" when there are no samples.
  const ms = s => (s && s.n) ? `${s.p50} / ${s.p95} ms` : "–";
  // A compact "name n · name n" line from a {name: count} map, or "–".
  const counts = (map) => {
    const parts = Object.entries(map || {}).filter(([, n]) => n > 0);
    return parts.length ? parts.map(([k, n]) => `${k} ${n}`).join(" · ") : "–";
  };

  function render() {
    const harness = window.nuiEval;
    if (!harness) { panel.dataset.empty = "true"; return; }
    const r = harness.snapshot();
    // Empty until the session has actually processed frames with a subject.
    const hasData = r.framesWithSubject > 0 || r.inferenceMs.n > 0;
    panel.dataset.empty = hasData ? "false" : "true";

    if (out.dur)     out.dur.textContent     = `${r.durationSec} s`;
    if (out.frames)  out.frames.textContent  = String(r.framesWithSubject);
    if (out.inf)     out.inf.textContent     = ms(r.inferenceMs);
    if (out.lat)     out.lat.textContent     = ms(r.latencyMs);
    if (out.actions) out.actions.textContent = counts(r.actions);
    if (out.commits) out.commits.textContent = counts(r.commitsPerGesture);
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (window.nuiEval) window.nuiEval.reset();
      render();
    });
  }

  // Download the current session (incl. raw latency samples) as JSON. This file
  // becomes nui/eval-data.json, which the Evaluation page renders its real numbers
  // from. The structured-trial counts are filled into that file by hand afterwards.
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      if (!window.nuiEval) return;
      const blob = new Blob([JSON.stringify(window.nuiEval.export(), null, 2)],
        { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eval-session.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  render();
  setInterval(render, POLL_MS);
}
