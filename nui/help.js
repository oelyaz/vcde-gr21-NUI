// nui/help.js - the "?" help popout in the NUI dock head.
//
// Progressive enhancement: the dock works without this. It only opens a small
// non-modal popout that explains the dock controls and the whole-page hand
// navigation. Closes on its button, Escape, or a click outside.

const toggle = document.getElementById("nui-help-toggle");
const popout = document.getElementById("nui-help");

if (toggle && popout) {
  const closeBtn = popout.querySelector(".nui-help-close");

  function setOpen(open) {
    popout.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    // Move focus into the popout on open, back to the trigger on close.
    if (open) (closeBtn || popout).focus();
    else toggle.focus();
  }

  // Toggle from the dock-head button. stopPropagation so the document
  // outside-click handler below doesn't immediately re-close it.
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(popout.hidden);
  });

  if (closeBtn) closeBtn.addEventListener("click", () => setOpen(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popout.hidden) setOpen(false);
  });

  document.addEventListener("click", (e) => {
    if (popout.hidden) return;
    if (popout.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });
}
