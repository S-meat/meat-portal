/**
 * ミートチーム ポータル — 作業予定の保存・配信・Slack投稿
 *
 * 【スクリプトプロパティ】（プロジェクトの設定 → スクリプト プロパティ）
 *   SHEET_ID          … 保存用スプレッドシート（初回に自動作成・自動設定）
 *   UPLOAD_PIN        … 抽出アプリから保存するときの暗証番号（例：4桁）
 *   SLACK_BOT_TOKEN   … 既存の Slack Bot トークン（xoxb-…）
 *   SLACK_CHANNEL     … 投稿先チャンネルID（#110 = C05G46NECKV）
 *   APP_URL           … 共有アプリのURL（Slack投稿のリンク用）
 *   UPDATE_NOTIFY     … 取り込み時の更新通知を止めるときだけ 0 にする（未設定＝通知する）
 *   SLACK_DAY_OFFSET  … 6:50の投稿で何日後の予定を出すか（0=当日 / 1=翌日、未設定は0）
 *   VIEW_KEY          … 閲覧用の合言葉（アプリを開くときに入力。未設定なら合言葉なしで開ける）
 *   SHARE_CHANNEL     … 「本日の共有」まとめが投稿されるチャンネル（未設定は #110 = C05G46NECKV）
 *   PDF_CHANNELS      … PDFを表示してよいチャンネルID（カンマ区切り。未設定は #110 終礼ノートのみ）
 *   SHARE_GROUPS      … 本日の共有に出すチャンネル名の先頭番号（カンマ区切り。未設定は 101 = 報告・連絡のみ）
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
    if (p.kind === 'gift') {
      // ギフト予定（バランス照会から抽出したもの）
      if (!plan || !plan.items || !plan.dates || !plan.dates.length) throw new Error('ギフトのデータが不正です');
      saveGift_(plan);
      result = { ok: true, kind: 'gift', date: plan.dates[0].date };
    } else {
      if (!plan || !plan.date || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) throw new Error('日付が不正です');
      savePlan_(plan);
      result = { ok: true, date: plan.date };
    }
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  // 保存できたら #110 に更新通知（まとめて共有したときは最後の1件でまとめて1回だけ）
  if (result.ok && p.notify && p.notify !== '0') {
    try {
      var items = JSON.parse(p.notify);
      if (Object.prototype.toString.call(items) !== '[object Array]') items = [];
      items.push(p.kind === 'gift' ? { kind: 'gift' } : { kind: 'plan', date: result.date });
      postUpdateNotice_(items);
    } catch (err2) {
      Logger.log('更新通知に失敗：' + err2);
    }
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
    } else if (action === 'gift') {
      body = { ok: true, gift: loadGift_() };
    } else if (action === 'notes') {
      body = { ok: true, notes: listShureiNotes_(Number(p.days || 4)) };
    } else if (action === 'pdf') {
      body = getPdf_(p.id || '');
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
  return { ok: true, date: d, share: filterShare_(share), dates: listShares_() };
}

// 本日の共有に出すチャンネルだけに絞る（未設定は #101 報告・連絡のみ）
function shareGroupPrefixes_() {
  var v = PropertiesService.getScriptProperties().getProperty('SHARE_GROUPS');
  return (v || '101').split(/[,\s]+/).filter(function (x) { return x; });
}
function filterShare_(share) {
  if (!share) return share;
  var prefixes = shareGroupPrefixes_(), groups = [], count = 0;
  for (var i = 0; i < (share.groups || []).length; i++) {
    var g = share.groups[i], hit = false;
    for (var j = 0; j < prefixes.length; j++) if (String(g.channel).indexOf(prefixes[j] + '-') === 0 || g.channel === prefixes[j]) hit = true;
    if (hit) { groups.push(g); count += g.posts.length; }
  }
  share.groups = groups;
  share.count = count;
  return share;
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

  var parsed = filterShare_(parseDigest_(digest.text || ''));
  for (var g = 0; g < parsed.groups.length; g++) {
    var posts = parsed.groups[g].posts;
    for (var j = 0; j < posts.length; j++) {
      var post = posts[j];
      var full = '';
      if (post.channelId && post.ts) {
        try {
          var r = slackApi_('conversations.history', { channel: post.channelId, latest: post.ts, oldest: post.ts, inclusive: 'true', limit: 1 });
          if (r.messages && r.messages.length) {
            full = r.messages[0].text || '';
            post.pdfs = pdfIds_(r.messages[0].files);
          }
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
    // 行頭の【…】（複数可）は見出しに：【連絡】【共有】件名 → 見出し「連絡・共有」＋件名
    var h = line.match(/^[\s　]*((?:【[^】]+】[\s　]*)+)(.*)$/);
    if (h) {
      flushSec();
      sec.title = (h[1].match(/【([^】]+)】/g) || []).map(function (x) { return x.replace(/[【】]/g, ''); }).join('・');
      if (h[2]) line = h[2]; else continue;
    }
    // 行頭の「・」「●」「-」などは外す（画面側で点を付けるため）
    line = line.replace(/^([\s　]*)[・●○■□◆◇▪︎\-–—＊*]+[\s　]*/, '$1');
    if (!line.replace(/[\s　]/g, '')) continue;
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

