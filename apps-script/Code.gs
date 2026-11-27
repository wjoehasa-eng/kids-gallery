/**
 * 가족 미술관 — 구글 시트 + 드라이브 백엔드 (Google Apps Script) v1.0.0
 * =====================================================================
 * 아이들의 작품 사진 원본은 구글 드라이브 폴더에, 목록 정보는 구글 시트에 쌓입니다.
 * 집에서 쓰는 웹앱(index.html)이 이 웹 앱에 접속해 읽고 씁니다.
 *
 * ── 쓰는 법 (한 번만, 약 5분) ─────────────────────────────────────────
 *  1. 구글 드라이브에서 새 스프레드시트를 만듭니다. (예: 「가족미술관 데이터」)
 *  2. 그 시트에서 확장 프로그램 → Apps Script 를 엽니다.
 *  3. 기본 Code.gs 내용을 모두 지우고 이 파일 내용을 그대로 붙여 넣고 저장합니다.
 *  4. 배포 → 새 배포 → 유형(⚙) = 웹 앱
 *       · 설명: 가족미술관 백엔드
 *       · 다음 사용자로 실행: 나
 *       · 액세스 권한: 모든 사용자   ← 폰 브라우저에서 접속하려면 반드시 이 값
 *     → 배포 → 권한 검토/허용(내 계정) → 웹 앱 URL(.../exec) 복사
 *  5. 앱(index.html) ⚙ 설정 → '구글 시트 연결'에 붙여 넣고 [연결하고 불러오기].
 *     연결되면 주소창이 ...index.html#s=<base64> 형태가 됩니다.
 *     그 주소를 즐겨찾기/홈 화면에 넣으면 다음부터 바로 연결됩니다.
 *     가족에게 보내는 관람용 링크는 ...index.html#v=<base64> 입니다.
 *
 *  코드를 고친 뒤에는 반드시 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포.
 *
 * ── 시트 구성 (없으면 자동으로 만듭니다) ──────────────────────────────
 *  · 작품목록 : id | date | year | room | artist | title | memo |
 *               driveFileId | driveUrl | thumbUrl | createdAt | updatedAt
 *      - date  : 전시 날짜(YYYY-MM-DD). 연도·분기(전시실)는 이 날짜에서 정해집니다.
 *      - artist: a1 / a2  (아이 1 / 아이 2)
 *      - year  : 2026 …
 *      - room  : 1~4  (1실 1~3월 · 2실 4~6월 · 3실 7~9월 · 4실 10~12월)
 *  · 설정     : 항목 | 값 | 비고
 *      - museumTitle, artist1, artist2, dadName, momName, kid1Name, kid2Name
 *      - 실제 아이 이름 같은 표시 이름은 여기에만 둡니다. (스크립트·앱 코드에는 없음)
 *
 * ── 드라이브 폴더 ───────────────────────────────────────────────────
 *  가족미술관_작품원본/
 *    2026/
 *      1실_1~3월/  2026-03-02_아이1_무지개마을.jpg
 *      2실_4~6월/  …
 *  → 시트의 driveFileId 로 원본을 찾고, 필요하면 이 폴더에서 통째로 내려받으면 됩니다.
 *
 * ── API ────────────────────────────────────────────────────────────
 *  GET  ?action=ping                     연결 확인 { ok, app, version, now }
 *  GET  ?action=load                     전체 읽기 { ok, settings, artworks:[…], savedAt }
 *  GET  ?callback=함수이름               JSONP 로 감싸서 응답
 *  POST {action:'save', settings, artworks:[…], clear?:true}
 *                                        목록 전체 저장(시트를 이 내용으로 교체)
 *  POST {action:'upload', image:'data:image/jpeg;base64,…', date, year, room, artist, title}
 *                                        원본 사진을 드라이브에 저장 → { fileId, url, thumbUrl }
 *
 * ── 안전장치 ────────────────────────────────────────────────────────
 *  · 저장 요청이 비어 있는데 시트에 기록이 있으면, 기존 기록을 지우지 않고 거부합니다.
 *    정말 전부 지울 때만 clear:true 를 함께 보냅니다.
 *  · 저장 중에는 LockService 로 다른 기기의 동시 저장을 잠급니다.
 *  · 앱에서 작품을 '삭제'해도 드라이브의 원본 사진은 지우지 않습니다(안전).
 *  · 시트에 없는 id는 그대로 두지 않고, 요청에 담긴 목록 기준으로 정리합니다.
 *
 * ── 사진 공유 범위(SHARE_ARTWORK) ───────────────────────────────────
 *  가족이 링크만으로 작품을 보려면 사진 파일이 '링크가 있는 사람 보기'여야 합니다.
 *  기본값 true 는 관람용 링크(#v=)와 같은 수준의 공개입니다(주소를 아는 사람만).
 *  원본을 완전히 비공개로 두고 싶으면 false 로 바꾸세요.
 *  그때는 앱이 기기에 들고 있는 미리보기 사진으로만 보여 줍니다(큰 사진은 흐릿).
 *
 * 개인정보: 이 스크립트는 사용자 본인의 스프레드시트와 드라이브만 읽고 씁니다.
 *           웹 앱 주소(.../exec)를 아는 사람은 이 시트를 읽고 쓸 수 있으니 주소는 비공개로 두세요.
 */

