export async function copyText(value, button, notify) {
  if (!value?.trim()) {
    notify("Nothing to copy yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    notify("Copied to clipboard.");
    if (button) {
      const label = button.textContent;
      button.textContent = "Copied ✓";
      button.disabled = true;
      setTimeout(() => {
        button.textContent = label;
        button.disabled = false;
      }, 1600);
    }
  } catch {
    notify(
      "Clipboard access is unavailable. Select the text and copy it manually, or open DBMux over HTTPS or localhost.",
    );
  }
}
