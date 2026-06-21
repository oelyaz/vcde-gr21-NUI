// nui/controller.js
// NUI controller for the gesture-driven T-Rex demo: camera + MediaPipe
// recognition (hand gestures / body pose), a state machine + HUD, the
// whole-page hand cursor, and the sticky control dock. Constants, pure helpers,
// the overlay renderer and the explainer modules live in sibling modules
// (config / filters / overlay / explainer .js).
//
// A few practical rules:
//   • Drive the game through Runner.instance_.onKeyDown / onKeyUp, not synthetic
//     KeyboardEvents. The vendored runner reads e.keyCode, and Firefox shadows
//     defineProperty overrides on KeyboardEvent instances.
//   • Request getUserMedia() before the long model-loading await chain. Otherwise
//     Firefox may reject it because the click's user-activation has gone stale.
//   • Mouse and keyboard stay as the fallback. This module only adds gesture and
//     pose controls on top.

import {
    CAM_H,
    CAM_W,
    CURSOR,
    GESTURE_CONF_MIN,
    GESTURE_MAP,
    GESTURE_MODEL_URL,
    GESTURE_STABLE_FRAMES,
    HAND_CONF_MIN,
    JUMP_COOLDOWN_MS,
    KEY,
    LM,
    MP_VERSION,
    POSE,
    POSE_MODEL_URL,
    PREFERRED_DELEGATE,
    State, STATE_INFO,
} from "./config.js";
import { evalAction, evalCommit, evalFrameStart, evalSawSubject } from "./eval.js";
import { createExplainer } from "./explainer.js";
import { clamp, handFeatures, OneEuro } from "./filters.js";
import { createOverlay } from "./overlay.js";

// DOM
const video     = document.getElementById("nui-video");
const startBtn  = document.getElementById("nui-start");
const gestureEl = document.getElementById("nui-gesture");
const statusEl  = document.getElementById("nui-status");
const stateEl   = document.getElementById("nui-state");
const modeBtns  = document.querySelectorAll(".nui-mode-btn");
const ov        = createOverlay(document.getElementById("nui-overlay"));
// Hand-navigation DOM, the global toggle, the focus ring and the
// floating nav legend/menu overlay (all live in the demo section).
const navToggleBtn = document.getElementById("nui-nav-toggle");
const navOverlayEl = document.getElementById("nui-nav-overlay");
// Sticky global dock: collapse/expand toggle + a status dot that
// mirrors setState, so the whole-page controls float in view from anywhere.
const dockEl        = document.getElementById("nui-dock");
const dockToggleBtn = document.getElementById("nui-dock-toggle");
// The vendored T-Rex host. Used to scope the "swallow Space/↑/↓ scrolling" fix
// to when the game is actually on screen (see the keydown handler below).
const trexHostEl    = document.querySelector(".trex-host");

// cursor + explainer wiring
// The whole-page cursor follows the index fingertip (landmark 8); a pinch is
// the unified click / drag-scroll action. Cursor tuning + the 1-Euro filter
// live in config.js / filters.js. The explainer modules own their DOM + state.
const cursorEl  = document.getElementById("nui-cursor");
const explainer = createExplainer();

// runtime state
let GestureRecognizer, PoseLandmarker, FilesetResolver;
let visionResolver = null;            // shared FilesetResolver (wasm)
let recognizer     = null;            // hand GestureRecognizer (lazy)
let poseLandmarker = null;            // PoseLandmarker (lazy)

let state         = State.BOOT;
let libReady      = false;
let cameraReady   = false;
let selectedMode  = "off";            // chosen mode (pending until camera starts)
let activeMode    = "off";            // mode the loop currently drives
let switching     = false;            // guard against concurrent model loads
let rafId         = 0;
let lastVideoTime = -1;

// Hand path
let candidateGesture = "None";   // raw gesture awaiting debounce confirmation
let candidateFrames  = 0;        // consecutive frames the candidate has held
let stableGesture    = "None";   // confirmed gesture currently in effect
let duckHeld         = false;
let lastJumpAt       = 0;

// Pose path
let calibrating   = false;
let calibCount    = 0, calibSumSh = 0, calibSumHip = 0, calibSumTorso = 0;
let baseShoulderY = null, baseHipY = null, baseTorso = null;
let emaHeight     = null;            // smoothed torso height (up = +)
const heightBuf   = [];              // recent { t, h } for windowed jump detection
let duckCount     = 0;               // consecutive frames past DUCK_ON (debounce)
let duckReleaseAt = 0;               // perf-time of the last duck release

