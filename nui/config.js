// nui/config.js
// Shared, immutable configuration for the NUI controller: model/camera setup,
// the state-machine vocabulary, the gesture map, cursor tuning and the overlay
// drawing tokens. No runtime state and no DOM, just data imported by the
// controller, overlay and explainer modules.

export const MP_VERSION = "0.10.35";

// Pinned CDN model bundles (float16 .task, "latest" channel).
export const GESTURE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task";
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

// Camera capture. The larger frame helps full-body pose tracking; the GPU keeps
// it usable in the browser.
export const CAM_W = 640, CAM_H = 480;

// MediaPipe inference delegate. "GPU" (WebGL) is usually faster and a bit more
// accurate than "CPU" in the browser; CPU is the fallback if GPU creation fails.
export const PREFERRED_DELEGATE = "GPU";

// BlazePose 33-landmark indices used for torso tracking.
export const LM = Object.freeze({ L_SHOULDER: 11, R_SHOULDER: 12, L_HIP: 23, R_HIP: 24 });

// Pose-control tuning. Vertical thresholds use torso height (shoulder↔hip
// distance), so the player can stand nearer or farther from the camera.
export const POSE = Object.freeze({
  VIS_MIN:           0.35,  // min landmark visibility to trust a point
  CALIB_SAMPLES:     24,    // valid frames averaged for the neutral baseline
  EMA_ALPHA:         0.6,   // light height smoothing (0..1, higher = snappier)
  JUMP_RISE:         0.13,  // upward rise from the recent low (× torso) -> jump
  JUMP_WINDOW_MS:    220,   // look-back window the rise is measured over
  JUMP_HOLD_MS:      130,   // how long jump is held, for a taller hop
  JUMP_COOLDOWN_MS:  650,   // min gap between pose jumps
  DUCK_ON:           0.18,  // crouch depth (× torso) to engage duck
  DUCK_OFF:          0.08,  // crouch depth to release duck (hysteresis)
  DUCK_FRAMES:       2,     // consecutive frames past DUCK_ON before engaging
  DUCK_JUMP_LOCK_MS: 450,   // suppress jump right after standing up from a duck
});

// state machine
// Lifecycle of the camera / recognition pipeline. The keyboard + mouse fallback
// is independent of this and stays live in every state.
//   BOOT -> NO_CAMERA -> CALIBRATING -> READY -> RUNNING
//   any setup failure -> ERROR
export const State = Object.freeze({
  BOOT:        "BOOT",         // module loaded, MediaPipe library importing
  NO_CAMERA:   "NO_CAMERA",    // no camera session, keyboard/mouse fallback only
  CALIBRATING: "CALIBRATING",  // acquiring camera / loading model / pose baseline
  READY:       "READY",        // camera + model ready, control armed
  RUNNING:     "RUNNING",      // recognition loop active, driving the game
  ERROR:       "ERROR",        // setup/runtime failure (fallback still works)
});

// HUD label + default status hint per state. The hint can be overridden per
// transition via setState(state, message).
export const STATE_INFO = {
  [State.BOOT]:        { label: "Boot",       hint: "Initializing…" },
  [State.NO_CAMERA]:   { label: "No camera",  hint: "Keyboard: Space / ↓ to play" },
  [State.CALIBRATING]: { label: "Setup",      hint: "Loading camera & model…" },
  [State.READY]:       { label: "Ready",      hint: "Control armed" },
  [State.RUNNING]:     { label: "Running",    hint: "Controlling the game · keyboard/mouse still work" },
  [State.ERROR]:       { label: "Error",      hint: "Keyboard fallback still works" },
};

// game-control constants
export const KEY = { JUMP: 32, DUCK: 40, RESTART: 13 };
export const JUMP_COOLDOWN_MS = 280;   // hand-gesture jump debounce

// Discrete hand-gesture vocabulary. Only the built-in GestureRecognizer
// categories are used, no custom training. `intent` is the HUD hint;
// gestures with an empty intent are recognised but bound to no action (we keep
// the vocabulary deliberately small). Game bindings (handleHand) and the single
// nav binding (Victory to menu, navCommit) reference gesture names directly.
//   • Open_Palm / Closed_Fist / Thumb_Up drive the T-Rex.
//   • Pointing_Up is the cursor posture in Hand-Nav, not a discrete action
//     (binding it would fire on every cursor move); page changes happen by
//     pinch-clicking navbar links.
//   • Victory toggles the Hand-Nav menu.
export const GESTURE_MAP = Object.freeze({
  Open_Palm:   { label: "Open palm",   intent: "Jump" },
  Closed_Fist: { label: "Fist",        intent: "Duck" },
  Thumb_Up:    { label: "Thumbs up",   intent: "Restart" },
  Pointing_Up: { label: "Point",       intent: "Cursor \u00b7 Hand-Nav" },
  Victory:     { label: "Victory",     intent: "Men\u00fc \u00b7 Hand-Nav" },
  Thumb_Down:  { label: "Thumbs down", intent: "" },
});

