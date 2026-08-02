import { beforeEach, describe, expect, test, vi } from "vitest";

type Listener = (event: { data?: unknown }) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  readonly listeners = new Map<string, Listener[]>();
  readyState = MockWebSocket.OPEN;

  constructor() {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(): void {}

  close(): void {
    this.emit("close");
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }
}

const session: Record<string, unknown> = {};
const tabsCreate = vi.fn().mockResolvedValue({ id: 42 });
const tabsUpdate = vi.fn().mockResolvedValue({ id: 42 });
const tabsRemove = vi.fn().mockResolvedValue(undefined);

function installChromeMock(): void {
  vi.stubGlobal("chrome", {
    storage: {
      local: { set: vi.fn().mockResolvedValue(undefined) },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: session[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(session, values)),
        remove: vi.fn(async (key: string) => {
          delete session[key];
        }),
      },
    },
    tabs: { create: tabsCreate, update: tabsUpdate, remove: tabsRemove },
  });
}

describe("ws-client fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    for (const key of Object.keys(session)) delete session[key];
    installChromeMock();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  test("opens Limbo after a WebSocket closes post-authentication", async () => {
    const { connectAndAuth } = await import("../../../apps/extension/src/ws-client");
    const connected = connectAndAuth();
    const ws = MockWebSocket.instances[0];
    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "auth.ok" }));
    await connected;

    ws.emit("close");

    await vi.waitFor(() =>
      expect(tabsCreate).toHaveBeenCalledWith({ url: "limbo://open", active: false }),
    );
  });

  test("uses the persisted cooldown after a service worker restart", async () => {
    const { connectAndAuth } = await import("../../../apps/extension/src/ws-client");
    const connected = connectAndAuth();
    const ws = MockWebSocket.instances[0];
    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "auth.ok" }));
    await connected;
    ws.emit("close");
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalledTimes(1));

    vi.resetModules();
    vi.stubGlobal("WebSocket", class {
      constructor() {
        throw new Error("desktop offline");
      }
    });
    const restartedClient = await import("../../../apps/extension/src/ws-client");

    await expect(restartedClient.connectAndAuth()).rejects.toThrow("desktop offline");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tabsCreate).toHaveBeenCalledTimes(1);
  });
});
