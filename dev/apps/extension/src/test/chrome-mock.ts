import { vi } from "vitest";

type AnyRecord = Record<string, unknown>;

const localStore: AnyRecord = {};
const sessionStore: AnyRecord = {};

/**
 * Minimal `chrome.*` stub covering every API the extension modules touch under test. Installed
 * globally (see `vitest.config.ts` → `setupFiles`) so suites don't each have to re-declare it.
 *
 * Individual tests can override a single method (e.g. `chrome.cookies.getAll`) with a `vi.fn()`
 * to drive specific behaviour; `vi.clearAllMocks()` between tests keeps the default
 * implementations intact (only recorded calls are cleared).
 */
export function installChromeMock(): void {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
        set: vi.fn(async (values: AnyRecord) => {
          Object.assign(localStore, values);
        }),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
        set: vi.fn(async (values: AnyRecord) => {
          Object.assign(sessionStore, values);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStore[key];
        }),
      },
    },
    cookies: {
      getAll: vi.fn(async () => []),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
  });
}

/** Empties the in-memory `storage.local` / `storage.session` backends between tests. */
export function resetChromeStores(): void {
  for (const key of Object.keys(localStore)) delete localStore[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
}

installChromeMock();
