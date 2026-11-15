/* 作業指示書 (.xlsx) から 4シートを抽出するパーサー
 *  - 内臓作業室 / 精肉パック作業室 / 当日分まとめ / 翌日分まとめ
 *  セル番地の固定ではなく「ラベル文字」を目印に探すので、行が多少ずれても動きます。
 *  ブラウザ (window.PlanParser) と Node (module.exports) の両方で使えます。
 */
(function (root) {
  'use strict';

  var SHEETS = {
    naizo: '内臓作業室',
    pack: '精肉パック作業室',
    today: '当日分まとめ',
    next: '翌日分まとめ'
  };

  // ---------- セル読み取りヘルパー ----------
  function makeReader(XLSX, ws, maxCol) {
    var ref = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    var lastRow = ref.e.r;
    var lastCol = Math.min(ref.e.c, maxCol == null ? ref.e.c : maxCol);

    function cell(r, c) { return ws[XLSX.utils.encode_cell({ r: r, c: c })]; }

    function isDateFmt(cl) {
      if (!cl || cl.t !== 'n') return false;
      var z = cl.z || '';
      try { return XLSX.SSF.is_date(z); } catch (e) { return false; }
    }

    // 表示用の値を返す（日付→YYYY-MM-DD、時刻→H:MM、数値→数値、文字→整形済み文字）
    function val(r, c) {
      var cl = cell(r, c);
      if (!cl || cl.v == null) return null;
      if (cl.t === 'd') return dateToStr(cl.v);
      if (cl.t === 'e') return null; // #REF! など
      if (isDateFmt(cl)) {
        var v = cl.v;
        if (v < 1) return serialToTime(v);
        return serialToDate(v);
      }
      if (cl.t === 'n') return Math.round(cl.v * 100) / 100;
      var s = String(cl.v).replace(/\r/g, '');
      s = s.replace(/^[\s　]+|[\s　]+$/g, '');
      return s === '' ? null : s;
    }

    function str(r, c) { var v = val(r, c); return v == null ? '' : String(v); }

    function find(pred, opt) {
      opt = opt || {};
      var r0 = opt.fromRow || 0, r1 = opt.toRow == null ? lastRow : opt.toRow;
      var c1 = opt.maxCol == null ? lastCol : opt.maxCol;
      for (var r = r0; r <= r1; r++) {
        for (var c = 0; c <= c1; c++) {
          var s = str(r, c);
          if (s && pred(s, r, c)) return { r: r, c: c };
        }
      }
      return null;
    }

    return { val: val, str: str, find: find, lastRow: lastRow, lastCol: lastCol };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function serialToDate(v) {
    var d = new Date(Math.round((v - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function serialToTime(v) {
    var mins = Math.round(v * 1440);
    return Math.floor(mins / 60) + ':' + pad(mins % 60);
  }
  function dateToStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function num(v) {
    if (v == null || v === '') return 0;
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  function clean(s) {
    if (s == null) return '';
    s = String(s).replace(/^[\s　]+|[\s　]+$/g, '');
    if (s === 'なし' || s === '#REF!') return '';
    return s;
  }
  var reTime = /^\d{1,2}\s*[:：]\s*\d{2}\s*[～~〜]/;   // 8：30～14：45（45）

  // 「ラベル」の右側にある最初の値を返す
  function rightOf(R, pos, opt) {
    if (!pos) return null;
    opt = opt || {};
    for (var dc = 1; dc <= (opt.span || 4); dc++) {
      var v = R.val(pos.r, pos.c + dc);
      if (v != null) return v;
    }
    return null;
  }
  // 「ラベル」の下にある最初の値を返す
  function below(R, pos, span) {
    if (!pos) return null;
    for (var dr = 1; dr <= (span || 3); dr++) {
      var v = R.val(pos.r + dr, pos.c);
      if (v != null) return v;
    }
    return null;
  }

  // ---------- 作業室シート（内臓 / 精肉パック）共通：人員タイムテーブル ----------
  function parseTimetable(R, maxCol) {
    // 「7:30～」「8:00～」…が並ぶ見出し行を探す
    var head = R.find(function (s) { return /^\d{1,2}\s*[:：]\s*\d{2}\s*[～~〜]$/.test(s); }, { maxCol: maxCol });
    if (!head) return { slots: [], staff: [] };
    var slots = [];
    var slotCols = [];
    for (var c = head.c; c <= maxCol; c++) {
      var s = R.str(head.r, c);
      if (/[～~〜]$/.test(s)) { slots.push(s.replace(/：/g, ':').replace(/[～~〜]$/, '')); slotCols.push(c); }
    }
    var staff = [];
    for (var r = head.r + 1; r <= R.lastRow; r++) {
      var name = R.str(r, 0);
      var shift = R.str(r, 1);
      if (name === '商品名' || name === 'S1') break;
      if (!name || !reTime.test(shift)) continue;
      var status = '';
      for (var cc = 2; cc < slotCols[0]; cc++) { var st = R.str(r, cc); if (st) status = st; }
      var tasks = slotCols.map(function (col) { return R.str(r, col); });
      staff.push({
        name: name,
        shift: shift.replace(/：/g, ':').replace(/\s/g, ''),
        status: status,
        tasks: tasks
      });
    }
    return { slots: slots, staff: staff };
  }

  // ---------- 内臓作業室 ----------
  function parseNaizo(XLSX, ws) {
    var MAXC = 13; // A〜N 列だけを見る（右側の名簿・メモ欄は無視）
    var R = makeReader(XLSX, ws, MAXC);
    var out = {};
    out.date = R.val(0, findDateCol(R, 0, MAXC));

    var endPos = R.find(function (s) { return s === '作業終了予定'; });
    out.endPlan = below(R, endPos);
    var yPos = R.find(function (s) { return s === '昨日の実績'; });
    var heads = [], packs = [];
    R.find(function (s, r, c) {
      if (s === '入荷頭数') heads.push({ r: r, c: c });
      if (s === '総パック数') packs.push({ r: r, c: c });
      return false;
    }, { toRow: 12 });
    // 「昨日の実績」より上が本日、下が昨日
    function split(list) {
      var cut = yPos ? yPos.r : 9999;
      return {
        today: list.filter(function (p) { return p.r < cut; })[0],
        yest: list.filter(function (p) { return p.r >= cut; })[0]
      };
    }
    var h = split(heads), p = split(packs);
    out.heads = rightOf(R, h.today, { span: 2 });
    out.packs = rightOf(R, p.today, { span: 2 });
    var endTimePos = R.find(function (s) { return s === '終了時間'; }, { toRow: 12 });
    out.yesterday = {
      heads: rightOf(R, h.yest, { span: 2 }),
      packs: rightOf(R, p.yest, { span: 2 }),
      endTime: rightOf(R, endTimePos, { span: 2 })
    };
    out.leader = rightOf(R, R.find(function (s) { return s === '現場責任者'; }, { toRow: 12 }));
    out.notes = clean(rightOf(R, R.find(function (s) { return /特注|特記/.test(s); }, { toRow: 12 })));

    var tt = parseTimetable(R, MAXC);
    out.slots = tt.slots; out.staff = tt.staff;

    // 商品表
    var hdr = R.find(function (s) { return s === '商品名'; });
    var products = [];
    if (hdr) {
      var col = { weight: -1, todayQty: -1, todayNote: -1, nextQty: -1, nextNote: -1, gToday: -1, gNext: -1 };
      var seenPlan = 0;
      for (var c = 1; c <= MAXC; c++) {
        var s = R.str(hdr.r, c);
        if (s === '重量目安') col.weight = c;
        else if (s === '作業予定') { if (seenPlan++ === 0) col.todayQty = c; else col.nextQty = c; }
        else if (s === '当日分') col.todayNote = c;
        else if (s === '翌日分') col.nextNote = c;
        else if (s === '当日') col.gToday = c;
        else if (s === '翌日') col.gNext = c;
      }
      for (var r = hdr.r + 1; r <= R.lastRow; r++) {
        var name = R.str(r, 0);
        if (!name) continue;
        products.push({
          name: name.replace(/　/g, ' '),
          weight: col.weight >= 0 ? R.str(r, col.weight) : '',
          todayQty: num(R.val(r, col.todayQty)),
          todayNote: clean(R.str(r, col.todayNote)),
          nextQty: num(R.val(r, col.nextQty)),
          nextNote: clean(R.str(r, col.nextNote)),
          genbokuToday: col.gToday >= 0 ? num(R.val(r, col.gToday)) : 0,
          genbokuNext: col.gNext >= 0 ? num(R.val(r, col.gNext)) : 0
        });
      }
    }
    out.products = products;
    out.totalToday = products.reduce(function (a, x) { return a + x.todayQty; }, 0);
    out.totalNext = products.reduce(function (a, x) { return a + x.nextQty; }, 0);
    return out;
  }

  // ---------- 精肉パック作業室 ----------
  function parsePack(XLSX, ws) {
    var MAXC = 14; // A〜O 列
    var R = makeReader(XLSX, ws, MAXC);
    var out = {};
    out.date = R.val(0, findDateCol(R, 0, MAXC));
    out.endPlan = below(R, R.find(function (s) { return s === '作業終了予定'; }));
    var yPos = R.find(function (s) { return s === '昨日の実績'; });
    var packs = [];
    R.find(function (s, r, c) { if (s === '総パック数') packs.push({ r: r, c: c }); return false; }, { toRow: 12 });
    var cut = yPos ? yPos.r : 9999;
    out.packs = rightOf(R, packs.filter(function (p) { return p.r < cut; })[0], { span: 2 });
    if (typeof out.packs === 'number') out.packs = Math.round(out.packs);
    out.yesterday = {
      packs: rightOf(R, packs.filter(function (p) { return p.r >= cut; })[0], { span: 2 }),
      endTime: rightOf(R, R.find(function (s) { return s === '終了時間'; }, { toRow: 12 }), { span: 2 })
    };
    out.leaders = [];
    R.find(function (s, r, c) {
      if (/責任者$/.test(s)) {
        var who = rightOf(R, { r: r, c: c });
        if (who) out.leaders.push({ role: s.replace(/\n?責任者$/, '').replace(/\n/g, '・'), name: who });
      }
      return false;
    }, { toRow: 12 });
    out.notes = clean(below(R, R.find(function (s) { return /^特記/.test(s); }, { toRow: 12 })));
    out.attendance = rightOf(R, R.find(function (s) { return s === '出勤人数'; }, { toRow: 12 }));
    var tt = parseTimetable(R, MAXC);
    out.slots = tt.slots; out.staff = tt.staff;
    return out;
  }

  // ---------- 当日分 / 翌日分まとめ ----------
  function parseSummary(XLSX, ws) {
    var R = makeReader(XLSX, ws, 16); // A〜Q 列
    var out = { date: R.val(0, 0), expiries: [], groups: [] };
    // 1行目「賞味D+2の商品」← その左下(2行目)の日付
    for (var c = 0; c <= 16; c++) {
      var s = R.str(0, c);
      if (/^賞味/.test(s)) {
        var d = R.val(1, c - 1);
        out.expiries.push({ label: s.replace(/の商品$/, ''), date: d });
      }
    }
    // グループ見出し：「○○」の右隣が「当日分」
    var groupStarts = [];
    for (var r = 0; r <= R.lastRow; r++) {
      for (var cc = 0; cc <= 15; cc++) {
        if (R.str(r, cc + 1) === '当日分' && R.str(r, cc) && R.str(r, cc) !== '商品名') {
          groupStarts.push({ r: r, c: cc, name: R.str(r, cc) });
        }
      }
    }
    // シート上の並び（左の列→上から）に揃える
    groupStarts.sort(function (a, b) { return a.c - b.c || a.r - b.r; });
    groupStarts.forEach(function (g) {
      var items = [];
      for (var rr = g.r + 1; rr <= R.lastRow; rr++) {
        var nm = R.str(rr, g.c);
        if (R.str(rr, g.c + 1) === '当日分') break; // 次のグループ
        if (!nm || nm === '商品名') continue;
        var qty = num(R.val(rr, g.c + 1));
        var flag = R.str(rr, g.c + 2);
        items.push({
          name: nm.replace(/\n/g, ' ').replace(/　/g, ' '),
          qty: qty,
          urgent: qty > 0 && flag === '急ぎ'
        });
      }
      out.groups.push({ name: g.name, items: items });
    });
    out.total = out.groups.reduce(function (a, g) {
      return a + g.items.reduce(function (x, i) { return x + i.qty; }, 0);
    }, 0);
    return out;
  }

  function findDateCol(R, row, maxC) {
    for (var c = 0; c <= maxC; c++) {
      var v = R.val(row, c);
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return c;
    }
    return 0;
  }

  // ---------- 入口 ----------
  // XLSX: SheetJS, data: ArrayBuffer / Uint8Array
  function parseWorkbook(XLSX, data, fileName) {
    var wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, cellStyles: false });
    var missing = [];
    Object.keys(SHEETS).forEach(function (k) { if (!wb.Sheets[SHEETS[k]]) missing.push(SHEETS[k]); });
    if (missing.length) throw new Error('シートが見つかりません：' + missing.join('、'));

    var plan = {
      version: 1,
      sourceFile: fileName || '',
      extractedAt: new Date().toISOString(),
      naizo: parseNaizo(XLSX, wb.Sheets[SHEETS.naizo]),
      pack: parsePack(XLSX, wb.Sheets[SHEETS.pack]),
      today: parseSummary(XLSX, wb.Sheets[SHEETS.today]),
      next: parseSummary(XLSX, wb.Sheets[SHEETS.next])
    };
    plan.date = plan.naizo.date || plan.pack.date || plan.today.date;
    if (!plan.date || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) throw new Error('作業日（日付）が読み取れませんでした');
    return plan;
  }

  var api = { parseWorkbook: parseWorkbook, SHEETS: SHEETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanParser = api;
})(typeof window !== 'undefined' ? window : this);
