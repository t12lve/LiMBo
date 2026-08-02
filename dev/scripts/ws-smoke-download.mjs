// Smoke test for Task 7's job runner (download.create / job.cancel over the Desktop WebSocket).
// Usage: node scripts/ws-smoke-download.mjs [youtubeUrl] [formatId] (Desktop app must be running).
//
// Flow: hello -> auth -> jobs.snapshot -> formats.list (to pick a format if none given) ->
// download.create (no trim) -> job.created/job.progress*/job.done -> download.create (trim 5-20s)
// -> job.created/job.progress*/job.done. Exits 0 only if both downloads reach job.done.

const YOUTUBE_URL = process.argv[2] ?? "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const REQUESTED_FORMAT = process.argv[3] ?? null;

const ws = new WebSocket("ws://127.0.0.1:4567");

const timeout = setTimeout(() => {
  console.error("TIMEOUT: smoke test did not complete within 120s");
  process.exit(1);
}, 120_000);

let stage = "handshake";
let pickedFormat = REQUESTED_FORMAT;

function fail(msg) {
  console.error(`FAIL (${stage}):`, msg);
  clearTimeout(timeout);
  ws.close();
  process.exit(1);
}

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "hello" }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data.toString());
  console.log(JSON.stringify(msg));

  if (msg.type === "hello.ok") {
    ws.send(JSON.stringify({ type: "auth", token: msg.token }));
  }

  if (msg.type === "auth.fail") {
    fail(msg.error);
  }

  if (msg.type === "jobs.snapshot") {
    if (pickedFormat) {
      startNoTrimDownload();
    } else {
      stage = "formats.list";
      ws.send(JSON.stringify({ type: "formats.list", url: YOUTUBE_URL }));
    }
  }

  if (msg.type === "formats.error") {
    fail(msg.error);
  }

  if (msg.type === "formats.result") {
    const withAudio = msg.formats.find((f) => f.hasAudio && f.hasVideo);
    pickedFormat = (withAudio ?? msg.formats[0])?.formatId;
    if (!pickedFormat) {
      fail("no usable format returned");
    }
    console.log(`PICKED_FORMAT: ${pickedFormat}`);
    startNoTrimDownload();
  }

  if (msg.type === "job.error") {
    fail(`job.error: ${msg.job.error}`);
  }

  if (msg.type === "job.done") {
    if (stage === "download.no-trim") {
      console.log(`NO_TRIM_DONE: job=${msg.job.id} title="${msg.job.title}"`);
      startTrimDownload();
    } else if (stage === "download.trim") {
      console.log(`TRIM_DONE: job=${msg.job.id} title="${msg.job.title}"`);
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  }
});

function startNoTrimDownload() {
  stage = "download.no-trim";
  console.log("STAGE: download.create (no trim)");
  ws.send(
    JSON.stringify({
      type: "download.create",
      url: YOUTUBE_URL,
      formatId: pickedFormat,
    }),
  );
}

function startTrimDownload() {
  stage = "download.trim";
  console.log("STAGE: download.create (trim 5-20s)");
  ws.send(
    JSON.stringify({
      type: "download.create",
      url: YOUTUBE_URL,
      formatId: pickedFormat,
      trim: { startSec: 5, endSec: 20 },
    }),
  );
}

ws.addEventListener("error", (event) => {
  fail(event.message ?? event);
});