// Nav path. The old focus ring became a whole-page hand cursor.
let navEnabled     = false;          // global hand-navigation toggle
let navOverlayOpen = false;          // floating nav legend/menu visible?
// Continuous cursor + pinch
const euroX = new OneEuro(CURSOR.MIN_CUTOFF, CURSOR.BETA, CURSOR.D_CUTOFF);
const euroY = new OneEuro(CURSOR.MIN_CUTOFF, CURSOR.BETA, CURSOR.D_CUTOFF);
let cursorX = 0, cursorY = 0;        // current cursor position (px, viewport)
let cursorIdle = 0;                  // frames since the hand was last seen
let pinchActive  = false;            // pinch currently engaged?
let pinchCand    = 0;                // consecutive sub-PINCH_ON frames (engage debounce)
let pinchMoved   = false;            // committed to scroll (cursor passed the deadzone)?
let pinchStartX  = 0, pinchStartY = 0; // cursor pos where the pinch began
let pinchLastY   = 0;                // last cursor-Y while pinched (grab-scroll)

function setState(next, message) {
  state = next;
  const info = STATE_INFO[next] || { label: next, hint: "" };
  if (stateEl) {
    stateEl.textContent = info.label;
    stateEl.dataset.state = next;
  }
  if (dockEl) dockEl.dataset.state = next;   // colour the sticky-dock status dot
  if (statusEl) {
    statusEl.textContent = message != null ? message : info.hint;
  }
}

