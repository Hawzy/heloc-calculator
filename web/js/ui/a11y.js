/**
 * Accessible form validation sync (:user-invalid + fallback), dynamic aria-describedby
 * linking, and centralized polite live-region announcements.
 */

/**
 * Create a single polite live-region announcer for the document.
 *
 * @returns {{ announce: (text: string, delayMs?: number) => void, clear: () => void }}
 */
export function createAnnouncer() {
  const region = document.createElement("div");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.className = "visually-hidden";
  document.body.append(region);

  let timerId = null;

  return {
    announce(text, delayMs = 0) {
      clearTimeout(timerId);
      region.textContent = "";
      if (!text) return;
      if (delayMs <= 0) {
        timerId = setTimeout(() => {
          region.textContent = text;
        }, 20);
        return;
      }
      timerId = setTimeout(() => {
        region.textContent = text;
      }, delayMs);
    },
    clear() {
      clearTimeout(timerId);
      region.textContent = "";
    },
  };
}

function spokenText(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
    n.replaceWith(`${n.getAttribute("aria-label")}: `);
  });
  return copy.textContent.replace(/\s+/g, " ").trim();
}

function linkErrorId(el, errorId, shown) {
  if (!errorId) return;
  const ids = (el.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length > 0) {
    el.setAttribute("aria-describedby", ids.join(" "));
  } else {
    el.removeAttribute("aria-describedby");
  }
}

/**
 * Initialize `:user-invalid` + fallback ARIA synchronization on a form element.
 *
 * @param {HTMLFormElement} formEl
 * @param {{ announce: (text: string, delayMs?: number) => void, clear: () => void }} announcer
 */
export function initFormValidation(formEl, announcer) {
  const supportsUserInvalid =
    typeof CSS !== "undefined" && typeof CSS.supports === "function"
      ? CSS.supports("selector(:user-invalid)")
      : false;

  const flagged = new WeakSet();
  const announced = new WeakSet();
  const dirtyState = new WeakMap();
  let lastAnnouncedField = null;

  const getErrorElement = (el) => {
    const id = el.dataset?.error;
    return id ? document.getElementById(id) : null;
  };

  const announceFieldError = (el) => {
    const errorEl = getErrorElement(el);
    if (!errorEl) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
    lastAnnouncedField = el;
    announcer.announce(label + spokenText(errorEl), 500);
  };

  const isFieldShowingError = (el) => {
    if (el.classList.contains("user-invalid-fallback")) return true;
    if (supportsUserInvalid) {
      try {
        return el.matches(":user-invalid");
      } catch {
        return false;
      }
    }
    return false;
  };

  const syncAria = (el, shouldAnnounce = false) => {
    if (!el || !el.matches?.("input, select, textarea")) return;
    const invalid = isFieldShowingError(el);
    if (invalid) {
      if (shouldAnnounce && !announced.has(el)) {
        announceFieldError(el);
        announced.add(el);
      }
      el.setAttribute("aria-invalid", "true");
      linkErrorId(el, el.dataset?.error, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
      el.setAttribute("aria-invalid", "false");
      linkErrorId(el, el.dataset?.error, false);
      flagged.delete(el);
      announced.delete(el);
      if (lastAnnouncedField === el) {
        announcer.clear();
      }
    }
  };

  // Initialize all fields at aria-invalid="false"
  formEl.querySelectorAll("input, select, textarea").forEach((el) => {
    el.setAttribute("aria-invalid", "false");
  });

  const setCustomFieldError = (el, message, { forceShow = false, announce = false } = {}) => {
    if (!el || typeof el.setCustomValidity !== "function") return;
    el.setCustomValidity(message || "");
    const errorEl = getErrorElement(el);
    if (errorEl) {
      const textSlot = errorEl.querySelector("[data-error-text]") || errorEl;
      if (message) {
        textSlot.textContent = message;
      } else if (errorEl.dataset.defaultMessage) {
        textSlot.textContent = errorEl.dataset.defaultMessage;
      }
    }

    if (message) {
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      if (forceShow || state.hasBlurred || !supportsUserInvalid) {
        if (forceShow || !supportsUserInvalid) {
          el.classList.add("user-invalid-fallback");
        }
      }
      syncAria(el, announce);
    } else {
      el.classList.remove("user-invalid-fallback");
      syncAria(el, false);
    }
  };

  const clearFieldError = (el) => {
    if (!el) return;
    if (typeof el.setCustomValidity === "function" && el.validity?.customError) {
      el.setCustomValidity("");
    }
    el.classList.remove("user-invalid-fallback");
    syncAria(el, false);
  };

  formEl.addEventListener(
    "blur",
    (e) => {
      const el = e.target;
      if (!el.matches?.("input, select, textarea")) return;
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasBlurred = true;
      dirtyState.set(el, state);
      if (!supportsUserInvalid && state.hasInteracted && !el.validity.valid) {
        el.classList.add("user-invalid-fallback");
      }
      syncAria(el, true);
    },
    true,
  );

  formEl.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches?.("input, select, textarea")) return;
    const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
    state.hasInteracted = true;
    dirtyState.set(el, state);
    if (!supportsUserInvalid && state.hasBlurred) {
      el.classList.toggle("user-invalid-fallback", !el.validity.valid);
    }
    if (el.hasAttribute("aria-invalid")) {
      syncAria(el, false);
    }
  });

  formEl.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (!el.matches?.("input, select, textarea")) return;
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(el, state);
      if (!supportsUserInvalid) {
        el.classList.toggle("user-invalid-fallback", !el.validity.valid);
      }
      syncAria(el, true);
    },
    true,
  );

  formEl.addEventListener(
    "invalid",
    (e) => {
      const el = e.target;
      if (!el.matches?.("input, select, textarea")) return;
      announced.add(el);
      if (!supportsUserInvalid) {
        el.classList.add("user-invalid-fallback");
      }
      syncAria(el, false);
    },
    true,
  );

  formEl.addEventListener(
    "reset",
    () => {
      setTimeout(() => {
        formEl.querySelectorAll("input, select, textarea").forEach((el) => {
          dirtyState.delete(el);
          if (typeof el.setCustomValidity === "function") el.setCustomValidity("");
          el.classList.remove("user-invalid-fallback");
          syncAria(el, false);
        });
      });
    },
    true,
  );

  return {
    setCustomFieldError,
    clearFieldError,
    syncAll(announce = false) {
      formEl.querySelectorAll("input, select, textarea").forEach((el) => syncAria(el, announce));
    },
  };
}
