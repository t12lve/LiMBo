/**
 * LiMBO-premiere — ExtendScript host for Adobe Premiere Pro.
 * Import a downloaded media file into bin "LiMBo".
 * If a sequence is active: insert on a new track.
 * If none: create a sequence from the clip (import still succeeds).
 *
 * Modes: son → audio track; video / combo → video track (linked audio for combo).
 */
function limboFindOrCreateBin(name) {
  var root = app.project.rootItem;
  var i;
  for (i = 0; i < root.children.numItems; i++) {
    var child = root.children[i];
    if (child.name === name && child.type === ProjectItemType.BIN) {
      return child;
    }
  }
  return root.createBin(name);
}

function limboFindImportedItem(bin, filePath) {
  var base = File(filePath).name;
  var i;
  for (i = 0; i < bin.children.numItems; i++) {
    var child = bin.children[i];
    if (child.name === base) {
      return child;
    }
  }
  if (bin.children.numItems > 0) {
    return bin.children[bin.children.numItems - 1];
  }
  return null;
}

function limboModeBase(mode) {
  var m = String(mode || "combo");
  if (m.indexOf("_trimmed") === m.length - 8) {
    m = m.substring(0, m.length - 8);
  }
  return m;
}

function limboSeqNameFromItem(item) {
  var name = String(item.name || "LiMBo");
  var dot = name.lastIndexOf(".");
  if (dot > 0) {
    name = name.substring(0, dot);
  }
  if (!name) {
    name = "LiMBo";
  }
  return name;
}

/**
 * @param {string} filePath Absolute path to media
 * @param {string} mode combo | son | video | *_trimmed
 * @returns {string} JSON { ok, error?, createdSequence? }
 */
function limboImport(filePath, mode) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "Aucun projet ouvert" });
    }

    var f = new File(filePath);
    if (!f.exists) {
      return JSON.stringify({ ok: false, error: "Fichier introuvable: " + filePath });
    }

    var bin = limboFindOrCreateBin("LiMBo");
    var ok = app.project.importFiles([f.fsName], true, bin, false);
    if (!ok) {
      return JSON.stringify({ ok: false, error: "importFiles a échoué" });
    }

    var item = limboFindImportedItem(bin, f.fsName);
    if (!item) {
      return JSON.stringify({ ok: false, error: "Élément projet introuvable après import" });
    }

    var seq = app.project.activeSequence;
    if (!seq) {
      app.project.createNewSequenceFromClips(limboSeqNameFromItem(item), [item], bin);
      return JSON.stringify({ ok: true, createdSequence: true });
    }

    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var t = seq.getPlayerPosition();
    var base = limboModeBase(mode);

    if (base === "son") {
      qeSeq.addTracks(0, 0, 1, seq.audioTracks.numTracks);
      var aIdx = seq.audioTracks.numTracks - 1;
      seq.audioTracks[aIdx].insertClip(item, t);
    } else {
      // video or combo — new V track; linked audio comes with combo files
      qeSeq.addTracks(1, seq.videoTracks.numTracks, 0, 0);
      var vIdx = seq.videoTracks.numTracks - 1;
      seq.videoTracks[vIdx].insertClip(item, t);
    }

    return JSON.stringify({ ok: true, createdSequence: false });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}
