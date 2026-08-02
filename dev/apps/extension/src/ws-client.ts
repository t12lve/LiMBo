// WebSocket client for the local desktop bridge (127.0.0.1:4567).
//
// Handshake (mirrors `dev/apps/desktop/src-tauri/src/ws_server.rs`):
//   1. client -> { type: "hello" }
//   2. server -> { type: "hello.ok", token }        (token persisted to chrome.storage.local)
//   3. client -> { type: "auth", token }
//   4. server -> { type: "auth.ok" } | { type: "auth.fail", error }
//
// Runs directly inside the MV3 service worker: modern Chrome (116+) extends
// the SW lifetime for as long as a WebSocket stays open. If that proves
// unreliable in practice, move this module behind an offscreen document
// (see the note in `background.ts`) without changing its public API.
import { WS_URL, PROTOCOL_URL } from "@limbo/shared";
import type { WsClientMessage, WsServerMessage } from "@limbo/shared";
import { isWsServerMessage } from "@limbo/shared";
import { updateBadge } from "./badge";
import { flushQueue } from "./queue";

const TOKEN_STORAGE_KEY = "limboToken";
const LIMBO_OPEN_STORAGE_KEY = "limboOpenAt";
const CONNECT_TIMEOUT_MS = 3000;
const LIMBO_OPEN_COOLDOWN_MS = 5000;

type ServerMessageHandler = (msg: WsServerMessage) => void;

let socket: WebSocket | null = null;
let authenticated = false;
let inFlight: Promise<void> | null = null;
let lastLimboOpenAt = 0;

const messageHandlers = new Set<ServerMessageHandler>();

export function onServerMessage(handler: ServerMessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function isConnected(): boolean {
  return authenticated && socket?.readyState === WebSocket.OPEN;
}

/** Connects (if needed), performs the hello/auth handshake, and resolves once `auth.ok` is received. */
export function connectAndAuth(): Promise<void> {
  if (isConnected()) {
    return Promise.resolve();
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      inFlight = null;
      action();
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      maybeOpenLimboFallback();
      reject(toError(err));
      return;
    }

    timeoutId = setTimeout(() => {
      ws.close();
      settle(() => {
        maybeOpenLimboFallback();
        reject(new Error("connectAndAuth: timed out waiting for auth.ok"));
      });
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      sendRaw(ws, { type: "hello" });
    });

    ws.addEventListener("message", (event) => {
      const parsed = parseServerMessage(event.data);
      if (!parsed) return;

      if (parsed.type === "hello.ok") {
        void chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: parsed.token });
        sendRaw(ws, { type: "auth", token: parsed.token });
        return;
      }

      if (parsed.type === "auth.ok") {
        authenticated = true;
        socket = ws;
        console.log("[LiMBo] ws-client: auth.ok");
        settle(resolve);
        void flushQueue();
        dispatch(parsed);
        return;
      }

      if (parsed.type === "auth.fail") {
        console.warn("[LiMBo] ws-client: auth.fail", parsed.error);
        settle(() => {
          maybeOpenLimboFallback();
          reject(new Error(`connectAndAuth: auth failed (${parsed.error})`));
        });
        ws.close();
        return;
      }

      dispatch(parsed);
    });

    ws.addEventListener("close", () => {
      const wasAuthenticated = socket === ws && authenticated;
      if (socket === ws) {
        socket = null;
      }
      authenticated = false;
      if (wasAuthenticated) {
        console.warn("[LiMBo] ws-client: connection closed");
        void openDesktopIfNeeded();
      }
      settle(() => {
        maybeOpenLimboFallback();
        reject(new Error("connectAndAuth: connection closed before auth.ok"));
      });
    });

    ws.addEventListener("error", () => {
      settle(() => {
        maybeOpenLimboFallback();
        reject(new Error("connectAndAuth: websocket error"));
      });
    });
  });

  return inFlight;
}

/** Ensures an authenticated connection, then sends `msg`. Throws if the connection is unavailable. */
export async function send(msg: WsClientMessage): Promise<void> {
  await connectAndAuth();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("send: no active connection");
  }
  sendRaw(socket, msg);
}

function dispatch(msg: WsServerMessage): void {
  if (msg.type === "job.progress") {
    updateBadge(msg.percent);
  } else if (msg.type === "job.done" || msg.type === "job.error") {
    updateBadge("");
  }
  for (const handler of messageHandlers) {
    handler(msg);
  }
}

function sendRaw(ws: WebSocket, msg: WsClientMessage): void {
  ws.send(JSON.stringify(msg));
}

function parseServerMessage(data: unknown): WsServerMessage | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  return isWsServerMessage(parsed) ? parsed : null;
}

/** Opens the desktop app via the `limbo://open` deep link, at most once per cooldown window. */
function maybeOpenLimboFallback(): void {
  void openDesktopIfNeeded();
}

async function openDesktopIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastLimboOpenAt < LIMBO_OPEN_COOLDOWN_MS) {
    return;
  }
  lastLimboOpenAt = now;

  try {
    const stored = await chrome.storage.session.get(LIMBO_OPEN_STORAGE_KEY);
    const persistedAt = stored[LIMBO_OPEN_STORAGE_KEY];
    if (
      typeof persistedAt === "number" &&
      now - persistedAt < LIMBO_OPEN_COOLDOWN_MS
    ) {
      lastLimboOpenAt = persistedAt;
      return;
    }
    await chrome.storage.session.set({ [LIMBO_OPEN_STORAGE_KEY]: now });
  } catch (err) {
    console.warn("[LiMBo] ws-client: failed to persist limbo:// cooldown", err);
  }

  console.warn("[LiMBo] ws-client: desktop unreachable, opening", PROTOCOL_URL);
  try {
    const storedTab = await chrome.storage.session.get("limboTabId");
    const existingId =
      typeof storedTab.limboTabId === "number" ? storedTab.limboTabId : null;

    let tabId: number | null = null;
    if (existingId !== null) {
      try {
        await chrome.tabs.update(existingId, { url: PROTOCOL_URL, active: false });
        tabId = existingId;
      } catch {
        tabId = null;
      }
    }

    if (tabId === null) {
      const tab = await chrome.tabs.create({ url: PROTOCOL_URL, active: false });
      tabId = tab.id ?? null;
      if (tabId !== null) {
        await chrome.storage.session.set({ limboTabId: tabId });
      }
    }

    if (tabId !== null) {
      const idToClose = tabId;
      setTimeout(() => {
        chrome.tabs.remove(idToClose).catch(() => {});
        void chrome.storage.session.remove("limboTabId");
      }, 1200);
    }
  } catch (err) {
    console.warn("[LiMBo] ws-client: failed to open limbo:// fallback", err);
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
