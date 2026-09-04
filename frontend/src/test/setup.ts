// Vitest global setup (registered in vite.config.ts as `test.setupFiles`).
//
// Why this exists: Node 22 defines its own experimental `localStorage` getter on
// globalThis which resolves to `undefined` unless the process was started with
// `--localstorage-file`. Vitest's happy-dom environment only copies a window
// property onto globalThis when the key is absent, and Node's getter makes
// `'localStorage' in globalThis` true — so happy-dom's real Storage never lands
// and every `localStorage.getItem(...)` in app code throws
// "Cannot read properties of undefined (reading 'getItem')".
//
// Rather than have each test file install its own shim, give the whole suite one
// spec-shaped in-memory Storage. This file runs once per test file, so each file
// starts from an empty store.

class MemoryStorage implements Storage {
  #store = new Map<string, string>();

  get length(): number {
    return this.#store.size;
  }

  key(index: number): string | null {
    return Array.from(this.#store.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    const v = this.#store.get(String(key));
    return v === undefined ? null : v;
  }

  setItem(key: string, value: string): void {
    this.#store.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.#store.delete(String(key));
  }

  clear(): void {
    this.#store.clear();
  }
}

function install(name: 'localStorage' | 'sessionStorage') {
  const existing = (globalThis as Record<string, unknown>)[name];
  // A real Storage (happy-dom's, if a future version wins the race) is left alone.
  if (existing && typeof (existing as Storage).getItem === 'function') return;
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

install('localStorage');
install('sessionStorage');
