// server/render-setup.js
// Single-page form for /cart-setup. Pre-populates from existing profile,
// writes everything at once. Replaces the 6-section chat wizard.
//
// Excluded by design: palette (filled by /cart thumb signals, not setup —
// see commands/cart-setup.md anti-patterns).

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
<title>Cart setup</title>
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
  padding:20px 32px;
  border-bottom:1px solid #e8e8e8;
  background:#fff;
}

header h1{
  font-size:15px;
  font-weight:500;
  letter-spacing:-.01em;
  color:#888;
}

main#root{
  flex:1;
  padding:32px;
  max-width:680px;
  margin:0 auto;
  width:100%;
}

.intro{
  font-size:14px;
  color:#555;
  margin-bottom:24px;
  line-height:1.5;
}

.section{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:12px;
  padding:20px 22px;
  margin-bottom:16px;
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
  .row label{margin-bottom:0}
}

.row label{
  font-size:13px;
  color:#555;
  font-weight:500;
}

.row .hint{
  display:block;
  font-size:11px;
  color:#aaa;
  font-weight:400;
  margin-top:2px;
}

.row input[type="text"],
.row input[type="number"],
.row input[type="url"],
.row textarea{
  width:100%;
  font:inherit;
  font-size:13px;
  padding:8px 11px;
  border:1px solid #e8e8e8;
  border-radius:8px;
  background:#fff;
  color:#1a1a1a;
  transition:border-color .12s;
}

.row textarea{
  min-height:60px;
  resize:vertical;
}

.row input:focus,
.row textarea:focus{
  outline:none;
  border-color:#888;
}

