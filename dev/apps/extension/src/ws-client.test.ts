import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket } from "./test/fake-websocket";

const mocks = vi.hoisted(() => ({
  flushQueue: vi.fn(async () => {}),
  updateBadge: vi.fn(),
  setDefaultQuality: vi.fn(),
}));

vi.mock("./queue", () => ({ flushQueue: mocks.flushQueue }));
vi.mock("./badge", () => ({ updateBadge: mocks.updateBadge }));
vi.mock("./prefs", () => ({ setDefaultQuality: mocks.setDefaultQuality }));

type WsClient = typeof import("./ws-client");

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

function load(): Promise<WsClient> {
  return import("./ws-client");
}

/** Drives a full hello/auth handshake and returns the (now authenticated) socket. */
async function authenticated(ws: WsClient): Promise<FakeWebSocket> {
  const promise = ws.connectAndAuth();
  const socket = lastSocket();
  socket.open();
  socket.message({ type: "hello.ok", token: "tok-123" });
  socket.message({ type: "auth.ok" });
  await promise;
  return socket;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

describe("connectAndAuth", () => {
  it("runs the hello/auth handshake, stores the token, and flushes the queue", async () => {
    const ws = await load();
    const promise = ws.connectAndAuth();
    const socket = lastSocket();
    socket.open();

    expect(socket.sent[0]).toBe(JSON.stringify({ type: "hello" }));

    socket.message({ type: "hello.ok", token: "tok-123" });
    expect(socket.sent[1]).toBe(JSON.stringify({ type: "auth", token: "tok-123" }));

    socket.message({ type: "auth.ok" });
    await expect(promise).resolves.toBeUndefined();

    expect(ws.isConnected()).toBe(true);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ limboToken: "tok-123" });
    expect(mocks.flushQueue).toHaveBeenCalled();
  });

  it("rejects and closes the socket on auth.fail", async () => {
    const ws = await load();
    const promise = ws.connectAndAuth();
    const socket = lastSocket();
    socket.open();
    socket.message({ type: "hello.ok", token: "tok-123" });

    socket.message({ type: "auth.fail", error: "invalid or missing token" });

    await expect(promise).rejects.toThrow(/auth failed/);
    expect(ws.isConnected()).toBe(false);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("rejects when the bridge is unreachable (constructor throws)", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("desktop offline");
        }
      },
    );
    const ws = await load();

    await expect(ws.connectAndAuth()).rejects.toThrow("desktop offline");
  });

  it("times out when auth.ok never arrives", async () => {
    vi.useFakeTimers();
    try {
      const ws = await load();
      const promise = ws.connectAndAuth();
      const socket = lastSocket();
      socket.open();
      socket.message({ type: "hello.ok", token: "tok-123" });

      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(3000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("send", () => {
  it("forwards a message once authenticated", async () => {
    const ws = await load();
    const socket = await authenticated(ws);

    await ws.send({ type: "job.cancel", id: "abc" });

    expect(socket.sent).toContain(JSON.stringify({ type: "job.cancel", id: "abc" }));
  });

  it("rejects when there is no usable connection", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("nope");
        }
      },
    );
    const ws = await load();

    await expect(ws.send({ type: "hello" })).rejects.toThrow();
  });
});

describe("server-message dispatch", () => {
  it("applies prefs, badge progress, and clears the badge on completion", async () => {
    const ws = await load();
    const socket = await authenticated(ws);

    socket.message({ type: "prefs.snapshot", defaultQuality: "best_sound" });
    expect(mocks.setDefaultQuality).toHaveBeenCalledWith("best_sound");

    socket.message({
      type: "job.progress",
      id: "1",
      percent: 42,
      speed: "1.00MiB/s",
      eta: "00:10",
      phase: "downloading",
    });
    expect(mocks.updateBadge).toHaveBeenCalledWith(42);

    socket.message({
      type: "job.done",
      job: { id: "1", url: "u", title: "t", phase: "done", percent: 100, speed: "", eta: "" },
    });
    expect(mocks.updateBadge).toHaveBeenLastCalledWith("");
  });

  it("delivers messages to subscribers and stops after unsubscribe", async () => {
    const ws = await load();
    const socket = await authenticated(ws);
    const seen: string[] = [];
    const off = ws.onServerMessage((msg) => seen.push(msg.type));

    socket.message({ type: "prefs.snapshot", defaultQuality: "best_image" });
    expect(seen).toEqual(["prefs.snapshot"]);

    off();
    socket.message({ type: "prefs.snapshot", defaultQuality: "best_image" });
    expect(seen).toEqual(["prefs.snapshot"]);
  });

  it("ignores malformed and unknown frames", async () => {
    const ws = await load();
    const socket = await authenticated(ws);
    const handler = vi.fn();
    ws.onServerMessage(handler);

    socket.rawMessage("not json");
    socket.message({ type: "totally-unknown" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("marks the client disconnected when the socket closes", async () => {
    const ws = await load();
    const socket = await authenticated(ws);

    socket.close();

    expect(ws.isConnected()).toBe(false);
  });
});
