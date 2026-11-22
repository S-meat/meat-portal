/* ギフト予定：バランス照会（商品コード／規格／商品名称／規格名／現在在庫／11／22日 …）から
 * 商品名称に「ギフト」を含む行だけを取り出す。.xlsx でも、Excelからコピーした貼り付けでも使える。
 * ブラウザ (window.GiftParser) と Node (module.exports) の両方で使えます。 */
(function (root) {
  'use strict';

  // 並び順と表示名・単位（上から順に表示）。合わないギフト品目は最後に元の名前で出す。
  var ITEMS = [
    { key: 'hire',       name: 'ヒレブロック',       unit: '本', re: /ヒレブロック/ },
    { key: 'kirimi',     name: 'ロース切身120g1枚',  unit: '枚', re: /ロース切身/ },
    { key: 'rshabu200',  name: 'ロースしゃぶ200g',   unit: 'P',  re: /ロースしゃぶ.*200/ },
    { key: 'bshabu200',  name: 'ばらしゃぶ200g',     unit: 'P',  re: /バラシャブ.*200/ },
    { key: 'rshabu300',  name: 'ロースしゃぶ300g',   unit: 'P',  re: /ロースしゃぶ.*300/ },
    { key: 'bshabu300',  name: 'ばらしゃぶ300g',     unit: 'P',  re: /バラシャブ.*300/ },
    { key: 'rslice200',  name: 'ローススライス200g', unit: 'P',  re: /ローススライス.*200/ },
    { key: 'bslice200',  name: 'ばらスライス200g',   unit: 'P',  re: /バラスライス.*200/ },
    { key: 'rslice300',  name: 'ローススライス300g', unit: 'P',  re: /ローススライス.*300/ },
    { key: 'bslice300',  name: 'ばらスライス300g',   unit: 'P',  re: /バラスライス.*300/ },
    { key: 'rmiso',      name: 'ロース味噌',         unit: '枚', re: /味噌漬_?ロース/ },
    { key: 'kmiso',      name: '肩ロース味噌',       unit: '枚', re: /味噌漬_?(かた|肩)ロース/ },
    { key: 'bmiso',      name: 'ばら味噌',           unit: '枚', re: /味噌漬_?バラ/ }
  ];

  function nfkc(s) { return String(s == null ? '' : s).normalize ? String(s).normalize('NFKC') : String(s); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // 「11／22日」「11/22(日)」→ 日付。年は今日に近い年で補う
  function parseDateHeader(v, today) {
    var m = nfkc(v).match(/^(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!m) return null;
    var mo = +m[1], d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var y = today.getFullYear();
    if (mo < today.getMonth() + 1 - 6) y++;
    else if (mo > today.getMonth() + 1 + 6) y--;
    var dt = new Date(y, mo - 1, d);
    return { date: y + '-' + pad(mo) + '-' + pad(d), label: mo + '/' + d + '(' + WEEK[dt.getDay()] + ')' };
  }

  function num(v) {
    if (v == null || v === '') return 0;
    var n = Number(nfkc(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  // rows: 2次元配列（1行目に見出しを含む）
  function fromRows(rows, opt) {
    opt = opt || {};
    var today = opt.today || new Date();
    var hi = -1, nameCol = -1, codeCol = -1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = rows[i] || [];
      for (var c = 0; c < r.length; c++) {
        var t = nfkc(r[c]).trim();
        if (t === '商品名称' || t === '商品名') { hi = i; nameCol = c; }
        if (t === '商品コード') codeCol = c;
      }
      if (hi >= 0) break;
    }
    if (hi < 0) throw new Error('「商品名称」の見出しが見つかりません（バランス照会のデータを使ってください）');
    var head = rows[hi];
    var dateCols = [];
    for (var c2 = 0; c2 < head.length; c2++) {
      var d = parseDateHeader(head[c2], today);
      if (d) dateCols.push({ col: c2, date: d.date, label: d.label });
    }
    if (!dateCols.length) throw new Error('日付の列（11／22日 など）が見つかりません');

    var found = {}, extra = [];
    for (var j = hi + 1; j < rows.length; j++) {
      var row = rows[j] || [];
      var orig = row[nameCol];
      var name = nfkc(orig);
      if (!/ギフト/.test(name)) continue;
      var values = {};
      dateCols.forEach(function (dc) { values[dc.date] = num(row[dc.col]); });
      var item = null;
      for (var k = 0; k < ITEMS.length; k++) if (!found[ITEMS[k].key] && ITEMS[k].re.test(name)) { item = ITEMS[k]; break; }
      var rec = { code: codeCol >= 0 ? nfkc(row[codeCol]).trim() : '', orig: String(orig), values: values };
      if (item) { rec.key = item.key; rec.name = item.name; rec.unit = item.unit; found[item.key] = rec; }
      else { rec.key = 'x' + j; rec.name = name.replace(/^ギフト用/, '').replace(/[kj]$/, ''); rec.unit = ''; extra.push(rec); }
    }
    var items = [];
    ITEMS.forEach(function (it) { if (found[it.key]) items.push(found[it.key]); });
    items = items.concat(extra);
    if (!items.length) throw new Error('「ギフト」を含む商品が見つかりませんでした');
    return {
      version: 1,
      kind: 'gift',
      sourceFile: opt.fileName || '',
      importedAt: new Date().toISOString(),
      dates: dateCols.map(function (d) { return { date: d.date, label: d.label }; }),
      items: items
    };
  }

  // SheetJS のブックから（「バランス照会」シート優先、なければ「商品名称」がある最初のシート）
  function fromWorkbook(XLSX, wb, opt) {
    var names = wb.SheetNames.slice();
    names.sort(function (a, b) { return (b === 'バランス照会') - (a === 'バランス照会'); });
    var lastErr = null;
    for (var i = 0; i < names.length; i++) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[names[i]], { header: 1, raw: true, defval: null });
      try { return fromRows(rows, opt); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('読み取れませんでした');
  }

  // Excelからコピーした文字（タブ区切り）
  function fromText(text, opt) {
    var rows = String(text).replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); })
      .map(function (l) { return l.split('\t'); });
    return fromRows(rows, opt);
  }

  function isGiftWorkbook(wb) {
    if (wb.SheetNames.indexOf('内臓作業室') >= 0) return false;
    return true;
  }

  var api = { fromRows: fromRows, fromWorkbook: fromWorkbook, fromText: fromText, isGiftWorkbook: isGiftWorkbook, ITEMS: ITEMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GiftParser = api;
})(typeof window !== 'undefined' ? window : this);
