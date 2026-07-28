/**
 * Light and dark, shared by every page.
 *
 * The choice is stored rather than held in memory, because otherwise moving
 * between the plate and the map would drop it and snap back to whatever the
 * operating system prefers. A small inline script in each page's <head>
 * applies the stored value before first paint, so the page never flashes the
 * wrong theme on the way in.
 */

const KEY = "corpus-theme";

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme")
      ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(KEY, theme); } catch { /* private browsing */ }
  return theme;
}

export function toggleTheme() {
  return setTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Wires a button and keeps its label describing what pressing it will do. */
export function wireThemeButton(button) {
  if (!button) return;
  const label = () => {
    button.textContent = currentTheme() === "dark" ? "Light plate" : "Dark plate";
  };
  label();
  button.addEventListener("click", () => { toggleTheme(); label(); });
}
