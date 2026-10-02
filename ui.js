/* =========================================================================
 *  CẨM NANG GIÁO VIÊN SEC — ui.js
 *  Giao diện người xem · Bảng quản trị · Soạn thảo · Xuất bản · Lịch sử
 * ========================================================================= */
(function (g) {
  'use strict';
  const SEC = g.SEC, U = SEC.util, M = SEC.model, MD = SEC.md, ST = SEC.store, K = SEC.KEYS;
  const $ = U.$, esc = U.esc;
  const EMBEDDED = SEC.EMBEDDED || null;

  /* ============================== TRẠNG THÁI ============================== */
  const S = {
    cfg: null, mode: 'static', adapter: ST.static, siteCfg: null,
    pub: null,            // bản đã xuất bản (mọi người xem)
    draft: null,          // bản nháp của admin
    dirty: false,
    admin: false, view: 'edit',
    tab: 0, etab: 0, cf: '', filter: '',
    openSec: {}, openEd: {},
    undo: [], redo: [], pendingSnap: null,
    versions: [], baseSha: null, pubInfo: null,
    user: '', busy: false, online: true, previewId: null
  };

  /* Người XEM luôn thấy bản đã xuất bản. ADMIN thấy bản nháp (kể cả khi bấm “Xem trang”
     -> đó chính là bản xem trước những gì sẽ được công bố). */
  const C = () => (S.admin && S.draft) ? S.draft : (S.pub || EMBEDDED);
  const cfgG = () => S.cfg.github;
  const cfgC = () => S.cfg.cloud;
  const cfgFor = () => S.mode === 'github' ? cfgG() : S.mode === 'cloud' ? cfgC() : {};
  const canPublish = () => S.adapter.canPublish(cfgFor());
  const tokens = () => ($('#q') ? $('#q').value.trim().split(/\s+/).filter(Boolean) : []);

  const isValidUrl = l => l && /^https?:\/\//i.test(String(l.url || '').trim());
  const isShownLink = l => l && String(l.url || '').trim() && (isValidUrl(l) || /^[\w./@-]+$/.test(String(l.url).trim()));

  /* ============================== THÔNG BÁO ============================== */
  function toast(msg, type, ms) {
    const box = $('#toasts'); if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    box.appendChild(d);
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 350); }, ms || 3800);
  }
  function notice(html, type) {
    const n = $('#notice'); if (!n) return;
    if (!html) { n.innerHTML = ''; n.hidden = true; return; }
    n.hidden = false;
    n.innerHTML = `<div class="ntc ${type || ''}">${html}</div>`;
  }
  function busy(on, label) {
    S.busy = !!on;
    document.body.classList.toggle('busy', S.busy);
    const b = $('#abPublish');
    if (b) { b.disabled = S.busy; b.textContent = on ? (label || 'Đang xuất bản…') : '⬆ Xuất bản'; }
  }
  const copyText = async (txt) => {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch (e) {
      const t = document.createElement('textarea');
      t.value = txt; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (z) { }
      t.remove(); return ok;
    }
  };

  /* ======================= KHUNG NHÌN CHUNG (read) ====================== */
  function tabBar(items, cur, attr, numCount) {
    const n = numCount == null ? items.length : numCount;
    return `<div class="tabs" role="tablist">${items.map((h, i) =>
      `<button type="button" role="tab" aria-selected="${i === cur}" ${attr}="${i}">${i < n ? `<em>${i + 1}</em>` : ''}${esc(h)}</button>`
    ).join('')}</div>`;
  }

  function linkList(links, tk, head, showInvalid) {
    const all = (links || []).filter(l => String(l.url || '').trim());
    const a = showInvalid ? all : all.filter(isShownLink);
    if (!a.length) return '';
    const res = ST.assetResolver(cfgFor(), S.mode);
    return (head ? `<h4 class="lh">${esc(head)} · ${a.length}</h4>` : '') +
      `<ul class="ll">${a.map(l => {
        const ok = isValidUrl(l);
        const href = ok ? l.url : res(l.url);
        return `<li><span>${MD.inline(l.name || l.url, tk)}${(!ok && showInvalid) ? ' <b class="bad">⚠ link chưa đúng</b>' : ''}</span>` +
          (ok ? `<a class="ob" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Mở ↗</a>`
            : (showInvalid ? `<span class="ob dis">${esc(String(l.url).slice(0, 30))}</span>` : '')) + `</li>`;
      }).join('')}</ul>`;
  }

  function card(c, s, tk, open, badge) {
    const q = M.q(c);
    return `<details class="dt" data-sec="${s.id}" ${open ? 'open' : ''}><summary><span class="no">${q.label(s)}</span>` +
      `<span class="tt"><b>${MD.inline(s.title, tk)}${badge ? `<span class="bd">${esc(badge)}</span>` : ''}</b>` +
      `<small>${esc(q.desc(s))}</small></span></summary>` +
      `<div class="db">${MD.render(s.body, tk)}${linkList(s.links, tk, 'Tài liệu đính kèm')}</div></details>`;
  }

  function tmplItem(t, tk, num, badge) {
    return `<details class="mi"><summary><span class="no">${num}</span><span class="tt"><b>${MD.inline(t.title, tk)}` +
      `${t.course ? `<span class="cb">${MD.inline(t.course, tk)}</span>` : ''}${badge ? `<span class="bd">${esc(badge)}</span>` : ''}` +
      `</b></span></summary><pre>${esc(t.text)}</pre>` +
      `<button type="button" data-cp="${t.id}">Sao chép mẫu</button></details>`;
  }

  function templatesBlock(c, p, tk) {
    const list = c.templates.filter(t => t.phase === p.id);
    if (!list.length) return '';
    const courses = [...new Set(list.map(t => t.course || 'Khác'))];
    const shown = list.filter(t => !S.cf || (t.course || 'Khác') === S.cf);
    const numOf = t => list.map(x => x.id).indexOf(t.id) + 1;
    return `<div class="th"><h3>Mẫu tin nhắn · ${esc(p.name)}</h3></div>` +
      `<p class="note" style="margin:0 0 6px">Mỗi khóa học có mẫu riêng: chọn đúng khóa của lớp mình, bấm để mở mẫu rồi bấm “Sao chép mẫu”.</p>` +
      (courses.length > 1 ? `<div class="cf"><button type="button" data-cf="" aria-pressed="${!S.cf}">Tất cả</button>` +
        courses.map(x => `<button type="button" data-cf="${esc(x)}" aria-pressed="${S.cf === x}">${esc(x)}</button>`).join('') + `</div>` : '') +
      (shown.map(t => tmplItem(t, tk, numOf(t))).join('') || '<p class="note">Không có mẫu nào khớp bộ lọc này.</p>');
  }

  function phasePanel(c, idx, tk) {
    const p = c.phases[idx]; if (!p) return '<p class="note">Chưa có giai đoạn nào.</p>';
    const q = M.q(c);
    const secs = q.sectionsOf(p.id);
    const left = [p.bullets.map(b => '- ' + b).join('\n'), (p.notes || []).join('\n')].filter(x => x.trim()).join('\n\n');
    return `<div class="tp" role="tabpanel"><div>${MD.render(left, tk) || '<p class="note">Chưa có nội dung tóm tắt.</p>'}</div>` +
      `<aside>${p.outcome ? `<div class="out"><b>Kết quả cần đạt</b>${MD.inline(p.outcome, tk)}</div>` : ''}</aside></div>` +
      linkList(c.commonLinks, [], c.meta.commonDocsTitle || 'Tài liệu chung') +
      `<div class="th"><h3>Chi tiết từng công việc · ${esc(p.name)}</h3>` +
      `<button type="button" data-all="#ovc details.dt">Mở / thu gọn tất cả</button></div>` +
      (secs.map(s => card(c, s, tk, !!S.openSec[s.id])).join('') || '<p class="note">Chưa có mục nào trong tab này.</p>') +
      templatesBlock(c, p, tk);
  }

  function docsPanel(c) {
    const q = M.q(c);
    let o = `<div class="th" style="margin-top:20px"><p class="note" style="margin:0">Toàn bộ tài liệu của cẩm nang, xếp theo giai đoạn. Bấm “Mở” để đi tới tài liệu.</p>` +
      `<button type="button" data-all="#ovc details.dt">Mở / thu gọn tất cả</button></div>`;
    c.phases.forEach((p, i) => {
      const ss = c.sections.filter(s => s.phase === p.id && s.links.some(isValidUrl));
      if (!ss.length) return;
      const cnt = ss.reduce((n, s) => n + s.links.filter(isValidUrl).length, 0);
      o += `<details class="dt" open><summary><span class="no">${i + 1}</span><span class="tt"><b>${esc(p.name)}</b><small>${cnt} tài liệu</small></span></summary>` +
        `<div class="db">${ss.map(s => `<h3>${q.label(s)} ${esc(s.title)}</h3>${linkList(s.links, [])}`).join('')}</div></details>`;
    });
    if (c.commonLinks.some(isValidUrl))
      o += `<details class="dt" open><summary><span class="no">TQ</span><span class="tt"><b>${esc(c.meta.commonDocsTitle || 'Tài liệu chung')}</b>` +
        `<small>${c.commonLinks.filter(isValidUrl).length} tài liệu</small></span></summary><div class="db">${linkList(c.commonLinks, [])}</div></details>`;
    const total = c.sections.reduce((n, s) => n + s.links.filter(isValidUrl).length, 0) + c.commonLinks.filter(isValidUrl).length;
    o += `<p class="note" style="margin-top:14px">Tổng cộng <b>${total}</b> tài liệu · <b>${c.sections.length}</b> mục quy trình · <b>${c.templates.length}</b> mẫu tin nhắn.</p>`;
    return o;
  }

  function searchResults(c, tk, qstr) {
    const nt = tk.map(U.norm);
    const mq = M.q(c);
    const si = c.sections.filter(s => nt.every(w => mq.haystack(s).includes(w)));
    const ti = c.templates.filter(t => nt.every(w => U.norm([t.course, t.title, t.text].join(' ')).includes(w)));
    if (!si.length && !ti.length)
      return { html: `<div class="empty">Không có kết quả cho “${esc(qstr)}”.<br>Thử từ khóa ngắn hơn, ví dụ “zoom” hoặc “bài tập”.</div>`, sec: 0, tmpl: 0 };
    const html = si.map(s => card(c, s, tk, true, mq.phaseName(s.phase))).join('') +
      (ti.length ? `<div class="th"><h3>Mẫu tin nhắn</h3></div>` +
        ti.map(t => tmplItem(t, tk, c.templates.filter(x => x.phase === t.phase).map(x => x.id).indexOf(t.id) + 1, mq.phaseName(t.phase))).join('') : '');
    return { html, sec: si.length, tmpl: ti.length };
  }

  function readPanel(c, tk) {
    const n = c.phases.length;
    if (S.tab > n) S.tab = 0;
    const bar = tabBar(c.phases.map(p => p.name).concat(['Tất cả tài liệu']), S.tab, 'data-tab');
    return bar + (S.tab === n ? docsPanel(c) : phasePanel(c, S.tab, tk));
  }

  /* ============================ ÁP DỤNG META ============================ */
  function applyMeta(c) {
    const m = c.meta || {};
    document.title = m.title || 'Cẩm nang giáo viên';
    const hero = document.querySelector('[data-hero]');
    if (hero) hero.innerHTML = `${esc(m.heroTitle || 'Cẩm nang')} <span>${esc(m.heroTitleAccent || '')}</span>`;
    document.querySelectorAll('[data-bind]').forEach(el => {
      const k = el.getAttribute('data-bind');
      if (m[k] != null) el.textContent = m[k];
    });
    const q = $('#q'); if (q && m.searchPlaceholder) q.placeholder = m.searchPlaceholder;
    const res = ST.assetResolver(cfgFor(), S.mode);
    document.querySelectorAll('img[data-logo]').forEach(img => {
      if (m.logo) img.src = res(m.logo);
      img.alt = m.org || 'Logo';
    });
    const chips = $('#chips');
    if (chips) {
      const list = (m.quickChips || []).filter(Boolean);
      if (chips.dataset.sig !== list.join('|')) {
        chips.dataset.sig = list.join('|');
        chips.innerHTML = list.map(k => `<button type="button" data-chip="${esc(k)}">${esc(k)}</button>`).join('');
      }
    }
    const fu = $('#fUpdated');
    if (fu) fu.textContent = m.updatedAt ? `Cập nhật: ${U.fmtDate(m.updatedAt)}${m.updatedBy ? ' · ' + m.updatedBy : ''}` : '';
    const ds = document.querySelector('meta[name="description"]');
    if (ds && m.subtitle) ds.setAttribute('content', String(m.subtitle).slice(0, 160));
  }

  /* ========================= BẢNG QUẢN TRỊ (edit) ======================= */
  const field = (label, path, value, attrs) =>
    `<label>${esc(label)}</label><input data-path="${path}" value="${esc(value == null ? '' : value)}" ${attrs || ''}>`;

  function mdToolbar(path) {
    const b = (a, txt, title) => `<button type="button" class="mdb" data-md="${a}" data-for="${path}" title="${title}">${txt}</button>`;
    return `<div class="mdtb" role="toolbar" aria-label="Công cụ định dạng">` +
      b('bold', '<b>B</b>', 'In đậm (**chữ**)') + b('h2', 'H2', 'Tiêu đề nhỏ (## )') + b('h3', 'H3', 'Tiêu đề nhỏ hơn (### )') +
      b('ul', '• Danh sách', 'Gạch đầu dòng (- )') + b('ol', '1. Số', 'Danh sách đánh số') +
      b('link', '🔗 Link', 'Chèn liên kết [chữ](https://…)') + b('img', '🖼 Ảnh', 'Chèn ảnh ![mô tả](url)') +
      b('quote', '❝ Ghi chú', 'Khối ghi chú (> )') + b('hr', '— Kẻ ngang', 'Đường kẻ') +
      `<button type="button" class="mdb" data-md="pv" data-for="${path}" title="Bật/tắt xem trước">👁 Xem trước</button>` +
      `<button type="button" class="mdb" data-md="up" data-for="${path}" title="Tải ảnh lên (cần quyền ghi)">⬆ Tải ảnh</button>` +
      `</div>`;
  }

  function linkRows(owner, links) {
    return (links || []).map((l, j) =>
      `<div class="lr"><input placeholder="Tên hiển thị" data-path="${owner}:links:${j}:name" value="${esc(l.name)}">` +
      `<input placeholder="https://…" data-path="${owner}:links:${j}:url" value="${esc(l.url)}" class="${isValidUrl(l) ? '' : 'warn'}">` +
      (isValidUrl(l) ? `<a class="mini" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="Mở thử">↗</a>` : `<span class="mini dis" title="Link chưa đúng định dạng http(s)">⚠</span>`) +
      `<button type="button" class="dg" data-a="dellink" data-owner="${owner}" data-j="${j}" title="Xoá tài liệu này">✕</button></div>`
    ).join('') + `<div class="row"><button type="button" data-a="addlink" data-owner="${owner}">+ Thêm tài liệu</button></div>`;
  }

  function secEditor(c, s) {
    const q = M.q(c), p = `sections:${s.id}`;
    const nt = c.templates.filter(t => t.section === s.id).length;
    return `<details class="ed" data-ed="${s.id}" data-draggable="sections:${s.id}" ${S.openEd[s.id] ? 'open' : ''}>` +
      `<summary><span class="dh" data-drag="sections:${s.id}" title="Kéo để sắp xếp">⠿</span>` +
      `<span class="no">${q.label(s)}</span><span class="edttl">${esc(s.title)}</span>` +
      `<span class="cnt">${s.links.length ? s.links.length + ' 🔗' : ''}${nt ? nt + ' ✉' : ''}</span></summary>` +
      `<div class="edb">` +
      `<div class="grid2">` + field('Tiêu đề mục', `${p}:title`, s.title, 'style="flex:2"') +
      `<div><label>Giai đoạn (tab)</label><select data-path="${p}:phase">` +
      c.phases.map(ph => `<option value="${ph.id}" ${ph.id === s.phase ? 'selected' : ''}>${esc(ph.name)}</option>`).join('') + `</select></div></div>` +
      `<label>Nội dung <span class="hint">## tiêu đề nhỏ · - gạch đầu dòng · 1. đánh số · **in đậm** · [chữ](link) · ![mô tả](ảnh) · &gt; ghi chú</span></label>` +
      mdToolbar(`${p}:body`) +
      `<div class="edsplit"><textarea rows="10" data-path="${p}:body" data-pv="pv-${s.id}" spellcheck="false">${esc(s.body)}</textarea>` +
      `<div class="pv" id="pv-${s.id}" hidden>${MD.render(s.body, [])}</div></div>` +
      `<label>Tài liệu đính kèm</label>${linkRows(p, s.links)}` +
      `<div class="row edact"><button type="button" data-a="dupsec" data-id="${s.id}">⧉ Nhân bản</button>` +
      `<button type="button" data-a="up" data-kind="sections" data-id="${s.id}" title="Lên">↑</button>` +
      `<button type="button" data-a="dn" data-kind="sections" data-id="${s.id}" title="Xuống">↓</button>` +
      `<button type="button" class="dg" data-a="delsec" data-id="${s.id}">🗑 Xoá mục này</button></div>` +
      `</div></details>`;
  }

  function tmplEditor(c, t, num) {
    const p = `templates:${t.id}`;
    return `<details class="ed" data-ed="${t.id}" data-draggable="templates:${t.id}" ${S.openEd[t.id] ? 'open' : ''}>` +
      `<summary><span class="dh" data-drag="templates:${t.id}" title="Kéo để sắp xếp">⠿</span>` +
      `<span class="no">${num}</span><span class="edttl">${esc(t.title)}</span>` +
      `${t.course ? `<span class="cb">${esc(t.course)}</span>` : ''}</summary><div class="edb">` +
      `<div class="grid2">` + field('Khóa học (VD: KTN, TOEIC LR)', `${p}:course`, t.course) + field('Tên mẫu', `${p}:title`, t.title) + `</div>` +
      `<div><label>Hiển thị ở giai đoạn</label><select data-path="${p}:phase">` +
      c.phases.map(ph => `<option value="${ph.id}" ${ph.id === t.phase ? 'selected' : ''}>${esc(ph.name)}</option>`).join('') + `</select></div>` +
      `<label>Nội dung mẫu tin nhắn (giữ nguyên định dạng, có emoji)</label>` +
      `<textarea rows="7" data-path="${p}:text" spellcheck="false">${esc(t.text)}</textarea>` +
      `<div class="row edact"><button type="button" data-a="cpm" data-id="${t.id}">⧉ Sao chép nội dung</button>` +
      `<button type="button" data-a="duptmpl" data-id="${t.id}">⧉ Nhân bản</button>` +
      `<button type="button" data-a="up" data-kind="templates" data-id="${t.id}">↑</button>` +
      `<button type="button" data-a="dn" data-kind="templates" data-id="${t.id}">↓</button>` +
      `<button type="button" class="dg" data-a="deltmpl" data-id="${t.id}">🗑 Xoá</button></div></div></details>`;
  }

  function phaseEditor(c, p) {
    const q = M.q(c);
    const f = U.norm(S.filter);
    const secs = q.sectionsOf(p.id).filter(s => !f || U.norm(s.title + ' ' + s.body).includes(f));
    const tms = q.templatesOf(p.id).filter(t => !f || U.norm(t.title + ' ' + t.text + ' ' + t.course).includes(f));
    const nDoc = q.sectionsOf(p.id).reduce((n, s) => n + s.links.length, 0);
    return `<div class="edhead"><input id="edFilter" type="search" class="edfilter" placeholder="Lọc nhanh mục trong tab này…" value="${esc(S.filter)}">` +
      `<div class="row"><button type="button" class="pri" data-a="addsec" data-phase="${p.id}">+ Thêm mục</button>` +
      `<button type="button" data-a="addtmpl" data-phase="${p.id}">+ Thêm mẫu tin nhắn</button>` +
      `<button type="button" data-a="gotoPhaseCfg" data-id="${p.id}">✎ Sửa tóm tắt giai đoạn</button></div></div>` +
      `<p class="note edsum">${q.sectionsOf(p.id).length} mục · ${q.templatesOf(p.id).length} mẫu tin nhắn · ${nDoc} tài liệu đính kèm` +
      (S.filter ? ` — đang lọc “${esc(S.filter)}”` : '') + `</p>` +
      `<h3 class="edh">Mục chi tiết <span class="hint">bấm ⠿ giữ và kéo để đổi thứ tự</span></h3>` +
      `<div class="edlist" data-zone="sections:${p.id}">` +
      (secs.map(s => secEditor(c, s)).join('') || `<p class="note">Chưa có mục nào${S.filter ? ' khớp bộ lọc' : ''}.</p>`) + `</div>` +
      `<h3 class="edh">Mẫu tin nhắn</h3>` +
      `<div class="edlist" data-zone="templates:${p.id}">` +
      (tms.map(t => tmplEditor(c, t, q.templatesOf(p.id).map(x => x.id).indexOf(t.id) + 1)).join('') || '<p class="note">Chưa có mẫu nào.</p>') + `</div>`;
  }

  function metaEditor(c) {
    return `<div class="edhead"><h3 class="edh" style="margin:0">Giai đoạn (tab trên trang)</h3>` +
      `<div class="row"><button type="button" class="pri" data-a="addphase">+ Thêm giai đoạn</button></div></div>` +
      `<p class="note edsum">Mỗi giai đoạn là một tab. Tên, tóm tắt và “Kết quả cần đạt” hiển thị ở đầu tab tương ứng.</p>` +
      `<div class="edlist" data-zone="phases">` + c.phases.map((p, i) => {
        const ns = c.sections.filter(s => s.phase === p.id).length;
        const nt = c.templates.filter(t => t.phase === p.id).length;
        return `<details class="ed" data-ed="ph-${p.id}" data-draggable="phases:${p.id}" ${S.openEd['ph-' + p.id] ? 'open' : ''}>` +
          `<summary><span class="dh" data-drag="phases:${p.id}" title="Kéo để sắp xếp">⠿</span><span class="no">${i + 1}</span>` +
          `<span class="edttl">${esc(p.name)}</span><span class="cnt">${ns} mục · ${nt} mẫu</span></summary><div class="edb">` +
          field('Tên giai đoạn', `phases:${p.id}:name`, p.name) +
          `<label>Tóm tắt công việc <span class="hint">mỗi dòng là một gạch đầu dòng</span></label>` +
          `<textarea rows="6" data-path="phases:${p.id}:bulletsText" spellcheck="false">${esc((p.bullets || []).join('\n'))}</textarea>` +
          field('Kết quả cần đạt (hiện trong ô cam)', `phases:${p.id}:outcome`, p.outcome) +
          `<div class="row edact"><button type="button" data-a="dupphase" data-id="${p.id}">⧉ Nhân bản</button>` +
          `<button type="button" data-a="up" data-kind="phases" data-id="${p.id}">↑</button>` +
          `<button type="button" data-a="dn" data-kind="phases" data-id="${p.id}">↓</button>` +
          `<button type="button" class="dg" data-a="delphase" data-id="${p.id}">🗑 Xoá giai đoạn</button></div></div></details>`;
      }).join('') + `</div>` +
      `<h3 class="edh">Thông tin trang</h3><section class="ed open2"><div class="edb">` +
      `<div class="grid2">` + field('Tên trang (thẻ trình duyệt)', 'meta:title', c.meta.title) + field('Tên hiển thị góc trái', 'meta:brand', c.meta.brand) + `</div>` +
      `<div class="grid2">` + field('Chữ lớn hero (phần 1)', 'meta:heroTitle', c.meta.heroTitle) + field('Chữ lớn hero (phần nhấn màu)', 'meta:heroTitleAccent', c.meta.heroTitleAccent) + `</div>` +
      `<label>Đoạn giới thiệu dưới tiêu đề</label><textarea rows="2" data-path="meta:subtitle">${esc(c.meta.subtitle)}</textarea>` +
      `<div class="grid2">` + field('Chữ trong ô tìm kiếm', 'meta:searchPlaceholder', c.meta.searchPlaceholder) + field('Tên nhóm tài liệu chung', 'meta:commonDocsTitle', c.meta.commonDocsTitle) + `</div>` +
      field('Từ khóa tìm nhanh (phân cách bằng dấu phẩy)', 'meta:quickChipsText', (c.meta.quickChips || []).join(', ')) +
      field('Dòng cuối trang', 'meta:footer', c.meta.footer) +
      field('Đường dẫn logo (để trống dùng logo mặc định)', 'meta:logo', c.meta.logo) +
      `</div></section>`;
  }

  function commonEditor(c) {
    const info = S.pubInfo || {};
    return `<div class="edhead"><h3 class="edh" style="margin:0">${esc(c.meta.commonDocsTitle || 'Tài liệu chung')}</h3></div>` +
      `<p class="note edsum">Những tài liệu này hiện ở <b>mọi</b> tab và trong trang “Tất cả tài liệu”. Thường dùng cho 3Q, bảng theo dõi, quy trình chung.</p>` +
      `<section class="ed open2"><div class="edb">${linkRows('commonLinks', c.commonLinks)}</div></section>` +
      `<h3 class="edh">Trạng thái lưu trữ</h3><section class="ed open2"><div class="edb">` +
      `<table class="kv"><tbody>` +
      `<tr><th>Chế độ</th><td>${esc(S.adapter.label)}${canPublish() ? '' : ' <b class="bad">— chưa thể xuất bản</b>'}</td></tr>` +
      `<tr><th>Bản đang xem</th><td>${info.updatedAt ? esc(U.fmtDate(info.updatedAt)) + (info.updatedBy ? ' · ' + esc(info.updatedBy) : '') : '(nội dung gốc nhúng trong trang)'}</td></tr>` +
      `<tr><th>Nguồn dữ liệu</th><td>${esc(info.source || '—')}</td></tr>` +
      `<tr><th>Người xuất bản</th><td><input data-path="cfgAuthor" value="${esc(S.cfg.author || '')}" placeholder="Tên của bạn (ghi vào lịch sử)"></td></tr>` +
      `<tr><th>Dung lượng</th><td>${U.bytes(JSON.stringify(c).length)} nội dung · ${U.bytes(U.ls.quota() || 0)} trong bộ nhớ trình duyệt</td></tr>` +
      `</tbody></table>` +
      `<div class="row" style="margin-top:12px"><button type="button" data-a="openCfg">⚙ Đổi nơi lưu / cấp quyền</button>` +
      `<button type="button" data-a="openData">⇅ Xuất / nạp JSON</button>` +
      `<button type="button" data-a="openHist">🕘 Lịch sử phiên bản</button></div>` +
      `<h4 class="lh">Vùng nguy hiểm</h4><div class="row">` +
      `<button type="button" class="dg" data-a="resetDefault">↺ Nạp lại nội dung gốc của trang</button>` +
      `<button type="button" class="dg" data-a="clearLocal">🗑 Xoá bản nháp & bộ nhớ đệm trên máy này</button></div>` +
      `</div></section>`;
  }

  function adminPanel(c) {
    const n = c.phases.length;
    if (S.etab > n + 1) S.etab = 0;
    const items = c.phases.map(p => p.name).concat(['⚙ Giai đoạn & trang', '🔗 Tài liệu chung']);
    const bar = tabBar(items, S.etab, 'data-etab', n);
    const warn = !canPublish() ? `<div class="ntc warn" style="margin:0 0 12px">Bạn đang sửa <b>bản nháp trên máy này</b>. ` +
      `Bấm <b>⚙ Kết nối</b> để chọn nơi lưu (GitHub hoặc Cloudflare) thì thay đổi mới tới được tất cả giáo viên.</div>` : '';
    return warn + bar + (S.etab === n ? metaEditor(c) : S.etab === n + 1 ? commonEditor(c) : phaseEditor(c, c.phases[S.etab]));
  }

  /* ================================ RENDER ============================== */
  function render() {
    const c = C(); if (!c) return;
    applyMeta(c);
    const tk = tokens(), qstr = $('#q') ? $('#q').value.trim() : '';
    const ovc = $('#ovc'), list = $('#list'), info = $('#info'), ow = $('#ow');
    const keepY = g.scrollY;

    $('#adminbar').hidden = !S.admin;
    const nav = $('#navAdmin'); if (nav) nav.hidden = !S.admin;
    document.body.classList.toggle('admin', S.admin);
    const ba = $('#btnAdmin');
    if (ba) {
      ba.textContent = S.admin ? '✓ Quản trị' : '🔒 Quản trị';
      ba.className = S.admin ? 'pri' : 'ghost';
    }

    if (S.admin && S.view === 'edit') {
      ow.hidden = false; list.innerHTML = ''; info.textContent = '';
      ovc.innerHTML = adminPanel(c);
      bindDrag();
    } else {
      const searching = !!qstr;
      ow.hidden = searching;
      ovc.innerHTML = searching ? '' : readPanel(c, tk);
      if (searching) {
        const r = searchResults(c, tk, qstr);
        info.textContent = (r.sec || r.tmpl) ? `Tìm thấy ${r.sec} mục và ${r.tmpl} mẫu tin nhắn phù hợp với “${qstr}”` : '';
        list.innerHTML = r.html;
      } else { list.innerHTML = ''; info.textContent = ''; }
    }
    updateStatus();
    g.scrollTo(0, keepY);
  }
  const softRender = U.debounce(render, 450);

  /* ====================== RÀNG BUỘC DỮ LIỆU (path) ===================== */
  function setByPath(c, path, value) {
    const p = String(path).split(':');
    if (p[0] === 'cfgAuthor') { S.cfg.author = value; ST.saveCfg(S.cfg); return; }
    if (p[0] === 'meta') {
      if (p[1] === 'quickChipsText') c.meta.quickChips = String(value).split(',').map(s => s.trim()).filter(Boolean);
      else c.meta[p[1]] = value;
      return;
    }
    if (p[0] === 'phases') {
      const o = U.byId(c.phases, p[1]); if (!o) return;
      if (p[2] === 'bulletsText') o.bullets = String(value).split('\n').map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
      else o[p[2]] = value;
      return;
    }
    if (p[0] === 'sections') {
      const o = U.byId(c.sections, p[1]); if (!o) return;
      if (p[2] === 'links') { const l = o.links[+p[3]]; if (l) l[p[4]] = value; }
      else o[p[2]] = value;
      return;
    }
    if (p[0] === 'templates') { const o = U.byId(c.templates, p[1]); if (!o) return; o[p[2]] = value; return; }
    if (p[0] === 'commonLinks') { const l = c.commonLinks[+p[1]]; if (l) l[p[2]] = value; return; }
  }

  function updatePreview(ta) {
    const id = ta.dataset.pv; if (!id) return;
    const box = document.getElementById(id); if (!box || box.hidden) return;
    box.innerHTML = MD.render(ta.value, []);
  }

  /* ============================ BẢN NHÁP / UNDO ========================= */
  function recomputeDirty() {
    S.dirty = !!(S.draft && JSON.stringify(S.draft) !== JSON.stringify(S.pub));
    if (!S.dirty && S.draft) { /* bản nháp trùng bản công khai -> bỏ nháp */ }
  }
  const persistDraft = U.debounce(() => {
    recomputeDirty();
    if (S.draft && S.dirty) U.ls.set(K.draft, { at: Date.now(), content: S.draft });
    else U.ls.del(K.draft);
    updateStatus();
  }, 400);

  function ensureDraft() { if (!S.draft) S.draft = U.clone(S.pub || EMBEDDED); return S.draft; }
  function markDirty() { S.dirty = true; persistDraft(); }
  function pushUndo(raw) {
    S.undo.push(raw || JSON.stringify(C()));
    if (S.undo.length > 80) S.undo.shift();
    S.redo.length = 0;
  }
  function doUndo() {
    if (!S.undo.length) return toast('Không còn thao tác nào để hoàn tác', 'warn');
    S.redo.push(JSON.stringify(C()));
    S.draft = M.migrate(S.undo.pop());
    markDirty(); render(); toast('Đã hoàn tác ↩︎');
  }
  function doRedo() {
    if (!S.redo.length) return toast('Không có thao tác nào để làm lại', 'warn');
    S.undo.push(JSON.stringify(C()));
    S.draft = M.migrate(S.redo.pop());
    markDirty(); render(); toast('Đã làm lại ↪︎');
  }
  function discardDraft() {
    if (!S.draft) return toast('Không có thay đổi nào để huỷ', 'warn');
    if (!confirm('Huỷ toàn bộ thay đổi chưa xuất bản và quay về bản đang công khai?')) return;
    S.draft = null; S.dirty = false; S.undo = []; S.redo = []; U.ls.del(K.draft);
    render(); toast('Đã quay về bản đã xuất bản', 'ok');
  }

  /* ============================ THAO TÁC CRUD =========================== */
  function moveWithin(arr, id, dir) {
    const i = U.indexOfId(arr, id); if (i < 0) return false;
    let j = i + dir;
    const phaseKey = arr[i].phase;
    if (phaseKey !== undefined) { while (j >= 0 && j < arr.length && arr[j].phase !== phaseKey) j += dir; }
    if (j < 0 || j >= arr.length) return false;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true;
  }
  function moveTo(arr, id, targetId, before) {
    const i = U.indexOfId(arr, id); if (i < 0) return false;
    const item = arr.splice(i, 1)[0];
    let j = U.indexOfId(arr, targetId);
    if (j < 0) { arr.splice(i, 0, item); return false; }
    arr.splice(before ? j : j + 1, 0, item);
    return true;
  }
  function nextId(arr, prefix) {
    let n = arr.length + 1, id;
    do { id = prefix + String(n).padStart(2, '0'); n++; } while (U.byId(arr, id));
    return id;
  }

  const ACT = {
    addsec(c, d) {
      const ph = d.phase || c.phases[Math.min(S.etab, c.phases.length - 1)].id;
      const s = M.newSection(ph, 'Mục mới');
      s.id = nextId(c.sections, 's') + '-' + U.slug('moi');
      c.sections.push(s); S.openEd[s.id] = 1; S.filter = '';
      return 'Đã thêm mục mới — nhớ đặt tiêu đề và nội dung';
    },
    delsec(c, d) {
      const s = U.byId(c.sections, d.id); if (!s) return;
      const nt = c.templates.filter(t => t.section === d.id).length;
      if (!confirm(`Xoá mục “${s.title}” cùng ${s.links.length} tài liệu đính kèm${nt ? ' và ' + nt + ' mẫu tin nhắn liên quan' : ''}?`)) return 'cancel';
      c.sections = c.sections.filter(x => x.id !== d.id);
      c.templates.forEach(t => { if (t.section === d.id) t.section = ''; });
      delete S.openEd[d.id];
      return 'Đã xoá mục';
    },
    dupsec(c, d) {
      const s = U.byId(c.sections, d.id); if (!s) return;
      const n = U.clone(s);
      n.id = U.uid('s'); n.title = s.title + ' (bản sao)';
      c.sections.splice(c.sections.indexOf(s) + 1, 0, n);
      S.openEd[n.id] = 1;
      return 'Đã nhân bản mục';
    },
    addtmpl(c, d) {
      const ph = d.phase || c.phases[Math.min(S.etab, c.phases.length - 1)].id;
      const t = M.newTemplate(ph, 'Mẫu tin nhắn mới');
      c.templates.push(t); S.openEd[t.id] = 1;
      return 'Đã thêm mẫu tin nhắn mới';
    },
    deltmpl(c, d) {
      const t = U.byId(c.templates, d.id); if (!t) return;
      if (!confirm(`Xoá mẫu tin nhắn “${t.title}”?`)) return 'cancel';
      c.templates = c.templates.filter(x => x.id !== d.id); delete S.openEd[d.id];
      return 'Đã xoá mẫu tin nhắn';
    },
    duptmpl(c, d) {
      const t = U.byId(c.templates, d.id); if (!t) return;
      const n = U.clone(t); n.id = U.uid('m'); n.title = t.title + ' (bản sao)';
      c.templates.splice(c.templates.indexOf(t) + 1, 0, n); S.openEd[n.id] = 1;
      return 'Đã nhân bản mẫu';
    },
    addphase(c) {
      const p = M.newPhase('Giai đoạn mới');
      c.phases.push(p); S.openEd['ph-' + p.id] = 1; S.etab = c.phases.length;
      return 'Đã thêm giai đoạn — đặt tên rồi bấm “Xuất bản”';
    },
    delphase(c, d) {
      const p = U.byId(c.phases, d.id); if (!p) return;
      if (c.phases.length < 2) return 'Phải còn ít nhất 1 giai đoạn';
      const ns = c.sections.filter(s => s.phase === d.id).length;
      const nt = c.templates.filter(t => t.phase === d.id).length;
      let target = (c.phases.filter(x => x.id !== d.id)[0] || {}).id;
      if (ns || nt) {
        const list = c.phases.filter(x => x.id !== d.id).map((x, i) => `${i + 1}. ${x.name}`).join('\n');
        const a = prompt(`Giai đoạn “${p.name}” đang chứa ${ns} mục và ${nt} mẫu tin nhắn.\nChuyển tất cả sang giai đoạn nào? (nhập số)\n${list}`, '1');
        if (a === null) return 'cancel';
        const idx = Math.max(1, Math.min(parseInt(a, 10) || 1, c.phases.length - 1)) - 1;
        target = c.phases.filter(x => x.id !== d.id)[idx].id;
      } else if (!confirm(`Xoá giai đoạn “${p.name}”?`)) return 'cancel';
      c.sections.forEach(s => { if (s.phase === d.id) s.phase = target; });
      c.templates.forEach(t => { if (t.phase === d.id) t.phase = target; });
      c.phases = c.phases.filter(x => x.id !== d.id);
      if (S.etab > c.phases.length) S.etab = c.phases.length;
      return 'Đã xoá giai đoạn';
    },
    dupphase(c, d) {
      const p = U.byId(c.phases, d.id); if (!p) return;
      const n = U.clone(p); n.id = U.uid('p'); n.name = p.name + ' (bản sao)';
      c.phases.splice(c.phases.indexOf(p) + 1, 0, n);
      return 'Đã nhân bản giai đoạn (mục bên trong không bị sao chép)';
    },
    addlink(c, d) {
      const owner = d.owner.split(':');
      if (owner[0] === 'commonLinks') c.commonLinks.push(M.newLink());
      else { const s = U.byId(c.sections, owner[1]); if (s) s.links.push(M.newLink()); }
      return 'Đã thêm dòng tài liệu';
    },
    dellink(c, d) {
      const owner = d.owner.split(':');
      if (owner[0] === 'commonLinks') c.commonLinks.splice(+d.j, 1);
      else { const s = U.byId(c.sections, owner[1]); if (s) s.links.splice(+d.j, 1); }
      return 'Đã xoá tài liệu';
    },
    up(c, d) { if (!moveWithin(c[d.kind], d.id, -1)) return 'Đã ở đầu danh sách'; },
    dn(c, d) { if (!moveWithin(c[d.kind], d.id, 1)) return 'Đã ở cuối danh sách'; },
    cpm(c, d) { const t = U.byId(c.templates, d.id); if (t) copyText(t.text).then(ok => toast(ok ? 'Đã sao chép nội dung mẫu ✓' : 'Không sao chép được', ok ? 'ok' : 'err')); return 'no-render'; }
  };

  /* ========================= HÀNH ĐỘNG (delegate) ======================= */
  function handleAction(a, d, el) {
    if (a === 'openCfg') return openCfg();
    if (a === 'openHist') return openHist();
    if (a === 'openData') return openData();
    if (a === 'publish') return doPublish();
    if (a === 'discard') return discardDraft();
    if (a === 'resetDefault') {
      if (!confirm('Nạp lại NỘI DUNG GỐC nhúng trong trang vào bản nháp? Mọi chỉnh sửa chưa xuất bản sẽ bị thay thế (vẫn có thể hoàn tác trước khi xuất bản).')) return;
      mutate(c => { const e = M.migrate(EMBEDDED) || M.empty(); Object.keys(c).forEach(k => delete c[k]); Object.assign(c, e); }, { toast: 'Đã nạp nội dung gốc vào bản nháp' });
      return;
    }
    if (a === 'clearLocal') {
      if (!confirm('Xoá bản nháp, bộ nhớ đệm và lịch sử cục bộ trên máy này?')) return;
      [K.draft, K.cache, K.hist, 'sec.pub.v2'].forEach(k => U.ls.del(k));
      S.draft = null; S.dirty = false; S.undo = []; S.redo = [];
      toast('Đã xoá dữ liệu cục bộ', 'ok'); render(); return;
    }
    if (a === 'gotoPhaseCfg') {
      S.etab = C().phases.length; S.openEd['ph-' + d.id] = 1; render(); return;
    }
    if (a === 'uploadimg') return uploadImage(d, el);
    if (!ACT[a]) return;
    if (!S.admin) return toast('Bấm “🔒 Quản trị” để chỉnh sửa.', 'warn');
    const msg = (function () { let r; mutate(c => { r = ACT[a](c, d, el); if (r === 'cancel') throw CANCEL; }); return r; })();
    if (msg && msg !== 'cancel' && msg !== 'no-render') toast(msg, 'ok');
  }
  const CANCEL = { __cancel: 1 };   // người dùng bấm Cancel trong hộp thoại xác nhận
  function mutate(fn, opt) {
    if (!S.admin) { toast('Bấm “🔒 Quản trị” để chỉnh sửa.', 'warn'); return; }
    pushUndo();
    try { fn(ensureDraft()); } catch (e) {
      if (e === CANCEL) { S.undo.pop(); return; }
      S.undo.pop(); throw e;
    }
    markDirty(); render();
    if (opt && opt.toast) toast(opt.toast, 'ok');
  };

  /* ============================== TOOLBAR MD ============================ */
  function findTa(path) {
    return document.querySelector(`textarea[data-path="${path}"]`);
  }
  function mdAction(kind, path, el) {
    const ta = findTa(path); if (!ta) return;
    if (kind === 'pv') {
      const id = ta.dataset.pv, box = id && document.getElementById(id);
      if (box) { box.hidden = !box.hidden; if (!box.hidden) box.innerHTML = MD.render(ta.value, []); }
      el.classList.toggle('on'); return;
    }
    if (kind === 'up') return uploadImage({ path: path }, el);
    if (kind === 'bold') return MD.wrapSelection(ta, '**', '**', 'chữ in đậm');
    if (kind === 'h2') return MD.prefixLines(ta, '## ');
    if (kind === 'h3') return MD.prefixLines(ta, '### ');
    if (kind === 'ul') return MD.prefixLines(ta, '- ');
    if (kind === 'ol') return MD.prefixLines(ta, '1. ');
    if (kind === 'quote') return MD.prefixLines(ta, '> ');
    if (kind === 'hr') return MD.wrapSelection(ta, '\n---\n', '', '');
    if (kind === 'link') {
      const url = prompt('Dán đường link (https://…):', 'https://');
      if (!url) return;
      MD.wrapSelection(ta, '[', '](' + url + ')', 'tên liên kết');
    }
    if (kind === 'img') {
      const url = prompt('Dán URL ảnh (hoặc bấm “⬆ Tải ảnh” để đưa ảnh lên kho):', 'https://');
      if (!url) return;
      MD.wrapSelection(ta, '![', '](' + url + ')', 'mô tả ảnh');
    }
  }

  /* ============================ TẢI ẢNH LÊN ============================= */
  function uploadImage(d, el) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 3e6) return toast('Ảnh quá lớn (tối đa ~3 MB). Hãy nén lại hoặc dùng link ảnh.', 'err', 6000);
      const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      const name = (Date.now().toString(36) + '-' + U.slug(f.name.replace(/\.[^.]+$/, '')) + '.' + (f.name.split('.').pop() || 'png')).slice(0, 60);
      let url;
      toast('Đang tải ảnh lên…', '', 2000);
      try {
        if (S.adapter.uploadAsset && (S.mode === 'github' ? ST.github.canPublish(cfgG()) : S.mode === 'cloud')) {
          const r = await S.adapter.uploadAsset(cfgFor(), name, dataUrl);
          url = r.url;
          toast('Đã tải ảnh lên kho ✓ (ảnh xuất hiện sau khi trang được cập nhật)', 'ok', 5000);
        } else {
          url = dataUrl;
          toast('Chưa kết nối kho ảnh — ảnh được nhúng trực tiếp vào nội dung (làm nặng file).', 'warn', 6000);
        }
      } catch (e) {
        url = dataUrl;
        toast('Không tải lên được (' + e.message + ') — đã nhúng ảnh vào nội dung.', 'warn', 6000);
      }
      const ta = d.ta ? document.getElementById(d.ta) : (d.path ? findTa(d.path) : null);
      if (ta) MD.wrapSelection(ta, `![${f.name.replace(/\.[^.]+$/, '')}](${url})`, '', '');
      else mutate(c => { const s = U.byId(c.sections, d.id); if (s) s.body += `\n![${f.name}](${url})`; });
    };
    inp.click();
  }

  /* ============================ KÉO THẢ SẮP XẾP ========================= */
  let dragId = null;
  function bindDrag() {
    U.$$('[data-draggable]').forEach(el => {
      el.addEventListener('dragstart', onDragStart);
      el.addEventListener('dragend', onDragEnd);
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('drop', onDrop);
    });
  }
  function onDragStart(e) {
    dragId = e.currentTarget.getAttribute('data-draggable');
    e.currentTarget.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', dragId); } catch (z) { }
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    U.$$('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    dragId = null;
  }
  function onDragOver(e) {
    if (!dragId) return;
    const t = e.currentTarget;
    if (t.getAttribute('data-draggable') === dragId) return;
    if (t.getAttribute('data-draggable').split(':')[0] !== dragId.split(':')[0]) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    const before = (e.clientY - r.top) < r.height / 2;
    U.$$('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    t.classList.add(before ? 'drop-before' : 'drop-after');
  }
  function onDrop(e) {
    if (!dragId) return;
    const t = e.currentTarget;
    const targetId = t.getAttribute('data-draggable');
    if (targetId === dragId) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    const before = (e.clientY - r.top) < r.height / 2;
    const kind = dragId.split(':')[0], id = dragId.split(':')[1], tid = targetId.split(':')[1];
    U.$$('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    dragId = null;
    mutate(c => { moveTo(c[kind], id, tid, before); }, { toast: 'Đã sắp xếp lại' });
  }

  /* ============================ TRẠNG THÁI BAR =========================== */
  function updateStatus() {
    const ab = $('#adminbar'); if (!ab || ab.hidden) return;
    const diff = S.draft && S.pub ? M.summarize(S.pub, S.draft) : '';
    $('#abMode').textContent = S.adapter.short + (S.mode === 'local' ? ' (chỉ máy này)' : '');
    $('#abState').innerHTML = S.dirty
      ? `<b class="chg">● Chưa xuất bản:</b> ${esc(diff)}`
      : `Đã đồng bộ · ${esc(U.fmtRel((S.pub && S.pub.meta.updatedAt) || ''))}`;
    $('#abPublish').disabled = !S.dirty || S.busy || (!canPublish() && S.mode !== 'local');
    $('#abPublish').title = canPublish() || S.mode === 'local' ? 'Ctrl+S' : 'Chưa cấu hình nơi lưu — bấm ⚙ Kết nối';
    $('#abDiscard').disabled = !S.dirty;
    $('#abUndo').disabled = !S.undo.length;
    $('#abRedo').disabled = !S.redo.length;
    $('#abView').textContent = S.view === 'edit' ? '👁 Xem trang' : '✎ Tiếp tục sửa';
    const dot = $('#syncDot');
    if (dot) {
      dot.hidden = false;
      dot.className = 'dot ' + (S.dirty ? 'dirty' : canPublish() ? 'ok' : 'ro');
      dot.title = S.dirty ? 'Có thay đổi chưa xuất bản' : canPublish() ? 'Đã kết nối kho nội dung' : 'Chế độ chỉ đọc';
    }
  }

  /* ============================== XUẤT BẢN ============================== */
  async function doPublish() {
    if (!S.admin) return toast('Bạn chưa ở chế độ quản trị', 'warn');
    if (!S.dirty) return toast('Không có thay đổi nào để xuất bản', 'warn');
    const c = U.clone(C());
    const v = M.validate(c);
    if (!v.ok) return toast('Dữ liệu chưa hợp lệ: ' + v.errors.join(' · '), 'err', 7000);
    if (v.warnings.length) console.warn('[SEC] Cảnh báo nội dung:', v.warnings);
    if (!canPublish() && S.mode !== 'local') { openCfg(); return toast('Chưa cấu hình nơi lưu nội dung', 'warn', 5000); }

    const suggest = M.summarize(S.pub, c);
    const note = prompt('Ghi chú cho lần xuất bản này (lưu vào lịch sử):', suggest);
    if (note === null) return;
    c.meta.updatedAt = new Date().toISOString();
    c.meta.updatedBy = S.cfg.author || S.user || 'Quản trị';

    busy(true, 'Đang xuất bản…');
    try {
      const res = await S.adapter.write(cfgFor(), c, { note: note || suggest, author: c.meta.updatedBy, baseSha: S.baseSha });
      S.pub = c; S.draft = null; S.dirty = false; S.undo = []; S.redo = [];
      S.baseSha = res.sha || null;
      S.pubInfo = { updatedAt: c.meta.updatedAt, updatedBy: c.meta.updatedBy, source: S.adapter.short };
      U.ls.del(K.draft);
      ST.cacheSet(c, S.pubInfo);
      toast('✅ Đã xuất bản! ' + (S.mode === 'github' ? 'Trang sẽ cập nhật trong ~30–60 giây.' : 'Mọi người thấy ngay khi tải lại trang.'), 'ok', 7000);
      render();
      loadVersions(true);
      if (S.mode === 'github') setTimeout(() => refreshRemote(true), 25000);
    } catch (e) {
      if (e && e.status === 409) {
        const ok = confirm('XUNG ĐỘT: nội dung trên kho đã bị thay đổi bởi người khác kể từ khi bạn mở bản nháp.\n\n' +
          'OK = Ghi đè bằng bản của bạn (bản kia vẫn nằm trong lịch sử, khôi phục được).\nCancel = Tải bản mới nhất về xem trước (giữ nguyên bản nháp).');
        if (ok) { S.baseSha = null; busy(false); return doPublish(); }
        await refreshRemote(true);
        toast('Đã tải bản mới nhất. Bản nháp của bạn vẫn còn — kiểm tra lại rồi xuất bản.', 'warn', 8000);
      } else {
        toast('Xuất bản thất bại: ' + (e && e.message ? e.message : e), 'err', 9000);
        console.error(e);
      }
    } finally { busy(false); }
  }

  async function loadVersions(silent) {
    try {
      S.versions = await S.adapter.versions(cfgFor(), 30);
      if ($('#dlgHist').open) renderVersions();
      if (!silent && !S.versions.length) toast('Chưa có phiên bản nào được lưu', 'warn');
    } catch (e) {
      if (!silent) toast('Không đọc được lịch sử: ' + e.message, 'err');
      S.versions = [];
    }
  }

  function renderVersions() {
    const b = $('#histBody'); if (!b) return;
    if (!S.versions.length) {
      b.innerHTML = `<p class="note">Chưa có phiên bản nào. ${canPublish() ? 'Mỗi lần “Xuất bản” sẽ tạo một phiên bản có thể khôi phục.' : 'Cấu hình GitHub/Cloudflare để có lịch sử phiên bản.'}</p>`;
      return;
    }
    b.innerHTML = `<p class="note">${S.versions.length} phiên bản gần nhất · bấm <b>Xem</b> để đọc lại, <b>Nạp vào bản nháp</b> để khôi phục.</p>` +
      `<ul class="vlist">${S.versions.map(v => `<li>
        <div class="vmeta"><b>${esc(v.note || '(không ghi chú)')}</b>
        <span>${esc(v.short || '')} · ${esc(v.author || '?')} · ${esc(U.fmtDate(v.date))} <i>(${esc(U.fmtRel(v.date))})</i></span></div>
        <div class="row"><button type="button" data-v="view" data-id="${esc(v.id)}">Xem</button>
        <button type="button" class="pri" data-v="load" data-id="${esc(v.id)}">Nạp vào bản nháp</button>
        ${v.url ? `<a class="mini" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</div></li>`).join('')}</ul>`;
  }

  async function openHist() {
    $('#dlgHist').showModal();
    $('#histBody').innerHTML = '<p class="note">Đang tải lịch sử…</p>';
    await loadVersions(true);
    renderVersions();
  }

  async function histAction(kind, id) {
    try {
      const c = await S.adapter.versionContent(cfgFor(), id);
      if (!c) return toast('Không đọc được phiên bản này', 'err');
      if (kind === 'view') {
        S.previewId = id;
        $('#prevTitle').textContent = 'Xem trước phiên bản ' + ((S.versions.filter(v => v.id === id)[0] || {}).short || '');
        $('#prevBody').innerHTML = previewHTML(c);
        $('#dlgPrev').showModal();
      } else {
        if (!S.admin) enterAdmin(true);
        pushUndo();
        S.draft = c; markDirty(); render();
        $('#dlgHist').close();
        toast('Đã nạp phiên bản cũ vào BẢN NHÁP. Kiểm tra lại rồi bấm “Xuất bản”.', 'ok', 8000);
      }
    } catch (e) { toast('Lỗi: ' + e.message, 'err'); }
  }

  function previewHTML(c) {
    const q = M.q(c);
    return `<div class="pvhead"><b>${esc(c.meta.title)}</b><span class="note">${c.phases.length} giai đoạn · ${c.sections.length} mục · ${c.templates.length} mẫu · cập nhật ${esc(U.fmtDate(c.meta.updatedAt))}</span></div>` +
      c.phases.map((p, i) => {
        const secs = q.sectionsOf(p.id);
        return `<details class="dt" ${i === 0 ? 'open' : ''}><summary><span class="no">${i + 1}</span><span class="tt"><b>${esc(p.name)}</b><small>${secs.length} mục</small></span></summary>
        <div class="db">${MD.render(p.bullets.map(b => '- ' + b).join('\n'), [])}${secs.map(s => `<h3>${q.label(s)} ${esc(s.title)}</h3>${MD.render(s.body, [])}${linkList(s.links, [])}`).join('')}</div></details>`;
      }).join('');
  }

  /* ========================= HỘP THOẠI KẾT NỐI ========================= */
  function openCfg() {
    const c = S.cfg;
    const modes = [['github', 'GitHub — miễn phí, có lịch sử phiên bản, khôi phục 1 chạm (khuyên dùng)'],
    ['cloud', 'Cloudflare Worker + D1 — xuất bản tức thì, cần deploy Worker'],
    ['local', 'Chỉ lưu trên máy này — dùng thử, không chia sẻ'],
    ['static', 'Chỉ đọc — không cho sửa']];
    $('#cfgBody').innerHTML = `
    <div class="fld"><label>Nơi lưu nội dung</label>
      <select id="cfgMode">${modes.map(m => `<option value="${m[0]}" ${c.mode === m[0] ? 'selected' : ''}>${esc(m[1])}</option>`).join('')}</select></div>
    <div id="cfgGithub" class="cfgset">
      <h4>Kết nối GitHub</h4>
      <p class="note">Token chỉ lưu trên <b>trình duyệt của bạn</b>, không nằm trong mã nguồn trang. Tạo token: GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> → chọn repo này → quyền <b>Contents: Read and write</b>. Xem hướng dẫn chi tiết trong file <code>docs/</code>.</p>
      <div class="grid2">
        <div class="fld"><label>Owner (user/tổ chức)</label><input id="ghOwner" value="${esc(c.github.owner)}" placeholder="ten-cua-ban"></div>
        <div class="fld"><label>Tên repo</label><input id="ghRepo" value="${esc(c.github.repo)}" placeholder="cam-nang-giao-vien-sec"></div>
      </div>
      <div class="grid2">
        <div class="fld"><label>Nhánh</label><input id="ghBranch" value="${esc(c.github.branch)}" placeholder="main"></div>
        <div class="fld"><label>Đường dẫn file nội dung</label><input id="ghPath" value="${esc(c.github.path)}" placeholder="content.json"></div>
      </div>
      <div class="fld"><label>Token (PAT)</label><input id="ghToken" type="password" value="${esc(c.github.token)}" placeholder="github_pat_…" autocomplete="off"></div>
      ${c.github.token ? `<p class="note">🔑 Đã có token trên máy này. <button type="button" class="lnk" id="ghDrop">Xoá token (đăng xuất)</button></p>` : ''}
    </div>
    <div id="cfgCloud" class="cfgset">
      <h4>Kết nối Cloudflare Worker</h4>
      <div class="fld"><label>Địa chỉ API</label><input id="cfBase" value="${esc(c.cloud.apiBase)}" placeholder="https://ten-cua-ban.pages.dev"></div>
      <div class="fld"><label>Mật khẩu quản trị (ADMIN_KEY)</label><input id="cfKey" type="password" value="${esc(c.cloud.adminKey)}" autocomplete="off"></div>
    </div>
    <div class="fld"><label>Tên người xuất bản (ghi vào lịch sử)</label><input id="cfgAuthor" value="${esc(c.author)}" placeholder="VD: Cô Lan – Quản lý đào tạo"></div>
    <p id="cfgMsg" class="note"></p>
    <div class="row" style="margin-top:12px">
      <button type="button" class="pri" id="cfgSave">💾 Lưu & đăng nhập quản trị</button>
      <button type="button" id="cfgTest">🔌 Kiểm tra kết nối</button>
      <button type="button" id="cfgLogout" class="dg">Thoát quản trị</button>
      <button type="button" value="cancel">Đóng</button>
    </div>`;
    $('#dlgCfg').showModal();
    const sync = () => {
      const m = $('#cfgMode').value;
      $('#cfgGithub').hidden = m !== 'github';
      $('#cfgCloud').hidden = m !== 'cloud';
    };
    $('#cfgMode').onchange = sync; sync();
    const readForm = () => {
      S.cfg.mode = $('#cfgMode').value;
      S.cfg.github = { owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim() || 'main', path: $('#ghPath').value.trim() || 'content.json', token: $('#ghToken').value.trim() };
      S.cfg.cloud = { apiBase: $('#cfBase').value.trim(), adminKey: $('#cfKey').value.trim() };
      S.cfg.author = $('#cfgAuthor').value.trim();
      return S.cfg;
    };
    $('#ghDrop') && ($('#ghDrop').onclick = () => { $('#ghToken').value = ''; $('#cfgMsg').textContent = 'Đã xoá token khỏi ô nhập. Bấm Lưu để áp dụng.'; });
    $('#cfgTest').onclick = async () => {
      readForm();
      $('#cfgMsg').textContent = 'Đang kiểm tra…';
      const ad = ST.get(S.cfg.mode);
      try {
        const r = await ad.check(S.cfg.mode === 'github' ? S.cfg.github : S.cfg.cloud);
        $('#cfgMsg').innerHTML = (r.ok ? '✅ ' : '⚠ ') + esc(r.message || '');
        if (r.user) { S.user = r.user; }
      } catch (e) { $('#cfgMsg').innerHTML = '❌ ' + esc(e.message || JSON.stringify(e)); }
    };
    $('#cfgSave').onclick = () => {
      readForm();
      ST.saveCfg(S.cfg);
      applyMode();
      $('#dlgCfg').close();
      enterAdmin(true);
    };
    $('#cfgLogout').onclick = () => {
      exitAdmin(); $('#dlgCfg').close();
    };
  }

  function applyMode() {
    S.mode = ST.resolveMode(S.cfg);
    S.adapter = ST.get(S.mode);
    MD.assetResolver = ST.assetResolver(S.cfg, S.mode);
    updateStatus();
  }

  function enterAdmin(force) {
    if (!S.admin) {
      if (!canPublish() && S.mode !== 'local' && !force) { openCfg(); return; }
      S.admin = true;
      if (!S.draft) S.draft = U.clone(S.pub || C());
      S.view = 'edit';
      if (!canPublish() && S.mode === 'static') { S.cfg.mode = 'local'; ST.saveCfg(S.cfg); applyMode(); toast('Chưa cấu hình kho nội dung → đang ở chế độ bản nháp trên máy này.', 'warn', 6000); }
      toast('Đã bật chế độ quản trị. Sửa xong nhớ bấm “Xuất bản”.', 'ok', 5000);
    } else if (force) { S.view = 'edit'; }
    U.ls.set(K.ui, { admin: S.admin, view: S.view, tab: S.tab, etab: S.etab });
    render();
    g.scrollTo(0, Math.min(g.scrollY, 200));
  }
  function exitAdmin() {
    S.admin = false; S.view = 'read';
    U.ls.set(K.ui, { admin: false, view: 'read', tab: S.tab, etab: S.etab });
    render(); toast('Đã thoát chế độ quản trị');
  }

  /* ========================= XUẤT / NẠP DỮ LIỆU ========================= */
  function openData() {
    $('#dJson').value = JSON.stringify(C(), null, 1);
    $('#dMsg').textContent = '';
    $('#dlgData').showModal();
  }
  function download(name, text, type) {
    const b = new Blob([text], { type: type || 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ============================ ĐỌC TỪ XA =============================== */
  async function refreshRemote(silent) {
    try {
      const c = await S.adapter.read(cfgFor(), { anon: S.mode === 'github' && !cfgG().token });
      if (!c) throw new Error('không đọc được');
      const changed = JSON.stringify(c) !== JSON.stringify(S.pub);
      S.pub = c;
      S.pubInfo = { updatedAt: c.meta.updatedAt, updatedBy: c.meta.updatedBy, source: S.adapter.short };
      ST.cacheSet(c, S.pubInfo);
      if (S.mode === 'github') { try { S.baseSha = (await ST.github.head(cfgG())).sha; } catch (e) { } }
      else if (S.mode === 'cloud') { try { S.baseSha = (await ST.cloud.head(cfgC())).sha; } catch (e) { } }
      if (changed) {
        if (!S.dirty) render();
        if (!silent) toast('Đã cập nhật nội dung mới nhất từ kho ✓', 'ok');
      } else if (!silent) toast('Nội dung đã là bản mới nhất');
      notice('');
      return true;
    } catch (e) {
      if (!silent) toast('Không kết nối được kho nội dung: ' + e.message, 'err', 6000);
      if (!S.pub) notice('Không tải được nội dung từ máy chủ — đang hiển thị <b>bản gốc nhúng trong trang</b>.', 'warn');
      return false;
    }
  }

  /* ================================ SỰ KIỆN ============================= */
  function bindEvents() {
    /* tìm kiếm */
    $('#q').addEventListener('input', U.debounce(() => { if (!S.admin || S.view === 'read') render(); }, 120));
    $('#q').addEventListener('keydown', e => { if (e.key === 'Escape') { $('#q').value = ''; render(); } });

    /* kéo-thả: chỉ cho phép kéo khi bấm giữ tay cầm ⠿ (tránh nhiễu khi bôi đen chữ) */
    document.addEventListener('mousedown', e => {
      const h = e.target.closest('[data-drag]'); if (!h) return;
      const p = h.closest('[data-draggable]'); if (p) p.setAttribute('draggable', 'true');
    });
    const clearDraggable = () => U.$$('[data-draggable][draggable]').forEach(p => p.removeAttribute('draggable'));
    document.addEventListener('mouseup', clearDraggable);
    document.addEventListener('dragend', clearDraggable);
    document.addEventListener('click', e => { if (e.target.closest('[data-drag]')) e.preventDefault(); }, true);

    /* giữ trạng thái mở/đóng của các thẻ details */
    document.addEventListener('toggle', e => {
      const t = e.target, d = t.dataset; if (!d) return;
      if (d.sec != null) t.open ? S.openSec[d.sec] = 1 : delete S.openSec[d.sec];
      if (d.ed != null) t.open ? S.openEd[d.ed] = 1 : delete S.openEd[d.ed];
    }, true);

    /* nhập liệu: cập nhật model, KHÔNG render lại (tránh nhảy con trỏ) */
    document.addEventListener('input', e => {
      const t = e.target, d = t.dataset; if (!d) return;
      if (d.path) {
        if (!S.admin) return;
        ensureDraft();
        setByPath(S.draft, d.path, t.value);
        markDirty(); updateStatus();
        if (d.pv) updatePreview(t);
        const sum = t.closest('details.ed') && t.closest('details.ed').querySelector('.edttl');
        if (sum && (d.path.endsWith(':title') || d.path.endsWith(':name'))) sum.textContent = t.value;
        if (d.path === 'meta:title' || d.path === 'meta:brand' || d.path === 'meta:subtitle' || d.path === 'meta:footer') softRender();
        return;
      }
      if (t.id === 'edFilter') { S.filter = t.value; const y = g.scrollY; render(); g.scrollTo(0, y); const f = $('#edFilter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
      if (t.id === 'dJson') $('#dMsg').textContent = '';
    });

    /* focus/blur: chụp snapshot để hoàn tác theo từng trường */
    document.addEventListener('focusin', e => {
      const d = e.target.dataset;
      if (d && d.path && S.admin) S.pendingSnap = JSON.stringify(C());
    });
    document.addEventListener('focusout', e => {
      const d = e.target.dataset;
      if (d && d.path && S.pendingSnap) {
        if (S.pendingSnap !== JSON.stringify(C())) { S.undo.push(S.pendingSnap); if (S.undo.length > 80) S.undo.shift(); S.redo.length = 0; updateStatus(); }
        S.pendingSnap = null;
      }
      if (d && d.path) persistDraft();
    });

    document.addEventListener('change', e => {
      const t = e.target, d = t.dataset;
      if (d && d.path && t.tagName === 'SELECT') {
        if (!S.admin) return;
        pushUndo(); ensureDraft(); setByPath(S.draft, d.path, t.value); markDirty(); render();
      }
    });

    /* click uỷ quyền */
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-tab],[data-etab],[data-all],[data-cp],[data-cf],[data-go],[data-a],[data-md],[data-chip],[data-v],[data-refresh]');
      if (!t) return;
      const d = t.dataset;

      if (d.chip != null) { $('#q').value = d.chip; if (S.admin && S.view === 'edit') { S.view = 'read'; } render(); $('#info').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (d.refresh != null) { refreshRemote(); return; }
      if (d.go) { S.tab = d.go === 'docs' ? C().phases.length : 0; S.cf = ''; if (S.admin) S.view = 'read'; render(); document.getElementById('overview').scrollIntoView({ behavior: 'smooth' }); return; }
      if (d.tab != null) { S.tab = +d.tab; S.cf = ''; render(); return; }
      if (d.etab != null) { S.etab = +d.etab; render(); return; }
      if (d.cf != null) { S.cf = d.cf; render(); return; }
      if (d.all) { const a = U.$$(d.all); const open = a.some(x => !x.open); a.forEach(x => x.open = open); return; }
      if (d.cp != null) {
        const c = C(), item = U.byId(c.templates, d.cp);
        if (item) copyText(item.text).then(ok => {
          t.textContent = ok ? 'Đã sao chép ✓' : 'Không sao chép được';
          setTimeout(() => t.textContent = 'Sao chép mẫu', 1800);
        });
        return;
      }
      if (d.md != null) { mdAction(d.md, d.for, t); return; }
      if (d.v != null) { histAction(d.v, d.id); return; }
      if (d.a != null) { handleAction(d.a, d, t); return; }
    });

    /* thanh quản trị */
    $('#btnAdmin').onclick = () => S.admin ? exitAdmin() : enterAdmin();
    $('#navAdmin').onclick = e => { e.preventDefault(); enterAdmin(true); document.getElementById('overview').scrollIntoView({ behavior: 'smooth' }); };
    $('#abPublish').onclick = doPublish;
    $('#abDiscard').onclick = discardDraft;
    $('#abUndo').onclick = doUndo;
    $('#abRedo').onclick = doRedo;
    $('#abCfg').onclick = openCfg;
    $('#abHist').onclick = openHist;
    $('#abData').onclick = openData;
    $('#abExit').onclick = exitAdmin;
    $('#abView').onclick = () => { S.view = S.view === 'edit' ? 'read' : 'edit'; render(); };

    /* hộp thoại dữ liệu */
    $('#dDownload').onclick = () => download('content.json', JSON.stringify(C(), null, 1));
    $('#dCopy').onclick = () => copyText($('#dJson').value).then(ok => toast(ok ? 'Đã sao chép JSON ✓' : 'Không sao chép được', ok ? 'ok' : 'err'));
    $('#dUpload').onclick = () => $('#dFile').click();
    $('#dFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#dJson').value = await f.text();
      $('#dMsg').textContent = 'Đã nạp tệp ' + f.name + ' vào ô bên dưới — bấm “Nạp vào bản nháp”.';
      e.target.value = '';
    };
    $('#dValidate').onclick = () => {
      const c = M.migrate($('#dJson').value);
      if (!c) { $('#dMsg').innerHTML = '<b class="bad">❌ JSON không hợp lệ</b>'; return; }
      const v = M.validate(c);
      $('#dMsg').innerHTML = (v.ok ? '<b>✅ Hợp lệ</b> · ' : '<b class="bad">❌ ' + esc(v.errors.join('; ')) + '</b> · ') +
        `${c.phases.length} giai đoạn, ${c.sections.length} mục, ${c.templates.length} mẫu, ${U.bytes(v.size || 0)}` +
        (v.warnings.length ? `<br><span class="note">⚠ ${esc(v.warnings.slice(0, 4).join(' · '))}</span>` : '');
    };
    $('#dLoad').onclick = () => {
      const c = M.migrate($('#dJson').value);
      if (!c) { $('#dMsg').innerHTML = '<b class="bad">❌ Không nạp được: JSON sai định dạng</b>'; return; }
      if (!S.admin) enterAdmin(true);
      pushUndo(); S.draft = c; markDirty(); render();
      $('#dlgData').close();
      toast('Đã nạp vào BẢN NHÁP (' + M.summarize(S.pub, c) + '). Bấm “Xuất bản” để áp dụng cho mọi người.', 'ok', 8000);
    };
    $('#prevRestore').onclick = () => { if (S.previewId) { $('#dlgPrev').close(); histAction('load', S.previewId); } };

    /* phím tắt */
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.admin) doPublish(); return; }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && S.admin) { e.preventDefault(); doUndo(); return; }
      if (mod && ((e.key.toLowerCase() === 'y') || (e.key.toLowerCase() === 'z' && e.shiftKey)) && S.admin) { e.preventDefault(); doRedo(); return; }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); S.admin ? (S.view = S.view === 'edit' ? 'read' : 'edit', render()) : enterAdmin(); return; }
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
    });

    /* cảnh báo mất thay đổi khi đóng trang */
    g.addEventListener('beforeunload', e => {
      if (S.dirty) { persistDraft(); e.preventDefault(); e.returnValue = ''; }
    });
    g.addEventListener('online', () => { S.online = true; notice(''); refreshRemote(true); });
    g.addEventListener('offline', () => { S.online = false; notice('Mất kết nối mạng — bạn vẫn xem được bản đã lưu trên máy, nhưng không xuất bản được.', 'warn'); });
  }

  /* ================================ KHỞI ĐỘNG =========================== */
  async function boot() {
    MD.assetResolver = url => url;
    /* 1) sơn trang ngay lập tức bằng bộ đệm/nội dung nhúng -> KHÔNG có thời gian chờ */
    const cache = ST.cacheGet();
    let start = null;
    if (cache && cache.content) { try { start = M.migrate(cache.content); } catch (e) { } }
    if (!start) start = M.migrate(EMBEDDED);
    if (!start) start = M.empty();
    S.pub = start;
    S.pubInfo = (cache && cache.info) || { updatedAt: start.meta.updatedAt, updatedBy: start.meta.updatedBy, source: 'bộ nhớ đệm/nội dung nhúng' };

    /* 2) cấu hình */
    S.cfg = ST.loadCfg();
    const siteCfg = await ST.readSiteConfig();
    if (siteCfg) {
      S.siteCfg = siteCfg;
      if (siteCfg.mode && S.cfg.mode === 'auto') S.cfg.mode = siteCfg.mode;
      if (siteCfg.github) S.cfg.github = Object.assign(S.cfg.github, siteCfg.github, { token: S.cfg.github.token });
      if (siteCfg.cloud) S.cfg.cloud = Object.assign(S.cfg.cloud, siteCfg.cloud, { adminKey: S.cfg.cloud.adminKey });
      if (siteCfg.author && !S.cfg.author) S.cfg.author = siteCfg.author;
      ST.saveCfg(S.cfg);
    }
    applyMode();
    render();

    /* 3) khôi phục UI + bản nháp */
    const ui = U.ls.get(K.ui, {});
    if (ui.tab != null) S.tab = ui.tab;
    if (ui.etab != null) S.etab = ui.etab;
    const dr = U.ls.get(K.draft, null);
    if (dr && dr.content) {
      const d = M.migrate(dr.content);
      if (d && JSON.stringify(d) !== JSON.stringify(S.pub)) {
        S.draft = d; S.dirty = true;
        notice(`Bạn có <b>bản nháp chưa xuất bản</b> (lưu lúc ${esc(U.fmtDate(new Date(dr.at).toISOString()))}). ` +
          `<button type="button" class="pri sm" id="ntcResume">Tiếp tục sửa</button> ` +
          `<button type="button" class="sm" id="ntcDiscard">Huỷ bản nháp</button>`, 'info');
        $('#ntcResume').onclick = () => { enterAdmin(true); notice(''); };
        $('#ntcDiscard').onclick = () => { U.ls.del(K.draft); S.draft = null; S.dirty = false; notice(''); render(); toast('Đã huỷ bản nháp'); };
      } else U.ls.del(K.draft);
    }

    /* 4) nhập dữ liệu cũ (v4) nếu có */
    try {
      const legacy = g.localStorage.getItem(K.legacy);
      if (legacy && !dr) {
        const old = M.migrate(legacy);
        if (old) {
          notice('Tìm thấy <b>bản chỉnh sửa cũ</b> (phiên bản trước) trên máy này. ' +
            `<button type="button" class="pri sm" id="impLegacy">Nhập vào bản nháp</button> ` +
            `<button type="button" class="sm" id="skipLegacy">Bỏ qua</button>`, 'info');
          $('#impLegacy').onclick = () => { enterAdmin(true); pushUndo(); S.draft = old; markDirty(); render(); notice(''); toast('Đã nhập bản cũ vào bản nháp', 'ok'); };
          $('#skipLegacy').onclick = () => { U.ls.del(K.legacy); notice(''); };
        }
      }
    } catch (e) { }

    bindEvents();

    /* 5) tải bản mới nhất ở nền (không chặn hiển thị) */
    if (S.mode !== 'local') await refreshRemote(true);
    else {
      const c = await ST.local.read();
      if (c && !S.dirty) {
        S.pub = c; S.pubInfo = { updatedAt: c.meta.updatedAt, updatedBy: c.meta.updatedBy, source: 'Máy này' };
        ST.cacheSet(c, S.pubInfo); render();
      } else if (!c && !S.dirty && S.pubInfo && S.pubInfo.source && S.pubInfo.source !== 'Máy này') {
        // bộ đệm còn sót từ chế độ lưu khác -> quay về nội dung gốc nhúng trong trang
        S.pub = M.migrate(EMBEDDED) || S.pub;
        S.pubInfo = { updatedAt: S.pub.meta.updatedAt, updatedBy: S.pub.meta.updatedBy, source: 'nội dung nhúng' };
        ST.cacheSet(S.pub, S.pubInfo); render();
      }
    }
    if (S.admin) loadVersions(true);
    updateStatus();
    console.log('%cCẩm nang giáo viên SEC v' + SEC.APP_VERSION, 'color:#1f5aa6;font-weight:bold',
      '\nChế độ lưu:', S.mode, '\nGiai đoạn:', S.pub.phases.length, 'Mục:', S.pub.sections.length, 'Mẫu:', S.pub.templates.length);
  }

  SEC.state = S; SEC.render = render; SEC.boot = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