function updateModeButtons(active) {
  for (const btn of modeBtns) {
    const on = btn.dataset.mode === active;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

// game control, via Runner.instance_, never synthetic KeyboardEvents
function fireKey(type, keyCode) {
  const runner = window.Runner && window.Runner.instance_;
  if (!runner) return;
  const evt = { keyCode, type, target: document, preventDefault() {} };
  if (type === "keydown") runner.onKeyDown(evt);
  else if (type === "keyup") runner.onKeyUp(evt);
}
function tapKey(keyCode, holdMs = 60) {
  fireKey("keydown", keyCode);
  setTimeout(() => fireKey("keyup", keyCode), holdMs);
}
function setDuck(active) {
  if (active && !duckHeld)      { fireKey("keydown", KEY.DUCK); duckHeld = true; evalAction("duck"); }
  else if (!active && duckHeld) { fireKey("keyup",   KEY.DUCK); duckHeld = false; }
}
function requestJump(cooldownMs, holdMs = 60) {
  const now = performance.now();
  if (now - lastJumpAt < cooldownMs) return;
  lastJumpAt = now;
  evalAction("jump");
  tapKey(KEY.JUMP, holdMs);
}

// hand: gesture -> intent mapping + skeleton overlay
// Deliberately mirrors handlePose(res, now): pull the primary detection, draw
// the shared skeleton overlay, then map to game intent. The discrete
// gesture is debounced (see commitGesture) so noisy single frames can't fire.
function handleHand(res, now) {
  if (state !== State.RUNNING) setState(State.RUNNING);

  const lm    = (res.landmarks && res.landmarks.length) ? res.landmarks[0] : null;
  evalSawSubject(!!lm);
  const hd    = res.handedness || res.handednesses;
  const score = (hd && hd.length && hd[0].length) ? hd[0][0].score : 0;
  ov.drawHand(lm, score >= HAND_CONF_MIN);

  // Raw top gesture + its confidence for this frame.
  const top      = (res.gestures && res.gestures.length && res.gestures[0].length)
                 ? res.gestures[0][0] : null;
  const rawName  = (lm && top) ? top.categoryName : "None";
  const rawScore = top ? top.score : 0;

  // Continuous channel + explainer modules read the raw landmarks every frame,
  // independent of the discrete debounce below.
  const feat = lm ? handFeatures(lm) : null;
  explainer.updatePlayground(rawName, rawScore, feat);
  explainer.feed(lm, feat);

  // Whole-page cursor: while hand-nav is engaged the hand drives the cursor and
  // pinch (handled here, per frame) instead of the game.
  if (navEnabled) driveCursor(feat, now);

  // Confidence gate: a low-confidence frame is treated as "None". It can let a
  // hold lapse but never starts a new action.
  const gated = (rawName !== "None" && rawScore >= GESTURE_CONF_MIN) ? rawName : "None";

  // Debounce / hysteresis: a candidate must persist GESTURE_STABLE_FRAMES frames
  // before it becomes the committed (stable) gesture.
  if (gated === candidateGesture) candidateFrames++;
  else { candidateGesture = gated; candidateFrames = 1; }
  if (candidateFrames >= GESTURE_STABLE_FRAMES && candidateGesture !== stableGesture) {
    commitGesture(candidateGesture);
    stableGesture = candidateGesture;
  }

  // In nav mode the cursor owns the HUD line; otherwise show the game gesture.
  if (!navEnabled) updateGestureHud(lm ? rawName : "None", rawScore);
}

// Apply the edge/hold semantics of a confirmed (debounced) gesture transition.
function commitGesture(next) {
  evalCommit(next);
  // When hand-navigation is engaged the discrete gestures no longer drive the
  // game (the continuous cursor owns click/scroll); only Victory -> menu is routed
  // via navCommit. Returning here keeps the game and nav channels cleanly split.
  if (navEnabled) { navCommit(next); return; }
  // Duck is a hold: active exactly while the fist is the stable gesture.
  setDuck(next === "Closed_Fist");
  // Edge-triggered one-shots (jump keeps its own cooldown).
  if (next === "Open_Palm") requestJump(JUMP_COOLDOWN_MS);
  if (next === "Thumb_Up")  { tapKey(KEY.RESTART); evalAction("restart"); }
  // Pointing_Up / Victory / Thumb_Down never drive the game. In Hand-Nav mode
  // commitGesture routes them via navCommit, where only Victory does something
  // (toggles the menu); Pointing_Up is the cursor posture and Thumb_Down is
  // unbound. In game mode they are merely surfaced in the HUD.
}

// HUD: show the recognised gesture and live confidence, plus its intent hint when
// one is bound (e.g. "Jump", "Cursor · Hand-Nav"). Gestures with an empty intent
// are recognised but unbound and shown as just label · confidence.
function updateGestureHud(rawName, rawScore) {
  if (!gestureEl) return;
  if (rawName === "None") { gestureEl.textContent = "no hand"; return; }
  const m   = GESTURE_MAP[rawName];
  const pct = Math.round(rawScore * 100);
  if (!m)        { gestureEl.textContent = `${rawName} \u00b7 ${pct}%`; return; }
  if (!m.intent) { gestureEl.textContent = `${m.label} \u00b7 ${pct}%`; return; }
  gestureEl.textContent = `${m.label} \u00b7 ${m.intent} \u00b7 ${pct}%`;
}

// hand-navigation layer: whole-page cursor + pinch
// A global toggle (button or the "n" key) re-routes the hand from the game to a
// whole-page cursor. The cursor follows the index fingertip; a pinch (thumb tip
// 4 ↔ index tip 8, normalised by hand size) is the single continuous action
// channel from the spec:
//   • quick pinch (little motion) -> click whatever is under the cursor
//   • pinch + move                -> drag-scroll the page (grab-scroll)
//   • Victory (debounced gesture) -> toggle the floating NUI menu overlay
//   • Pointing_Up / Thumb_Down    -> step to the next / previous navbar page
// Engagement is explicit and the mouse/keyboard + the vendored runner's own
// listeners stay active throughout, so the whole page still works without
// a camera. No Midas touch.

// What the cursor can click: interactive elements only, so a click never lands
// "nowhere".
const CLICKABLE =
  "a[href], button, input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";

// Top-most clickable element under a viewport point. The cursor itself is
// pointer-events:none, so it is never returned.
function clickableAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(CLICKABLE) : null;
}

function showCursor() { if (cursorEl) cursorEl.style.display = "block"; }
function hideCursor() { if (cursorEl) cursorEl.style.display = "none"; }
function positionCursor() {
  if (cursorEl) cursorEl.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
}

// Light up whatever clickable element the cursor hovers (visual affordance).
let hoverEl = null;
function hoverUnderCursor() {
  const el = clickableAt(cursorX, cursorY);
  if (el === hoverEl) return;
  if (hoverEl) hoverEl.classList.remove("nui-hover");
  hoverEl = el;
  if (hoverEl) hoverEl.classList.add("nui-hover");
  if (cursorEl) cursorEl.classList.toggle("is-hover", !!hoverEl);
}

// pinch lifecycle
// A pinch starts ambiguous (neither click nor scroll). While held, we track the
// cursor's total travel from where the pinch began; once it passes the deadzone
// we commit to scroll (pinchMoved = true) and keep scrolling by per-frame dy. On
// release, if it never committed to scroll it is a click, no matter how long the
// pinch was held (a deliberate click must not depend on sub-second timing).
function startPinch() {
  pinchActive  = true;
  pinchMoved   = false;
  pinchStartX  = cursorX; pinchStartY = cursorY;
  pinchLastY   = cursorY;
  if (cursorEl) cursorEl.classList.add("is-pinch");
}
function movePinch() {
  const dy   = pinchLastY - cursorY;          // hand up -> page scrolls up
  pinchLastY = cursorY;
  const total = Math.hypot(cursorX - pinchStartX, cursorY - pinchStartY);
  // Once travel exceeds the deadzone the gesture is committed to scrolling.
  if (total > CURSOR.DRAG_DEADZONE) pinchMoved = true;
  if (pinchMoved) window.scrollBy(0, dy * CURSOR.SCROLL_GAIN);
}
function endPinch() {
  pinchActive = false;
  if (cursorEl) cursorEl.classList.remove("is-pinch");
  // Never committed to scroll means a click on the closest clickable (the cursor is
  // pointer-events:none, so elementFromPoint returns the element underneath).
  if (!pinchMoved) {
    const el = clickableAt(cursorX, cursorY);
    if (el) {
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
      el.click();
      if (cursorEl) {
        cursorEl.classList.add("is-click");
        setTimeout(() => cursorEl.classList.remove("is-click"), 160);
      }
    }
  }
}

// Per-frame cursor driver. feat = null means "no hand this frame".
function driveCursor(feat, now) {
  if (!feat) {
    if (++cursorIdle >= CURSOR.IDLE_HIDE) { hideCursor(); if (pinchActive) endPinch(); }
    pinchCand = 0;
    return;
  }
  cursorIdle = 0;
  showCursor();

  // Posture gate: the cursor follows the index fingertip, so it (and the pinch)
  // only make sense when the index is extended. A curled hand (fist) has a
  // meaningless fingertip and a small thumb-index distance, which made the
  // pinch fire constantly. Below the threshold we freeze the cursor and
  // refuse to start a pinch. A pinch already in flight keeps going (latch), so a
  // deliberate pinch (where the index curves in) can always complete.
  const posing = feat.idxReach >= CURSOR.INDEX_EXTEND_MIN;

  if (posing || pinchActive) {
    // Map the (mirrored) normalised fingertip to the viewport, with gain so the
    // edges stay reachable without moving the hand out of frame. 1-Euro smooths.
    const tSec = now / 1000;
    const cnx  = clamp(0.5 + ((1 - feat.nx) - 0.5) * CURSOR.GAIN, 0, 1);
    const cny  = clamp(0.5 + ( feat.ny       - 0.5) * CURSOR.GAIN, 0, 1);
    cursorX = euroX.filter(cnx, tSec) * window.innerWidth;
    cursorY = euroY.filter(cny, tSec) * window.innerHeight;
    positionCursor();
    hoverUnderCursor();
  }

  // Pinch: engage only from a valid pointing posture, only on a tight thumb-index
  // touch, and only after a couple of frames (debounce) so a single noisy frame
  // can't click. Continue / release use the wider PINCH_OFF (hysteresis) so a held
  // pinch never flickers and can always be released.
  if (!pinchActive) {
    if (posing && feat.pinch < CURSOR.PINCH_ON) {
      if (++pinchCand >= CURSOR.PINCH_FRAMES) { startPinch(); pinchCand = 0; }
    } else {
      pinchCand = 0;
    }
  } else if (feat.pinch < CURSOR.PINCH_OFF) {
    movePinch();
  } else {
    endPinch();
  }
}

// Toggle the floating NUI navigation overlay (the gesture legend / menu).
function navToggleOverlay() {
  navOverlayOpen = !navOverlayOpen;
  if (navOverlayEl) {
    navOverlayEl.classList.toggle("is-open", navOverlayOpen);
    navOverlayEl.setAttribute("aria-hidden", navOverlayOpen ? "false" : "true");
  }
}

// Route one committed (debounced, edge-triggered) gesture to a nav action. Only
// the menu toggle is a discrete gesture: the continuous cursor owns click/scroll,
// and page-to-page navigation is done by pinch-clicking navbar links (which keeps
// hand-nav alive across the page load via the sessionStorage resume). Pointing_Up
// is not bound here, it's the cursor posture, so binding it
// would fire on every cursor move.
function navCommit(name) {
  if (name === "Victory") navToggleOverlay();
  // Everything else is handled continuously by the cursor; no-op here.
}

// Don't steal the "n" toggle key while the user is typing in a field.
function isTypingTarget(t) {
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

// Space / ↑ / ↓ double as the dino's jump & duck keys and as the browser's
// page-scroll keys. The vendored runner only prevents that default scroll for
// the duck key (and on mobile), so on desktop a Space/↑ jump also scrolls the
// page away, which makes the game annoying to play. While the dino is on screen and the
// user isn't typing in a field, swallow the default so the keys drive the game;
// elsewhere they keep their normal page-scrolling behaviour.
const GAME_SCROLL_KEYS = new Set([" ", "Spacebar", "ArrowUp", "ArrowDown"]);
function gameOnScreen() {
  if (!trexHostEl) return false;
  const r = trexHostEl.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.bottom > 0 && r.top < vh;
}

// Hand-nav must survive in-site navigation. Each Quarto page is a full document
// load, so the camera + recognition are torn down on every page change. We
// persist only the user's "hand-nav is engaged" intent in sessionStorage (this
// tab, this session, never written until the user explicitly turns nav on), so
// the next page can re-arm it. sessionStorage is cleared when the tab closes.
const NAV_RESUME_KEY = "nui-nav-resume";
function setNavResume(on) {
  try {
    if (on) sessionStorage.setItem(NAV_RESUME_KEY, "1");
    else    sessionStorage.removeItem(NAV_RESUME_KEY);
  } catch { /* storage blocked, resume just won't persist; no functional loss */ }
}
function wantsNavResume() {
  try { return sessionStorage.getItem(NAV_RESUME_KEY) === "1"; } catch { return false; }
}

// Engage / disengage hand-navigation, the global toggle.
function setNavEnabled(on) {
  if (on === navEnabled) return;
  navEnabled = on;
  setNavResume(on);   // remember/forget the intent so it carries across pages
  // Drop any game hold + clear the gesture debounce so the two modes can't bleed.
  setDuck(false);
  candidateGesture = "None"; candidateFrames = 0; stableGesture = "None";

  if (navToggleBtn) {
    navToggleBtn.dataset.state = on ? "on" : "off";
    navToggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  if (on) {
    // Nav reads hand gestures, so make the hand model the active one, but only if
    // a camera is already live (we never auto-open the camera).
    if (cameraReady && activeMode !== "hand" && !switching) {
      selectedMode = "hand";
      applyMode("hand");
    }
    // Fresh filter state so the cursor doesn't fly in from a stale position.
    euroX.reset(); euroY.reset();
    cursorIdle = CURSOR.IDLE_HIDE;     // stay hidden until the first hand frame
    pinchActive = false; pinchMoved = false; pinchCand = 0;
    if (cursorEl) cursorEl.classList.remove("is-pinch", "is-hover", "is-click");
    setState(state, "Hand-Nav on \u00b7 move=cursor \u00b7 pinch=click \u00b7 pinch+drag=scroll \u00b7 victory=menu");
  } else {
    hideCursor();
    if (pinchActive) { pinchActive = false; if (cursorEl) cursorEl.classList.remove("is-pinch"); }
    if (hoverEl) { hoverEl.classList.remove("nui-hover"); hoverEl = null; }
    navOverlayOpen = false;
    if (navOverlayEl) {
      navOverlayEl.classList.remove("is-open");
      navOverlayEl.setAttribute("aria-hidden", "true");
    }
    setState(state, "Hand-Nav off \u00b7 gestures drive the game");
  }
  if (gestureEl) gestureEl.textContent = "-";
}

// pose: torso extraction + control
// Shoulders (11/12) and hips (23/24) are tracked separately so control
// degrades gracefully: during a real hop the head/shoulders often leave the top
// of the frame, but the hips usually stay visible and can still drive the jump.
// Image Y grows downward, so a smaller y means the body sits higher up.
function torso(lm) {
  const ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER];
  const lh = lm[LM.L_HIP],      rh = lm[LM.R_HIP];
  const vis = p => !!p && (p.visibility == null || p.visibility >= POSE.VIS_MIN);
  const visLs = vis(ls), visRs = vis(rs), visLh = vis(lh), visRh = vis(rh);
  const haveSh = visLs && visRs, haveHip = visLh && visRh;
  return {
    haveSh, haveHip,
    shY:  haveSh  ? (ls.y + rs.y) / 2 : null,
    hipY: haveHip ? (lh.y + rh.y) / 2 : null,
    ls, rs, lh, rh, visLs, visRs, visLh, visRh,
  };
}

// Current torso height above the calibrated neutral (up = +, in torso units),
// from whichever of shoulders / hips are reliably visible this frame.
function torsoHeight(t) {
  let sum = 0, n = 0;
  if (t.haveSh  && baseShoulderY != null) { sum += (baseShoulderY - t.shY);  n++; }
  if (t.haveHip && baseHipY     != null) { sum += (baseHipY     - t.hipY); n++; }
  return n ? (sum / n) / baseTorso : null;
}

function resetPose() {
  calibrating = false;
  calibCount = 0; calibSumSh = 0; calibSumHip = 0; calibSumTorso = 0;
  baseShoulderY = null; baseHipY = null; baseTorso = null;
  emaHeight = null; heightBuf.length = 0;
  duckCount = 0; duckReleaseAt = 0;
  ov.clear();
}

function handlePose(res, now) {
  const poses  = res && res.landmarks;
  const poseLm = (poses && poses.length) ? poses[0] : null;
  evalSawSubject(!!poseLm);
  const t      = poseLm ? torso(poseLm) : null;
  ov.drawPose(poseLm, baseShoulderY, baseHipY);

  if (!t || !(t.haveSh || t.haveHip)) {
    setDuck(false);
    if (gestureEl) gestureEl.textContent = "no body";
    if (calibrating) setState(State.CALIBRATING, "Step back until shoulders and hips are in view...");
    return;
  }

  // Neutral calibration: average resting shoulder-Y, hip-Y and torso height.
  if (calibrating) {
    if (!(t.haveSh && t.haveHip)) {
      setState(State.CALIBRATING, "Step back until shoulders and hips are in view...");
      return;
    }
    calibCount++;
    calibSumSh    += t.shY;
    calibSumHip   += t.hipY;
    calibSumTorso += Math.abs(t.hipY - t.shY);
    setState(State.CALIBRATING, `Calibrating, stand neutral & still (${calibCount}/${POSE.CALIB_SAMPLES})`);
    if (calibCount >= POSE.CALIB_SAMPLES) {
      baseShoulderY = calibSumSh / calibCount;
      baseHipY      = calibSumHip / calibCount;
      baseTorso     = Math.max(calibSumTorso / calibCount, 1e-3);
      emaHeight     = 0; heightBuf.length = 0;
      calibrating   = false;
      setState(State.RUNNING, "Go! · stand up / hop = jump · crouch = duck");
    }
    return;
  }

  // running control
  const hRaw = torsoHeight(t);
  if (hRaw == null) return;
  emaHeight = (emaHeight == null) ? hRaw
            : POSE.EMA_ALPHA * hRaw + (1 - POSE.EMA_ALPHA) * emaHeight;
  const h = emaHeight;     // up = +,  crouch = -
  const depth = -h;        // crouch depth, + = lower than neutral

  if (state !== State.RUNNING) setState(State.RUNNING);

  // Short look-back buffer gives the lowest recent body position for rise detection.
  heightBuf.push({ t: now, h });
  const cutoff = now - POSE.JUMP_WINDOW_MS;
  while (heightBuf.length && heightBuf[0].t < cutoff) heightBuf.shift();
  let minH = h;
  for (const s of heightBuf) if (s.h < minH) minH = s.h;
  const rise = h - minH;   // how far we have come up from the recent low

  // Duck: crouch held, with debounce (engage) + hysteresis (release).
  if (!duckHeld) {
    duckCount = depth > POSE.DUCK_ON ? duckCount + 1 : 0;
    if (duckCount >= POSE.DUCK_FRAMES) { setDuck(true); duckCount = 0; }
  } else if (depth < POSE.DUCK_OFF) {
    setDuck(false);
    duckReleaseAt = now;   // lock out the stand-up rebound from firing a jump
  }

  // Jump: fast upward rise from the recent low, only near neutral and not right
  // after a duck (this is what stops a crouch-then-stand-up mis-firing as a jump).
  const justUnducked = now - duckReleaseAt < POSE.DUCK_JUMP_LOCK_MS;
  if (!duckHeld && !justUnducked && depth < POSE.DUCK_OFF && rise > POSE.JUMP_RISE) {
    requestJump(POSE.JUMP_COOLDOWN_MS, POSE.JUMP_HOLD_MS);
    heightBuf.length = 0;  // consume the impulse so it fires once
  }

  if (gestureEl) {
    gestureEl.textContent = duckHeld ? "Duck ↓" : (now - lastJumpAt < 200 ? "Jump ↑" : "ready");
  }
}

// recognition loop (dispatches by active mode)
// One synchronous inference per fresh camera frame; requestAnimationFrame plus
// the (synchronous) detect call pace it naturally, so we no longer add an
// artificial throttle. That was just adding input latency.
function loop() {
  rafId = requestAnimationFrame(loop);
  if (!cameraReady || activeMode === "off") return;
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  evalFrameStart(now);
  if (activeMode === "hand" && recognizer) {
    handleHand(recognizer.recognizeForVideo(video, now), now);
  } else if (activeMode === "pose" && poseLandmarker) {
    handlePose(poseLandmarker.detectForVideo(video, now), now);
  }
}

// lazy model loaders (shared wasm fileset, models cached after first load)
async function getVision() {
  if (!visionResolver) {
    visionResolver = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
    );
  }
  return visionResolver;
}
// Try the preferred (GPU) delegate first; transparently fall back to CPU.
async function createWithFallback(make) {
  try {
    return await make(PREFERRED_DELEGATE);
  } catch (err) {
    console.warn(`${PREFERRED_DELEGATE} delegate failed, falling back to CPU.`, err);
    return await make("CPU");
  }
}
async function ensureHand() {
  if (recognizer) return recognizer;
  const vision = await getVision();
  recognizer = await createWithFallback(delegate =>
    GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 1,
    }));
  return recognizer;
}
async function ensurePose() {
  if (poseLandmarker) return poseLandmarker;
  const vision = await getVision();
  poseLandmarker = await createWithFallback(delegate =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    }));
  return poseLandmarker;
}

