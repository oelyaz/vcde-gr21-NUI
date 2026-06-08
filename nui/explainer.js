// nui/explainer.js
// The two small explainer widgets:
//   • Landmark-Explorer, a canvas that draws the same blue hand skeleton as the
//     live overlay, from live camera, a frozen frame, or a built-in static
//     sample. It still says something useful with no camera.
//   • Gesture-Playground, lights the matching gesture chip and shows the live
//     pinch meter.
//
// `createExplainer()` grabs its own DOM, owns its small state, wires the freeze
// button, renders the static sample once, and returns { feed, updatePlayground }
// for the controller to call per frame.
import { CURSOR, GESTURE_CONF_MIN, HAND_EDGES, OV, PINCH_VIS } from "./config.js";
import { clamp, handFeatures } from "./filters.js";

// A relaxed right hand in normalised [0,1] coords. This is the no-camera fallback, so
// both modules are meaningful before (or without) a webcam.
const SAMPLE_HAND = Object.freeze([
  { x: 0.50, y: 0.92 }, // 0  wrist
  { x: 0.38, y: 0.82 }, // 1  thumb cmc
  { x: 0.30, y: 0.72 }, // 2  thumb mcp
  { x: 0.26, y: 0.63 }, // 3  thumb ip
  { x: 0.24, y: 0.55 }, // 4  thumb tip
  { x: 0.44, y: 0.55 }, // 5  index mcp
  { x: 0.43, y: 0.42 }, // 6  index pip
  { x: 0.42, y: 0.33 }, // 7  index dip
  { x: 0.42, y: 0.25 }, // 8  index tip
  { x: 0.52, y: 0.54 }, // 9  middle mcp
  { x: 0.53, y: 0.40 }, // 10 middle pip
  { x: 0.53, y: 0.30 }, // 11 middle dip
  { x: 0.53, y: 0.22 }, // 12 middle tip
  { x: 0.60, y: 0.56 }, // 13 ring mcp
  { x: 0.62, y: 0.43 }, // 14 ring pip
  { x: 0.63, y: 0.34 }, // 15 ring dip
  { x: 0.63, y: 0.27 }, // 16 ring tip
  { x: 0.67, y: 0.60 }, // 17 pinky mcp
  { x: 0.70, y: 0.50 }, // 18 pinky pip
  { x: 0.71, y: 0.43 }, // 19 pinky dip
  { x: 0.72, y: 0.37 }, // 20 pinky tip
]);
const sampleFeatures = () => handFeatures(SAMPLE_HAND);