// ============================================================
//  PDF（終礼ノートなど）をアプリで表示する
//   ・Slackのファイルを取り出してアプリへ渡す（合言葉が必要。Driveには置かない）
//   ・決められたチャンネルのPDFだけ
// ============================================================
var DEFAULT_PDF_CHANNELS = ['C05G46NECKV']; // 終礼ノート（#110）だけ。取引先などの資料は出さない
var PDF_MAX_BYTES = 15 * 1024 * 1024;

function pdfIds_(files) {
  var out = [];
  for (var i = 0; i < (files || []).length; i++) {
    var f = files[i];
    if (f && (f.filetype === 'pdf' || f.mimetype === 'application/pdf')) out.push({ id: f.id, pages: f.pages || 0 });
  }
  return out;
}

function pdfChannels_() {
  var v = PropertiesService.getScriptProperties().getProperty('PDF_CHANNELS');
  return v ? v.split(/[,\s]+/).filter(function (x) { return x; }) : DEFAULT_PDF_CHANNELS;
}

/** #110 の最近の終礼ノート（PDF付きの投稿）。まとめBotの投稿は除く */
function listShureiNotes_(days) {
  var channel = PropertiesService.getScriptProperties().getProperty('SHARE_CHANNEL') || 'C05G46NECKV';
  var cache = CacheService.getScriptCache();
  var ck = 'notes:' + channel + ':' + days;
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var oldest = String(Math.floor((new Date().getTime() - days * 86400000) / 1000));
  var hist = slackApi_('conversations.history', { channel: channel, oldest: oldest, limit: 100 });
  var out = [];
  for (var i = 0; i < (hist.messages || []).length; i++) {
    var m = hist.messages[i];
    if (SHARE_TITLE_RE.test(m.text || '')) continue;
    var pdfs = pdfIds_(m.files);
    if (!pdfs.length) continue;
    var d = new Date(Number(m.ts) * 1000);
    out.push({
      ts: m.ts,
      date: Utilities.formatDate(d, 'Asia/Tokyo', 'M/d'),
      time: Utilities.formatDate(d, 'Asia/Tokyo', 'H:mm'),
      day: dateStr_(d),
      text: cleanSlack_(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      pdfs: pdfs
    });
  }
  cache.put(ck, JSON.stringify(out), 300);
  return out;
}

/** PDF本体（base64）を返す */
function getPdf_(id) {
  if (!/^F[A-Z0-9]+$/.test(id)) throw new Error('ファイルの指定が不正です');
  var info = slackApi_('files.info', { file: id }).file;
  if (!(info.filetype === 'pdf' || info.mimetype === 'application/pdf')) throw new Error('PDFではありません');
  var allowed = pdfChannels_(), chans = [].concat(info.channels || [], info.groups || []);
  var shares = info.shares || {};
  for (var kind in shares) if (shares.hasOwnProperty(kind)) for (var c in shares[kind]) if (shares[kind].hasOwnProperty(c)) chans.push(c);
  var ok = false;
  for (var i = 0; i < chans.length; i++) if (allowed.indexOf(chans[i]) >= 0) ok = true;
  if (!ok) throw new Error('このファイルは表示できません');
  if (info.size && info.size > PDF_MAX_BYTES) throw new Error('ファイルが大きすぎます（' + Math.round(info.size / 1048576) + 'MB）');
  var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  var res = UrlFetchApp.fetch(info.url_private_download || info.url_private, {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: true
  });
  if (res.getResponseCode() !== 200) throw new Error('ダウンロードできませんでした（' + res.getResponseCode() + '）');
  var blob = res.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') {
    throw new Error('PDFを取得できませんでした（Slackアプリに files:read の権限が必要です）');
  }
  var d = new Date(Number(info.created) * 1000);
  return { ok: true, id: id, date: Utilities.formatDate(d, 'Asia/Tokyo', 'M/d H:mm'), data: Utilities.base64Encode(bytes) };
}

