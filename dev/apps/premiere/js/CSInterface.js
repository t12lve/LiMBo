/**
 * Minimal CSInterface for CEP panels (Adobe Premiere Pro).
 * Enough for evalScript + getSystemPath — not a full Adobe SDK copy.
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (callback === null || callback === undefined) {
    callback = function () {};
  }
  if (window.__adobe_cep__) {
    window.__adobe_cep__.evalScript(script, callback);
  } else {
    callback('{"ok":false,"error":"CEP runtime missing"}');
  }
};

CSInterface.prototype.getSystemPath = function (pathType) {
  if (!window.__adobe_cep__) return "";
  var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
  if (navigator.platform.toUpperCase().indexOf("WIN") >= 0) {
    path = path.replace("file:///", "");
  } else if (path.indexOf("file://") === 0) {
    path = path.replace("file://", "");
  }
  return path;
};

CSInterface.SystemPath = {
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  MY_DOCUMENTS: "myDocuments",
  APPLICATION: "application",
  EXTENSION: "extension",
  HOST_APPLICATION: "hostApplication",
};
