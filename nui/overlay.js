// nui/overlay.js
// One shared skeleton renderer for hand and pose. Consistent visual
// language: confident = crisp Apple-blue, uncertain = red; joints as dots,
// bones as lines, drawn over the CSS-mirrored (scaleX(-1)) video feed. Hand and
// pose only differ in which landmarks/edges they feed in, the drawing logic is
// identical for both.
//
// `createOverlay(overlayEl)` captures the canvas + its 2D context and returns a
// small renderer { clear, drawPose, drawHand }. It holds no app state; the pose
// baseline-guide Y values are passed in per call.
import { HAND_EDGES, OV, POSE, POSE_EDGES, POSE_NODES } from "./config.js";

export function createOverlay(overlayEl) {
  const overlay = overlayEl;
  const octx    = overlay ? overlay.getContext("2d") : null;

  function fit() {
    if (!overlay) return false;
    const w = overlay.clientWidth, h = overlay.clientHeight;
    if (!w || !h) return false;
    if (overlay.width !== w)  overlay.width = w;
    if (overlay.height !== h) overlay.height = h;
    return true;
  }

  function clear() {
    if (octx && overlay) octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  // Start a frame: size + clear the canvas, return mirrored normalized-to-pixel
  // mappers (X mirrors to match the CSS-mirrored video), or null if not drawable.
  function begin() {
    if (!octx || !fit()) return null;
    const W = overlay.width, H = overlay.height;
    octx.clearRect(0, 0, W, H);
    return { W, H, X: nx => (1 - nx) * W, Y: ny => ny * H };
  }

  // The shared primitive used by both modes: stroke `edges`, then dot the nodes.
  // `ok(i)` decides blue (confident) vs red (uncertain); the light contrast edge
  // is applied only when both endpoints are confident. `nodes` optionally restricts
  // which points are dotted (pose uses a curated subset; hand dots all 21).
  function drawSkeleton(view, pts, edges, ok, nodes) {
    const { X, Y } = view;
    octx.lineCap     = "round";
    octx.lineWidth   = OV.BONE_W;
    octx.shadowColor = OV.CONTRAST;
    for (const [a, b] of edges) {
      const pa = pts[a], pb = pts[b];
      if (!pa || !pb) continue;
      const good = ok(a) && ok(b);
      octx.strokeStyle = good ? OV.BONE : OV.BONE_WEAK;
      octx.shadowBlur  = good ? OV.CONTRAST_BLUR : 0;
      octx.beginPath(); octx.moveTo(X(pa.x), Y(pa.y)); octx.lineTo(X(pb.x), Y(pb.y)); octx.stroke();
    }
    const list = nodes || pts.map((_, i) => i);
    for (const i of list) {
      const p = pts[i];
      if (!p) continue;
      const good = ok(i);
      octx.fillStyle  = good ? OV.NODE : OV.NODE_WEAK;
      octx.shadowBlur = good ? OV.CONTRAST_BLUR : 0;
      octx.beginPath(); octx.arc(X(p.x), Y(p.y), OV.DOT_R, 0, Math.PI * 2); octx.fill();
    }
    octx.shadowBlur = 0;   // reset so the contrast edge never bleeds into later draws
  }

  // Pose overlay = neutral-baseline guide + the full-body BlazePose skeleton,
  // drawn straight from the raw 33 landmarks (per-point visibility picks blue/red).
  function drawPose(lmArr, baseShoulderY, baseHipY) {
    const view = begin();
    if (!view) return;
    if (baseShoulderY != null && baseHipY != null) {
      const by = view.Y((baseShoulderY + baseHipY) / 2);
      octx.shadowBlur = 0;
      octx.strokeStyle = OV.GUIDE; octx.lineWidth = 1.5; octx.setLineDash([6, 5]);
      octx.beginPath(); octx.moveTo(0, by); octx.lineTo(view.W, by); octx.stroke();
      octx.setLineDash([]);
    }
    if (!lmArr) return;
    const ok = i => {
      const p = lmArr[i];
      return !!p && (p.visibility == null || p.visibility >= POSE.VIS_MIN);
    };
    drawSkeleton(view, lmArr, POSE_EDGES, ok, POSE_NODES);
  }

  // Hand overlay = the full 21-point hand skeleton (blue when confident).
  function drawHand(lm, confident) {
    const view = begin();
    if (!view || !lm) return;
    drawSkeleton(view, lm, HAND_EDGES, () => confident);
  }

  return { clear, drawPose, drawHand };
}
