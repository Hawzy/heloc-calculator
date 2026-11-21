/**
 * Safe `localStorage` persistence for user-saved scenarios.
 */

import { DEFAULT_SCENARIO } from "./state.js";

export const STORAGE_KEY = "heloc-calculator:presets:v1";
const MAX_PRESETS = 25;

function getDefaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function sanitizeName(raw) {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Load saved scenarios safely from `localStorage`.
 *
 * @param {Storage | null} [storage=getDefaultStorage()]
 * @returns {Array<{ id: string, name: string, savedAt: string, params: Record<string, unknown> }>}
 */
export function loadSavedPresets(storage = getDefaultStorage()) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        item.params &&
        typeof item.params === "object",
    );
  } catch {
    return [];
  }
}

/**
 * Save a named scenario to `localStorage`.
 *
 * @param {Storage | null} storage
 * @param {string} rawName
 * @param {Record<string, unknown>} params
 * @returns {{ presets: Array<Record<string, unknown>>, saved: Record<string, unknown> | null, error: string | null }}
 */
export function savePreset(storage, rawName, params) {
  const store = storage === undefined ? getDefaultStorage() : storage;
  const name = sanitizeName(rawName);
  if (!name) {
    return {
      presets: loadSavedPresets(store),
      saved: null,
      error: "Please enter a name for the preset.",
    };
  }
  if (!store) {
    return {
      presets: [],
      saved: null,
      error: "Browser storage is unavailable in this context.",
    };
  }

  const existing = loadSavedPresets(store);
  const entry = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    savedAt: new Date().toISOString(),
    params: {
      ...DEFAULT_SCENARIO,
      ...params,
      custom_rates: Array.isArray(params?.custom_rates) ? [...params.custom_rates] : null,
      cash_flow_events: Array.isArray(params?.cash_flow_events)
        ? params.cash_flow_events.map((ev) => ({ ...ev }))
        : [],
    },
  };

  const next = [entry, ...existing.filter((p) => p.name.toLowerCase() !== name.toLowerCase())].slice(
    0,
    MAX_PRESETS,
  );

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
    return { presets: next, saved: entry, error: null };
  } catch {
    return {
      presets: existing,
      saved: null,
      error: "Unable to save preset: browser storage is blocked or full.",
    };
  }
}

/**
 * Delete a saved scenario by ID from `localStorage`.
 *
 * @param {Storage | null} storage
 * @param {string} id
 * @returns {{ presets: Array<Record<string, unknown>>, error: string | null }}
 */
export function deletePreset(storage, id) {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return { presets: [], error: "Browser storage is unavailable in this context." };
  }
  const existing = loadSavedPresets(store);
  const next = existing.filter((p) => p.id !== id);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
    return { presets: next, error: null };
  } catch {
    return {
      presets: existing,
      error: "Unable to update saved presets: browser storage is blocked.",
    };
  }
}