/** 스프레드시트 ID. 시트에 붙인(컨테이너 바인딩) 스크립트라면 비워 두세요.
 *  웹 앱에서 시트를 찾지 못한다는 오류가 나면, 시트 주소의 /d/<ID>/ 부분을 여기에 넣고 다시 배포하세요. */
var SHEET_ID = '';

var BACKEND_VERSION = '1.0.0';
var ROOT_NAME = '가족미술관_작품원본';
var SHARE_ARTWORK = true;
var MAX_IMAGE_BYTES = 12 * 1024 * 1024;

var TABS = { works: '작품목록', settings: '설정' };
var HEAD = ['id', 'date', 'year', 'room', 'artist', 'title', 'memo',
            'driveFileId', 'driveUrl', 'thumbUrl', 'createdAt', 'updatedAt'];
var SETTING_KEYS = ['museumTitle', 'artist1', 'artist2', 'dadName', 'momName', 'kid1Name', 'kid2Name'];
var ROOM_LABEL = { 1: '1실_1~3월', 2: '2실_4~6월', 3: '3실_7~9월', 4: '4실_10~12월' };
var ARTIST_KEY = { a1: '아이1', a2: '아이2' };

/* ------------------------------------------------------------------ 라우팅 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'status';
  var callback = p.callback || '';
  try {
    if (action === 'ping') {
      return out_({ ok: true, app: 'kidsgallery', version: BACKEND_VERSION, now: new Date().toISOString() }, callback);
    }
    if (action === 'load') return out_(loadAll_(), callback);
    return out_({ ok: true, app: 'kidsgallery', version: BACKEND_VERSION, title: ss_().getName() }, callback);
  } catch (err) {
    return out_({ ok: false, error: errText_(err) }, callback);
  }
}

function doPost(e) {
  var req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ ok: false, error: '요청 본문(JSON)을 읽지 못했습니다.' });
  }
  try {
    var action = req.action || 'ping';
    if (action === 'save') return out_(saveAll_(req));
    if (action === 'upload') return out_(uploadImage_(req));
    if (action === 'load') return out_(loadAll_());
    return out_({ ok: true, app: 'kidsgallery', version: BACKEND_VERSION });
  } catch (err) {
    return out_({ ok: false, error: errText_(err) });
  }
}

/** callback이 있으면 JSONP(스크립트)로, 없으면 JSON으로 응답합니다. */
function out_(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errText_(err) {
  return String((err && err.message) || err || '알 수 없는 오류');
}

function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
}

function tab_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function ensureHeader_(sh, headers) {
  var first = sh.getRange(1, 1, 1, Math.max(headers.length, 1)).getValues()[0];
  var empty = true;
  for (var i = 0; i < first.length; i++) if (String(first[i]).length) { empty = false; break; }
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ------------------------------------------------------------------ 읽기 */

function loadAll_() {
  var ss = ss_();
  return {
    ok: true,
    app: 'kidsgallery',
    version: BACKEND_VERSION,
    savedAt: new Date().toISOString(),
    settings: readSettings_(ss),
    artworks: readWorks_(ss)
  };
}

function readSettings_(ss) {
  var sh = ss.getSheetByName(TABS.settings);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) {
    var k = String(v[i][0] || '').trim();
    if (!k) continue;
    out[k] = String(v[i][1] == null ? '' : v[i][1]).trim();
  }
  return out;
}

