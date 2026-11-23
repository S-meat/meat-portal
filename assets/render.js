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
      '<div class="room"><div class="lbl">精肉パック作業室</div>' +
      '<div class="big">' + v(p.packs) + '<small>パック</small></div>' +
      '<div class="kv">出勤 <b>' + v(p.attendance, '名') + '</b>　終了予定 <b>' + v(p.endPlan) + '</b>' + (leaders ? '<br>' + leaders : '') + '</div></div>' +
      '<div class="room"><div class="lbl">内臓作業室</div>' +
      '<div class="big">' + v(n.packs) + '<small>パック</small></div>' +
      '<div class="kv">入荷 <b>' + v(n.heads, '頭') + '</b>　終了予定 <b>' + v(n.endPlan) + '</b><br>責任者 <b>' + v(n.leader) + '</b></div></div>' +
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
      [['精肉パック作業室', plan.pack], ['内臓作業室', plan.naizo]].forEach(function (pair) {
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

  // ---------- ギフト予定 ----------
  function ymd(d) { return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }
  function giftHTML(gift, state, opt) {
    opt = opt || {};
    if (state === 'loading') return '<div class="card"><div class="empty">ギフト予定を読み込み中…</div></div>';
    if (!gift) return '<div class="card"><div class="empty"><b style="font-size:15px;color:var(--ink)">ギフト予定はまだありません</b><br>バランス照会を取り込むと表示されます。</div></div>';
    // 表示期間：投稿（取り込み）日の2日後から7日分（日がたっても期間は動かない）
    var upd = gift.updatedAt || gift.importedAt;
    var t = upd ? new Date(upd) : new Date(); t.setDate(t.getDate() + 2);
    var from = ymd(t); t.setDate(t.getDate() + 6);
    var to = ymd(t);
    var days = opt.all ? gift.dates.slice() : gift.dates.filter(function (d) { return d.date >= from && d.date <= to; });
    var range = days.length ? days[0].label.replace(/\(.\)$/, '') + '〜' + days[days.length - 1].label.replace(/\(.\)$/, '') : '';
    var updText = '';
    if (upd) { var u = new Date(upd); updText = (u.getMonth() + 1) + '/' + u.getDate() + ' ' + u.getHours() + ':' + ('0' + u.getMinutes()).slice(-2) + ' 取り込み'; }
    if (!days.length) return '<div class="card"><div class="empty">表示できるギフト予定がありません（' + esc(updText) + '）<br>新しいバランス照会を取り込んでください。</div></div>';
    var head = '<tr><th class="gn">品目</th>' + days.map(function (d) {
      var wk = d.label.replace(/^.*\(/, '').replace(')', '');
      return '<th class="q' + (wk === '土' ? ' sat' : wk === '日' ? ' sun' : '') + '">' + esc(d.label.replace(/\(.\)$/, '')) + '<small>' + esc(wk) + '</small></th>';
    }).join('') + '</tr>';
    var rows = gift.items.map(function (it) {
      return '<tr><td class="gn"><b>' + esc(it.name) + '</b>' + (it.unit ? '<span>' + esc(it.unit === 'P' ? 'パック' : it.unit) + '</span>' : '') + '</td>' + days.map(function (d) {
        var v = it.values[d.date] || 0;
        return '<td class="q">' + (v ? '<b>' + n1(v) + '</b>' : '<span class="z">–</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="card"><div class="toolbar"><h2 style="margin:0"><span class="num">GIFT</span>' + (opt.all ? 'ギフト予定（取り込み内容）' : 'ギフト予定 ' + esc(range)) + '</h2><span class="muted">' + esc(updText) + '</span></div>' +
      '<div class="gift-scroll"><table class="gift"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted" style="margin:8px 0 0">単位：ヒレ＝本、ロース切身・味噌＝枚、しゃぶ・スライス＝パック</p></div>';
  }

  // ---------- 本体 ----------
  var SECTIONS = [['pack', '精肉パック'], ['naizo', '内臓作業室'], ['today', '当日分'], ['next', '翌日分'], ['gift', 'ギフト']];

  function render(el, plan, opt) {
    opt = opt || {};
    var state = { sec: opt.section || 'pack', me: opt.me || '', zero: false, gift: opt.gift || null, giftState: opt.gift ? 'done' : 'loading' };

    function draw() {
      var body;
      if (state.sec === 'naizo') body = naizoHTML(plan, state.me, state.zero);
      else if (state.sec === 'pack') body = packHTML(plan, state.me);
      else if (state.sec === 'gift') body = giftHTML(state.gift, state.giftState);
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
    return {
      setGift: function (g) { state.gift = g; state.giftState = 'done'; if (state.sec === 'gift') draw(); }
    };
  }

  // ---------- 本日の共有 ----------
  function renderShare(el, share) {
    var groups = share.groups || [];
    var html = '<div id="shureiBox"></div><div class="share-intro">Slack #101 報告・連絡の投稿を、要点だけ読みやすく整理しています。</div>';
    if (!groups.length) html += '<div class="card"><div class="empty">#101 報告・連絡の新しい投稿はありません</div></div>';
    groups.forEach(function (g) {
      html += '<div class="card share-group"><div class="g-head"><h3>' + esc(g.channel.replace(/^\d+-/, '').replace(/_/g, '・')) + '</h3><span class="sum">' + g.posts.length + '件</span></div>';
      g.posts.forEach(function (p, idx) {
        var body = '';
        (p.sections || []).forEach(function (sec) {
          body += (sec.title ? '<div class="sh-title">' + esc(sec.title) + '</div>' : '') +
            '<ul class="sh-lines">' + sec.lines.map(function (l) {
              var m = l.match(/^(.+?)：(.*)$/);
              return '<li>' + (m && m[1].length <= 20 ? '<b>' + esc(m[1]) + '</b>：' + esc(m[2]) : esc(l)) + '</li>';
            }).join('') + '</ul>';
        });
        // PDFは終礼ノートだけ（一番上のカードに表示）。取引先などの資料は表示しない
        var isShurei = /終礼ノート/.test(g.channel) && (p.pdfs || []).length;
        if (isShurei) body += '<div class="pdf-note">↑ 終礼ノートは一番上に表示しています</div>';
        else if (!body) body = '<div class="muted">資料の共有です。くわしくはSlackで確認してください。</div>';
        html += '<div class="sh-post' + (idx ? ' sep' : '') + '"><div class="sh-meta">' + esc(p.date) + ' ' + esc(p.time) + '　' + esc(p.author) +
          (p.link ? '<a class="sh-link" href="' + esc(p.link) + '" target="_blank" rel="noopener">Slackで見る</a>' : '') + '</div>' +
          '<div class="sh-body">' + body + '</div></div>';
      });
      html += '</div>';
    });
    el.innerHTML = html;
    // 長い投稿はたたむ
    [].forEach.call(el.querySelectorAll('.sh-body'), function (b) {
      if (b.querySelector('.pdf-inline')) return;
      if (b.scrollHeight > 480) {
        b.classList.add('clamp');
        var more = document.createElement('button');
        more.className = 'sh-more'; more.textContent = '続きを読む';
        more.onclick = function () { b.classList.remove('clamp'); more.remove(); };
        b.parentNode.appendChild(more);
      }
    });
  }

  function renderNotes(el, notes) {
    if (!notes || !notes.length) { el.innerHTML = ''; return; }
    var n = notes[0];
    var more = notes.slice(1, 4).map(function (x) {
      return '<button class="pdf-link" data-pdf="' + esc(x.pdfs[0].id) + '" data-title="終礼ノート ' + esc(x.date) + '">' + esc(x.date) + ' ' + esc(x.time) + '</button>';
    }).join('');
    el.innerHTML = '<div class="card shurei"><div class="shurei-top"><div><span class="num">PDF</span><b>終礼ノート</b><small>' + esc(n.date) + ' ' + esc(n.time) + ' に共有　・ページを押すと拡大できます</small></div></div>' +
      n.pdfs.map(function (f) { return '<div class="pdf-inline eager" data-pdf="' + esc(f.id) + '" data-title="終礼ノート ' + esc(n.date) + '"><div class="pdf-ph">終礼ノートを読み込み中…</div></div>'; }).join('') +
      (more ? '<div class="shurei-more"><span>前の終礼ノート：</span>' + more + '</div>' : '') + '</div>';
  }

  root.PlanView = { render: render, giftHTML: giftHTML, renderShare: renderShare, renderNotes: renderNotes, jpDate: jpDate, relDay: relDay, esc: esc };
})(window);
