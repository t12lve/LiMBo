// MV3 service worker entry point.
//
// Note (WS fallback): a MV3 service worker can be killed/suspended by the
// browser at any time, which would drop a persistent WebSocket connection to
// the local desktop bridge (127.0.0.1:4567). `host_permissions` above already
// covers that origin, but if this proves unreliable in practice, the WS
// client should be moved into a MV3 "offscreen document" (a persistent,
// DOM-capable page the SW can keep alive) instead of living directly in the
// service worker. That migration is tracked for the ws-client task and is
// intentionally not implemented here.
console.log("LiMBo SW");
