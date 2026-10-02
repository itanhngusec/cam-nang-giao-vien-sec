/* =========================================================================
 *  CẨM NANG GIÁO VIÊN SEC — storage.js
 *  Lớp lưu trữ tách rời: Local · GitHub · Cloudflare Worker
 *  - Người XEM: luôn đọc file tĩnh/CDN => tải tức thì, không cold start
 *  - NGƯỜI SỬA (admin): ghi qua API có xác thực, kèm lịch sử phiên bản
 * ========================================================================= */
(function (g) {
  'use strict';
  var SEC = g.SEC = g.SEC || {};
  var U = SEC.util, M = SEC.model, K = SEC.KEYS;

  var S = {};
  SEC.store = S;

  /* ------------------------------------------------------------ cấu hình */
  S.defaultCfg = function () {
    return {
      mode: 'auto',                                   // auto | static | local | github | cloud
      github: { owner: '', repo: '', branch: 'main', path: 'content.json', token: '' },
      cloud: { apiBase: '', adminKey: '' },
      author: ''
    };
  };
  S.loadCfg = function () {
    var c = U.clone(S.defaultCfg());
    var saved = U.ls.get(K.cfg, null);
    if (saved && typeof saved === 'object') {
      c = Object.assign(c, saved);
      c.github = Object.assign(S.defaultCfg().github, saved.github || {});
      c.cloud = Object.assign(S.defaultCfg().cloud, saved.cloud || {});
    }
    // site-config.json (deploy kèm) ghi sẵn owner/repo/branch/apiBase — không chứa secret
    return c;
  };
  S.saveCfg = function (c) { return U.ls.set(K.cfg, c); };
  S.stripSecrets = function (c) {
    var o = U.clone(c);
    if (o.github) o.github.token = '';
    if (o.cloud) o.cloud.adminKey = '';
    return o;
  };

  /* ------------------------------------------------------- cache offline */
  S.cacheGet = function () { return U.ls.get(K.cache, null); };
  S.cacheSet = function (content, info) {
    U.ls.set(K.cache, { at: Date.now(), info: info || {}, content: content });
  };

  /* ------------------------------------------------- đọc file tĩnh (CDN) */
  S.readStatic = function (base) {
    var url = (base || '') + 'content.json';
    if (location.protocol === 'file:') return Promise.reject(new Error('file://'));
    return fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'v=' + Date.now(), {
      cache: 'no-store', headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      var o = M.migrate(t);
      if (!o) throw new Error('content.json không hợp lệ');
      return o;
    });
  };

  S.readSiteConfig = function () {
    if (location.protocol === 'file:') return Promise.resolve(null);
    return fetch('site-config.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  };

  /* ============================================================ GITHUB */
  var GH = 'https://api.github.com';

  function ghHeaders(cfg, extra) {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (cfg && cfg.token) h['Authorization'] = 'Bearer ' + cfg.token;
    return Object.assign(h, extra || {});
  }
  function ghPath(cfg) { return '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo); }

  function ghReq(cfg, path, opts) {
    opts = opts || {};
    if (!cfg.owner || !cfg.repo) return Promise.reject(new Error('Chưa nhập owner/repo'));
    return fetch(GH + path, {
      method: opts.method || 'GET',
      headers: ghHeaders(cfg, opts.headers),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      var rl = r.headers.get('x-ratelimit-remaining');
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var e = new Error(j.message || ('GitHub API lỗi ' + r.status));
          e.status = r.status; e.detail = j; e.rateLeft = rl; throw e;
        });
      }
      var ct = r.headers.get('content-type') || '';
      var p = ct.indexOf('json') > -1 ? r.json() : r.text();
      return p.then(function (v) { v && typeof v === 'object' && (v.__rateLeft = rl); return v; });
    });
  }

  var github = {
    id: 'github',
    label: 'GitHub (miễn phí, có lịch sử phiên bản)',
    short: 'GitHub',
    remote: true,

    ready: function (cfg) { return !!(cfg && cfg.owner && cfg.repo); },
    canPublish: function (cfg) { return !!(cfg && cfg.owner && cfg.repo && cfg.token); },

    /* Đọc bản đã xuất bản: ưu tiên API (chuẩn xác), fallback file tĩnh */
    read: function (cfg, opts) {
      opts = opts || {};
      if (this.ready(cfg) && (cfg.token || opts.anon)) {
        return ghReq(cfg, ghPath(cfg) + '/contents/' + (cfg.path || 'content.json') + '?ref=' + encodeURIComponent(cfg.branch || 'main'),
          { headers: { 'Accept': 'application/vnd.github.raw+json' } })
          .then(function (t) { return M.migrate(t); });
      }
      return S.readStatic();
    },

    /* sha hiện tại của file (dùng phát hiện xung đột) */
    head: function (cfg) {
      return ghReq(cfg, ghPath(cfg) + '/contents/' + (cfg.path || 'content.json') + '?ref=' + encodeURIComponent(cfg.branch || 'main'))
        .then(function (j) { return { sha: j.sha, size: j.size }; })
        .catch(function (e) { if (e.status === 404) return { sha: null }; throw e; });
    },

    write: function (cfg, content, o) {
      o = o || {};
      var path = ghPath(cfg) + '/contents/' + (cfg.path || 'content.json');
      var self = this;
      return self.head(cfg).then(function (h) {
        if (o.baseSha !== undefined && h.sha && o.baseSha && h.sha !== o.baseSha) {
          var e = new Error('CONFLICT'); e.status = 409; e.sha = h.sha; throw e;
        }
        var json = JSON.stringify(content, null, 1);
        return ghReq(cfg, path, {
          method: 'PUT',
          body: {
            message: (o.note || 'Cập nhật cẩm nang') + '\n\nXuat ban tu trang cam nang (v' + SEC.APP_VERSION + ')',
            content: U.b64encode(json),
            branch: cfg.branch || 'main',
            sha: h.sha || undefined
          }
        }).then(function (res) {
          return { ok: true, sha: res.content && res.content.sha, commit: res.commit && res.commit.sha, size: json.length };
        });
      });
    },

    versions: function (cfg, limit) {
      return ghReq(cfg, ghPath(cfg) + '/commits?path=' + encodeURIComponent(cfg.path || 'content.json') +
        '&sha=' + encodeURIComponent(cfg.branch || 'main') + '&per_page=' + (limit || 30))
        .then(function (arr) {
          return (arr || []).map(function (c) {
            return {
              id: c.sha, short: String(c.sha).slice(0, 7),
              date: (c.commit && (c.commit.author || c.commit.committer) || {}).date,
              author: ((c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || '?'),
              note: String((c.commit && c.commit.message) || '').split('\n')[0],
              url: c.html_url
            };
          });
        });
    },

    versionContent: function (cfg, sha) {
      return ghReq(cfg, ghPath(cfg) + '/contents/' + (cfg.path || 'content.json') + '?ref=' + encodeURIComponent(sha),
        { headers: { 'Accept': 'application/vnd.github.raw+json' } })
        .then(function (t) { return M.migrate(t); });
    },

    check: function (cfg) {
      var out = { ok: false };
      var p = cfg.token ? ghReq(cfg, '/user').then(function (u) { out.user = u.login; }) : Promise.resolve();
      return p.then(function () {
        return ghReq(cfg, ghPath(cfg));
      }).then(function (r) {
        out.ok = true;
        out.repo = r.full_name;
        out.push = !!(r.permissions && r.permissions.push);
        out.private = !!r.private;
        out.defaultBranch = r.default_branch;
        out.message = 'Kết nối OK tới ' + r.full_name +
          (out.user ? ' bằng tài khoản @' + out.user : ' (ẩn danh)') +
          (out.push ? ' · có quyền ghi ✓' : ' · CHỈ ĐỌC (thiếu quyền ghi)');
        return out;
      }).catch(function (e) {
        out.message = 'Lỗi: ' + e.message + (e.status === 401 ? ' (token sai/hết hạn)' : e.status === 404 ? ' (không thấy repo — kiểm tra owner/repo hoặc quyền của token)' : '');
        throw out;
      });
    },

    /* Đưa ảnh lên repo (assets/) -> dùng đường dẫn tương đối */
    uploadAsset: function (cfg, filename, dataUrl) {
      var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
      if (!m) return Promise.reject(new Error('Ảnh không hợp lệ'));
      if (m[2].length > 3.2e6) return Promise.reject(new Error('Ảnh quá lớn (giới hạn ~2.4 MB sau mã hoá)'));
      return ghReq(cfg, ghPath(cfg) + '/contents/assets/' + filename, {
        method: 'PUT',
        body: { message: 'Thêm ảnh ' + filename, content: m[2], branch: cfg.branch || 'main' }
      }).then(function () { return { url: 'assets/' + filename }; });
    },

    /* URL raw công khai — dùng khi mở bằng file:// để ảnh/link tương đối vẫn chạy */
    rawBase: function (cfg) {
      return 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/' + (cfg.branch || 'main') + '/';
    }
  };

  /* =================================================== CLOUDFLARE WORKER */
  var cloud = {
    id: 'cloud',
    label: 'Cloudflare Worker + D1 (xuất bản tức thì)',
    short: 'Cloudflare',
    remote: true,
    ready: function (cfg) { return !!(cfg && cfg.apiBase); },
    canPublish: function (cfg) { return !!(cfg && cfg.apiBase && cfg.adminKey); },

    _req: function (cfg, path, opts) {
      opts = opts || {};
      var h = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
      if (cfg.adminKey) h['x-admin-key'] = cfg.adminKey;
      if (opts.body) h['Content-Type'] = 'application/json';
      return fetch(String(cfg.apiBase).replace(/\/$/, '') + path, {
        method: opts.method || 'GET', headers: h,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
          return j;
        });
      });
    },
    read: function (cfg) {
      if (!this.ready(cfg)) return S.readStatic();
      var self = this;
      return self._req(cfg, '/api/content').then(function (j) { return M.migrate(j.content); });
    },
    head: function (cfg) {
      return this._req(cfg, '/api/content').then(function (j) { return { sha: String(j.rev || ''), updatedAt: j.updatedAt }; });
    },
    write: function (cfg, content, o) {
      o = o || {};
      return this._req(cfg, '/api/content', {
        method: 'PUT', body: { content: content, note: o.note || '', author: o.author || '', baseRev: o.baseSha || null }
      }).then(function (j) { return { ok: true, sha: String(j.rev || ''), size: j.size }; });
    },
    versions: function (cfg, limit) {
      return this._req(cfg, '/api/versions?limit=' + (limit || 30)).then(function (j) {
        return (j.versions || []).map(function (v) {
          return { id: String(v.id), short: '#' + v.id, date: v.created_at, author: v.author || '?', note: v.note || '', size: v.size };
        });
      });
    },
    versionContent: function (cfg, id) {
      return this._req(cfg, '/api/versions/' + encodeURIComponent(id)).then(function (j) { return M.migrate(j.content); });
    },
    check: function (cfg) {
      return this._req(cfg, '/api/ping').then(function (j) {
        var okKey = false;
        return cloud._req(cfg, '/api/versions?limit=1').then(function () { okKey = true; })
          .catch(function () { okKey = false; })
          .then(function () {
            return {
              ok: true, repo: j.service || 'Cloudflare Worker', push: okKey,
              user: okKey ? 'admin' : '', message: 'Kết nối OK tới ' + (j.service || 'Worker') +
                (okKey ? ' · mật khẩu quản trị đúng ✓' : ' · SAI mật khẩu quản trị (chỉ đọc)')
            };
          });
      }).catch(function (e) { throw { ok: false, message: 'Lỗi: ' + e.message }; });
    },
    uploadAsset: function (cfg, filename, dataUrl) {
      var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
      if (!m) return Promise.reject(new Error('Ảnh không hợp lệ'));
      var fd = new FormData();
      fd.append('file', new Blob([U.b64decode(m[2])], { type: m[1] }), filename);
      return fetch(String(cfg.apiBase).replace(/\/$/, '') + '/api/assets', {
        method: 'POST', headers: { 'x-admin-key': cfg.adminKey || '' }, body: fd
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.url) throw new Error('Tải ảnh lên thất bại');
        return { url: j.url };
      });
    }
  };

  /* =============================================================== LOCAL */
  var local = {
    id: 'local',
    label: 'Chỉ trên máy này (bản nháp, không chia sẻ)',
    short: 'Máy này',
    remote: false,
    ready: function () { return true; },
    canPublish: function () { return true; },
    _k: 'sec.pub.v2',
    read: function () {
      var v = U.ls.get(this._k, null);
      return Promise.resolve(v ? M.migrate(v) : null);
    },
    write: function (cfg, content, o) {
      o = o || {};
      var ok = U.ls.set(this._k, content);
      var h = U.ls.get(K.hist, []);
      h.unshift({ id: 'l' + Date.now(), date: new Date().toISOString(), author: o.author || 'Bạn', note: o.note || '', content: content });
      U.ls.set(K.hist, h.slice(0, 15));
      if (!ok) return Promise.reject(new Error('Bộ nhớ trình duyệt đầy — không lưu được'));
      return Promise.resolve({ ok: true, sha: 'local-' + Date.now() });
    },
    versions: function () {
      return Promise.resolve((U.ls.get(K.hist, []) || []).map(function (v) {
        return { id: v.id, short: v.id.slice(0, 8), date: v.date, author: v.author, note: v.note, local: true };
      }));
    },
    versionContent: function (cfg, id) {
      var v = (U.ls.get(K.hist, []) || []).filter(function (x) { return x.id === id; })[0];
      return Promise.resolve(v ? M.migrate(v.content) : null);
    },
    check: function () { return Promise.resolve({ ok: true, message: 'Chế độ cục bộ — nội dung chỉ lưu trên trình duyệt này.', push: true, user: 'Bạn' }); },
    uploadAsset: function (cfg, filename, dataUrl) { return Promise.resolve({ url: dataUrl }); }
  };

  /* ============================================================= STATIC */
  var stat = {
    id: 'static',
    label: 'Chỉ đọc (chưa cấu hình nơi lưu)',
    short: 'Chỉ đọc',
    remote: false,
    ready: function () { return true; },
    canPublish: function () { return false; },
    read: function () { return S.readStatic(); },
    write: function () { return Promise.reject(new Error('Chưa cấu hình nơi lưu nội dung. Bấm ⚙ Kết nối để chọn GitHub hoặc Cloudflare.')); },
    versions: function () { return Promise.resolve([]); },
    versionContent: function () { return Promise.resolve(null); },
    check: function () { return Promise.resolve({ ok: false, message: 'Chưa cấu hình. Trang đang chạy chế độ chỉ đọc.' }); }
  };

  S.adapters = { static: stat, local: local, github: github, cloud: cloud };
  S.github = github; S.cloud = cloud; S.local = local; S.static = stat;

  /* Chế độ thực tế đang dùng (auto = tự suy ra từ cấu hình có sẵn) */
  S.resolveMode = function (cfg) {
    if (cfg.mode && cfg.mode !== 'auto') return cfg.mode;
    if (github.canPublish(cfg) || github.ready(cfg)) return 'github';
    if (cloud.canPublish(cfg) || cloud.ready(cfg)) return 'cloud';
    return 'static';
  };
  S.get = function (mode) { return S.adapters[mode] || stat; };

  /* Đường dẫn ảnh tương đối -> URL tuyệt đối khi mở bằng file:// */
  S.assetResolver = function (cfg, mode) {
    return function (url) {
      url = String(url || '');
      if (!url || /^(https?:|data:|blob:)/i.test(url)) return url;
      if (location.protocol === 'file:' && mode === 'github' && cfg.github.owner) return github.rawBase(cfg.github) + url.replace(/^\.\//, '');
      return url;
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