// mode switching (Hand / Pose / Off)
async function applyMode(mode) {
  if (switching) return;

  // Hand-navigation reads hand gestures, so disengage it when leaving hand mode.
  if (navEnabled && mode !== "hand") setNavEnabled(false);

  // Leaving the current mode: release held keys + clear transient state, and
  // pause the loop (activeMode = off) while the target model loads.
  setDuck(false);
  candidateGesture = "None"; candidateFrames = 0; stableGesture = "None";
  resetPose();
  activeMode = "off";
  updateModeButtons(mode);
  if (gestureEl) gestureEl.textContent = "-";

  if (mode === "off") {
    setState(State.READY, "Control off · keyboard & mouse still play");
    return;
  }

  switching = true;
  try {
    if (mode === "hand") {
      setState(State.CALIBRATING, "Loading hand model…");
      await ensureHand();
      activeMode = "hand";
      setState(State.READY, "Hand · offene Hand = Sprung · Faust = Ducken · Daumen hoch = Neustart");
    } else {
      setState(State.CALIBRATING, "Loading pose model…");
      await ensurePose();
      calibrating = true;
      activeMode  = "pose";
      setState(State.CALIBRATING, "Calibrating, stand neutral & still...");
    }
  } catch (err) {
    console.error(err);
    setState(State.ERROR, "Model failed to load: " + (err.message || err));
  } finally {
    switching = false;
  }
}

