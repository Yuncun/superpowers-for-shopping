// server/render-profile.js
// Tabbed UI for /cart-profile (Profile | Retailers).
//
// State pushed by the server is the full snapshot:
//   { stage: 'main', profile, retailers, initialTab?, banner? }
//
// banner: { tab, kind: 'success' | 'error' | 'info', text } — surfaced as a
// dismissible toast on the named tab.
//
// Page sends actions:
//   { type: 'submit-profile', profile }
//   { type: 'submit-retailer-add', host }
//   { type: 'submit-retailer-remove', host }
//   { type: 'dismissed' }

function safeJsonEmbed(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderPage({ id, token, baseUrl }) {
  const sessionJson = safeJsonEmbed({ id, token, baseUrl });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cart profile</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  background:#fafafa;
  color:#1a1a1a;
  min-height:100vh;
  display:flex;
  flex-direction:column;
}

header{
  padding:18px 32px 0;
  background:#fff;
  border-bottom:1px solid #e8e8e8;
}

header h1{
  font-size:15px;
  font-weight:500;
  letter-spacing:-.01em;
  color:#888;
  margin-bottom:14px;
}

.tabs{
  display:flex;
  gap:0;
}

.tab{
  border:none;
  background:none;
  padding:10px 18px;
  font:inherit;
  font-size:13px;
  color:#888;
  cursor:pointer;
  border-bottom:2px solid transparent;
  transition:color .12s,border-color .12s;
  font-weight:500;
  letter-spacing:-.005em;
}

.tab:hover{color:#1a1a1a}
.tab.active{color:#1a1a1a;border-bottom-color:#1a1a1a}
.tab .badge{
  display:inline-block;
  background:#1a1a1a;
  color:#fff;
  font-size:10px;
  padding:1px 6px;
  border-radius:8px;
  margin-left:6px;
  vertical-align:1px;
  font-weight:600;
}

main#root{
  flex:1;
  padding:24px 32px 40px;
  max-width:760px;
  margin:0 auto;
  width:100%;
}

.intro{
  font-size:13px;
  color:#888;
  margin-bottom:18px;
  line-height:1.5;
}

.banner{
  padding:10px 14px;
  border-radius:8px;
  font-size:13px;
  margin-bottom:18px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
}

.banner.success{background:#f0f9f0;border:1px solid #c8e6c8;color:#2a7030}
.banner.error  {background:#fff5f5;border:1px solid #ffd0d0;color:#b03030}
.banner.info   {background:#f4f7fb;border:1px solid #d4dff0;color:#385080}

.banner button{
  border:none;
  background:none;
  font:inherit;
  font-size:18px;
  line-height:1;
  cursor:pointer;
  color:inherit;
  opacity:.6;
  padding:0 4px;
}

.banner button:hover{opacity:1}

/* ---------- Profile / Retailers sections ---------- */

.section{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:12px;
  padding:18px 20px;
  margin-bottom:14px;
}

.section-title{
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.06em;
  color:#888;
  margin-bottom:14px;
}

.row{
  display:grid;
  grid-template-columns:140px 1fr;
  gap:12px;
  align-items:center;
  margin-bottom:10px;
}

.row:last-child{margin-bottom:0}

@media(max-width:560px){
  .row{grid-template-columns:1fr;gap:4px}
}

.row label{font-size:13px;color:#555;font-weight:500}
.row .hint{display:block;font-size:11px;color:#aaa;font-weight:400;margin-top:2px}

.row input[type="text"],
.row input[type="number"],
.row input[type="url"]{
  width:100%;font:inherit;font-size:13px;padding:8px 11px;
  border:1px solid #e8e8e8;border-radius:8px;background:#fff;color:#1a1a1a;
  transition:border-color .12s;
}

.row input:focus{outline:none;border-color:#888}
.row input::placeholder{color:#bbb}

.radio-group{display:flex;gap:8px;flex-wrap:wrap}

.radio-group .choice{flex:1;min-width:80px;position:relative}
.radio-group input{position:absolute;opacity:0;pointer-events:none}

.radio-group label{
  display:block;text-align:center;border:1px solid #e8e8e8;background:#fafafa;
  border-radius:8px;padding:9px 8px;font-size:13px;cursor:pointer;user-select:none;
  transition:background .12s,border-color .12s,color .12s;margin:0;font-weight:500;
}

.radio-group label:hover{background:#f0f0f0;border-color:#ccc}
.radio-group input:checked + label{background:#1a1a1a;border-color:#1a1a1a;color:#fff}

.actions-bar{margin-top:20px;display:flex;justify-content:flex-end;gap:12px}

.btn-primary{
  background:#1a1a1a;color:#fff;border:none;border-radius:10px;
  padding:11px 24px;font-size:14px;font-weight:500;cursor:pointer;
  letter-spacing:-.01em;transition:background .12s;
}

.btn-primary:hover{background:#333}
.btn-primary:disabled{background:#ccc;cursor:not-allowed}

.btn-secondary{
  background:none;border:1px solid #e8e8e8;border-radius:10px;
  padding:11px 18px;font-size:13px;color:#555;cursor:pointer;
  transition:border-color .12s,color .12s;
}

.btn-secondary:hover{border-color:#aaa;color:#1a1a1a}

.btn-danger{
  background:none;border:1px solid #f0d0d0;color:#b03030;
  border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;
  transition:background .12s;
}

.btn-danger:hover{background:#fff5f5}

/* ---------- Retailers tab ---------- */

.retailer-list{margin-bottom:14px}

.retailer{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 14px;border:1px solid #e8e8e8;border-radius:8px;
  background:#fff;margin-bottom:8px;
}

.retailer:last-child{margin-bottom:0}

.retailer-host{font-size:13px;font-weight:500}
.retailer-meta{font-size:11px;color:#aaa;margin-left:8px}

.add-row{display:flex;gap:8px;margin-top:6px}
.add-row input{flex:1}

.empty-state{
  text-align:center;padding:24px;color:#888;font-size:13px;
  border:1px dashed #e0e0e0;border-radius:8px;
}

/* ---------- common ---------- */

.center-msg{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:40vh;gap:16px;color:#555;font-size:15px;text-align:center;
}

.spinner{
  width:28px;height:28px;border:2px solid #e0e0e0;border-top-color:#888;
  border-radius:50%;animation:spin .7s linear infinite;
}

@keyframes spin{to{transform:rotate(360deg)}}

#tab-content>*{animation:fadein .15s ease}
@keyframes fadein{from{opacity:0}to{opacity:1}}
</style>
</head>
<body>
<header>
  <h1>Cart — shopping profile</h1>
  <nav class="tabs" id="tabs"></nav>
</header>
<main id="root">
  <div id="tab-content"></div>
</main>
<script>
window.__SESSION__ = ${sessionJson};

(function() {
  var SESSION = window.__SESSION__;
  var id = SESSION.id;
  var token = SESSION.token;
  var baseUrl = SESSION.baseUrl;

  var tabsEl = document.getElementById('tabs');
  var contentEl = document.getElementById('tab-content');

  // Client-side state — server pushes full snapshots, client renders.
  var state = null;
  var activeTab = 'profile';
  // Track dismissed banners so a re-pushed identical banner doesn't reappear.
  var dismissedBanner = null;

  var es = new EventSource(baseUrl + '/r/' + id + '/events?token=' + token);

  es.addEventListener('state', function(e) {
    var s = JSON.parse(e.data);
    state = s;
    if (s.initialTab && !activeTabExplicitlySet) {
      activeTab = s.initialTab;
      activeTabExplicitlySet = true;
    }
    renderAll();
  });

  es.addEventListener('closed', function() {
    es.close();
    contentEl.innerHTML = '<div class="center-msg"><p>Session closed.</p></div>';
  });

  es.onerror = function() { es.close(); };

  var activeTabExplicitlySet = false;

  function sendAction(action) {
    return fetch(baseUrl + '/r/' + id + '/action?token=' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    }).catch(function() {});
  }

  window.addEventListener('beforeunload', function() {
    var url = baseUrl + '/r/' + id + '/action?token=' + token;
    var body = JSON.stringify({ type: 'dismissed' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: body }).catch(function() {});
    }
  });

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtPrice(p) {
    if (p == null || p === '') return '';
    var s = String(p);
    return /^[$€£¥]/.test(s) ? escHtml(s) : '$' + escHtml(s);
  }

  // ---- top-level render ----

  function renderAll() {
    if (!state || state.stage === 'loading') {
      contentEl.innerHTML = '<div class="center-msg"><div class="spinner"></div><p>Loading…</p></div>';
      return;
    }
    renderTabs();
    renderActiveTab();
  }

  function renderTabs() {
    var tabs = [
      { key: 'profile',   label: 'Profile' },
      { key: 'retailers', label: 'Retailers', badge: (state.retailers || []).length },
    ];
    tabsEl.innerHTML = '';
    tabs.forEach(function(t) {
      var btn = document.createElement('button');
      btn.className = 'tab' + (t.key === activeTab ? ' active' : '');
      btn.dataset.tab = t.key;
      btn.textContent = t.label;
      if (t.badge && t.badge > 0) {
        var b = document.createElement('span');
        b.className = 'badge';
        b.textContent = String(t.badge);
        btn.appendChild(b);
      }
      btn.addEventListener('click', function() {
        if (activeTab === t.key) return;
        activeTab = t.key;
        activeTabExplicitlySet = true;
        renderActiveTab();
        renderTabs();
      });
      tabsEl.appendChild(btn);
    });
  }

  function renderActiveTab() {
    contentEl.innerHTML = '';
    if (activeTab === 'profile')   renderProfileTab();
    if (activeTab === 'retailers') renderRetailersTab();
    renderBanner();
  }

  function renderBanner() {
    var b = state && state.banner;
    if (!b || b.tab !== activeTab) return;
    var key = b.tab + ':' + b.kind + ':' + b.text;
    if (key === dismissedBanner) return;
    var div = document.createElement('div');
    div.className = 'banner ' + (b.kind || 'info');
    var span = document.createElement('span');
    span.textContent = b.text;
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'dismiss');
    close.textContent = '×';
    close.addEventListener('click', function() {
      dismissedBanner = key;
      div.remove();
    });
    div.appendChild(span);
    div.appendChild(close);
    contentEl.insertBefore(div, contentEl.firstChild);
  }

  // ---- profile tab ----

  function tagInputValue(arr) {
    if (!arr || !Array.isArray(arr)) return '';
    return arr.join(', ');
  }

  function renderProfileTab() {
    var profile = state.profile || {};
    var wrap = document.createElement('div');

    var intro = document.createElement('p');
    intro.className = 'intro';
    intro.textContent = 'How you shop. /cart uses this to rank candidates.';
    wrap.appendChild(intro);

    wrap.appendChild(section('Sizes', [
      textRow('sizes.top', 'Top', (profile.sizes || {}).top, 'S / M / L / XL'),
      textRow('sizes.bottom', 'Bottom', (profile.sizes || {}).bottom, 'waist x inseam, e.g. 32x32'),
      numberRow('sizes.shoes', 'Shoes', (profile.sizes || {}).shoes, 'whole or half number'),
    ]));

    wrap.appendChild(section('Budget', [
      radioRow('budget_default', 'Default tier',
        [['low','Low'],['mid','Mid'],['high','High']],
        profile.budget_default || 'mid'),
      numberRow('budget_caps.clothes', 'Clothes cap', (profile.budget_caps || {}).clothes, 'max for a single clothing item ($)'),
      numberRow('budget_caps.furniture', 'Furniture cap', (profile.budget_caps || {}).furniture, 'max for a single furniture item ($)'),
    ]));

    wrap.appendChild(section('Brands', [
      tagRow('brands_love', 'Love', tagInputValue(profile.brands_love), 'comma-separated, e.g. Marine Layer, Uniqlo'),
      tagRow('brands_avoid', 'Avoid', tagInputValue(profile.brands_avoid), 'comma-separated, e.g. Shein, Temu'),
    ]));

    wrap.appendChild(section('Fit notes', [
      textRow('fit_notes.tops', 'Tops', (profile.fit_notes || {}).tops, "e.g. \\"relaxed, no v-necks\\""),
      textRow('fit_notes.pants', 'Pants', (profile.fit_notes || {}).pants, 'e.g. tapered, slim'),
      textRow('fit_notes.shoes', 'Shoes', (profile.fit_notes || {}).shoes, 'e.g. wide toe box'),
    ]));

    wrap.appendChild(section('Optional', [
      urlRow('moodboard_url', 'Moodboard', profile.moodboard_url || '', 'Pinterest or similar (not used yet)'),
    ]));

    var bar = document.createElement('div');
    bar.className = 'actions-bar';

    var submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn-primary';
    submit.textContent = 'Save profile';
    submit.addEventListener('click', function() {
      submit.disabled = true;
      submit.textContent = 'Saving…';
      var payload = collectProfile(wrap);
      sendAction({ type: 'submit-profile', profile: payload });
      // Server pushes fresh state on success/error; re-renders will reset button.
    });

    bar.appendChild(submit);
    wrap.appendChild(bar);

    contentEl.appendChild(wrap);
  }

  function section(title, rows) {
    var s = document.createElement('section');
    s.className = 'section';
    var h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = title;
    s.appendChild(h);
    rows.forEach(function(r) { s.appendChild(r); });
    return s;
  }

  function makeRow(field, labelText, hintText) {
    var row = document.createElement('div');
    row.className = 'row';
    row.dataset.field = field;
    var label = document.createElement('label');
    label.textContent = labelText;
    if (hintText) {
      var hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = hintText;
      label.appendChild(hint);
    }
    row.appendChild(label);
    return row;
  }

  function textRow(field, label, value, hint) {
    var row = makeRow(field, label, hint);
    var input = document.createElement('input');
    input.type = 'text';
    input.dataset.field = field;
    input.dataset.kind = 'string';
    input.value = value == null ? '' : String(value);
    row.appendChild(input);
    return row;
  }

  function numberRow(field, label, value, hint) {
    var row = makeRow(field, label, hint);
    var input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.dataset.field = field;
    input.dataset.kind = 'number';
    input.value = value == null || value === '' ? '' : String(value);
    row.appendChild(input);
    return row;
  }

  function urlRow(field, label, value, hint) {
    var row = makeRow(field, label, hint);
    var input = document.createElement('input');
    input.type = 'url';
    input.dataset.field = field;
    input.dataset.kind = 'string';
    input.value = value || '';
    row.appendChild(input);
    return row;
  }

  function tagRow(field, label, value, hint) {
    var row = makeRow(field, label, hint);
    var input = document.createElement('input');
    input.type = 'text';
    input.dataset.field = field;
    input.dataset.kind = 'array';
    input.value = value || '';
    row.appendChild(input);
    return row;
  }

  function radioRow(field, label, options, value) {
    var row = makeRow(field, label, '');
    var group = document.createElement('div');
    group.className = 'radio-group';
    group.dataset.field = field;
    var nameBase = 'radio-' + field.replace(/\\./g, '-');
    options.forEach(function(opt) {
      var val = opt[0], text = opt[1];
      var choice = document.createElement('div');
      choice.className = 'choice';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = nameBase;
      input.value = val;
      input.id = nameBase + '-' + val;
      input.dataset.field = field;
      if (val === value) input.checked = true;
      var lbl = document.createElement('label');
      lbl.htmlFor = input.id;
      lbl.textContent = text;
      choice.appendChild(input);
      choice.appendChild(lbl);
      group.appendChild(choice);
    });
    row.appendChild(group);
    return row;
  }

  function setNested(obj, dottedKey, value) {
    var parts = dottedKey.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function collectProfile(wrap) {
    var out = {};
    var inputs = wrap.querySelectorAll('input[data-field]');
    var seenRadios = {};
    inputs.forEach(function(el) {
      var field = el.dataset.field;
      var kind = el.dataset.kind;
      if (el.type === 'radio') {
        if (seenRadios[field]) return;
        var checked = wrap.querySelector('input[type="radio"][data-field="' + field + '"]:checked');
        if (!checked) return;
        seenRadios[field] = true;
        setNested(out, field, checked.value);
        return;
      }
      var raw = el.value;
      if (raw == null) return;
      var trimmed = String(raw).trim();
      if (kind === 'number') {
        if (trimmed === '') return;
        var n = Number(trimmed);
        if (Number.isNaN(n)) return;
        setNested(out, field, n);
        return;
      }
      if (kind === 'array') {
        var arr = trimmed === '' ? [] : trimmed.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        setNested(out, field, arr);
        return;
      }
      setNested(out, field, trimmed);
    });
    return out;
  }

  // ---- retailers tab ----

  function renderRetailersTab() {
    var retailers = state.retailers || [];
    var wrap = document.createElement('div');

    var intro = document.createElement('p');
    intro.className = 'intro';
    intro.textContent = '/cart searches these stores in parallel. Only Shopify-detected sites are accepted.';
    wrap.appendChild(intro);

    var list = document.createElement('section');
    list.className = 'section retailer-list';

    var title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'Current (' + retailers.length + ')';
    list.appendChild(title);

    if (retailers.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No retailers yet. Add one below.';
      list.appendChild(empty);
    } else {
      retailers.forEach(function(r) {
        var row = document.createElement('div');
        row.className = 'retailer';

        var hostEl = document.createElement('div');
        hostEl.innerHTML =
          '<span class="retailer-host">' + escHtml(r.host) + '</span>' +
          '<span class="retailer-meta">tier ' + escHtml(String(r.tier)) + ' · ' + escHtml(r.handler) +
          (r.last_used ? ' · used ' + escHtml(r.last_used) : '') +
          '</span>';

        var rm = document.createElement('button');
        rm.className = 'btn-danger';
        rm.type = 'button';
        rm.textContent = 'Remove';
        rm.addEventListener('click', function() {
          rm.disabled = true;
          rm.textContent = 'Removing…';
          sendAction({ type: 'submit-retailer-remove', host: r.host });
        });

        row.appendChild(hostEl);
        row.appendChild(rm);
        list.appendChild(row);
      });
    }

    var addSection = document.createElement('section');
    addSection.className = 'section';
    var addTitle = document.createElement('div');
    addTitle.className = 'section-title';
    addTitle.textContent = 'Add a store';
    addSection.appendChild(addTitle);

    var addRow = document.createElement('div');
    addRow.className = 'add-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'host, e.g. marinelayer.com';

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-primary';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', function() {
      var host = (input.value || '').trim();
      if (!host) return;
      addBtn.disabled = true;
      addBtn.textContent = 'Checking…';
      sendAction({ type: 'submit-retailer-add', host: host });
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    });

    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    addSection.appendChild(addRow);

    wrap.appendChild(list);
    wrap.appendChild(addSection);

    contentEl.appendChild(wrap);
  }

})();
</script>
</body>
</html>`;
}
