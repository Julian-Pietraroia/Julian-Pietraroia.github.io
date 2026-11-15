/**
 * Stomp Pad Studio: dataset collector (Google Apps Script web app).
 *
 * Receives opt-in submissions from the website and stores each one in your Google Drive:
 *   Stomp Pad Dataset/
 *     images/<id>.jpg      the board photo (max 1024 px)
 *     labels/<id>.json     nose/tail/waist points + board outline (normalised 0..1),
 *                          the detector's automatic guess, board length and waist
 *     Stomp Pad Dataset (sheet)   one row per submission, for quick stats
 *
 * Setup: see data/README.md. Deploy as a web app with "Execute as: Me" and
 * "Who has access: Anyone", then paste the /exec URL into DATA_ENDPOINT in index.html.
 */

const ROOT_NAME = 'Stomp Pad Dataset';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;   // ignore anything absurdly large

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.v !== 1 || !d.image || !d.final || !Array.isArray(d.final.outline)) return out_('bad request');
    const bytes = Utilities.base64Decode(d.image);
    if (bytes.length > MAX_IMAGE_BYTES) return out_('too large');

    const root = folder_(DriveApp.getRootFolder(), ROOT_NAME);
    const images = folder_(root, 'images'), labels = folder_(root, 'labels');
    const id = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss") + '_' + Utilities.getUuid().slice(0, 8);

    images.createFile(Utilities.newBlob(bytes, 'image/jpeg', id + '.jpg'));
    delete d.image;
    d.id = id;
    d.received = new Date().toISOString();
    labels.createFile(id + '.json', JSON.stringify(d), MimeType.PLAIN_TEXT);

    sheet_(root).appendRow([d.received, id, d.lengthCm, d.waistMm, d.auto ? d.auto.waistMm : '', d.corrected, d.method, d.detector, d.imgW + 'x' + d.imgH]);
    return out_('ok');
  } catch (err) {
    return out_('error: ' + err);
  }
}

function doGet() { return out_('Stomp Pad dataset collector is running.'); }

function out_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }

function folder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function sheet_(root) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) { id = null; } }
  const ss = SpreadsheetApp.create(ROOT_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  const sh = ss.getSheets()[0];
  sh.appendRow(['received', 'id', 'length_cm', 'waist_mm', 'auto_waist_mm', 'user_corrected', 'method', 'detector', 'image_size']);
  sh.setFrozenRows(1);
  props.setProperty('SHEET_ID', ss.getId());
  return sh;
}
