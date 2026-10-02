/* =========================================================================
 *  CẨM NANG GIÁO VIÊN SEC — core.js
 *  Tiện ích · Mô hình dữ liệu v5 · Di trú từ bản cũ · Engine markdown-lite
 *  Không phụ thuộc thư viện ngoài. Chạy được cả khi mở bằng file://
 * ========================================================================= */
(function (g) {
  'use strict';
  var SEC = (g.SEC = g.SEC || {});

  SEC.APP_VERSION = '2.0.0';
  SEC.MODEL = 5;                       // phiên bản cấu trúc dữ liệu

  /* ---------------------------------------------------------------- util */
  var U = {};
  SEC.util = U;

  // chấp nhận cả 'adminbar' lẫn '#adminbar' cho tiện
  U.$ = function (id) { return document.getElementById(String(id).replace(/^#/, '')); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.clone = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };

  U.uid = function (prefix) {
    var s = '';
    if (g.crypto && g.crypto.randomUUID) s = g.crypto.randomUUID().slice(0, 8);
    else s = Math.random().toString(36).slice(2, 10);
    return (prefix || 'x') + '-' + s;
  };

  U.slug = function (t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 42);
  };

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Bỏ dấu tiếng Việt để tìm kiếm không cần gõ dấu
  U.norm = function (s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd').toLowerCase();
  };

  U.rx = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  U.debounce = function (fn, ms) {
    var t; return function () {
      var a = arguments, self = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 300);
    };
  };

  U.byId = function (arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  };
  U.indexOfId = function (arr, id) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i] && arr[i].id === id) return i;
    return -1;
  };

  U.fmtDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return String(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  U.fmtRel = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'vừa xong';
    if (s < 3600) return Math.round(s / 60) + ' phút trước';
    if (s < 86400) return Math.round(s / 3600) + ' giờ trước';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' ngày trước';
    return U.fmtDate(iso);
  };

  U.bytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  U.b64encode = function (str) {           // UTF-8 an toàn
    return btoa(unescape(encodeURIComponent(str)));
  };
  U.b64decode = function (b64) {
    return decodeURIComponent(escape(atob(b64)));
  };

  U.isUrl = function (s) { return /^(https?:|mailto:|tel:)/i.test(String(s || '').trim()); };
  U.isSafeUrl = function (s) {
    s = String(s || '').trim();
    return /^(https?:|mailto:|tel:)/i.test(s) || (/^[\w./-]/.test(s) && !/^(javascript|data|vbscript):/i.test(s));
  };

  /* ------------------------------------------------------- data model v5 */
  var M = {};
  SEC.model = M;

  M.empty = function () {
    return {
      v: SEC.MODEL,
      meta: {
        title: 'Cẩm nang giáo viên', subtitle: '', brand: 'Cẩm nang giáo viên', org: '',
        footer: '', searchPlaceholder: 'Tìm theo từ khóa…', quickChips: [],
        commonDocsTitle: 'Tài liệu chung', heroTitle: 'Cẩm nang', heroTitleAccent: 'giáo viên',
        logo: 'assets/logo.jpg', updatedAt: new Date().toISOString(), updatedBy: '', version: '1.0.0'
      },
      phases: [], sections: [], templates: [], commonLinks: []
    };
  };

  M.newPhase = function (name) {
    return { id: U.uid('p'), name: name || 'Giai đoạn mới', bullets: [], outcome: '' };
  };
  M.newSection = function (phaseId, title) {
    return { id: U.uid('s'), phase: phaseId, title: title || 'Mục mới', body: '- Nội dung mới', links: [] };
  };
  M.newTemplate = function (phaseId, title) {
    return { id: U.uid('m'), phase: phaseId, course: '', title: title || 'Mẫu tin nhắn mới', text: '' };
  };
  M.newLink = function (name, url) { return { name: name || '', url: url || '' }; };

  /* Chuẩn hoá + vá lỗi để dữ liệu luôn render được, không bao giờ crash */
  M.normalize = function (c) {
    if (!c || typeof c !== 'object') return null;
    var e = M.empty();
    c.meta = Object.assign({}, e.meta, c.meta || {});
    if (!Array.isArray(c.meta.quickChips)) {
      c.meta.quickChips = String(c.meta.quickChips || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    c.phases = (Array.isArray(c.phases) ? c.phases : []).map(function (p, i) {
      return {
        id: p.id || ('p' + (i + 1)), name: String(p.name || ('Giai đoạn ' + (i + 1))),
        bullets: Array.isArray(p.bullets) ? p.bullets.map(String)
          : String(p.bullets || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        outcome: String(p.outcome || ''), notes: Array.isArray(p.notes) ? p.notes.map(String) : []
      };
    });
    if (!c.phases.length) c.phases = [M.newPhase('Nội dung')];

    c.sections = (Array.isArray(c.sections) ? c.sections : []).map(function (s, i) {
      return {
        id: s.id || ('s' + (i + 1)),
        phase: s.phase != null ? String(s.phase) : (c.phases[0] && c.phases[0].id),
        title: String(s.title || 'Không tiêu đề'),
        body: String(s.body == null ? '' : s.body),
        links: (Array.isArray(s.links) ? s.links : []).map(function (l) {
          if (Array.isArray(l)) return { name: String(l[0] || ''), url: String(l[1] || '') };
          return { name: String((l && l.name) || ''), url: String((l && l.url) || '') };
        })
      };
    });

    c.templates = (Array.isArray(c.templates) ? c.templates : []).map(function (t, i) {
      return {
        id: t.id || ('m' + (i + 1)),
        phase: t.phase != null ? String(t.phase) : (c.phases[0] && c.phases[0].id),
        section: t.section || '', course: String(t.course || ''),
        title: String(t.title || 'Mẫu tin nhắn'), text: String(t.text == null ? '' : t.text)
      };
    });

    c.commonLinks = (Array.isArray(c.commonLinks) ? c.commonLinks : []).map(function (l) {
      if (Array.isArray(l)) return { name: String(l[0] || ''), url: String(l[1] || '') };
      return { name: String((l && l.name) || ''), url: String((l && l.url) || '') };
    });

    // id trùng -> cấp lại ; phase mồ côi -> gán về phase đầu
    var seen = {};
    ['phases', 'sections', 'templates'].forEach(function (k) {
      c[k].forEach(function (o, i) {
        if (!o.id || seen[k + ':' + o.id]) o.id = U.uid(k[0]);
        seen[k + ':' + o.id] = 1;
      });
    });
    var pids = {}; c.phases.forEach(function (p) { pids[p.id] = 1; });
    c.sections.forEach(function (s) { if (!pids[s.phase]) s.phase = c.phases[0].id; });
    c.templates.forEach(function (t) { if (!pids[t.phase]) t.phase = c.phases[0].id; });
    if (!pids[(c.sections[0] || {}).phase]) { /* noop */ }

    c.v = SEC.MODEL;
    return c;
  };

  /* ---- Di trú bản cũ: {d:[{p,t,b,l,m}], m:[{p,c,t,x}]}  (localStorage v4) ---- */
  M.fromV4 = function (o) {
    var d = Array.isArray(o) ? o : (o && Array.isArray(o.d) ? o.d : null);
    if (!d || !d.length) return null;
    var legacyM = (o && Array.isArray(o.m)) ? o.m : [];
    var ov = null, rest = [];
    d.forEach(function (s) { if (s.p === -1 || s.p === '-1') ov = s; else rest.push(s); });
    if (!ov) ov = { p: -1, t: 'Tổng quan', b: '', l: [] };

    var names = [], blocks = [];
    var cur = null;
    String(ov.b || '').split('\n').forEach(function (ln) {
      if (/^##\s+/.test(ln)) { cur = { name: ln.replace(/^##\s+/, '').trim(), lines: [] }; names.push(cur.name); blocks.push(cur); }
      else if (cur) cur.lines.push(ln);
    });
    if (!blocks.length) blocks = [{ name: 'Nội dung', lines: [] }];

    var phases = blocks.map(function (b, i) {
      var bullets = [], outcome = '';
      b.lines.forEach(function (ln) {
        var t = ln.trim(); if (!t) return;
        if (/^-\s+/.test(t)) {
          var item = t.replace(/^-\s+/, '');
          var m = item.match(/^\*\*Kết quả:\*\*\s*([\s\S]*)$/i);
          if (m) outcome = m[1].trim(); else bullets.push(item);
        }
      });
      return { id: ['before', 'during', 'after', 'common'][i] || ('p' + (i + 1)), name: b.name, bullets: bullets, outcome: outcome };
    });

    var sections = [], templates = [];
    rest.forEach(function (s, i) {
      var pi = parseInt(s.p, 10); if (isNaN(pi) || pi < 0 || pi >= phases.length) pi = 0;
      var id = 's' + (i + 1) + '-' + U.slug(s.t);
      sections.push({
        id: id, phase: phases[pi].id, title: String(s.t || ''),
        body: String(s.b || '').replace(/\n{3,}/g, '\n\n').trim(),
        links: (s.l || []).map(function (l) {
          return Array.isArray(l) ? { name: String(l[0] || ''), url: String(l[1] || '') }
            : { name: String((l && l.name) || ''), url: String((l && l.url) || '') };
        })
      });
      (s.m || []).forEach(function (mm) {
        var parts = String(mm[0] || '').split(' · ');
        var course = parts.length > 1 ? parts.shift() : '';
        templates.push({
          id: U.uid('m'), phase: phases[pi].id, section: id, course: course,
          title: parts.join(' · '), text: String(mm[1] || '')
        });
      });
    });
    legacyM.forEach(function (t) {
      var pi = parseInt(t.p, 10); if (isNaN(pi) || pi < 0 || pi >= phases.length) pi = 0;
      templates.push({
        id: U.uid('m'), phase: phases[pi].id, section: '', course: String(t.c || ''),
        title: String(t.t || ''), text: String(t.x || '')
      });
    });

    var e = M.empty();
    e.meta.title = 'Cẩm nang giáo viên SEC';
    e.meta.updatedBy = 'Nhập từ bản cũ';
    return M.normalize({
      v: SEC.MODEL, meta: e.meta, phases: phases, sections: sections, templates: templates,
      commonLinks: (ov.l || []).map(function (l) {
        return Array.isArray(l) ? { name: String(l[0] || ''), url: String(l[1] || '') } : l;
      })
    });
  };

  /* Nhận mọi định dạng: v5, v4 {d,m}, mảng DEF thô -> trả về v5 hoặc null */
  M.migrate = function (input) {
    if (!input) return null;
    var o = input;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return null; } }
    if (Array.isArray(o) && o.length && (o[0].t !== undefined) && (o[0].b !== undefined)) o = { d: o, m: [] };
    if (o.v === SEC.MODEL || (Array.isArray(o.phases) && Array.isArray(o.sections))) return M.normalize(U.clone(o));
    if (Array.isArray(o.d)) return M.fromV4(o);
    return null;
  };

  /* Kiểm tra hợp lệ + cảnh báo (không ném lỗi) */
  M.validate = function (c) {
    var err = [], warn = [];
    if (!c || typeof c !== 'object') return { ok: false, errors: ['Dữ liệu không phải đối tượng JSON'], warnings: [] };
    if (!Array.isArray(c.phases) || !c.phases.length) err.push('Thiếu ít nhất 1 giai đoạn (tab).');
    if (!Array.isArray(c.sections)) err.push('Thiếu danh sách mục (sections).');
    (c.sections || []).forEach(function (s) {
      if (!String(s.title || '').trim()) warn.push('Có mục chưa đặt tiêu đề.');
      (s.links || []).forEach(function (l) {
        if (String(l.url || '').trim() && !U.isUrl(l.url)) warn.push('Link không hợp lệ trong “' + (s.title || '?') + '”: ' + String(l.url).slice(0, 50));
      });
    });
    (c.templates || []).forEach(function (t) {
      if (!String(t.title || '').trim()) warn.push('Có mẫu tin nhắn chưa đặt tên.');
    });
    var json = JSON.stringify(c || {});
    if (json.length > 4.5e6) warn.push('Nội dung đang rất lớn (' + U.bytes(json.length) + ') — nên chuyển ảnh sang dạng link.');
    return { ok: !err.length, errors: err, warnings: warn, size: json.length };
  };

  /* Tóm tắt khác biệt giữa 2 bản (dùng cho ghi chú commit + thanh trạng thái) */
  M.summarize = function (a, b) {
    if (!a || !b) return 'Cập nhật nội dung';
    var out = [];
    function cmp(key, label, fields) {
      var A = {}, B = {};
      (a[key] || []).forEach(function (x) { A[x.id] = x; });
      (b[key] || []).forEach(function (x) { B[x.id] = x; });
      var add = 0, del = 0, mod = 0;
      Object.keys(B).forEach(function (id) {
        if (!A[id]) return add++;
        if (fields.some(function (f) { return JSON.stringify(A[id][f]) !== JSON.stringify(B[id][f]); })) mod++;
      });
      Object.keys(A).forEach(function (id) { if (!B[id]) del++; });
      if (add) out.push('+' + add + ' ' + label);
      if (mod) out.push('sửa ' + mod + ' ' + label);
      if (del) out.push('−' + del + ' ' + label);
    }
    cmp('phases', 'giai đoạn', ['name', 'bullets', 'outcome']);
    cmp('sections', 'mục', ['title', 'body', 'links', 'phase']);
    cmp('templates', 'mẫu tin nhắn', ['title', 'text', 'course', 'phase']);
    if (JSON.stringify(a.commonLinks || []) !== JSON.stringify(b.commonLinks || [])) out.push('đổi tài liệu chung');
    if (JSON.stringify((a.meta || {}).quickChips) !== JSON.stringify((b.meta || {}).quickChips)) out.push('đổi từ khóa nhanh');
    if ((a.sections || []).length !== (b.sections || []).length ||
      (a.sections || []).some(function (s, i) { return (b.sections || [])[i] && (b.sections || [])[i].id !== s.id; })) out.push('sắp xếp lại');
    return out.length ? out.join(', ') : 'không có thay đổi nội dung';
  };

  /* Truy vấn helpers dùng chung cho cả chế độ đọc & sửa */
  M.q = function (c) {
    return {
      phaseName: function (id) { var p = U.byId(c.phases, id); return p ? p.name : ''; },
      sectionsOf: function (pid) { return c.sections.filter(function (s) { return s.phase === pid; }); },
      templatesOf: function (pid) { return c.templates.filter(function (t) { return t.phase === pid; }); },
      label: function (sec) {
        var pi = -1; c.phases.forEach(function (p, i) { if (p.id === sec.phase) pi = i; });
        var list = c.sections.filter(function (s) { return s.phase === sec.phase; });
        var idx = list.map(function (s) { return s.id; }).indexOf(sec.id);
        return (pi + 1) + '.' + (idx + 1);
      },
      desc: function (sec) {
        var ln = String(sec.body || '').split('\n').filter(function (x) { return /^[-*]\s+/.test(x.trim()); })[0];
        return ln ? ln.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim() : '';
      },
      coursesOf: function (pid) {
        var seen = {}, out = [];
        c.templates.filter(function (t) { return t.phase === pid; }).forEach(function (t) {
          var k = t.course || 'Khác'; if (!seen[k]) { seen[k] = 1; out.push(k); }
        });
        return out;
      },
      haystack: function (sec) {
        return U.norm([sec.title, sec.body, (sec.links || []).map(function (l) { return l.name + ' ' + l.url; }).join(' ')].join(' '));
      }
    };
  };

  /* --------------------------------------------------- markdown-lite v2 */
  /* Cú pháp:
     ## Tiêu đề nhỏ      ### Tiêu đề nhỏ hơn
     - gạch đầu dòng     1. danh sách số
     > ghi chú nổi bật   ![mô tả](https://…/anh.png)   [chữ](https://…)
     **in đậm**          --- (đường kẻ)                                        */
  var MD = {};
  SEC.md = MD;

  MD.assetResolver = null;      // ui.js gán hàm xử lý đường dẫn ảnh tương đối

  function safeHref(u) {
    u = String(u || '').trim();
    if (/^(javascript|data|vbscript):/i.test(u)) return '#';
    return u;
  }

  MD.link = function (txt, url, tk) {
    var h = safeHref(url);
    var label = MD.inline(txt, tk);
    var ext = /^https?:/i.test(h);
    return '<a href="' + U.esc(h) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
  };

  MD.image = function (alt, url) {
    var src = MD.assetResolver ? MD.assetResolver(url) : url;
    if (!/^https?:|^data:image|^\/|^\.\.?\//i.test(String(src))) src = safeHref(src);
    return '<figure class="fig"><img src="' + U.esc(src) + '" alt="' + U.esc(alt || '') + '" loading="lazy">' +
      (alt ? '<figcaption>' + U.esc(alt) + '</figcaption>' : '') + '</figure>';
  };

  // Inline: escape -> giữ link/ảnh -> highlight từ khóa -> in đậm -> phục hồi link
  MD.inline = function (text, tk) {
    var h = U.esc(text);
    var store = [];
    h = h.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (m, bang, txt, url) {
      store.push({ img: !!bang, txt: txt, url: url });
      return '\u0001' + (store.length - 1) + '\u0001';
    });
    var toks = (tk || []).filter(function (x) { return x.length > 1; });
    if (toks.length) {
      try {
        h = h.replace(new RegExp('(&#?\\w+;)|(' + toks.map(function (x) { return U.rx(U.esc(x)); }).join('|') + ')', 'gi'),
          function (m, ent, hit) { return hit ? '<mark>' + hit + '</mark>' : m; });
      } catch (e) { /* từ khóa chứa ký tự lạ -> bỏ highlight */ }
    }
    h = h.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
    h = h.replace(/\u0001(\d+)\u0001/g, function (m, i) {
      var L = store[+i]; if (!L) return '';
      return L.img ? MD.image(L.txt, L.url) : MD.link(L.txt, L.url, []);
    });
    return h;
  };

  MD.render = function (text, tk) {
    var out = [], list = null;
    function close() { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } }
    String(text == null ? '' : text).split('\n').forEach(function (raw) {
      var t = String(raw).replace(/\s+$/, '').trim();
      if (!t) { close(); return; }
      var m;
      if ((m = t.match(/^(#{2,4})\s+(.*)$/))) {
        close();
        var lv = m[1].length === 2 ? 3 : 4;
        out.push('<h' + lv + '>' + MD.inline(m[2], tk) + '</h' + lv + '>');
      } else if ((m = t.match(/^[-*•]\s+(.*)$/))) {
        if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + MD.inline(m[1], tk) + '</li>');
      } else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
        if (list !== 'ol') { close(); out.push('<ol class="ol">'); list = 'ol'; }
        out.push('<li>' + MD.inline(m[1], tk) + '</li>');
      } else if ((m = t.match(/^&gt;\s?(.*)$/)) || (m = t.match(/^>\s?(.*)$/))) {
        close(); out.push('<div class="callout">' + MD.inline(m[1], tk) + '</div>');
      } else if ((m = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
        close(); out.push(MD.image(m[1], m[2]));
      } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
        close(); out.push('<hr>');
      } else {
        close(); out.push('<p>' + MD.inline(t, tk) + '</p>');
      }
    });
    close();
    return out.join('');
  };

  MD.plain = function (text) {
    return String(text == null ? '' : text)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`]/g, '').trim();
  };

  // Chèn cú pháp vào textarea tại vị trí con trỏ (dùng cho toolbar)
  MD.wrapSelection = function (ta, before, after, placeholder) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var sel = v.slice(s, e) || placeholder || '';
    ta.value = v.slice(0, s) + before + sel + (after || '') + v.slice(e);
    ta.focus();
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + sel.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  MD.prefixLines = function (ta, prefix) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var le = v.indexOf('\n', e); if (le === -1) le = v.length;
    var block = v.slice(ls, le).split('\n').map(function (l) { return prefix + l; }).join('\n');
    ta.value = v.slice(0, ls) + block + v.slice(le);
    ta.focus(); ta.selectionStart = ls; ta.selectionEnd = ls + block.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /* ------------------------------------------------------ localStorage */
  var LS = {};
  SEC.ls = LS;
  LS.get = function (k, dflt) {
    try { var v = g.localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  };
  LS.set = function (k, v) {
    try { g.localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  };
  LS.del = function (k) { try { g.localStorage.removeItem(k); } catch (e) { } };
  LS.quota = function () {
    try {
      var t = 0; for (var i = 0; i < g.localStorage.length; i++) {
        var k = g.localStorage.key(i); t += (k.length + (g.localStorage.getItem(k) || '').length);
      }
      return t;
    } catch (e) { return -1; }
  };

  U.ls = LS;                    // alias: SEC.util.ls
  SEC.KEYS = {
    cfg: 'sec.cfg.v2', draft: 'sec.draft.v2', cache: 'sec.cache.v2',
    hist: 'sec.hist.v2', ui: 'sec.ui.v2', legacy: 'quytrinh-runlop-v4'
  };
})(typeof window !== 'undefined' ? window : globalThis);