// Debounce against false triggers: ignore sub-threshold frames, and require a
// gesture to persist a few frames before it commits (hysteresis).
export const GESTURE_CONF_MIN      = 0.5;  // min top-gesture score to be considered
export const GESTURE_STABLE_FRAMES = 3;    // consecutive frames before a gesture commits
// Min handedness (left/right) confidence before the hand skeleton is drawn as
// "confident" (crisp blue) rather than "uncertain" (red).
export const HAND_CONF_MIN         = 0.5;

// continuous channel: whole-page hand cursor + pinch
// The cursor follows the index fingertip (landmark 8); a pinch (thumb tip 4 ↔
// index tip 8, normalised by hand size) is the unified click / drag-scroll
// action. The thresholds are defaults and can be tuned.
export const CURSOR = Object.freeze({
  GAIN:          1.35,  // expand hand motion around centre so screen edges are reachable
  // Pinch thresholds, normalised by hand size. A clear thumb-index touch is
  // ~0.05-0.15; a relaxed/open hand is ~0.5-0.9. Keep engage well below a resting
  // hand so the pinch isn't "always on", with a wider release for hysteresis.
  PINCH_ON:      0.22,  // pinch distance (× hand size) to engage a pinch
  PINCH_OFF:     0.38,  // pinch distance to release (hysteresis, no flicker)
  PINCH_FRAMES:  2,     // consecutive sub-PINCH_ON frames before a pinch engages (debounce)
  // Posture gate: the cursor follows the index fingertip, so a pinch only makes
  // sense when the index is extended ("pointing"). idxReach = |tip 8 ↔ wrist 0| ÷
  // hand size; a pointing hand is ~1.4-1.8, a fist/curl ~0.7-0.9. Below this we
  // freeze the cursor and refuse to start a pinch, so a fist never mis-fires one.
  INDEX_EXTEND_MIN: 1.1,
  DRAG_DEADZONE: 40,    // px the cursor must travel while pinched to commit to scroll
                        // (else the pinch is a click); generous to absorb hand tremor
  SCROLL_GAIN:   2.1,   // hand -> page scroll multiplier for grab-scrolling
  IDLE_HIDE:     16,    // frames without a hand before the cursor fades out
  // 1-Euro filter params. Smooth enough, still responsive.
  MIN_CUTOFF:    1.1, BETA: 0.7, D_CUTOFF: 1.0,
});

// Pinch "openness" meter in the Gesture-Playground (explainer.js): a normalised
// pinch distance maps linearly onto a bar from closed (0 %) to open (100 %). The
// real click threshold CURSOR.PINCH_ON sits inside this range, so the bar's lower
// region (below PINCH_ON) is exactly the "closed -> click" zone.
export const PINCH_VIS = Object.freeze({
  CLOSED: 0.10,  // pinch distance shown as a fully closed hand (bar empty)
  OPEN:   1.00,  // pinch distance shown as a fully open hand (bar full)
});

// overlay drawing tokens
// Same colours across modes: confident = blue landmark graph, uncertain = red.
// Keep enough contrast for live video.
export const OV = Object.freeze({
  NODE: "#0071e3", NODE_WEAK: "#d70015",
  BONE: "rgba(0,113,227,0.92)", BONE_WEAK: "rgba(215,0,21,0.64)",
  CONTRAST: "rgba(255,255,255,0.92)", CONTRAST_BLUR: 2,
  GUIDE: "rgba(0,113,227,0.72)",
  DOT_R: 4.5, BONE_W: 3,
});
// Edge lists for the skeleton overlay. Hand = MediaPipe's 21-landmark topology;
// pose = a readable full-body subset of the BlazePose 33-landmark graph.
export const HAND_EDGES = Object.freeze([
  [0,1],[1,2],[2,3],[3,4],          // thumb
  [0,5],[5,6],[6,7],[7,8],          // index
  [5,9],[9,10],[10,11],[11,12],     // middle
  [9,13],[13,14],[14,15],[15,16],   // ring
  [13,17],[17,18],[18,19],[19,20],  // pinky
  [0,17],                           // palm base
]);
// BlazePose indices: 0 nose · 11/12 shoulders · 13/14 elbows · 15/16 wrists ·
// 23/24 hips · 25/26 knees · 27/28 ankles. A simple full-body skeleton, no
// noisy face mesh.
export const POSE_NODES = Object.freeze([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);
export const POSE_EDGES = Object.freeze([
  [0,11],[0,12],                    // head to shoulders
  [11,12],                          // shoulders
  [11,13],[13,15],                  // left arm
  [12,14],[14,16],                  // right arm
  [11,23],[12,24],[23,24],          // torso sides + hips
  [23,25],[25,27],                  // left leg
  [24,26],[26,28],                  // right leg
]);
