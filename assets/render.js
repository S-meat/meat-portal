/* 作業予定の表示（共有アプリと抽出アプリのプレビューで共通） */
(function (root) {
  'use strict';

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  var TASK_COLORS = {
    'パック': ['#dbeafe', '#1e3a8a'], 'パッカー': ['#dbeafe', '#1e3a8a'],
    'マルチ': ['#ede9fe', '#4c1d95'], '処理': ['#fee2e2', '#7f1d1d'],
    '内臓': ['#fee2e2', '#7f1d1d'], 'モツ': ['#fde2e4', '#831843'], 'モツ切り': ['#fde2e4', '#831843'],
    '詰め作業': ['#dcfce7', '#14532d'], '精肉作業室': ['#fef3c7', '#78350f'],
    '挽肉': ['#ffedd5', '#7c2d12'], '骨付き物': ['#e0f2fe', '#0c4a6e'],
    'スライスセット': ['#f3e8ff', '#581c87'], 'スライサー': ['#f3e8ff', '#581c87'],
    '塩コショウ': ['#ecfccb', '#365314'], '味噌': ['#fef9c3', '#713f12'], 'HB': ['#fef9c3', '#713f12'],
    '清掃': ['#e5e7eb', '#1f2937'], '洗浄室': ['#e5e7eb', '#1f2937'],
    '休憩': ['#f1f1ee', '#6b6b6b'], '昼': ['#f1f1ee', '#6b6b6b'], 'お昼': ['#f1f1ee', '#6b6b6b'],
    '半加工室': ['#ccfbf1', '#134e4a'], 'AtoZ': ['#cffafe', '#164e63'],
    '翌日準備': ['#e0e7ff', '#312e81'], '応援': ['#fce7f3', '#831843']
  };
  var PALETTE = [['#e0f2fe', '#0c4a6e'], ['#fae8ff', '#701a75'], ['#dcfce7', '#14532d'], ['#ffedd5', '#7c2d12'],
    ['#e0e7ff', '#312e81'], ['#fef3c7', '#78350f'], ['#ccfbf1', '#134e4a'], ['#fce7f3', '#831843']];

  function color(task) {
    if (TASK_COLORS[task]) return TASK_COLORS[task];
    var h = 0;
    for (var i = 0; i < task.length; i++) h = (h * 31 + task.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function chip(task, cls) {
    var c = color(task);
    return '<span class="chip ' + (cls || '') + '" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(task) + '</span>';
  }
  function v(x, unit) { return (x === null || x === undefined || x === '') ? '―' : esc(x) + (unit || ''); }
  function n1(x) { return Math.round(x * 10) / 10; }

  function jpDate(s) {
    if (!s) return '';
    var a = s.split('-');
    var d = new Date(+a[0], +a[1] - 1, +a[2]);
    return (+a[1]) + '/' + (+a[2]) + '(' + WEEK[d.getDay()] + ')';
  }
  function relDay(s) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var a = s.split('-');
    var d = new Date(+a[0], +a[1] - 1, +a[2]);
    var diff = Math.round((d - t) / 86400000);
    if (diff === 0) return { t: '今日', past: false };
    if (diff === 1) return { t: '明日', past: false };
    if (diff === 2) return { t: 'あさって', past: false };
    if (diff < 0) return { t: (-diff) + '日前', past: true };
    return { t: diff + '日後', past: false };
  }

  function slotLabel(slots, i) {
    var end = slots[i + 1];
    if (!end) { var p = slots[i].split(':'); end = (+p[0] + 1) + ':' + p[1]; }
    return slots[i] + '–' + end;
  }

  // 連続した同じ作業をまとめる
  function runs(tasks) {
    var out = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i] || '';
      if (out.length && out[out.length - 1].t === t) out[out.length - 1].n++;
      else out.push({ t: t, n: 1, i: i });
    }
    return out;
  }

  // ---------- 部品 ----------
  function heroHTML(plan) {
    var n = plan.naizo || {}, p = plan.pack || {};
    var todayItems = countPositive(plan.today);
    var urgent = countUrgent(plan.today);
    var leaders = (p.leaders || []).map(function (l) { return esc(l.role) + ' <b>' + esc(l.name) + '</b>'; }).join('<br>');
    return '<div class="hero">' +
      '<div class="room"><div class="lbl">内臓作業室</div>' +
      '<div class="big">' + v(n.packs) + '<small>パック</small></div>' +
      '<div class="kv">入荷 <b>' + v(n.heads, '頭') + '</b>　終了予定 <b>' + v(n.endPlan) + '</b><br>責任者 <b>' + v(n.leader) + '</b></div></div>' +
      '<div class="room"><div class="lbl">精肉パック作業室</div>' +
      '<div class="big">' + v(p.packs) + '<small>パック</small></div>' +
      '<div class="kv">出勤 <b>' + v(p.attendance, '名') + '</b>　終了予定 <b>' + v(p.endPlan) + '</b>' + (leaders ? '<br>' + leaders : '') + '</div></div>' +
      '<div class="flag">' +
      (todayItems ? '<span class="pill red">当日分あり ' + todayItems + '品目</span>' : '<span class="pill gray">当日分なし</span>') +
      (urgent ? '<span class="pill red">急ぎ ' + urgent + '</span>' : '') +
      '<span style="color:#bdbdb8;font-size:12px">翌日分 合計 ' + n1((plan.next && plan.next.total) || 0) + '</span>' +
      '</div></div>';
  }

  function countPositive(sum) {
    var c = 0;
    ((sum && sum.groups) || []).forEach(function (g) { g.items.forEach(function (i) { if (i.qty > 0) c++; }); });
    return c;
  }
  function countUrgent(sum) {
    var c = 0;
    ((sum && sum.groups) || []).forEach(function (g) { g.items.forEach(function (i) { if (i.urgent) c++; }); });
    return c;
  }

  function allNames(plan) {
    var seen = {}, out = [];
    [plan.naizo, plan.pack].forEach(function (room) {
      ((room && room.staff) || []).forEach(function (s) { if (!seen[s.name]) { seen[s.name] = 1; out.push(s.name); } });
    });
    return out;
  }

  function meHTML(plan, me) {
    var names = allNames(plan);
    var opts = '<option value="">名前を選ぶと自分の予定が出ます</option>' + names.map(function (nm) {
      return '<option' + (nm === me ? ' selected' : '') + '>' + esc(nm) + '</option>';
    }).join('');
    var body = '';
    if (me) {
      var blocks = [];
      [['内臓作業室', plan.naizo], ['精肉パック作業室', plan.pack]].forEach(function (pair) {
        var room = pair[1];
        if (!room || !room.staff) return;
        var s = room.staff.filter(function (x) { return x.name === me; })[0];
        if (!s) return;
        var inner;
        if (s.status) {
          inner = '<div class="me-off">' + esc(s.status) + '</div>';
        } else {
          var items = runs(s.tasks).filter(function (r) { return r.t; }).map(function (r) {
            var a = room.slots[r.i], endIdx = r.i + r.n;
            var b = room.slots[endIdx] || slotLabel(room.slots, endIdx - 1).split('–')[1];
            return '<div class="me-item"><span class="tm">' + esc(a) + '–' + esc(b) + '</span>' + chip(r.t, 'inline') + '</div>';
          });
          inner = items.length ? '<div class="me-list">' + items.join('') + '</div>' : '<div class="muted">この作業室での割り当てはありません</div>';
        }
        blocks.push('<div class="me-block"><div class="room-name">' + pair[0] + '　<span style="font-weight:400">' + esc(s.shift) + '</span></div>' + inner + '</div>');
      });
      body = blocks.length ? blocks.join('') : '<div class="muted" style="margin-top:8px">この日の指示書に名前がありません</div>';
    }
    return '<div class="card"><h2><span class="num">MY</span>自分の予定</h2>' +
      '<div class="me-row"><select data-me>' + opts + '</select></div>' + body + '</div>';
  }

  function timetableHTML(room, me) {
    var working = room.staff.filter(function (s) { return !s.status; });
    var off = room.staff.filter(function (s) { return s.status; });
    var head = '<tr><th class="nm"></th>' + room.slots.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr>';
    var rows = working.map(function (s) {
      var cells = runs(s.tasks).map(function (r) {
        return '<td class="slot" colspan="' + r.n + '">' + (r.t ? chip(r.t) : '') + '</td>';
      }).join('');
      return '<tr' + (s.name === me ? ' class="me"' : '') + '><td class="nm"><b>' + esc(s.name) + '</b><span>' + esc(s.shift) + '</span></td>' + cells + '</tr>';
    }).join('');
    var offHtml = '';
    if (off.length) {
      var byStatus = {};
      off.forEach(function (s) { (byStatus[s.status] = byStatus[s.status] || []).push(s.name); });
      offHtml = Object.keys(byStatus).map(function (k) {
        return '<div class="off-line"><b>' + esc(k) + '（' + byStatus[k].length + '名）</b>' +
          byStatus[k].map(function (nm) { return '<span class="n">' + esc(nm) + '</span>'; }).join('') + '</div>';
      }).join('');
    }
    return '<div class="card"><h2><span class="num">01</span>人員配置 <span class="muted">出勤 ' + working.length + '名</span></h2>' +
      (working.length ? '<div class="tt-scroll"><table class="tt"><colgroup><col class="nmcol">' + room.slots.map(function () { return '<col>'; }).join('') + '</colgroup><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">配置の入力がありません</div>') +
      offHtml + '</div>';
  }

  function naizoHTML(plan, me, showZero) {
    var n = plan.naizo || {};
    var kpi = '<div class="kpis">' +
      '<div class="kpi"><div class="k">入荷頭数</div><div class="v">' + v(n.heads, '頭') + '</div><div class="s">昨日 ' + v(n.yesterday && n.yesterday.heads, '頭') + '</div></div>' +
      '<div class="kpi"><div class="k">総パック数</div><div class="v">' + v(n.packs) + '</div><div class="s">昨日 ' + v(n.yesterday && n.yesterday.packs) + '</div></div>' +
      '<div class="kpi"><div class="k">作業終了予定</div><div class="v">' + v(n.endPlan) + '</div><div class="s">昨日 ' + v(n.yesterday && n.yesterday.endTime) + '</div></div>' +
      '<div class="kpi"><div class="k">現場責任者</div><div class="v">' + v(n.leader) + '</div></div></div>';
    var note = n.notes ? '<div class="note"><span class="t">特注・特記事項</span>' + esc(n.notes) + '</div>' : '';
    var prods = (n.products || []);
    var shown = prods.filter(function (p) { return showZero || p.todayQty > 0 || p.nextQty > 0 || p.todayNote || p.nextNote; });
    var rows = shown.map(function (p) {
      var zero = !(p.todayQty > 0 || p.nextQty > 0);
      return '<tr' + (zero ? ' class="zero"' : '') + '><td>' + esc(p.name) + (p.weight ? '<span class="w">' + esc(p.weight) + '</span>' : '') +
        (p.todayNote ? '<span class="nt">当日：' + esc(p.todayNote) + '</span>' : '') +
        (p.nextNote ? '<span class="nt">翌日：' + esc(p.nextNote) + '</span>' : '') + '</td>' +
        '<td class="q">' + (p.todayQty ? '<b>' + n1(p.todayQty) + '</b>' : '<span class="muted">0</span>') + '</td>' +
        '<td class="q"><b>' + n1(p.nextQty) + '</b></td>' +
        '<td class="q muted">' + (p.genbokuNext ? n1(p.genbokuNext) : '') + '</td></tr>';
    }).join('');
    var table = '<div class="card"><div class="toolbar"><h2 style="margin:0"><span class="num">02</span>商品別 作業予定</h2>' +
      '<label class="switch"><input type="checkbox" data-zero' + (showZero ? ' checked' : '') + '>0の商品も表示</label></div>' +
      (shown.length ? '<table class="list"><thead><tr><th>商品名</th><th class="q">当日分</th><th class="q">翌日分</th><th class="q">必要原木</th></tr></thead><tbody>' + rows +
        '</tbody><tfoot><tr><td>合計</td><td class="q">' + n1(n.totalToday || 0) + '</td><td class="q">' + n1(n.totalNext || 0) + '</td><td></td></tr></tfoot></table>'
        : '<div class="empty">作業予定の商品はありません</div>') + '</div>';
    return kpi + note + timetableHTML({ staff: n.staff || [], slots: n.slots || [] }, me) + table;
  }

  function packHTML(plan, me) {
    var p = plan.pack || {};
    var leaders = (p.leaders || []);
    var kpi = '<div class="kpis">' +
      '<div class="kpi"><div class="k">総パック数</div><div class="v">' + v(p.packs) + '</div><div class="s">昨日 ' + v(p.yesterday && p.yesterday.packs) + '</div></div>' +
      '<div class="kpi"><div class="k">作業終了予定</div><div class="v">' + v(p.endPlan) + '</div><div class="s">昨日 ' + v(p.yesterday && p.yesterday.endTime) + '</div></div>' +
      leaders.slice(0, 2).map(function (l) {
        return '<div class="kpi"><div class="k">' + esc(l.role) + ' 責任者</div><div class="v">' + esc(l.name) + '</div></div>';
      }).join('') + '</div>';
    var note = p.notes ? '<div class="note"><span class="t">特記・その他の連絡事項</span>' + esc(p.notes) + '</div>' : '';
    return kpi + note + timetableHTML({ staff: p.staff || [], slots: p.slots || [] }, me);
  }

  function summaryHTML(sum, title, showZero) {
    if (!sum) return '<div class="empty">データがありません</div>';
    var exp = (sum.expiries || []).map(function (e) {
      return '<span class="pill line">' + esc(e.label) + '：賞味 ' + esc(jpDate(e.date)) + '</span>';
    }).join('');
    var anyPositive = false;
    var cards = sum.groups.map(function (g) {
      var total = 0;
      var items = g.items.filter(function (i) { total += i.qty; return showZero || i.qty > 0; });
      if (total > 0) anyPositive = true;
      if (!showZero && total === 0) return '';
      var rows = items.map(function (i) {
        return '<tr' + (i.qty > 0 ? '' : ' class="zero"') + '><td>' + esc(i.name) + (i.urgent ? '<span class="urg">急ぎ</span>' : '') +
          '</td><td class="q"><b>' + n1(i.qty) + '</b></td></tr>';
      }).join('');
      return '<div class="card"><div class="g-head"><h3>' + esc(g.name) + '</h3><span class="sum">計 <b>' + n1(total) + '</b></span></div>' +
        '<table class="list"><tbody>' + rows + '</tbody></table></div>';
    }).join('');
    return '<div class="toolbar"><div class="exp">' + exp + '</div>' +
      '<label class="switch"><input type="checkbox" data-zero' + (showZero ? ' checked' : '') + '>0の商品も表示</label></div>' +
      (anyPositive || showZero ? '<div class="groups">' + cards + '</div>' : '<div class="card"><div class="empty"><b style="font-size:16px;color:var(--ink)">' + esc(title) + 'はありません</b></div></div>');
  }

  // ---------- 本体 ----------
  var SECTIONS = [['naizo', '内臓作業室'], ['pack', '精肉パック'], ['today', '当日分'], ['next', '翌日分']];

  function render(el, plan, opt) {
    opt = opt || {};
    var state = { sec: opt.section || 'naizo', me: opt.me || '', zero: false };

    function draw() {
      var body;
      if (state.sec === 'naizo') body = naizoHTML(plan, state.me, state.zero);
      else if (state.sec === 'pack') body = packHTML(plan, state.me);
      else if (state.sec === 'today') body = summaryHTML(plan.today, '当日分', state.zero);
      else body = summaryHTML(plan.next, '翌日分', state.zero);

      el.innerHTML = heroHTML(plan) + meHTML(plan, state.me) +
        '<div class="seg small" role="tablist" style="margin:0 0 12px">' + SECTIONS.map(function (s) {
          return '<button role="tab" data-sec="' + s[0] + '" aria-selected="' + (s[0] === state.sec) + '">' + s[1] + '</button>';
        }).join('') + '</div>' + body;

      el.querySelector('[data-me]').onchange = function (e) {
        state.me = e.target.value;
        if (opt.onMeChange) opt.onMeChange(state.me);
        draw();
      };
      [].forEach.call(el.querySelectorAll('[data-sec]'), function (b) {
        b.onclick = function () { state.sec = b.getAttribute('data-sec'); if (opt.onSection) opt.onSection(state.sec); draw(); };
      });
      var z = el.querySelector('[data-zero]');
      if (z) z.onchange = function () { state.zero = z.checked; draw(); };
    }
    draw();
  }

  root.PlanView = { render: render, jpDate: jpDate, relDay: relDay, esc: esc };
})(window);
