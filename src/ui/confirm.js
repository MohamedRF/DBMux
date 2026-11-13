/**
 * Lightweight confirmation dialog for destructive or irreversible actions.
 * Replaces native confirm() so the prompt can name the exact target and
 * state the consequences. Usage:
 *   const ok = await confirmAction({ title, body, confirmLabel });
 */
export function confirmAction({
  title,
  body,
  confirmLabel = "Confirm",
  danger = true,
}) {
  const dialog = document.getElementById("confirmDialog");
  const heading = document.getElementById("confirmTitle");
  const message = document.getElementById("confirmBody");
  const accept = document.getElementById("confirmAccept");
  const cancel = document.getElementById("confirmCancel");
  if (!dialog || !heading || !message || !accept || !cancel) {
    // Degrade gracefully: never silently proceed with a destructive action.
    return Promise.resolve(false);
  }
  heading.textContent = title;
  message.textContent = body;
  accept.textContent = confirmLabel;
  accept.classList.toggle("danger-solid", danger);
  const previouslyFocused = document.activeElement;

  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.hidden = true;
      document.removeEventListener("keydown", onKeydown, true);
      accept.onclick = null;
      cancel.onclick = null;
      backdrop.onclick = null;
      if (previouslyFocused instanceof HTMLElement)
        previouslyFocused.focus({ preventScroll: true });
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const backdrop = dialog.querySelector("[data-confirm-cancel]");
    accept.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    if (backdrop) backdrop.onclick = () => finish(false);
    dialog.hidden = false;
    document.addEventListener("keydown", onKeydown, true);
    // Focus the least destructive action for safety on dangerous prompts.
    (danger ? cancel : accept).focus({ preventScroll: true });
  });
}
