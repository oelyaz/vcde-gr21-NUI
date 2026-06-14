/* nui/onboarding.js - one-time camera coachmark + start emphasis.
 *
 * Purely additive progressive enhancement: if this never runs, the dock still
 * works (mouse/keyboard always; camera on click). It just makes the "click to
 * start" affordance obvious the first time, addressing the feedback that users
 * didn't realise the camera must be started by hand. */

const KEY = 'nui-coach-seen-v1';
const dock = document.getElementById('nui-dock');
const coach = document.getElementById('nui-coach');

let seen = false;
try { seen = !!localStorage.getItem(KEY); } catch { /* storage blocked, treat as unseen */ }

function dismiss() {
  if (coach) coach.hidden = true;
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
}

if (dock && coach) {
  if (!seen) {
    // Open the dock so the "Kamera starten" button is visible behind the coach.
    dock.classList.remove('is-collapsed');
    const toggle = document.getElementById('nui-dock-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    // Show after a beat so the calm hero paints first (it doesn't fight the intro).
    setTimeout(() => { coach.hidden = false; }, 1500);
    coach.querySelectorAll('.nui-coach-close, .nui-coach-ok').forEach((b) =>
      b.addEventListener('click', dismiss));
  }

  // Once the camera is actually live, the hint is moot. Drop it and remember.
  const obs = new MutationObserver(() => {
    const st = dock.dataset.state;
    if (st === 'RUNNING' || st === 'READY' || st === 'CALIBRATING') dismiss();
  });
  obs.observe(dock, { attributes: true, attributeFilter: ['data-state'] });
}
