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
 *   VIEW_KEY          … 閲覧用の合言葉（アプリを開くときに入力。未設定なら合言葉なしで開ける）
 *   SHARE_CHANNEL     … 「本日の共有」まとめが投稿されるチャンネル（未設定は #110 = C05G46NECKV）
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
    if (!authOk_(p.key)) {
      body = { ok: false, needKey: true, error: p.key ? '合言葉が違います' : '合言葉を入力してください' };
    } else if (action === 'list') {
      body = { ok: true, dates: listPlans_() };
    } else if (action === 'slack') {
      var d = p.date || dateStr_(addDays_(new Date(), Number(p.offset || 0)));
      var plan = loadPlan_(d);
      body = { ok: true, date: d, text: plan ? buildSlackText_(plan) : '' };
    } else if (action === 'share') {
      body = getShare_(p.date || '');
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

// 合言葉（VIEW_KEY）または取り込み用暗証番号（UPLOAD_PIN）なら閲覧OK。VIEW_KEY 未設定なら誰でも閲覧可。
function authOk_(key) {
  var props = PropertiesService.getScriptProperties();
  var view = props.getProperty('VIEW_KEY');
  if (!view) return true;
  var k = String(key || '');
  if (!k) return false;
  var pin = props.getProperty('UPLOAD_PIN');
  return k === String(view) || (!!pin && k === String(pin));
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

// ============================================================
//  本日の共有（#110 6:50 のまとめ投稿 → 元の投稿を読んで要点を整理）
//   ・まとめ投稿にある「元の投稿を見る」リンクから元の投稿を取得
//   ・AIは使わず、改行・字下げ・【○○作業】の見出しで整理
//   ・PDFなどのファイル名は出さない
// ============================================================
var SHARE_SHEET = 'shares';
var SHARE_TITLE_RE = /本日の共有/;

function getShare_(date) {
  var today = dateStr_(new Date());
  var d = date || today;
  var share = loadShare_(d);
  // 今日の分がまだなら、まとめ投稿が出ていれば作る（10分に1回まで）
  if (!share && d === today) {
    var cache = CacheService.getScriptCache();
    if (!cache.get('shareTry:' + d)) {
      cache.put('shareTry:' + d, '1', 600);
      try { share = buildShare_(d); } catch (e) { Logger.log(e); }
    }
  }
  // 指定なしで今日の分がなければ直近の分
  if (!share && !date) {
    var list = listShares_();
    if (list.length) { d = list[list.length - 1]; share = loadShare_(d); }
  }
  return { ok: true, date: d, share: share, dates: listShares_() };
}

/** 毎朝トリガー用（7時台） */
function buildTodayShare() {
  buildShare_(dateStr_(new Date()));
}

/** 7時台に「本日の共有」を作るトリガーを設定（1回だけ実行） */
function setupShareTrigger() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'buildTodayShare') ScriptApp.deleteTrigger(ts[i]);
  }
  ScriptApp.newTrigger('buildTodayShare').timeBased().everyDays(1).atHour(7).create();
}

function buildShare_(date) {
  var props = PropertiesService.getScriptProperties();
  var channel = props.getProperty('SHARE_CHANNEL') || 'C05G46NECKV';
  var a = date.split('-');
  var start = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]), 0, 0, 0);
  var end = addDays_(start, 1);
  var hist = slackApi_('conversations.history', {
    channel: channel, oldest: String(start.getTime() / 1000), latest: String(end.getTime() / 1000), limit: 50
  });
  var digest = null;
  for (var i = 0; i < (hist.messages || []).length; i++) {
    var m = hist.messages[i];
    if (SHARE_TITLE_RE.test(m.text || '')) { digest = m; break; } // 新しい順
  }
  if (!digest) return null;

  var parsed = parseDigest_(digest.text || '');
  for (var g = 0; g < parsed.groups.length; g++) {
    var posts = parsed.groups[g].posts;
    for (var j = 0; j < posts.length; j++) {
      var post = posts[j];
      var full = '';
      if (post.channelId && post.ts) {
        try {
          var r = slackApi_('conversations.history', { channel: post.channelId, latest: post.ts, oldest: post.ts, inclusive: 'true', limit: 1 });
          if (r.messages && r.messages.length) full = r.messages[0].text || '';
        } catch (e) {
          Logger.log('元投稿の取得失敗 ' + post.link + ' ' + e);
        }
      }
      post.sections = summarizeText_(full || post.snippet);
      post.fileOnly = !post.sections.length;
      delete post.snippet;
    }
  }
  var share = {
    date: date,
    postedAt: new Date(Number(digest.ts) * 1000).toISOString(),
    link: 'https://slack.com/archives/' + channel + '/p' + String(digest.ts).replace('.', ''),
    count: parsed.count,
    groups: parsed.groups
  };
  saveShare_(share);
  return share;
}