function readWorks_(ss) {
  var sh = ss.getSheetByName(TABS.works);
  if (!sh || sh.getLastRow() < 2) return [];
  var width = Math.max(HEAD.length, sh.getLastColumn());
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var r = v[i];
    var id = String(r[0] || '').trim();
    if (!id) continue;
    var date = dateStr_(r[1]);
    if (!date) continue;
    out.push({
      id: id,
      date: date,
      artist: String(r[4] || 'a1') === 'a2' ? 'a2' : 'a1',
      title: String(r[5] == null ? '' : r[5]),
      memo: String(r[6] == null ? '' : r[6]),
      driveFileId: String(r[7] == null ? '' : r[7]),
      driveUrl: String(r[8] == null ? '' : r[8]),
      thumbUrl: String(r[9] == null ? '' : r[9]),
      createdAt: String(r[10] == null ? '' : r[10]),
      updatedAt: String(r[11] == null ? '' : r[11])
    });
  }
  out.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  return out;
}

/* ------------------------------------------------------------------ 저장 */

function saveAll_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = ss_();
    var sh = ensureHeader_(tab_(TABS.works, HEAD), HEAD);
    var rows = sh.getLastRow() > 1 ? sh.getLastRow() - 1 : 0;
    var list = Array.isArray(req.artworks) ? req.artworks : null;

    if (!list) return { ok: false, error: '작품 목록(artworks)이 없습니다.' };
    if (!list.length && rows > 0 && req.clear !== true) {
      return {
        ok: false,
        error: '빈 목록으로 기존 기록(' + rows + '건)을 지우지 않았습니다. 정말 지우려면 clear:true 를 보내세요.'
      };
    }

    // 기존 드라이브 정보를 잃지 않도록 id별로 합칩니다(요청에 빈 값이 와도 유지).
    var prev = {};
    if (rows > 0) {
      var old = sh.getRange(2, 1, rows, HEAD.length).getValues();
      for (var i = 0; i < old.length; i++) {
        var oid = String(old[i][0] || '');
        if (oid) prev[oid] = old[i];
      }
    }

    var values = [];
    var now = new Date().toISOString();
    for (var k = 0; k < list.length; k++) {
      var a = list[k] || {};
      var id = String(a.id || '').trim();
      if (!id) continue;
      var date = dateStr_(a.date);
      if (!date) continue;
      var p = prev[id] || [];
      var driveFileId = str_(a.driveFileId) || str_(p[7]);
      var driveUrl = str_(a.driveUrl) || str_(p[8]);
      var thumbUrl = str_(a.thumbUrl) || str_(p[9]);
      values.push([
        id, date, Number(date.slice(0, 4)), quarter_(date),
        (String(a.artist) === 'a2' ? 'a2' : 'a1'),
        str_(a.title) || str_(p[5]), str_(a.memo) || str_(p[6]),
        driveFileId, driveUrl, thumbUrl,
        str_(a.createdAt) || str_(p[10]) || now,
        str_(a.updatedAt) || now
      ]);
    }

    if (rows > 0) sh.getRange(2, 1, rows, HEAD.length).clearContent();
    if (values.length) {
      sh.getRange(2, 1, values.length, HEAD.length).setValues(values);
      sh.getRange(2, 1, values.length, HEAD.length).setNumberFormat('@'); // 날짜/숫자 자동 변환 방지
    }

    writeSettings_(ss, req.settings);
    return { ok: true, saved: values.length, removed: Math.max(0, rows - values.length), savedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function writeSettings_(ss, s) {
  if (!s || typeof s !== 'object') return;
  var sh = tab_(TABS.settings, ['항목', '값', '비고']);
  ensureHeader_(sh, ['항목', '값', '비고']);
  var cur = {};
  var last = sh.getLastRow();
  if (last > 1) {
    var v = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < v.length; i++) cur[String(v[i][0])] = String(v[i][1]);
  }
  var changed = false;
  for (var j = 0; j < SETTING_KEYS.length; j++) {
    var k = SETTING_KEYS[j];
    if (s[k] == null) continue;
    var val = String(s[k]).trim();
    if (!val) continue;
    if (cur[k] !== val) { cur[k] = val; changed = true; }
  }
  if (!changed) return;
  var rowsOut = Object.keys(cur).map(function (k) { return [k, cur[k], '']; });
  // 기존 값 중 우리가 모르는 키(사용자가 직접 적은 항목)도 살립니다.
  if (last > 1) {
    var old = sh.getRange(2, 1, last - 1, 3).getValues();
    var seen = {};
    rowsOut.forEach(function (r) { seen[r[0]] = true; });
    for (var m = 0; m < old.length; m++) {
      var key = String(old[m][0] || '').trim();
      if (!key || seen[key]) continue;
      rowsOut.push([key, old[m][1], old[m][2]]);
    }
  }
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  sh.getRange(2, 1, rowsOut.length, 3).setValues(rowsOut);
}

