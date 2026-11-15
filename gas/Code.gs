/**
 * ミートチーム ポータル — 作業予定の保存・配信・Slack投稿
 *
 * 【スクリプトプロパティ】（プロジェクトの設定 → スクリプト プロパティ）
 *   SHEET_ID          … 保存用スプレッドシート（初回に自動作成・自動設定）
 *   UPLOAD_PIN        … 抽出アプリから保存するときの暗証番号（例：4桁）
 *   SLACK_BOT_TOKEN   … 既存の Slack Bot トークン（xoxb-…）
 *   SLACK_CHANNEL     … 投稿先チャンネルID（#110 = C05G46NECKV）
 *   APP_URL           … 共有アプリのURL（Slack投稿のリンク用）
 *   SLACK_DAY_OFFSET  … 6:50の投稿で何日後の予定を出すか（0=当日 / 1=翌日、未設定は0）
 *
 * 【デプロイ】ウェブアプリ / 実行ユーザー：自分 / アクセス：全員
 * ※ ES5 で記述（var・for ループのみ）
 */

var SHEET_NAME = 'plans';
var CHUNK = 40000; // 1セル 50,000 文字制限への対策で分割保存
var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// ============================================================
//  受信（抽出アプリ → hidden form + iframe POST）
// ============================================================
function doPost(e) {
  var p = (e && e.parameter) || {};
  var result;
  try {
    var pin = PropertiesService.getScriptProperties().getProperty('UPLOAD_PIN');
    if (!pin || String(p.pin) !== String(pin)) throw new Error('暗証番号が違います');
    var plan = JSON.parse(p.payload || '');
    if (!plan || !plan.date || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) throw new Error('日付が不正です');
    savePlan_(plan);
    result = { ok: true, date: plan.date };
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  // 親ページ（抽出アプリ）へ結果を通知
  var html = '<script>try{window.top.postMessage(' + JSON.stringify({ meatPortal: result }) +
    ',"*");}catch(e){}</script>' + (result.ok ? '保存しました' : 'エラー：' + result.error);
  return HtmlService.createHtmlOutput(html);
}

// ============================================================
//  配信（共有アプリ → fetch / JSONP）
//    ?action=list                 … 保存済みの日付一覧
//    ?action=get&date=YYYY-MM-DD  … 作業予定（date 省略時は今日以降で一番近い日）
//    ?action=slack&date=…         … Slack用テキスト（既存まとめBotから呼ぶ用）
// ============================================================
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'get';
  var body;
  try {
    if (action === 'list') {
      body = { ok: true, dates: listPlans_() };
    } else if (action === 'slack') {
      var d = p.date || dateStr_(addDays_(new Date(), Number(p.offset || 0)));
      var plan = loadPlan_(d);
      body = { ok: true, date: d, text: plan ? buildSlackText_(plan) : '' };
    } else {
      var date = p.date || pickDefaultDate_();
      body = { ok: true, date: date, plan: date ? loadPlan_(date) : null, dates: listPlans_() };
    }
  } catch (err) {
    body = { ok: false, error: String(err && err.message || err) };
  }
  var json = JSON.stringify(body);
  if (p.callback && /^[\w.$]+$/.test(p.callback)) {
    return ContentService.createTextOutput(p.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  保存・読み出し
// ============================================================
function spreadsheet_() {
  // スクリプト単体で動くよう、保存用スプレッドシートは初回に自動作成してIDを記録する
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var bound = null;
  try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  var ss = bound || SpreadsheetApp.create('ミートチーム 作業予定データ（ポータル用）');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function sheet_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, 4).setValues([['作業日', '更新日時', '元ファイル', 'JSON(分割)']]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

function savePlan_(plan) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var json = JSON.stringify(plan);
    var row = [plan.date, new Date(), plan.sourceFile || ''];
    for (var i = 0; i < json.length; i += CHUNK) row.push(json.substring(i, i + CHUNK));
    var r = findRow_(sh, plan.date);
    if (r) {
      sh.getRange(r, 1, 1, sh.getLastColumn()).clearContent();
    } else {
      r = sh.getLastRow() + 1;
    }
    sh.getRange(r, 1).setNumberFormat('@');
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    // 古いデータの整理（60日より前を削除）
    cleanup_(sh, 60);
  } finally {
    lock.releaseLock();
  }
}

function loadPlan_(date) {
  var sh = sheet_();
  var r = findRow_(sh, date);
  if (!r) return null;
  var vals = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  var json = '';
  for (var i = 3; i < vals.length; i++) json += (vals[i] || '');
  var plan = JSON.parse(json);
  plan.updatedAt = vals[1] instanceof Date ? vals[1].toISOString() : String(vals[1]);
  return plan;
}

function listPlans_() {
  var sh = sheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var vals = sh.getRange(2, 1, n, 2).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    out.push({ date: normDate_(vals[i][0]), updatedAt: vals[i][1] instanceof Date ? vals[i][1].toISOString() : '' });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}

// 今日以降で一番近い日。なければ最新。
function pickDefaultDate_() {
  var list = listPlans_();
  if (!list.length) return '';
  var today = dateStr_(new Date());
  for (var i = 0; i < list.length; i++) if (list[i].date >= today) return list[i].date;
  return list[list.length - 1].date;
}

function findRow_(sh, date) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  var vals = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (normDate_(vals[i][0]) === date) return i + 2;
  return 0;
}

function cleanup_(sh, days) {
  var limit = dateStr_(addDays_(new Date(), -days));
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var vals = sh.getRange(2, 1, n, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (normDate_(vals[i][0]) < limit) sh.deleteRow(i + 2);
  }
}

// ============================================================
//  Slack
// ============================================================

/** 6:50 に呼ばれる本体（単独で投稿する場合） */
function postPlanToSlack() {
  var props = PropertiesService.getScriptProperties();
  var offset = Number(props.getProperty('SLACK_DAY_OFFSET') || 0);
  var date = dateStr_(addDays_(new Date(), offset));
  var plan = loadPlan_(date);
  if (!plan) {
    Logger.log('作業予定なし：' + date);
    return;
  }
  var res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + props.getProperty('SLACK_BOT_TOKEN') },
    payload: JSON.stringify({
      channel: props.getProperty('SLACK_CHANNEL') || 'C05G46NECKV',
      text: buildSlackText_(plan),
      unfurl_links: false
    }),
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}

