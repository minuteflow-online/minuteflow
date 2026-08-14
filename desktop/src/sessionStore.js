/**
 * Simple file-based storage adapter for @supabase/supabase-js's auth persistence.
 *
 * supabase-js expects a storage object with getItem/setItem/removeItem (same
 * shape as window.localStorage). In Electron's main process there is no
 * localStorage, so we back it with a small JSON file in the app's userData
 * directory. This lets a login survive relaunching the app.
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function getStorePath() {
  return path.join(app.getPath("userData"), "mf-session-store.json");
}

function readStore() {
  try {
    const raw = fs.readFileSync(getStorePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(getStorePath()), { recursive: true });
  fs.writeFileSync(getStorePath(), JSON.stringify(store), "utf-8");
}

const fileStorageAdapter = {
  getItem(key) {
    const store = readStore();
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  },
  setItem(key, value) {
    const store = readStore();
    store[key] = value;
    writeStore(store);
  },
  removeItem(key) {
    const store = readStore();
    delete store[key];
    writeStore(store);
  },
};

module.exports = { fileStorageAdapter };