export function createExplainer() {
  const exCanvas    = document.getElementById("nui-explorer-canvas");
  const exCtx       = exCanvas ? exCanvas.getContext("2d") : null;
  const exFreezeBtn = document.getElementById("nui-explorer-freeze");
  const exSrcEl     = document.getElementById("nui-explorer-src");
  const exPinchEl   = document.getElementById("nui-ex-pinch");
  const exAngleEl   = document.getElementById("nui-ex-angle");
  const pgChips     = document.getElementById("nui-pg-chips");
  const pgPinchBar  = document.getElementById("nui-pg-pinch-bar");
  const pgPinchVal  = document.getElementById("nui-pg-pinch-val");
  const pgHintEl    = document.getElementById("nui-pg-hint");

  let explorerFrozen = false;          // Landmark-Explorer freeze toggle
  let explorerLm     = null;           // last hand landmarks shown in the explorer
  let explorerLive   = false;          // is the explorer showing live camera data?

  // Decide what the explorer shows this frame and (re)draw it.
  function feed(lm, feat) {
    if (explorerFrozen) return;                 // hold the frozen frame
    if (lm) {
      explorerLm = lm; explorerLive = true;
      drawExplorer(lm, feat || handFeatures(lm));
    } else {
      explorerLive = false;
      drawExplorer(SAMPLE_HAND, sampleFeatures());
    }
  }

  // Small monospace label with a neutral plate, for the annotated landmarks.
  function exLabel(text, x, y) {
    if (!exCtx) return;
    exCtx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const w = exCtx.measureText(text).width;
    exCtx.fillStyle = "rgba(255,255,255,0.92)";
    exCtx.fillRect(x + 8, y - 9, w + 8, 16);
    exCtx.fillStyle = "#1d1d1f";
    exCtx.fillText(text, x + 12, y + 3);
  }

  // Draw the hand skeleton into the explorer canvas (mirrored, like the camera).
  function drawExplorer(lm, feat) {
    if (!exCtx || !exCanvas) return;
    const W = exCanvas.width, H = exCanvas.height, pad = 24;
    exCtx.clearRect(0, 0, W, H);
    const X = (x) => pad + (1 - x) * (W - 2 * pad);   // mirror X
    const Y = (y) => pad + y * (H - 2 * pad);

    // Bones: same crisp blue motif as the live overlay.
    exCtx.lineWidth = OV.BONE_W; exCtx.lineCap = "round";
    exCtx.strokeStyle = OV.BONE; exCtx.shadowColor = OV.CONTRAST; exCtx.shadowBlur = OV.CONTRAST_BLUR;
    for (const [a, b] of HAND_EDGES) {
      exCtx.beginPath();
      exCtx.moveTo(X(lm[a].x), Y(lm[a].y));
      exCtx.lineTo(X(lm[b].x), Y(lm[b].y));
      exCtx.stroke();
    }
    // The pinch measurement itself: dashed line from thumb tip 4 to index tip 8.
    exCtx.setLineDash([5, 5]); exCtx.strokeStyle = OV.GUIDE; exCtx.shadowBlur = 0;
    exCtx.beginPath();
    exCtx.moveTo(X(lm[4].x), Y(lm[4].y));
    exCtx.lineTo(X(lm[8].x), Y(lm[8].y));
    exCtx.stroke();
    exCtx.setLineDash([]);
    // Nodes.
    exCtx.fillStyle = OV.NODE; exCtx.shadowColor = OV.CONTRAST; exCtx.shadowBlur = OV.CONTRAST_BLUR;
    for (const p of lm) { exCtx.beginPath(); exCtx.arc(X(p.x), Y(p.y), OV.DOT_R, 0, Math.PI * 2); exCtx.fill(); }
    exCtx.shadowBlur = 0;
    // Annotate the three landmarks the cursor/pinch model relies on.
    exLabel("0 · wrist", X(lm[0].x), Y(lm[0].y));
    exLabel("4 · thumb", X(lm[4].x), Y(lm[4].y));
    exLabel("8 · index", X(lm[8].x), Y(lm[8].y));

    if (exPinchEl) exPinchEl.textContent = feat ? feat.pinch.toFixed(2) : "-";
    if (exAngleEl) exAngleEl.textContent = feat ? `${Math.round(feat.angle)}\u00b0` : "-";
    if (exSrcEl)   exSrcEl.textContent   = explorerFrozen ? "Frozen" : (explorerLive ? "Live" : "Sample");
  }

  // Freeze / unfreeze the explorer on the current frame.
  function toggleFreeze() {
    explorerFrozen = !explorerFrozen;
    if (exFreezeBtn) {
      exFreezeBtn.dataset.state = explorerFrozen ? "on" : "off";
      exFreezeBtn.setAttribute("aria-pressed", explorerFrozen ? "true" : "false");
      exFreezeBtn.textContent = explorerFrozen ? "Frozen" : "Freeze";
    }
    if (explorerFrozen) {
      const lm = explorerLm || SAMPLE_HAND;
      drawExplorer(lm, handFeatures(lm));
    } else if (!explorerLive) {
      drawExplorer(SAMPLE_HAND, sampleFeatures());   // back to the sample when no camera
    }
  }

  // Gesture-Playground: light the matching chip + drive the pinch meter.
  function updatePlayground(rawName, rawScore, feat) {
    if (pgChips) {
      const active = (rawName && rawName !== "None" && rawScore >= GESTURE_CONF_MIN) ? rawName : null;
      for (const li of pgChips.children) li.classList.toggle("is-active", li.dataset.g === active);
    }
    // Map the normalised pinch distance onto the openness bar. The
    // real click threshold CURSOR.PINCH_ON lies inside this range, so the bar's
    // lower region is the "closed to click" zone the hint describes below.
    const openness = feat
      ? clamp((feat.pinch - PINCH_VIS.CLOSED) / (PINCH_VIS.OPEN - PINCH_VIS.CLOSED), 0, 1)
      : 0;
    if (pgPinchBar) pgPinchBar.style.width = `${Math.round(openness * 100)}%`;
    if (pgPinchVal) pgPinchVal.textContent = feat ? feat.pinch.toFixed(2) : "-";
    if (pgHintEl) {
      pgHintEl.textContent = feat
        ? (feat.pinch < CURSOR.PINCH_ON ? "pinch closed \u2192 click" : "open hand \u2192 move cursor")
        : "Zeig der Kamera eine Hand oder erkunde das Beispiel.";
    }
  }

  // Wire the freeze button + render the static sample immediately (no camera).
  if (exFreezeBtn) exFreezeBtn.addEventListener("click", toggleFreeze);
  feed(null, null);
  updatePlayground("None", 0, null);

  return { feed, updatePlayground };
}