/** 動作確認用：最新の終礼ノートを取得してログに出す */
function testShureiPdf() {
  var notes = listShureiNotes_(7);
  Logger.log('終礼ノート ' + notes.length + '件');
  if (!notes.length) return;
  var r = getPdf_(notes[0].pdfs[0].id);
  Logger.log(notes[0].date + ' ' + notes[0].time + ' PDF取得OK（' + Math.round(r.data.length * 0.75 / 1024) + 'KB）');
}

// ============================================================
//  ギフト予定（バランス照会のギフト品目）— 最新の1件だけ保存
// ============================================================
var GIFT_SHEET = 'gifts';

function giftSheet_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(GIFT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(GIFT_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['取り込み日時', '元ファイル', 'JSON(分割)']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function saveGift_(gift) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = giftSheet_();
    var json = JSON.stringify(gift);
    var row = [new Date(), gift.sourceFile || ''];
    for (var i = 0; i < json.length; i += CHUNK) row.push(json.substring(i, i + CHUNK));
    if (sh.getLastRow() >= 2) sh.getRange(2, 1, 1, sh.getLastColumn()).clearContent();
    sh.getRange(2, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
}

function loadGift_() {
  var sh = giftSheet_();
  if (sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  var json = '';
  for (var i = 2; i < vals.length; i++) json += (vals[i] || '');
  if (!json) return null;
  var gift = JSON.parse(json);
  gift.updatedAt = vals[0] instanceof Date ? vals[0].toISOString() : String(vals[0]);
  return gift;
}

// ============================================================
//  取り込み時の更新通知（#110）
// ============================================================
function postUpdateNotice_(items, giftBase) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('UPDATE_NOTIFY') === '0') return;
  var token = props.getProperty('SLACK_BOT_TOKEN');
  if (!token) return;
  var text = buildUpdateNotice_(items, giftBase);
  if (!text) return;
  var url = props.getProperty('APP_URL');
  if (url) text += '\n<' + url + '|:iphone: MEAT LINK で見る>';
  var res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      channel: props.getProperty('SLACK_CHANNEL') || 'C05G46NECKV',
      text: text,
      unfurl_links: false
    }),
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}

function buildUpdateNotice_(items, giftBase) {
  var plan = null, gift = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i] && items[i].kind === 'gift') gift = true;
    else if (items[i] && items[i].kind === 'plan' && /^\d{4}-\d{2}-\d{2}$/.test(items[i].date)) plan = items[i].date;
  }
  var parts = [];
  if (plan) parts.push(mdDate_(plan) + '分の作業指示書');
  if (gift) {
    // ギフト予定の表示期間：取り込んだ日の2日後から7日分（共有アプリと同じ）
    var base = giftBase || new Date();
    var from = addDays_(base, 2), to = addDays_(base, 8);
    parts.push('ギフトスケジュール（' + (from.getMonth() + 1) + '/' + from.getDate() + '〜' + (to.getMonth() + 1) + '/' + to.getDate() + '）');
  }
  if (!parts.length) return '';
  return ':bell: ' + parts.join('、') + 'が更新されました！';
}

function mdDate_(ymd) {
  var a = ymd.split('-');
  var d = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  return (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WEEK[d.getDay()] + ')';
}

/** エディタで実行して文面を確認する（Slackには投稿しない） */
function testUpdateNotice() {
  Logger.log(buildUpdateNotice_([{ kind: 'plan', date: dateStr_(addDays_(new Date(), 1)) }, { kind: 'gift' }]));
}

/**
 * 直近に取り込んだ作業指示書とギフト予定の更新通知を手動で #110 に投稿する
 * （通知機能を入れる前に取り込んだ分の通知や、投稿テスト用）
 */
function postLatestUpdateNotice() {
  var list = listPlans_(), latest = null;
  for (var i = 0; i < list.length; i++) {
    if (!latest || list[i].updatedAt > latest.updatedAt) latest = list[i];
  }
  var gift = loadGift_();
  var items = [];
  if (latest) items.push({ kind: 'plan', date: latest.date });
  if (gift) items.push({ kind: 'gift' });
  Logger.log(buildUpdateNotice_(items, gift ? new Date(gift.updatedAt) : null));
  postUpdateNotice_(items, gift ? new Date(gift.updatedAt) : null);
}
