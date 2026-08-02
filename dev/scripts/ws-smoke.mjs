// Minimal smoke test for the local Desktop WebSocket server (Task 5).
// Usage: node scripts/ws-smoke.mjs (run from dev/, with the Desktop app already running).
// Relies on Node's built-in WebSocket global (stable since Node 22).

const ws = new WebSocket("ws://127.0.0.1:4567");

const timeout = setTimeout(() => {
  console.error("TIMEOUT: no AUTH_OK within 10s");
  process.exit(1);
}, 10_000);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "hello" }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data.toString());
  console.log(msg);

  if (msg.type === "hello.ok") {
    ws.send(JSON.stringify({ type: "auth", token: msg.token }));
  }

  if (msg.type === "auth.ok") {
    console.log("AUTH_OK");
    clearTimeout(timeout);
    ws.close();
    process.exit(0);
  }

  if (msg.type === "auth.fail") {
    console.error("AUTH_FAIL:", msg.error);
    clearTimeout(timeout);
    process.exit(1);
  }
});

ws.addEventListener("error", (event) => {
  console.error("WS error:", event.message ?? event);
  clearTimeout(timeout);
  process.exit(1);
});
