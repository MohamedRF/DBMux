/**
 * DBMux theme controller.
 *
 * Resolves the light / dark / system preference, applies it to
 * <html data-theme> before first paint and keeps the header switch in sync.
 * The preference is stored in localStorage; storage failures fall back to the
 * system preference for the current page view.
 */
const THEME_KEY = "dbmux.theme";
const THEMES = ["light", "dark", "system"];
const root = document.documentElement;
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readPreference() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}

function writePreference(value) {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* Storage is unavailable; the preference applies to this page only. */
  }
}

function resolve(preference) {
  if (preference === "system") return media.matches ? "dark" : "light";
  return preference;
}

function sync() {
  const preference = readPreference();
  root.dataset.theme = resolve(preference);
  root.dataset.themePreference = preference;
  for (const button of document.querySelectorAll("[data-theme-choice]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === preference),
    );
  }
}

function apply(preference) {
  if (!THEMES.includes(preference)) return;
  writePreference(preference);
  sync();
}

// Applied before the first paint so the page never flashes the wrong theme.
const initial = readPreference();
root.dataset.theme = resolve(initial);
root.dataset.themePreference = initial;

media.addEventListener("change", () => {
  if (readPreference() === "system") sync();
});

// Keep other tabs and re-visited pages in step with the stored preference.
window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) sync();
});

window.addEventListener("focus", sync);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sync();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!target || typeof target.closest !== "function") return;
  const button = target.closest("[data-theme-choice]");
  if (!button) return;
  apply(button.dataset.themeChoice);
});

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", sync);
else sync();
