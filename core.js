/*!
 * 一件件 · core.js
 * 纯数据层：日期工具、任务筛选/分组/排序、统计。不依赖 DOM。
 */
(function (root, factory) {
  var api = factory();
  root.TodoCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DB_VERSION = 1;

  /* ------------------------------ 日期 ------------------------------ */
  function pad2(n) { return String(n).padStart(2, '0'); }

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseYMD(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(iso, n) {
    var d = parseYMD(iso);
    d.setDate(d.getDate() + n);
    return todayISO(d);
  }

  /** a - b 的天数差（正数表示 a 晚于 b） */
  function daysBetween(a, b) {
    var da = parseYMD(a), db = parseYMD(b);
    return Math.round((da - db) / 86400000);
  }

  function weekdayLabel(iso) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseYMD(iso).getDay()];
  }

  /** 2026-10-25 -> "10月25日" */
  function mdLabel(iso) {
    var d = parseYMD(iso);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** 截止日期的口语化显示 */
  function dueLabel(iso, today) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    today = today || todayISO();
    var diff = daysBetween(iso, today);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff === -1) return '昨天';
    if (diff < 0) return '逾期 ' + (-diff) + ' 天';
    if (diff < 7) return weekdayLabel(iso);
    return mdLabel(iso);
  }

  function isOverdue(iso, today) {
    if (!iso) return false;
    return daysBetween(iso, today || todayISO()) < 0;
  }

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 7);
  }

  /* ------------------------------ 清单 ------------------------------ */
  var DEFAULT_LISTS = [
    { name: '默认', color: '#6366f1' },
    { name: '工作', color: '#0ea5e9' },
    { name: '生活', color: '#f97316' },
    { name: '学习', color: '#10b981' }
  ];

  var PRIORITIES = [
    { level: 0, name: '普通', color: '#cbd5e1' },
    { level: 1, name: '低', color: '#38bdf8' },
    { level: 2, name: '中', color: '#f59e0b' },
    { level: 3, name: '高', color: '#ef4444' }
  ];

  function createSeedData(opts) {
    opts = opts || {};
    var lists = DEFAULT_LISTS.map(function (l, i) {
      return { id: uid('l'), name: l.name, color: l.color, order: i };
    });
    var db = {
      version: DB_VERSION,
      tasks: [],
      lists: lists,
      settings: {}
    };
    if (opts.demo) seedDemo(db);
    return db;
  }

  /** 示例任务：让第一次打开就能看到效果（仅 ?demo=1 时使用） */
  function seedDemo(db) {
    var t = todayISO();
    var list = function (name) {
      var l = db.lists.filter(function (x) { return x.name === name; })[0];
      return l ? l.id : db.lists[0].id;
    };
    var rows = [
      { title: '把上周的周报补完', due: addDays(t, -2), priority: 3, list: '工作', note: '重点写清楚数据看板那部分' },
      { title: '交房租', due: t, priority: 3, list: '生活' },
      { title: '给妈妈打电话', due: t, priority: 1, list: '生活' },
      { title: '买牛奶和鸡蛋', due: t, priority: 0, list: '生活' },
      { title: '复习英语单词 30 个', due: addDays(t, 0), priority: 2, list: '学习' },
      { title: '预约下周的牙医', due: addDays(t, 1), priority: 2, list: '生活' },
      { title: '整理季度预算表', due: addDays(t, 2), priority: 1, list: '工作' },
      { title: '看完《深度工作》第三章', due: addDays(t, 4), priority: 0, list: '学习' },
      { title: '给自行车打气', due: null, priority: 0, list: '生活' },
      { title: '想一个周末去处', due: null, priority: 1, list: '生活' }
    ];
    var now = Date.now();
    rows.forEach(function (r, i) {
      db.tasks.push({
        id: uid('t'),
        title: r.title,
        note: r.note || '',
        done: false,
        priority: r.priority,
        due: r.due,
        listId: list(r.list),
        createdAt: now - i * 60000,
        completedAt: null
      });
    });
    // 两条已完成的
    db.tasks.push({
      id: uid('t'), title: '回复客户邮件', note: '', done: true, priority: 2,
      due: t, listId: list('工作'), createdAt: now - 3600000, completedAt: now - 1800000
    });
    db.tasks.push({
      id: uid('t'), title: '晨跑 3 公里', note: '', done: true, priority: 0,
      due: null, listId: list('生活'), createdAt: now - 7200000, completedAt: now - 3600000
    });
    return db;
  }

  function normalizeDb(db) {
    if (!db || typeof db !== 'object') return null;
    if (!Array.isArray(db.tasks)) db.tasks = [];
    if (!Array.isArray(db.lists) || !db.lists.length) {
      db.lists = DEFAULT_LISTS.map(function (l, i) {
        return { id: uid('l'), name: l.name, color: l.color, order: i };
      });
    }
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    db.version = DB_VERSION;

    var listIds = db.lists.map(function (l) { return l.id; });
    db.tasks = db.tasks.filter(function (t) { return t && t.id && typeof t.title === 'string'; }).map(function (t) {
      t.title = String(t.title).slice(0, 120);
      t.note = typeof t.note === 'string' ? t.note : '';
      t.done = !!t.done;
      t.priority = Math.max(0, Math.min(3, Number(t.priority) || 0));
      t.due = /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : null;
      if (listIds.indexOf(t.listId) < 0) t.listId = listIds[0];
      t.createdAt = Number(t.createdAt) || Date.now();
      t.completedAt = t.done ? (Number(t.completedAt) || t.createdAt) : null;
      return t;
    });
    return db;
  }

  function isValidDb(db) {
    return !!(db && typeof db === 'object' && Array.isArray(db.tasks) && Array.isArray(db.lists));
  }

  /* ------------------------------ 查询 ------------------------------ */

  function listById(db, id) {
    return db.lists.filter(function (l) { return l.id === id; })[0] || db.lists[0];
  }

  function priorityOf(level) {
    return PRIORITIES[Math.max(0, Math.min(3, Number(level) || 0))];
  }

  /** 排序：未完成在前；按截止日期（有日期的优先，逾期最前）；同日期按优先级；再按创建时间 */
  function sortTasks(tasks, today) {
    today = today || todayISO();
    return tasks.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.done && b.done) return (b.completedAt || 0) - (a.completedAt || 0);
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
      if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  /**
   * 筛选
   * filter: today | pending | done | all
   */
  function filterTasks(db, filter, opts) {
    opts = opts || {};
    var today = opts.today || todayISO();
    var q = (opts.query || '').trim().toLowerCase();
    var listId = opts.listId || null;

    var out = db.tasks.filter(function (t) {
      if (listId && t.listId !== listId) return false;
      if (filter === 'done') {
        if (!t.done) return false;
      } else if (filter === 'pending') {
        if (t.done) return false;
      } else if (filter === 'today') {
        if (t.done) return false;
        if (!t.due) return false;
        if (daysBetween(t.due, today) > 0) return false; // 今天及逾期
      }
      if (q) {
        var hay = (t.title + ' ' + t.note).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    return sortTasks(out, today);
  }

  var GROUP_ORDER = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];

  var GROUP_TITLES = {
    overdue: '逾期',
    today: '今天',
    tomorrow: '明天',
    week: '本周',
    later: '以后',
    none: '没有日期'
  };

  function bucketOf(task, today) {
    if (!task.due) return 'none';
    var diff = daysBetween(task.due, today);
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff <= 7) return 'week';
    return 'later';
  }

  /** 把未完成任务按截止日期分组（只返回非空分组的键） */
  function groupTasks(tasks, today) {
    today = today || todayISO();
    var groups = {};
    tasks.forEach(function (t) {
      if (t.done) return;
      var k = bucketOf(t, today);
      (groups[k] = groups[k] || []).push(t);
    });
    return GROUP_ORDER.filter(function (k) { return groups[k] && groups[k].length; })
      .map(function (k) { return { key: k, title: GROUP_TITLES[k], tasks: groups[k] }; });
  }

  /** 顶部统计 */
  function stats(db, today) {
    today = today || todayISO();
    var total = 0, done = 0, doneToday = 0, overdue = 0, todayTotal = 0, todayDone = 0;
    db.tasks.forEach(function (t) {
      total++;
      if (t.done) {
        done++;
        if (t.completedAt && todayISO(new Date(t.completedAt)) === today) doneToday++;
      }
      var relevantToday = (t.due && daysBetween(t.due, today) <= 0) ||
        (t.done && t.completedAt && todayISO(new Date(t.completedAt)) === today);
      if (relevantToday) {
        todayTotal++;
        if (t.done) todayDone++;
      }
      if (!t.done && t.due && daysBetween(t.due, today) < 0) overdue++;
    });
    return {
      total: total,
      done: done,
      pending: total - done,
      doneToday: doneToday,
      overdue: overdue,
      todayTotal: todayTotal,
      todayDone: todayDone,
      todayPct: todayTotal ? Math.round(todayDone / todayTotal * 100) : 0
    };
  }

  function countsByList(db) {
    var map = {};
    db.lists.forEach(function (l) { map[l.id] = 0; });
    db.tasks.forEach(function (t) {
      if (!t.done && map[t.listId] !== undefined) map[t.listId]++;
    });
    return map;
  }

  return {
    DB_VERSION: DB_VERSION,
    // 日期
    pad2: pad2, todayISO: todayISO, parseYMD: parseYMD, addDays: addDays, daysBetween: daysBetween,
    weekdayLabel: weekdayLabel, mdLabel: mdLabel, dueLabel: dueLabel, isOverdue: isOverdue,
    // 数据
    createSeedData: createSeedData, normalizeDb: normalizeDb, isValidDb: isValidDb, uid: uid,
    PRIORITIES: PRIORITIES, priorityOf: priorityOf, DEFAULT_LISTS: DEFAULT_LISTS,
    // 查询
    listById: listById, sortTasks: sortTasks, filterTasks: filterTasks,
    groupTasks: groupTasks, GROUP_TITLES: GROUP_TITLES, stats: stats, countsByList: countsByList
  };
});
