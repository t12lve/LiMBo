type Listener = (event: { data?: unknown }) => void;

/**
 * Controllable WebSocket stand-in for the extension's `ws-client` tests. It records every frame
 * the client sends and lets a test drive the open/message/close/error lifecycle deterministically
 * (no real sockets, no timing flakiness).
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("FakeWebSocket: send on a non-open socket");
    }
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  /** Test helper: the socket is now open (client's `open` handler fires). */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  /** Test helper: deliver a JSON server frame. */
  message(payload: unknown): void {
    this.emit("message", JSON.stringify(payload));
  }

  /** Test helper: deliver a raw (possibly malformed) frame. */
  rawMessage(data: unknown): void {
    this.emit("message", data);
  }

  /** Test helper: deliver an error event. */
  fail(): void {
    this.emit("error");
  }

  private emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }
}
