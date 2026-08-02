// MV3 service worker entry point.
//
// Note (WS fallback): a MV3 service worker can be killed/suspended by the
// browser at any time, which would drop a persistent WebSocket connection to
// the local desktop bridge (127.0.0.1:4567). `host_permissions` above already
// covers that origin, and modern Chrome (116+) extends the SW's lifetime for
// as long as a WebSocket it opened stays connected, which is what
// `ws-client.ts` relies on today. If that proves unreliable in practice, the
// WS client should be moved into a MV3 "offscreen document" (a persistent,
// DOM-capable page the SW can keep alive) instead of living directly in the
// service worker — `ws-client.ts`'s public API (`connectAndAuth`/`send`) was
// kept small so that migration wouldn't require touching its callers.
import { connectAndAuth } from "./ws-client";
import { flushQueue } from "./queue";
import { requestDownload, requestFormats } from "./popup-handlers";
import { isPopupRequest } from "./popup-messages";

console.log("LiMBo SW");

// Popup -> SW messaging (see `popup-messages.ts`): `sendResponse` is called
// asynchronously in both cases, hence returning `true` to keep the channel
// open per the `chrome.runtime.onMessage` contract.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPopupRequest(message)) {
    return false;
  }

  if (message.type === "popup.formats") {
    void requestFormats(message.url).then(sendResponse);
    return true;
  }

  void requestDownload(message.payload).then(sendResponse);
  return true;
});

const RECONNECT_ALARM = "limbo-ws-reconnect";

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

// Belt-and-suspenders reconnect: covers the case where the desktop app was
// off when the SW last woke up and no other event (message, alarm-triggered
// enqueue, etc.) has retried since.
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    void bootstrap();
  }
});

async function bootstrap(): Promise<void> {
  try {
    await connectAndAuth();
    await flushQueue();
  } catch (err) {
    console.warn("[LiMBo] background: connectAndAuth failed", err);
  }
}

void bootstrap();