.row input::placeholder,
.row textarea::placeholder{color:#bbb}

.radio-group{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}

.radio-group .choice{
  flex:1;
  min-width:80px;
  position:relative;
}

.radio-group input{
  position:absolute;
  opacity:0;
  pointer-events:none;
}

.radio-group label{
  display:block;
  text-align:center;
  border:1px solid #e8e8e8;
  background:#fafafa;
  border-radius:8px;
  padding:9px 8px;
  font-size:13px;
  cursor:pointer;
  user-select:none;
  transition:background .12s,border-color .12s,color .12s;
  margin:0;
  font-weight:500;
}

.radio-group label:hover{background:#f0f0f0;border-color:#ccc}

.radio-group input:checked + label{
  background:#1a1a1a;
  border-color:#1a1a1a;
  color:#fff;
}

.radio-group input:focus-visible + label{
  outline:2px solid #1a1a1a;
  outline-offset:2px;
}

.actions-bar{
  margin-top:24px;
  display:flex;
  justify-content:flex-end;
  gap:12px;
}

.btn-primary{
  background:#1a1a1a;
  color:#fff;
  border:none;
  border-radius:10px;
  padding:12px 28px;
  font-size:14px;
  font-weight:500;
  cursor:pointer;
  letter-spacing:-.01em;
  transition:background .12s;
}

.btn-primary:hover{background:#333}
.btn-primary:disabled{background:#ccc;cursor:not-allowed}

.btn-cancel{
  background:none;
  border:1px solid #e8e8e8;
  border-radius:10px;
  padding:12px 20px;
  font-size:13px;
  color:#555;
  cursor:pointer;
  transition:border-color .12s,color .12s;
}

.btn-cancel:hover{border-color:#aaa;color:#1a1a1a}

.validation{
  margin-top:14px;
  padding:10px 14px;
  background:#fff5f5;
  border:1px solid #ffd0d0;
  border-radius:8px;
  font-size:12px;
  color:#b03030;
  line-height:1.5;
}

.center-msg{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  min-height:40vh;
  gap:16px;
  color:#555;
  font-size:15px;
  text-align:center;
}

.center-msg .summary{
  font-size:13px;
  color:#888;
  margin-top:-4px;
  max-width:420px;
  line-height:1.5;
}

.spinner{
  width:28px;height:28px;
  border:2px solid #e0e0e0;
  border-top-color:#888;
  border-radius:50%;
  animation:spin .7s linear infinite;
}

@keyframes spin{to{transform:rotate(360deg)}}

#root>*{animation:fadein .2s ease}
@keyframes fadein{from{opacity:0}to{opacity:1}}
</style>
</head>
<body>
<header><h1>Cart — shopping profile</h1></header>
<main id="root"></main>
<script>
window.__SESSION__ = ${sessionJson};

(function() {
  var SESSION = window.__SESSION__;
  var id = SESSION.id;
  var token = SESSION.token;
  var baseUrl = SESSION.baseUrl;

  var root = document.getElementById('root');
  var es = new EventSource(baseUrl + '/r/' + id + '/events?token=' + token);

  es.addEventListener('state', function(e) {
    render(JSON.parse(e.data));
  });

  es.addEventListener('closed', function() {
    es.close();
    showMsg('Session closed.');
  });

  es.onerror = function() {
    es.close();
  };

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

  function showMsg(msg, summary) {
    var html = '<div class="center-msg"><p>' + escHtml(msg) + '</p>';
    if (summary) html += '<p class="summary">' + escHtml(summary) + '</p>';
    html += '</div>';
    root.innerHTML = html;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(state) {
    var stage = state.stage;

    if (stage === 'loading') {
      root.innerHTML =
        '<div class="center-msg">' +
          '<div class="spinner"></div>' +
          '<p>' + escHtml(state.message || 'Loading…') + '</p>' +
        '</div>';
      return;
    }

    if (stage === 'form') {
      renderForm(state.profile || {}, state.errors || null);
      return;
    }

    if (stage === 'saving') {
      root.innerHTML =
        '<div class="center-msg">' +
          '<div class="spinner"></div>' +
          '<p>' + escHtml(state.message || 'Saving…') + '</p>' +
        '</div>';
      return;
    }

    if (stage === 'done') {
      showMsg(state.message || 'Profile saved.', state.summary || '');
      return;
    }

    showMsg('Unknown stage: ' + escHtml(stage));
  }

  function tagInputValue(arr) {
    if (!arr || !Array.isArray(arr)) return '';
    return arr.join(', ');
  }

  function renderForm(profile, errors) {
    var wrap = document.createElement('div');

    var intro = document.createElement('p');
    intro.className = 'intro';
    intro.textContent = 'Tell me how you shop. Fill what you remember — blanks are fine. /cart will use this to rank candidates.';
    wrap.appendChild(intro);

    // ---- Sizes ----
    wrap.appendChild(section('Sizes', [
      textRow('sizes.top', 'Top', (profile.sizes || {}).top, 'S / M / L / XL'),
      textRow('sizes.bottom', 'Bottom', (profile.sizes || {}).bottom, 'waist x inseam, e.g. 32x32'),
      numberRow('sizes.shoes', 'Shoes', (profile.sizes || {}).shoes, 'whole or half number'),
    ]));

    // ---- Budget ----
    wrap.appendChild(section('Budget', [
      radioRow('budget_default', 'Default tier',
        [['low', 'Low'], ['mid', 'Mid'], ['high', 'High']],
        profile.budget_default || 'mid'),
      numberRow('budget_caps.clothes', 'Clothes cap', (profile.budget_caps || {}).clothes, 'max for a single clothing item ($)'),
      numberRow('budget_caps.furniture', 'Furniture cap', (profile.budget_caps || {}).furniture, 'max for a single furniture item ($)'),
    ]));

    // ---- Brands ----
    wrap.appendChild(section('Brands', [
      tagRow('brands_love', 'Love', tagInputValue(profile.brands_love), 'comma-separated, e.g. Marine Layer, Uniqlo'),
      tagRow('brands_avoid', 'Avoid', tagInputValue(profile.brands_avoid), 'comma-separated, e.g. Shein, Temu'),
    ]));

    // ---- Fit notes ----
    wrap.appendChild(section('Fit notes', [
      textRow('fit_notes.tops', 'Tops', (profile.fit_notes || {}).tops, "e.g. \\"relaxed, no v-necks\\""),
      textRow('fit_notes.pants', 'Pants', (profile.fit_notes || {}).pants, 'e.g. tapered, slim'),
      textRow('fit_notes.shoes', 'Shoes', (profile.fit_notes || {}).shoes, 'e.g. wide toe box'),
    ]));

    // ---- Optional ----
    wrap.appendChild(section('Optional', [
      urlRow('moodboard_url', 'Moodboard', profile.moodboard_url || '', 'Pinterest or similar (not used yet)'),
    ]));

    if (errors && errors.length > 0) {
      var v = document.createElement('div');
      v.className = 'validation';
      v.textContent = 'Could not save: ' + errors.join('; ');
      wrap.appendChild(v);
    }

    var bar = document.createElement('div');
    bar.className = 'actions-bar';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function() {
      cancelBtn.disabled = true;
      sendAction({ type: 'dismissed' });
    });

    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'btn-primary';
    submitBtn.textContent = 'Save profile';
    submitBtn.addEventListener('click', function() {
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      submitBtn.textContent = 'Saving…';

      var payload = collect(wrap);
      sendAction({ type: 'submit', profile: payload });
    });

    bar.appendChild(cancelBtn);
    bar.appendChild(submitBtn);
    wrap.appendChild(bar);

    root.innerHTML = '';
    root.appendChild(wrap);
  }

  // ---- helpers ----

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
    group.dataset.kind = 'string';
    var nameBase = 'radio-' + field.replace(/\\./g, '-');
    options.forEach(function(opt) {
      var val = opt[0]; var text = opt[1];
      var choice = document.createElement('div');
      choice.className = 'choice';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = nameBase;
      input.value = val;
      input.id = nameBase + '-' + val;
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

  function collect(wrap) {
    var out = {};
    var inputs = wrap.querySelectorAll('input[data-field], textarea[data-field]');
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
        if (trimmed === '') return; // blank → omit
        var n = Number(trimmed);
        if (Number.isNaN(n)) return; // server-side validation will reject if needed
        setNested(out, field, n);
        return;
      }

      if (kind === 'array') {
        var arr = trimmed === ''
          ? []
          : trimmed.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        setNested(out, field, arr);
        return;
      }

      // string
      setNested(out, field, trimmed);
    });
    return out;
  }
})();
</script>
</body>
</html>`;
}
