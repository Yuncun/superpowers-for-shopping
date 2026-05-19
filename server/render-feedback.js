// server/render-feedback.js
// Pure function: returns a self-contained HTML/CSS/JS page string for the
// /cart-feedback flow. One-page form: list pending purchases as a checklist
// (Kept / Returned / Skip + optional notes), with a single Save button.
// No I/O, no imports from other server modules.

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
<title>Cart feedback</title>
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
  max-width:760px;
  margin:0 auto;
  width:100%;
}

.intro{
  font-size:14px;
  color:#555;
  margin-bottom:20px;
  line-height:1.5;
}

.purchase{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:12px;
  padding:18px 20px;
  margin-bottom:14px;
  transition:opacity .2s;
}

.purchase.saved{opacity:.5}

.purchase-head{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  gap:12px;
  margin-bottom:14px;
  flex-wrap:wrap;
}

.purchase-meta{
  flex:1;
  min-width:0;
}

.purchase-brand{
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.06em;
  color:#888;
  margin-bottom:4px;
}

.purchase-title{
  font-size:15px;
  font-weight:500;
  line-height:1.35;
  word-break:break-word;
}

.purchase-price{
  font-size:14px;
  color:#1a1a1a;
  font-weight:600;
  white-space:nowrap;
}

.purchase-date{
  font-size:12px;
  color:#aaa;
  font-weight:400;
  margin-left:6px;
}

.choices{
  display:flex;
  gap:8px;
  margin-bottom:10px;
  flex-wrap:wrap;
}

.choice{
  flex:1;
  min-width:90px;
  position:relative;
}

.choice input{
  position:absolute;
  opacity:0;
  pointer-events:none;
}

.choice label{
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
}

.choice label:hover{background:#f0f0f0;border-color:#ccc}

.choice input:checked + label{
  background:#1a1a1a;
  border-color:#1a1a1a;
  color:#fff;
}

.choice input:focus-visible + label{
  outline:2px solid #1a1a1a;
  outline-offset:2px;
}

.notes{
  width:100%;
  font:inherit;
  font-size:13px;
  padding:9px 11px;
  border:1px solid #e8e8e8;
  border-radius:8px;
  background:#fff;
  color:#1a1a1a;
  transition:border-color .12s;
}

.notes:focus{outline:none;border-color:#888}
.notes::placeholder{color:#bbb}

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
<header><h1>Cart — purchase feedback</h1></header>
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

  function fmtPrice(p) {
    if (p == null || p === '') return '';
    var s = String(p);
    return /^[$€£¥]/.test(s) ? escHtml(s) : '$' + escHtml(s);
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
      renderForm(state.pending || []);
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
      var parts = [];
      if (state.kept != null) parts.push(state.kept + ' kept');
      if (state.returned != null) parts.push(state.returned + ' returned');
      if (state.skipped != null && state.skipped > 0) parts.push(state.skipped + ' skipped');
      if (state.errors != null && state.errors > 0) parts.push(state.errors + ' failed');
      var summary = parts.join(' · ');
      showMsg(state.message || 'Saved.', summary);
      return;
    }

    showMsg('Unknown stage: ' + escHtml(stage));
  }

  function renderForm(pending) {
    if (pending.length === 0) {
      showMsg('No pending purchases to review.');
      return;
    }

    var wrap = document.createElement('div');

    var intro = document.createElement('p');
    intro.className = 'intro';
    intro.textContent = 'Tell me what stuck. Default is Skip — only the ones you mark Kept or Returned get recorded.';
    wrap.appendChild(intro);

    var nameCounter = 0;
    pending.forEach(function(p) {
      nameCounter++;
      var groupName = 'kept-' + nameCounter;

      var card = document.createElement('div');
      card.className = 'purchase';
      card.dataset.key = JSON.stringify({ date: p.date, item: p.item, brand: p.brand });

      var head = document.createElement('div');
      head.className = 'purchase-head';

      var meta = document.createElement('div');
      meta.className = 'purchase-meta';
      meta.innerHTML =
        '<div class="purchase-brand">' + escHtml(p.brand || '') + '</div>' +
        '<div class="purchase-title">' + escHtml(p.item || '') +
          '<span class="purchase-date">' + escHtml(p.date || '') + '</span>' +
        '</div>';

      var price = document.createElement('div');
      price.className = 'purchase-price';
      price.textContent = fmtPrice(p['$']);

      head.appendChild(meta);
      head.appendChild(price);

      var choices = document.createElement('div');
      choices.className = 'choices';
      ['skip', 'yes', 'no'].forEach(function(value) {
        var labelText = value === 'yes' ? 'Kept' : value === 'no' ? 'Returned' : 'Skip';
        var choice = document.createElement('div');
        choice.className = 'choice';

        var input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = value;
        input.id = groupName + '-' + value;
        if (value === 'skip') input.checked = true;

        var label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = labelText;

        choice.appendChild(input);
        choice.appendChild(label);
        choices.appendChild(choice);
      });

      var notes = document.createElement('input');
      notes.type = 'text';
      notes.className = 'notes';
      notes.placeholder = 'Notes (optional) — e.g. "wrong size", "love the fit"';
      notes.dataset.notes = '1';
      notes.maxLength = 200;

      card.appendChild(head);
      card.appendChild(choices);
      card.appendChild(notes);
      wrap.appendChild(card);
    });

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
    submitBtn.textContent = 'Save feedback';
    submitBtn.addEventListener('click', function() {
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      submitBtn.textContent = 'Saving…';

      var items = [];
      var cards = wrap.querySelectorAll('.purchase');
      cards.forEach(function(card) {
        var key;
        try { key = JSON.parse(card.dataset.key); } catch (e) { return; }
        var checked = card.querySelector('input[type="radio"]:checked');
        var decision = checked ? checked.value : 'skip';
        var notesEl = card.querySelector('input[data-notes]');
        var notesVal = notesEl ? notesEl.value.trim() : '';
        items.push({
          date: key.date,
          item: key.item,
          brand: key.brand,
          decision: decision,
          notes: notesVal,
        });
      });

      sendAction({ type: 'submit', items: items });
    });

    bar.appendChild(cancelBtn);
    bar.appendChild(submitBtn);
    wrap.appendChild(bar);

    root.innerHTML = '';
    root.appendChild(wrap);
  }
})();
</script>
</body>
</html>`;
}