// まとめ投稿の本文を読み取る
//   *# 201-特注共有*(2件)
//   ・11/14 10:55 清水佑:本文の先頭… :paperclip:file.pdf
//     → <https://xxx.slack.com/archives/C03LVUDEQLA/p1794621332984949|元の投稿を見る>
function parseDigest_(text) {
  var lines = String(text).split('\n');
  var groups = [], cur = null, last = null, count = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var gm = line.match(/^\*#\s*(.+?)\*\s*[（(](\d+)件[)）]/);
    if (gm) { cur = { channel: gm[1], posts: [] }; groups.push(cur); continue; }
    var pm = line.match(/^・(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+([^:：]+?)[:：]([\s\S]*)$/);
    if (pm && cur) {
      last = { date: pm[1], time: pm[2], author: pm[3].replace(/\s+/g, ' ').trim(), snippet: pm[4] };
      cur.posts.push(last); count++;
      continue;
    }
    var lm = line.match(/<(https?:\/\/[^|>]+\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})[^|>]*)\|/);
    if (lm && last) {
      last.link = lm[1];
      last.channelId = lm[2];
      last.ts = lm[3] + '.' + lm[4];
    }
  }
  return { groups: groups, count: count };
}

// Slackの書式を外してプレーンな文字に
function cleanSlack_(t) {
  return String(t || '')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '')
    .replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, '')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '')
    .replace(/:paperclip:[^\n]*/g, '')
    .replace(/:[a-z0-9_+\-]+:/g, '')
    .replace(/\[[^\]]*@slack-bots\.com[^\]]*\]/g, '')
    .replace(/\*使用して送信されました\*/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/(^|[\s　])[*_~]+(?=\S)|(?=\S)[*_~]+(?=$|[\s　])/g, '$1');
}

// 投稿文 → [{title:'11/17作業', lines:['けなりぃ様：ネック×5.0kg、…']}, {title:'', lines:[…]}]
function summarizeText_(raw) {
  var text = cleanSlack_(raw);
  var src = text.split('\n');
  var sections = [], sec = { title: '', lines: [] }, entry = null;
  function flushEntry() {
    if (entry) {
      sec.lines.push(entry.items.length ? entry.head + '：' + entry.items.join('、') : entry.head);
      entry = null;
    }
  }
  function flushSec() {
    flushEntry();
    if (sec.title || sec.lines.length) sections.push(sec);
    sec = { title: '', lines: [] };
  }
  for (var i = 0; i < src.length; i++) {
    var line = src[i].replace(/\s+$/, '');
    if (!line.replace(/[\s　]/g, '')) { flushEntry(); continue; }
    // 決まり文句は省く
    if (/^(特注が入りましたので共有(いた)?します|お疲れ様です|お疲れさまです|よろしくお願い(いた)?します)[。.]?$/.test(line.trim())) continue;
    var h = line.match(/^[\s　]*【([^】]+)】[\s　]*(.*)$/);
    if (h) {
      flushSec();
      sec.title = h[1];
      if (h[2]) line = h[2]; else continue;
    }
    var indented = /^[\s　]/.test(line);
    var body = line.replace(/^[\s　]+/, '');
    if (indented && entry) { entry.items.push(body.replace(/[\s　]+/g, ' ')); continue; }
    flushEntry();
    // 「取引先様　品目×数」の形
    var m = body.match(/^(.+?(?:様|催事|店))[\s　]+(.+)$/);
    if (m && /[×x✕]\s*\d|\d+\s*(kg|ｋｇ|P|枚|本|c\/s|cs|個|袋)/i.test(m[2])) {
      entry = { head: m[1], items: [m[2].replace(/[\s　]+/g, ' ')] };
    } else {
      sec.lines.push(body.replace(/[\s　]{2,}/g, ' '));
    }
  }
  flushSec();
  return sections;
}

function slackApi_(method, params) {
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) throw new Error('SLACK_BOT_TOKEN が未設定です');
  var q = [];
  for (var k in params) if (params.hasOwnProperty(k)) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  var res = UrlFetchApp.fetch('https://slack.com/api/' + method + '?' + q.join('&'), {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  var json = JSON.parse(res.getContentText());
  if (!json.ok) throw new Error('Slack API ' + method + ': ' + json.error);
  return json;
}

function shareSheet_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(SHARE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHARE_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['日付', '更新日時', 'JSON']]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

function saveShare_(share) {
  var sh = shareSheet_();
  var json = JSON.stringify(share);
  var row = [share.date, new Date()];
  for (var i = 0; i < json.length; i += CHUNK) row.push(json.substring(i, i + CHUNK));
  var r = findRow_(sh, share.date);
  if (r) sh.getRange(r, 1, 1, sh.getLastColumn()).clearContent();
  else r = sh.getLastRow() + 1;
  sh.getRange(r, 1).setNumberFormat('@');
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  cleanup_(sh, 30);
}

function loadShare_(date) {
  var sh = shareSheet_();
  var r = findRow_(sh, date);
  if (!r) return null;
  var vals = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  var json = '';
  for (var i = 2; i < vals.length; i++) json += (vals[i] || '');
  return json ? JSON.parse(json) : null;
}

function listShares_() {
  var sh = shareSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var vals = sh.getRange(2, 1, n, 1).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) if (vals[i][0]) out.push(normDate_(vals[i][0]));
  out.sort();
  return out;
}

/** 動作確認用：今日の「本日の共有」を作り直してログに出す */
function testBuildShare() {
  var s = buildShare_(dateStr_(new Date()));
  Logger.log(s ? JSON.stringify(s, null, 1) : 'まとめ投稿が見つかりません');
}