// camera startup
async function start() {
  if (!libReady) {
    setState(State.NO_CAMERA, "Model library still loading, please try again in a moment.");
    return false;
  }
  startBtn.disabled = true;
  setState(State.CALIBRATING, "Requesting camera…");
  try {
    // Camera first, before the long await chain, so the click's user-activation
    // is still fresh. Firefox can otherwise reject getUserMedia with
    // NotAllowedError after a long await chain.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: CAM_W }, height: { ideal: CAM_H }, facingMode: "user" },
      audio: false
    });
    video.srcObject = stream;
    await video.play();

    cameraReady = true;
    startBtn.disabled = false;
    startBtn.dataset.on = "true";
    startBtn.textContent = "Kamera stoppen";
    if (!rafId) rafId = requestAnimationFrame(loop);
    await applyMode(selectedMode);   // load the model for the chosen mode
    return true;
  } catch (err) {
    console.error(err);
    let msg = err.message || String(err);
    if (err.name === "NotAllowedError") {
      msg = window.isSecureContext
        ? "Camera permission denied, allow it in the site settings."
        : "Insecure context, open via http://localhost (e.g. `quarto preview`), not file:// or a LAN IP.";
    } else if (err.name === "NotFoundError") {
      msg = "No camera device found.";
    }
    setState(State.ERROR, msg);
    startBtn.disabled = false;
    return false;
  }
}

