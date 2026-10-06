/**
 * slip.gs
 * Slip upload, text reading (OCR) and slip image storage in Drive.
 *
 * Flow:
 *   1. readSlip_()      saves the image to Drive/_pending, reads it, returns a draft
 *   2. saveTransaction_() moves the image to Drive/YYYY-MM and renames it
 *      or discardSlip_() throws it away if you skip it
 */

/**
 * payload: { base64, mimeType, qrText }
 * returns: { fileId, draft, duplicate, ocrError }
 *   duplicate: null, or the matching saved transaction plus match: 'ref' (same slip, already saved)
 *              or 'datetime' (possible duplicate: same date, time and amount)
 */
function readSlip_(payload) {
  if (!payload || !payload.base64) throw new Error('No image received.');
  var blob = Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType || 'image/jpeg', 'slip.jpg');

  var pending = pendingFolder_();
  var file = pending.createFile(blob).setName('pending_' + formatDate_(new Date(), 'yyyyMMdd_HHmmss') + '.jpg');

  var qr = parseSlipQr(payload.qrText);
  var text = '';
  var ocrError = '';
  try {
    text = ocrImage_(blob, pending.getId());
  } catch (e) {
    ocrError = String(e && e.message || e);
  }

  var draft = parseSlipText(text, qr);
  draft.category = guessCategory(draft.payee, draft.categoryHint, readTable_('rules'));

  // Match the slip's bank to one of your accounts
  var accounts = readTable_('accounts');
  var acc = accounts.filter(function (a) { return draft.bank && a.name.toLowerCase() === draft.bank.toLowerCase(); })[0];
  draft.account = acc ? acc.name : '';
  draft.method = acc ? (acc.default_method || 'PromptPay') : 'PromptPay';

  var dup = findDuplicate_(draft.ref, draft.date, draft.time, draft.amount, '');

  return {
    fileId: file.getId(),
    draft: draft,
    duplicate: dup ? Object.assign({ match: dup.match }, dup.tx) : null,
    ocrError: ocrError
  };
}

/** Throws away a slip image you skipped on the review screen. Only touches _pending files. */
function discardSlip_(fileId) {
  if (!fileId) return false;
  var file = DriveApp.getFileById(fileId);
  var pendingId = pendingFolder_().getId();
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === pendingId) { file.setTrashed(true); return true; }
  }
  return false;
}

/** Returns a slip image as a data URL so the app can show it. */
function getSlipImage_(slipUrlOrId) {
  var id = fileIdFromUrl_(slipUrlOrId) || slipUrlOrId;
  var blob = DriveApp.getFileById(id).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ------------------------------------------------------------------ */

/**
 * Google Drive OCR: uploading an image as a Google Doc makes Drive read its text.
 * Needs the "Drive API" advanced service (already listed in appsscript.json).
 */
function ocrImage_(blob, folderId) {
  var doc = Drive.Files.create(
    { name: 'ocr_tmp_' + Date.now(), mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
    blob,
    { ocrLanguage: 'th', fields: 'id' }
  );
  try {
    return DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    try { DriveApp.getFileById(doc.id).setTrashed(true); } catch (e) { /* ignore */ }
  }
}

/** Moves a pending slip into its month folder and gives it a readable name. */
function fileSlip_(fileId, tx) {
  var file = DriveApp.getFileById(fileId);
  var month = monthFolder_(tx.date.slice(0, 7));
  var name = [tx.date, (tx.time || '').replace(':', ''), tx.amount.toFixed(2), tx.payee || tx.person || tx.type]
    .filter(String).join('_').replace(/[\\\/:*?"<>|]/g, '').slice(0, 120) + '.jpg';
  file.setName(name);
  file.moveTo(month);
  return file.getUrl();
}

function rootFolder_() {
  return DriveApp.getFolderById(CONFIG.SLIP_FOLDER_ID);
}

function childFolder_(name) {
  var root = rootFolder_();
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function pendingFolder_() { return childFolder_(CONFIG.PENDING_FOLDER_NAME); }
function monthFolder_(yyyyMm) { return childFolder_(yyyyMm); }

function fileIdFromUrl_(url) {
  var m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})|[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? (m[1] || m[2]) : '';
}