/**
 * 既存のまとめBot（#110 6:50）に組み込む場合はこれを使う：
 *   var text = getPlanSlackText('2026-11-16');  // 同じプロジェクト内なら直接
 *   または UrlFetchApp.fetch(このWebアプリURL + '?action=slack&offset=0') の text
 */
function getPlanSlackText(date) {
  var plan = loadPlan_(date || dateStr_(new Date()));
  return plan ? buildSlackText_(plan) : '';
}

function buildSlackText_(plan) {
  var L = [];
  var n = plan.naizo || {}, p = plan.pack || {};
  L.push(':clipboard: *' + jpDate_(plan.date) + ' の作業予定*');

  L.push('');
  L.push('*【内臓作業室】* 入荷 ' + v_(n.heads) + '頭 ／ 総パック ' + v_(n.packs) +
    ' ／ 終了予定 ' + v_(n.endPlan) + ' ／ 責任者 ' + v_(n.leader));
  if (n.notes) L.push(quote_(n.notes));

  var leaders = [];
  for (var i = 0; i < (p.leaders || []).length; i++) leaders.push(p.leaders[i].role + '：' + p.leaders[i].name);
  L.push('*【精肉パック作業室】* 総パック ' + v_(p.packs) + ' ／ 終了予定 ' + v_(p.endPlan) +
    (p.attendance ? ' ／ 出勤 ' + p.attendance + '名' : ''));
  if (leaders.length) L.push('責任者 ' + leaders.join('　'));
  if (p.notes) L.push(quote_(p.notes));

  // 当日分
  L.push('');
  var t = summaryLines_(plan.today, true);
  L.push('*【当日分】* ' + (t.length ? '' : 'なし'));
  for (var j = 0; j < t.length; j++) L.push(t[j]);

  // 翌日分（グループ合計だけ）
  var nx = plan.next || { groups: [] };
  var parts = [];
  for (var k = 0; k < nx.groups.length; k++) {
    var sum = 0;
    for (var m = 0; m < nx.groups[k].items.length; m++) sum += nx.groups[k].items[m].qty;
    if (sum > 0) parts.push(nx.groups[k].name + ' ' + fmt_(sum));
  }
  L.push('*【翌日分】* ' + (parts.length ? parts.join(' ／ ') : 'なし'));

  var url = PropertiesService.getScriptProperties().getProperty('APP_URL');
  if (url) L.push('\n<' + url + '|:iphone: 詳しくは MEAT LINK で>');
  return L.join('\n');
}

function summaryLines_(sum, withItems) {
  var out = [];
  if (!sum || !sum.groups) return out;
  for (var i = 0; i < sum.groups.length; i++) {
    var g = sum.groups[i], items = [];
    for (var j = 0; j < g.items.length; j++) {
      var it = g.items[j];
      if (it.qty > 0) items.push(it.name + ' ' + fmt_(it.qty) + (it.urgent ? ' :red_circle:急ぎ' : ''));
    }
    if (items.length) out.push('• ' + g.name + '：' + items.join('、'));
  }
  return out;
}

// ============================================================
//  トリガー（単独投稿する場合だけ実行）
//   GAS の「毎日○時」トリガーは±15分ずれるため、
//   5時台に毎日動く準備トリガー → 当日 6:50 ちょうどの1回トリガーを作る方式。
// ============================================================
function setupTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    var f = ts[i].getHandlerFunction();
    if (f === 'scheduleTodayPost' || f === 'postPlanToSlack') ScriptApp.deleteTrigger(ts[i]);
  }
  ScriptApp.newTrigger('scheduleTodayPost').timeBased().everyDays(1).atHour(5).create();
}

function scheduleTodayPost() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'postPlanToSlack') ScriptApp.deleteTrigger(ts[i]);
  }
  var at = new Date();
  at.setHours(6, 50, 0, 0);
  if (at.getTime() > new Date().getTime()) {
    ScriptApp.newTrigger('postPlanToSlack').timeBased().at(at).create();
  }
}

// ============================================================
//  小物
// ============================================================
function dateStr_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}
function normDate_(v) {
  if (v instanceof Date) return dateStr_(v);
  return String(v || '');
}
function addDays_(d, n) {
  var x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
function jpDate_(s) {
  var a = s.split('-');
  var d = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  return Number(a[1]) + '/' + Number(a[2]) + '(' + WEEK[d.getDay()] + ')';
}
function v_(x) { return (x === null || x === undefined || x === '') ? '―' : String(x); }
function fmt_(n) { return (Math.round(n * 10) / 10) + ''; }
function quote_(s) {
  var lines = String(s).split('\n'), out = [];
  for (var i = 0; i < lines.length; i++) if (lines[i]) out.push('> ' + lines[i]);
  return out.join('\n');
}

/** 初回セットアップ：保存用シートを作成（エディタで1回実行） */
function setup() {
  var sh = sheet_();
  Logger.log('保存先：' + sh.getParent().getUrl());
}

/** 動作確認用：最新の予定で Slack テキストをログに出す */
function testSlackText() {
  var d = pickDefaultDate_();
  Logger.log(d ? getPlanSlackText(d) : '保存データなし');
}
