/**
 * Light/dark theme override controller synchronized with `<meta name="color-scheme">`
 * and `localStorage`, honoring system preference by default.
 */

const STORAGE_KEY = "color-scheme";

function getSystemScheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredScheme() {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val === "light" || val === "dark" ? val : null;
  } catch {
    return null;
  }
}

function writeStoredScheme(val) {
  try {
    if (val === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, val);
    }
  } catch {
    // Graceful no-op when storage is blocked
  }
}

/**
 * Initialize two-state light/dark theme toggle button with cross-tab sync.
 *
 * @param {HTMLButtonElement | null} buttonEl
 * @returns {{ getRenderedScheme: () => "light" | "dark" }}
 */
export function initThemeToggle(buttonEl) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const mql = window.matchMedia("(prefers-color-scheme: dark)");

  const getRenderedScheme = () => {
    const stored = readStoredScheme();
    return stored ?? getSystemScheme();
  };

  const syncDom = () => {
    const stored = readStoredScheme();
    const system = getSystemScheme();
    const rendered = stored ?? system;

    if (meta) {
      meta.content = stored ?? "light dark";
    }

    if (buttonEl) {
      const nextScheme = rendered === "dark" ? "light" : "dark";
      buttonEl.setAttribute("aria-label", `Switch to ${nextScheme} theme`);
      buttonEl.setAttribute("aria-pressed", String(rendered === "dark"));
      buttonEl.dataset.renderedTheme = rendered;
      buttonEl.dataset.themeMode = stored ? "override" : "system";
      const labelEl = buttonEl.querySelector("[data-theme-label]");
      if (labelEl) {
        labelEl.textContent = rendered === "dark" ? "Dark" : "Light";
      }
    }
  };

  syncDom();

  if (buttonEl) {
    buttonEl.addEventListener("click", () => {
      const system = getSystemScheme();
      const rendered = getRenderedScheme();
      const target = rendered === "dark" ? "light" : "dark";

      // Remove override when user toggles back to matching current system preference
      if (target === system) {
        writeStoredScheme(null);
      } else {
        writeStoredScheme(target);
      }
      syncDom();
    });
  }

  // Update button label if system changes while following system; never delete a stored override
  mql.addEventListener("change", () => {
    syncDom();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      syncDom();
    }
  });

  return { getRenderedScheme };
}
