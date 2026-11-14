/** Light / dark appearance. Saved per device; index.html applies it before first paint. */
export type Theme = "light" | "dark";

const KEY = "northstar:theme"; // keep in sync with the inline script in index.html
export const DEFAULT_THEME: Theme = "dark";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // storage can be blocked
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage can be blocked; the theme still applies for this visit */
  }
}
