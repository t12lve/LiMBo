// Minimal smoke test for the local Desktop WebSocket server (Tasks 5-6).
// Usage: node scripts/ws-smoke.mjs [youtubeUrl] (run from dev/, with the Desktop app already running).
// Relies on Node's built-in WebSocket global (stable since Node 22).
//
// Flow: hello -> hello.ok -> auth -> auth.ok -> formats.list -> formats.result | formats.error.
// Defaults to a short public YouTube video ("Me at the zoo") so the smoke run stays fast.

const YOUTUBE_URL = process.argv[2] ?? "https://www.youtube.com/watch?v=jNQXAC9IVRw";

const ws = new WebSocket("ws://127.0.0.1:4567");

// yt-dlp has to resolve YouTube's player + fetch metadata over the network, so give it more
// room than the plain hello/auth handshake.
const timeout = setTimeout(() => {
  console.error("TIMEOUT: smoke test did not complete within 45s");
  process.exit(1);
}, 45_000);

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
  }

  if (msg.type === "jobs.snapshot") {
    ws.send(JSON.stringify({ type: "formats.list", url: YOUTUBE_URL }));
  }

  if (msg.type === "auth.fail") {
    console.error("AUTH_FAIL:", msg.error);
    clearTimeout(timeout);
    process.exit(1);
  }

  if (msg.type === "formats.result") {
    console.log(`FORMATS_OK: ${msg.formats.length} format(s), title="${msg.title}"`);
    clearTimeout(timeout);
    ws.close();
    process.exit(msg.formats.length > 0 ? 0 : 1);
  }

  if (msg.type === "formats.error") {
    console.error("FORMATS_ERROR:", msg.error);
    clearTimeout(timeout);
    ws.close();
    process.exit(1);
  }
});

ws.addEventListener("error", (event) => {
  console.error("WS error:", event.message ?? event);
  clearTimeout(timeout);
  process.exit(1);
});