// camera shutdown
// Release the camera: stop every MediaStream track (this turns the webcam's
// in-use light off), disengage hand-nav, pause recognition and return to the
// NO_CAMERA state. The keyboard/mouse fallback stays fully live and the chosen
// mode is remembered, so a later Start resumes where the user left off.
function stopCamera() {
  if (navEnabled) setNavEnabled(false);
  const stream = video.srcObject;
  if (stream && stream.getTracks) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
  cameraReady   = false;
  activeMode    = "off";
  switching     = false;
  lastVideoTime = -1;

  // Drop any held game key + clear the gesture/pose transients so nothing bleeds
  // into the next session.
  setDuck(false);
  candidateGesture = "None"; candidateFrames = 0; stableGesture = "None";
  resetPose();
  ov.clear();
  if (gestureEl) gestureEl.textContent = "-";

  updateModeButtons(selectedMode);
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.dataset.on = "false";
    startBtn.textContent = "Kamera starten";
  }
  setState(State.NO_CAMERA, "Kamera gestoppt \u00b7 Tastatur/Maus spielen weiter");
}

// Start/stop the camera from the dock button.
function toggleCamera() {
  if (cameraReady) stopCamera();
  else start();
}

function onModeClick(mode) {
  selectedMode = mode;
  if (cameraReady) applyMode(mode);     // switch live
  else updateModeButtons(mode);         // just reflect the pending choice
}