/* ------------------------------------------------------------------ 사진 저장 */

function uploadImage_(req) {
  var dataUrl = String(req.image || '');
  var m = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([\s\S]+)$/i);
  if (!m) return { ok: false, error: '이미지 데이터 형식이 올바르지 않습니다.' };

  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: '사진이 너무 큽니다(최대 12MB).' };
  }

  var date = dateStr_(req.date) || dateStr_(new Date());
  var year = Number(req.year) || Number(date.slice(0, 4));
  var room = Number(req.room) || quarter_(date);
  if (room < 1 || room > 4) room = quarter_(date);
  var artist = String(req.artist) === 'a2' ? 'a2' : 'a1';

  var folder = folderFor_(year, room);
  var ext = m[1].toLowerCase() === 'png' ? 'png' : (m[1].toLowerCase() === 'webp' ? 'webp' : 'jpg');
  var name = date + '_' + ARTIST_KEY[artist] + '_' + safeName_(req.title || '작품') + '.' + ext;

  var blob = Utilities.newBlob(bytes, 'image/' + (ext === 'jpg' ? 'jpeg' : ext), name);
  var file = folder.createFile(blob);
  if (SHARE_ARTWORK) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  }
  var id = file.getId();
  return {
    ok: true,
    fileId: id,
    name: name,
    folder: folder.getName(),
    url: 'https://drive.google.com/file/d/' + id + '/view',
    thumbUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200'
  };
}

function folderFor_(year, room) {
  var root = rootFolder_();
  var y = childFolder_(root, String(year));
  return childFolder_(y, ROOM_LABEL[room] || ROOM_LABEL[1]);
}

function rootFolder_() {
  var it = DriveApp.getFoldersByName(ROOT_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function safeName_(s) {
  var t = String(s || '').replace(/[\\\/:*?"<>|\n\r\t#%]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 40) t = t.slice(0, 40);
  return t || '작품';
}

/* ------------------------------------------------------------------ 도우미 */

function quarter_(date) {
  var m = Number(date.slice(5, 7));
  return Math.floor((m - 1) / 3) + 1;
}

function dateStr_(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return '';
}

function str_(v) { return v == null ? '' : String(v); }

/* ------------------------------------------------------------------ 처음 한 번 (선택) */

/** 시트에 두 탭을 미리 만들고 싶을 때 편집기에서 한 번 실행하세요. */
function setupSheets() {
  tab_(TABS.works, HEAD);
  tab_(TABS.settings, ['항목', '값', '비고']);
  var sh = ss_().getSheetByName(TABS.settings);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, 3, 3).setValues([
      ['museumTitle', '우리 가족 미술관', '앱 위쪽에 보이는 이름'],
      ['artist1', '아이 1', '작가 표시 이름'],
      ['artist2', '아이 2', '작가 표시 이름']
    ]);
  }
  return { ok: true, version: BACKEND_VERSION };
}
