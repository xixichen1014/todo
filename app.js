/*!
 * 一件件 · app.js
 * 单页待办清单。
 * 渲染策略：页面骨架只建一次，之后只更新变化的那一块（头部/筛选/列表），
 * 勾选、点选项都只切类名，不重建 DOM —— 避免整页闪烁。
 */
(function () {
  'use strict';

  var C = window.TodoCore;
  var STORE_KEY = 'yijianjian.db.v1';

  var S = {
    db: null,
    filter: 'today',
    query: '',
    searchOpen: false,
    sheet: null,
    form: null,
    toastTimer: null,
    pendingList: null
  };

  /* ============================== 工具 ============================== */
  function $(sel, el) { return (el || document).querySelector(sel); }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function today() { return C.todayISO(); }

  var ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 21V4.5M5 5h12l-2.5 4L17 13H5"/></svg>'
  };

  function toast(msg, actionLabel, actionFn) {
    var el = document.getElementById('toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' +
      (actionLabel ? '<button class="toast-act" id="toast-act">' + esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    el.classList.add('is-on');
    clearTimeout(S.toastTimer);
    if (actionFn) {
      var b = document.getElementById('toast-act');
      if (b) b.addEventListener('click', function () { actionFn(); hideToast(); });
    }
    S.toastTimer = setTimeout(hideToast, actionFn ? 4000 : 1900);
  }
  function hideToast() {
    var el = document.getElementById('toast');
    el.classList.remove('is-on');
    setTimeout(function () { el.hidden = true; }, 220);
  }

  /* ============================== 存储 ============================== */
  var saveTimer = null;
  function save(immediate) {
    if (immediate) { persist(); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 120);
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.db)); }
    catch (e) { toast('保存失败：存储空间可能已满'); }
  }

  /* ============================== 骨架（只建一次） ============================== */
  function mount() {
    document.getElementById('app').innerHTML =
      '<header class="head" id="hdr"></header>' +
      '<div class="filters" id="filters"></div>' +
      '<div id="list-wrap"></div>' +
      '<button class="fab" data-act="add" aria-label="新任务">' + ICONS.plus + '</button>';
    updateHeader();
    updateFilters();
    renderList();
  }

  function updateHeader() {
    var hdr = document.getElementById('hdr');
    if (!hdr) return;

    // 首次挂载（空容器）或"搜索栏出现/消失"时才重建，其余情况只改数字，
    // 这样输入搜索词、勾任务都不会打断焦点或闪烁。
    var hasBar = !!hdr.querySelector('.search-bar');
    if (!hdr.firstElementChild || hasBar !== S.searchOpen) {
      hdr.innerHTML = headerInner();
      return;
    }

    var st = C.stats(S.db, today());
    var b = hdr.querySelector('.today-top b');
    if (b) b.textContent = st.todayDone + ' / ' + st.todayTotal;
    var bar = hdr.querySelector('.today-bar i');
    if (bar) bar.style.width = Math.min(100, st.todayPct) + '%';
    var sub = hdr.querySelector('.head-date');
    if (sub) sub.textContent = dateLine() + ' · ' + subLine(st);
  }

  function dateLine() {
    var d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + C.weekdayLabel(today());
  }

  function subLine(st) {
    if (st.pending === 0) return '全部完成，休息一下 🎉';
    if (st.overdue > 0) return '还有 ' + st.pending + ' 件事，其中 ' + st.overdue + ' 件已逾期';
    return '还有 ' + st.pending + ' 件事';
  }

  function updateFilters() {
    var f = document.getElementById('filters');
    if (f) f.innerHTML = filtersInner();
  }

  function renderList() {
    var wrap = document.getElementById('list-wrap');
    if (!wrap) return;
    wrap.innerHTML = listInner();
  }

  /* ============================== 片段 ============================== */
  function headerInner() {
    var st = C.stats(S.db, today());
    var dateText = dateLine();
    var sub = subLine(st);

    return '<div class="head-row">' +
      '<div>' +
      '<h1>一件件</h1>' +
      '<p class="head-date">' + dateText + ' · ' + sub + '</p>' +
      '</div>' +
      '<div class="head-actions">' +
      '<button class="icon-btn" data-act="toggle-search" aria-label="搜索">' + ICONS.search + '</button>' +
      '<button class="icon-btn" data-act="open-settings" aria-label="设置">' + ICONS.gear + '</button>' +
      '</div>' +
      '</div>' +
      (S.searchOpen
        ? '<div class="search-bar"><input id="search-input" type="search" placeholder="搜索任务…" value="' + esc(S.query) + '"><button class="icon-btn" data-act="toggle-search">' + ICONS.close + '</button></div>'
        : '') +
      '<div class="today-card">' +
      '<div class="today-top"><span>今天的进度</span><b>' + st.todayDone + ' / ' + st.todayTotal + '</b></div>' +
      '<div class="today-bar"><i style="width:' + Math.min(100, st.todayPct) + '%"></i></div>' +
      '</div>';
  }

  function filtersInner() {
    var all = C.filterTasks(S.db, 'all', { today: today() });
    var pending = all.filter(function (t) { return !t.done; });
    var done = all.filter(function (t) { return t.done; });
    var todayList = C.filterTasks(S.db, 'today', { today: today() });

    var items = [
      { key: 'today', label: '今天', n: todayList.length },
      { key: 'pending', label: '待办', n: pending.length },
      { key: 'done', label: '已完成', n: done.length },
      { key: 'all', label: '全部', n: all.length }
    ];
    return items.map(function (it) {
      return '<button class="filter' + (S.filter === it.key ? ' on' : '') + '" data-act="filter" data-f="' + it.key + '">' +
        it.label + (it.n ? '<b>' + it.n + '</b>' : '') + '</button>';
    }).join('');
  }

  function listInner() {
    var tasks = C.filterTasks(S.db, S.filter, { today: today(), query: S.query });
    var todayStr = today();

    if (!tasks.length) {
      return '<div class="empty">' +
        '<div class="empty-ico">' + (S.query ? '🔍' : '🌤') + '</div>' +
        '<p>' + (S.query ? '没找到相关任务' : (S.filter === 'done' ? '还没有完成的任务' : '这里空空如也')) + '</p>' +
        (S.query ? '' : '<button class="btn" data-act="add">添加一件事</button>') +
        '</div>';
    }

    var doneTasks = tasks.filter(function (t) { return t.done; });
    var openTasks = tasks.filter(function (t) { return !t.done; });

    var html = '';
    if (openTasks.length) {
      C.groupTasks(openTasks, todayStr).forEach(function (g) {
        html += groupHTML(g.title, g.key, g.tasks, todayStr);
      });
    }
    if (doneTasks.length) {
      html += '<section class="group">' +
        '<div class="group-head"><span>已完成</span><i>' + doneTasks.length + '</i></div>' +
        doneTasks.map(function (t) { return taskHTML(t, todayStr); }).join('') +
        '</section>';
    }
    return html;
  }

  function groupHTML(title, key, tasks, todayStr) {
    return '<section class="group">' +
      '<div class="group-head"><span class="' + (key === 'overdue' ? 'overdue' : '') + '">' + title + '</span><i>' + tasks.length + '</i></div>' +
      tasks.map(function (t) { return taskHTML(t, todayStr); }).join('') +
      '</section>';
  }

  function taskHTML(t, todayStr) {
    var list = C.listById(S.db, t.listId);
    var prio = C.priorityOf(t.priority);
    var dueText = C.dueLabel(t.due, todayStr);
    var overdue = !t.done && C.isOverdue(t.due, todayStr);

    var meta = [];
    if (dueText) {
      meta.push('<span class="due' + (overdue ? ' is-overdue' : (t.due === todayStr ? ' is-today' : '')) + '">' +
        (overdue ? '⚠︎ ' : '') + esc(dueText) + '</span>');
    }
    if (list) meta.push('<span class="tag" style="color:' + list.color + '"><i style="background:' + list.color + '"></i>' + esc(list.name) + '</span>');
    if (t.note) meta.push('<span class="note">' + esc(t.note) + '</span>');

    return '<div class="task' + (t.done ? ' is-done' : '') + '" data-act="edit" data-id="' + t.id + '">' +
      (t.priority > 0 && !t.done ? '<span class="prio" style="background:' + prio.color + '"></span>' : '') +
      '<button class="check' + (t.done ? ' on' : '') + '" data-act="toggle" data-id="' + t.id + '" aria-label="完成">' + ICONS.check + '</button>' +
      '<div class="task-main">' +
      '<div class="task-title">' + esc(t.title) + '</div>' +
      (meta.length ? '<div class="task-meta">' + meta.join('<span class="dot">·</span>') + '</div>' : '') +
      '</div>' +
      '</div>';
  }

  /* ============================== 面板 ============================== */
  function renderSheet() {
    var root = document.getElementById('sheet-root');
    var html = '';
    if (S.sheet && S.sheet.name === 'task') html = taskSheetHTML();
    else if (S.sheet && S.sheet.name === 'settings') html = settingsSheetHTML();
    else if (S.sheet && S.sheet.name === 'confirm') html = confirmHTML();
    root.innerHTML = '<div class="sheet-backdrop" data-act="close-sheet"></div>' + html;
  }

  function closeSheet() {
    S.sheet = null;
    S.form = null;
    document.getElementById('sheet-root').innerHTML = '';
  }

  function openSheet(name, data) {
    S.sheet = Object.assign({ name: name }, data || {});
    renderSheet();
  }

  function dateChipsInner() {
    var f = S.form;
    var t = today();
    var presets = [
      { v: t, label: '今天' },
      { v: C.addDays(t, 1), label: '明天' },
      { v: C.addDays(t, 2), label: '后天' }
    ];
    var custom = f.due && !presets.some(function (d) { return d.v === f.due; });

    return presets.map(function (d) {
      return '<button class="chip' + (f.due === d.v ? ' on' : '') + '" data-act="f-due" data-v="' + d.v + '">' + d.label + '</button>';
    }).join('') +
      '<label class="chip' + (custom ? ' on' : '') + '">' +
      (custom ? esc(C.mdLabel(f.due)) : '选日期') +
      '<input type="date" id="f-date" value="' + (f.due || '') + '" style="position:absolute;inset:0;opacity:0">' +
      '</label>' +
      (f.due ? '<button class="chip chip--clear" data-act="f-due" data-v="">清除</button>' : '');
  }

  function taskSheetHTML() {
    var f = S.form;
    var isEdit = !!f.id;

    return '<div class="sheet">' +
      '<div class="sheet-head">' +
      '<button class="text-btn" data-act="close-sheet">取消</button>' +
      '<h3>' + (isEdit ? '编辑任务' : '新任务') + '</h3>' +
      '<button class="text-btn primary' + (f.title.trim() ? ' is-ready' : '') + '" data-act="save-task">保存</button>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<input id="f-title" class="title-input" type="text" maxlength="120" placeholder="要做点什么？" value="' + esc(f.title) + '">' +
      '<textarea id="f-note" class="note-input" rows="2" maxlength="200" placeholder="备注（可选）">' + esc(f.note) + '</textarea>' +

      '<div class="field"><div class="field-label">' + ICONS.calendar + '截止日期</div>' +
      '<div class="chips" id="f-date-chips">' + dateChipsInner() + '</div></div>' +

      '<div class="field"><div class="field-label">' + ICONS.flag + '优先级</div>' +
      '<div class="chips">' + C.PRIORITIES.map(function (p) {
        return '<button class="chip' + (f.priority === p.level ? ' on' : '') + '" data-act="f-prio" data-v="' + p.level + '">' +
          (p.level ? '<i class="pdot" style="background:' + p.color + '"></i>' : '') + p.name + '</button>';
      }).join('') + '</div></div>' +

      '<div class="field"><div class="field-label">清单</div>' +
      '<div class="chips">' + S.db.lists.map(function (l) {
        return '<button class="chip' + (f.listId === l.id ? ' on' : '') + '" data-act="f-list" data-v="' + l.id + '">' +
          '<i class="pdot" style="background:' + l.color + '"></i>' + esc(l.name) + '</button>';
      }).join('') + '</div></div>' +

      (isEdit ? '<button class="del-line" data-act="del-task">删除这个任务</button>' : '') +
      '</div></div>';
  }

  function settingsSheetHTML() {
    var st = C.stats(S.db, today());
    return '<div class="sheet">' +
      '<div class="sheet-head"><h3>设置</h3><button class="close-btn" data-act="close-sheet">' + ICONS.close + '</button></div>' +
      '<div class="sheet-body">' +
      '<div class="stat-row">' +
      '<div class="stat"><b>' + st.pending + '</b><span>待办</span></div>' +
      '<div class="stat"><b>' + st.done + '</b><span>已完成</span></div>' +
      '<div class="stat"><b>' + st.doneToday + '</b><span>今日完成</span></div>' +
      '</div>' +
      '<button class="line" data-act="export"><span>导出备份</span><b>' + S.db.tasks.length + ' 条</b></button>' +
      '<button class="line" data-act="import"><span>导入备份</span></button>' +
      '<button class="line" data-act="clear-done"><span>清空已完成</span><b>' + st.done + ' 条</b></button>' +
      '<button class="line danger" data-act="clear-all"><span>清空所有任务</span></button>' +
      '<p class="hint">数据只保存在这台设备的浏览器里，不会上传服务器。<br>换手机前请先导出备份。</p>' +
      '</div></div>';
  }

  function confirmHTML() {
    var f = S.sheet;
    return '<div class="dialog-wrap"><div class="dialog">' +
      '<h3>' + esc(f.title) + '</h3><p>' + esc(f.message) + '</p>' +
      '<div class="dialog-actions">' +
      '<button class="btn ghost" data-act="close-sheet">取消</button>' +
      '<button class="btn danger" data-act="confirm-ok">' + esc(f.confirmText || '确定') + '</button>' +
      '</div></div></div>';
  }

  /* ============================== 动作 ============================== */
  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    var v = el.getAttribute('data-v');

    switch (act) {
      case 'filter':
        S.filter = el.getAttribute('data-f');
        S.query = '';
        S.searchOpen = false;
        updateHeader();
        updateFilters();
        renderList();
        break;

      case 'toggle-search':
        S.searchOpen = !S.searchOpen;
        if (!S.searchOpen) S.query = '';
        updateHeader();
        renderList();
        if (S.searchOpen) {
          setTimeout(function () {
            var inp = document.getElementById('search-input');
            if (inp) inp.focus();
          }, 30);
        }
        break;

      case 'add':
        S.form = { id: null, title: '', note: '', due: null, priority: 0, listId: S.db.lists[0].id };
        openSheet('task');
        setTimeout(function () { var i = document.getElementById('f-title'); if (i) i.focus(); }, 80);
        break;

      case 'edit': {
        var t = S.db.tasks.filter(function (x) { return x.id === id; })[0];
        if (!t) break;
        S.form = { id: t.id, title: t.title, note: t.note, due: t.due, priority: t.priority, listId: t.listId };
        openSheet('task');
        break;
      }

      case 'toggle': {
        var task = S.db.tasks.filter(function (x) { return x.id === id; })[0];
        if (!task) break;
        var nowDone = !task.done;
        task.done = nowDone;
        task.completedAt = nowDone ? Date.now() : null;
        save(true);

        // 就地切换样式，播完动画再重排列表（只重建列表，不动页面其它部分）
        var row = el.closest('.task');
        if (row) row.classList.toggle('is-done', nowDone);
        el.classList.toggle('on', nowDone);
        updateHeader();
        updateFilters();

        clearTimeout(S.pendingList);
        S.pendingList = setTimeout(renderList, 320);

        if (nowDone) {
          toast('已完成', '撤销', function () {
            task.done = false;
            task.completedAt = null;
            save(true);
            updateHeader();
            updateFilters();
            renderList();
          });
        }
        break;
      }

      case 'save-task': saveTask(); break;
      case 'del-task': askDeleteTask(); break;

      case 'f-due':
        S.form.due = v || null;
        document.getElementById('f-date-chips').innerHTML = dateChipsInner();
        break;

      case 'f-prio':
        S.form.priority = Number(v);
        markSelected('[data-act="f-prio"]', v);
        break;

      case 'f-list':
        S.form.listId = v;
        markSelected('[data-act="f-list"]', v);
        break;

      case 'open-settings': openSheet('settings'); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'clear-done': askClearDone(); break;
      case 'clear-all': askClearAll(); break;

      case 'confirm-ok':
        if (S.sheet && typeof S.sheet.onOk === 'function') {
          var fn = S.sheet.onOk;
          closeSheet();
          fn();
        }
        break;
      case 'close-sheet': closeSheet(); break;
    }
  }

  /** 只切选中态，不重建 DOM */
  function markSelected(selector, value) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('on', nodes[i].getAttribute('data-v') === value);
    }
  }

  function saveTask() {
    var f = S.form;
    var titleEl = document.getElementById('f-title');
    var noteEl = document.getElementById('f-note');
    if (titleEl) f.title = titleEl.value;
    if (noteEl) f.note = noteEl.value;
    var title = (f.title || '').trim();
    if (!title) { toast('写点什么吧'); if (titleEl) titleEl.focus(); return; }

    if (f.id) {
      S.db.tasks.forEach(function (t) {
        if (t.id !== f.id) return;
        t.title = title;
        t.note = (f.note || '').trim();
        t.due = f.due;
        t.priority = f.priority;
        t.listId = f.listId;
      });
    } else {
      S.db.tasks.push({
        id: C.uid('t'),
        title: title,
        note: (f.note || '').trim(),
        done: false,
        priority: f.priority,
        due: f.due,
        listId: f.listId,
        createdAt: Date.now(),
        completedAt: null
      });
      if (S.filter === 'done') S.filter = 'all';
      else if (S.filter === 'today' && (!f.due || f.due > today())) S.filter = 'pending';
    }
    save(true);
    var edited = !!f.id;
    closeSheet();
    updateHeader();
    updateFilters();
    renderList();
    toast(edited ? '已保存' : '加好了');
  }

  function askDeleteTask() {
    var id = S.form.id;
    openSheet('confirm', {
      title: '删除任务',
      message: '删除后无法恢复。',
      confirmText: '删除',
      onOk: function () {
        S.db.tasks = S.db.tasks.filter(function (t) { return t.id !== id; });
        save(true);
        updateHeader();
        updateFilters();
        renderList();
        toast('已删除');
      }
    });
  }

  function askClearDone() {
    openSheet('confirm', {
      title: '清空已完成',
      message: '所有已完成的任务都会被删除。',
      confirmText: '清空',
      onOk: function () {
        S.db.tasks = S.db.tasks.filter(function (t) { return !t.done; });
        save(true);
        updateHeader();
        updateFilters();
        renderList();
        toast('已清空');
      }
    });
  }

  function askClearAll() {
    openSheet('confirm', {
      title: '清空所有任务',
      message: '所有任务都会被删除，且无法恢复。',
      confirmText: '全部删除',
      onOk: function () {
        S.db.tasks = [];
        save(true);
        updateHeader();
        updateFilters();
        renderList();
        toast('已清空');
      }
    });
  }

  function exportData() {
    try {
      var blob = new Blob([JSON.stringify(S.db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '一件件-备份-' + today() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast('备份已导出');
    } catch (e) { toast('导出失败'); }
  }

  function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(String(reader.result)); } catch (e) { toast('文件不是有效的备份'); return; }
        if (!C.isValidDb(data)) { toast('备份文件格式不对'); return; }
        openSheet('confirm', {
          title: '导入备份',
          message: '导入会覆盖当前全部任务（' + S.db.tasks.length + ' 条），确定吗？',
          confirmText: '覆盖导入',
          onOk: function () {
            S.db = C.normalizeDb(data);
            save(true);
            updateHeader();
            updateFilters();
            renderList();
            toast('导入成功');
          }
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /* ============================== 启动 ============================== */
  function boot() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    var db = null;
    if (raw) { try { db = JSON.parse(raw); } catch (e) { db = null; } }

    if (db && C.isValidDb(db)) {
      S.db = C.normalizeDb(db);
    } else {
      S.db = C.createSeedData({ demo: /[?&]demo=1/.test(location.search) });
      persist();
    }

    var todayCount = C.filterTasks(S.db, 'today', { today: today() }).length;
    S.filter = todayCount ? 'today' : (S.db.tasks.length ? 'pending' : 'today');

    mount();

    document.addEventListener('click', onClick);
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'search-input') {
        S.query = t.value;
        renderList();               // 只更新列表，输入框不会失焦
      }
      if (t.id === 'f-title' && S.form) {
        S.form.title = t.value;
        var btn = document.querySelector('[data-act="save-task"]');
        if (btn) btn.classList.toggle('is-ready', !!t.value.trim());
      }
      if (t.id === 'f-note' && S.form) S.form.note = t.value;
      if (t.id === 'f-date' && S.form && t.value) {
        S.form.due = t.value;
        document.getElementById('f-date-chips').innerHTML = dateChipsInner();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!S.sheet) return;
      if (S.sheet.name === 'task' && e.key === 'Enter' && (e.target.id === 'f-title' || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveTask();
      }
      if (e.key === 'Escape') closeSheet();
    });

    registerSW();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