// sticky dock + nav engagement
// Collapse/expand the floating dock (its body holds the live feed + controls).
function setDockCollapsed(collapsed) {
  if (!dockEl) return;
  dockEl.classList.toggle("is-collapsed", collapsed);
  if (dockToggleBtn) dockToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

// Engage hand-nav from a user gesture (toggle click / "N"). If the camera isn't
// live yet, auto-acquire it in hand mode and expand the dock for framing, then
// arm nav. getUserMedia stays inside this user-activation, Firefox needs that.
function toggleNavRequested() {
  if (navEnabled) { setNavEnabled(false); return; }
  setDockCollapsed(false);             // reveal the feed so framing is visible
  if (!cameraReady) {
    selectedMode = "hand";
    updateModeButtons("hand");
    start();                           // async; arms the hand model once up
  }
  setNavEnabled(true);
}

// Resume hand-navigation automatically after an in-site page load. Each Quarto
// page is a full document load, so the camera + recognition don't survive
// navigation; without this, gesture control silently stops after every page
// change. When the user had hand-nav engaged we persisted that intent (this tab,
// this session); here we re-acquire the camera in hand mode and re-arm nav so
// control carries across pages seamlessly. The camera permission was already
// granted by the user's explicit click earlier this session, so this is a
// continuation of that consent, not an auto-open on first visit. If the browser
// still refuses getUserMedia without a fresh gesture (e.g. Firefox without a
// remembered permission), we degrade gracefully: forget the intent and leave the
// keyboard/mouse fallback live so a single click (or the N key) resumes.
async function resumeNav() {
  if (!libReady || cameraReady || navEnabled) return;
  setDockCollapsed(false);
  selectedMode = "hand";
  updateModeButtons("hand");
  setState(State.CALIBRATING, "Handsteuerung wird fortgesetzt…");
  const ok = await start();          // re-uses the granted camera permission
  if (ok) setNavEnabled(true);
  else    setNavResume(false);       // couldn't auto-resume, wait for a click
}

// bootstrap
setState(State.BOOT);
updateModeButtons(selectedMode);
if (startBtn) startBtn.addEventListener("click", toggleCamera);
for (const btn of modeBtns) {
  btn.addEventListener("click", () => onModeClick(btn.dataset.mode));
}
// Hand-navigation toggle, click + keyboard ("n"). Mouse/keyboard must always
// work; the vendored runner ignores "n", so this never clashes with game keys.
// Turning it on auto-acquires the camera (hand mode) so the page is operable
// straight away; the dock collapse button only shows/hides the feed + controls.
if (navToggleBtn) navToggleBtn.addEventListener("click", toggleNavRequested);
document.addEventListener("keydown", (e) => {
  if (GAME_SCROLL_KEYS.has(e.key) && !isTypingTarget(e.target) && gameOnScreen()) {
    e.preventDefault();  // stop the page from scrolling away while playing
  }
  if ((e.key === "n" || e.key === "N") && !e.repeat && !isTypingTarget(e.target)) {
    toggleNavRequested();
  }
});
if (dockToggleBtn && dockEl) {
  dockToggleBtn.addEventListener("click", () =>
    setDockCollapsed(!dockEl.classList.contains("is-collapsed")));
}
try {
  ({ GestureRecognizer, PoseLandmarker, FilesetResolver } = await import(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`
  ));
  libReady = true;
  setState(State.NO_CAMERA);
  // Carry hand-navigation across an in-site page change (see resumeNav).
  if (wantsNavResume()) resumeNav();
} catch (err) {
  console.error("MediaPipe import failed", err);
  setState(State.ERROR, "Model library failed to load: " + (err.message || err));
  // Keyboard + mouse fallback remains active via the vendored runner.
}
