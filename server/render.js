// server/render.js
// Pure function: returns a self-contained HTML/CSS/JS page string for a session.
// No I/O, no imports from other server modules.

/**
 * Escape a value for safe embedding inside a <script> tag.
 * JSON.stringify is XSS-safe for strings, but `<` in values can still close
 * a <script> context (e.g. baseUrl = '</script><script>alert(1)').
 * Replacing < with its unicode escape < neutralizes this.
 */
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
<title>Superpowers for Shopping</title>
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
  max-width:1200px;
  margin:0 auto;
  width:100%;
}

/* thumbs stage */
.grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:20px;
}

@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:500px){.grid{grid-template-columns:1fr}}

.card{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:12px;
  overflow:hidden;
  transition:opacity .2s,transform .15s;
  cursor:default;
}

.card.voted{opacity:.45;pointer-events:none}

.card img{
  width:100%;
  aspect-ratio:1/1;
  object-fit:cover;
  display:block;
  background:#f0f0f0;
}

.card-body{
  padding:14px;
}

.card-brand{
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.06em;
  color:#888;
  margin-bottom:4px;
}

.card-title{
  font-size:14px;
  font-weight:500;
  line-height:1.35;
  margin-bottom:6px;
}

.card-price{
  font-size:14px;
  color:#1a1a1a;
  font-weight:600;
}

.card-actions{
  display:flex;
  gap:8px;
  padding:10px 14px 14px;
}

.btn-thumb{
  flex:1;
  border:1px solid #e8e8e8;
  background:#fafafa;
  border-radius:8px;
  padding:8px;
  font-size:18px;
  cursor:pointer;
  transition:background .12s,border-color .12s;
  display:flex;
  align-items:center;
  justify-content:center;
}

.btn-thumb:hover{background:#f0f0f0;border-color:#ccc}
.btn-thumb.active{background:#1a1a1a;border-color:#1a1a1a}

.thumbs-footer{
  margin-top:28px;
  display:flex;
  justify-content:center;
}

.btn-primary{
  background:#1a1a1a;
  color:#fff;
  border:none;
  border-radius:10px;
  padding:14px 32px;
  font-size:15px;
  font-weight:500;
  cursor:pointer;
  letter-spacing:-.01em;
  transition:background .12s;
}

.btn-primary:hover{background:#333}
.btn-primary:disabled{background:#ccc;cursor:not-allowed}

/* final stage */
.final-wrap{
  display:flex;
  justify-content:center;
  align-items:flex-start;
  padding-top:16px;
}

.final-card{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:16px;
  overflow:hidden;
  max-width:440px;
  width:100%;
}

.final-card img{
  width:100%;
  aspect-ratio:4/3;
  object-fit:cover;
  display:block;
  background:#f0f0f0;
}

.final-body{
  padding:24px;
}

.final-brand{
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.06em;
  color:#888;
  margin-bottom:6px;
}

.final-title{
  font-size:20px;
  font-weight:600;
  line-height:1.3;
  margin-bottom:8px;
}

.final-price{
  font-size:18px;
  font-weight:700;
  margin-bottom:24px;
}

.final-actions{
  display:flex;
  flex-direction:column;
  gap:12px;
}

.btn-secondary{
  background:none;
  border:1px solid #e8e8e8;
  border-radius:10px;
  padding:12px 24px;
  font-size:14px;
  color:#555;
  cursor:pointer;
  transition:border-color .12s;
  text-align:center;
}

.btn-secondary:hover{border-color:#aaa;color:#1a1a1a}

.btn-cancel{
  background:none;
  border:none;
  color:#aaa;
  font-size:13px;
  cursor:pointer;
  text-align:center;
  padding:4px;
  transition:color .12s;
}

.btn-cancel:hover{color:#555}

/* loading / redirect / done */
.center-msg{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  min-height:40vh;
  gap:16px;
  color:#888;
  font-size:15px;
}

.spinner{
  width:28px;height:28px;
  border:2px solid #e0e0e0;
  border-top-color:#888;
  border-radius:50%;
  animation:spin .7s linear infinite;
}

@keyframes spin{to{transform:rotate(360deg)}}

/* transitions */
#root>*{animation:fadein .2s ease}
@keyframes fadein{from{opacity:0}to{opacity:1}}
</style>
</head>
<body>
<header><h1>Superpowers for Shopping</h1></header>
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
    showMsg('Connection lost. Refresh to reconnect.');
  };

  function sendAction(action) {
    fetch(baseUrl + '/r/' + id + '/action?token=' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    }).catch(function() {});
  }

  // Best-effort beacon on tab close.
  window.addEventListener('beforeunload', function() {
    var url = baseUrl + '/r/' + id + '/action?token=' + token;
    var body = JSON.stringify({ type: 'dismissed' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: body }).catch(function() {});
    }
  });

  function showMsg(msg) {
    root.innerHTML = '<div class="center-msg"><p>' + escHtml(msg) + '</p></div>';
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

  // ---- render(state) ----

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

    if (stage === 'thumbs') {
      renderThumbs(state.candidates || []);
      return;
    }

    if (stage === 'final') {
      renderFinal(state.product, state.alternativesCount || 0);
      return;
    }

    if (stage === 'redirect') {
      root.innerHTML =
        '<div class="center-msg">' +
          '<div class="spinner"></div>' +
          '<p>Sending you to the retailer…</p>' +
        '</div>';
      window.location.href = state.url;
      return;
    }

    if (stage === 'login_required') {
      var host = escHtml(state.host || '');
      var loginMsg = escHtml(state.message || '');
      root.innerHTML =
        '<div class="final-wrap">' +
          '<div class="final-card login-card">' +
            '<div class="final-body">' +
              '<div class="final-brand">Almost there</div>' +
              '<div class="final-title">Log in to ' + host + '</div>' +
              '<p class="login-msg">' + loginMsg + '. We\\'ve opened the page in another tab — log in, then click below.</p>' +
              '<button class="btn-primary" id="btn-login-complete">I\\'m logged in, retry</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.getElementById('btn-login-complete').addEventListener('click', function() {
        sendAction({ type: 'login_complete' });
      });
      return;
    }

    if (stage === 'done') {
      showMsg(state.message || 'Done.');
      return;
    }

    showMsg('Unknown stage: ' + escHtml(stage));
  }

  // ---- thumbs stage ----

  function renderThumbs(candidates) {
    var anyVoted = false;

    function buildGrid() {
      var grid = document.createElement('div');
      grid.className = 'grid';

      candidates.forEach(function(c, idx) {
        var card = document.createElement('div');
        card.className = 'card';

        var img = document.createElement('img');
        img.src = c.image || '';
        img.alt = escHtml(c.title || '');
        img.loading = 'lazy';

        var body = document.createElement('div');
        body.className = 'card-body';
        body.innerHTML =
          '<div class="card-brand">' + escHtml(c.brand || '') + '</div>' +
          '<div class="card-title">' + escHtml(c.title || '') + '</div>' +
          '<div class="card-price">' + fmtPrice(c.price) + '</div>';

        var actions = document.createElement('div');
        actions.className = 'card-actions';

        var btnUp = document.createElement('button');
        btnUp.className = 'btn-thumb';
        btnUp.title = 'Thumbs up';
        btnUp.textContent = '👍';

        var btnDown = document.createElement('button');
        btnDown.className = 'btn-thumb';
        btnDown.title = 'Thumbs down';
        btnDown.textContent = '👎';

        function vote(direction) {
          card.classList.add('voted');
          var activeBtn = direction === 'up' ? btnUp : btnDown;
          activeBtn.classList.add('active');
          anyVoted = true;
          showFooter();
          sendAction({ type: 'thumb', index: idx, direction: direction });
        }

        btnUp.addEventListener('click', function() { vote('up'); });
        btnDown.addEventListener('click', function() { vote('down'); });

        actions.appendChild(btnUp);
        actions.appendChild(btnDown);

        card.appendChild(img);
        card.appendChild(body);
        card.appendChild(actions);
        grid.appendChild(card);
      });

      return grid;
    }

    var footer = document.createElement('div');
    footer.className = 'thumbs-footer';

    var btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.disabled = true;
    btn.textContent = 'Show me the best one';
    btn.addEventListener('click', function() {
      sendAction({ type: 'thumbs_complete' });
      btn.disabled = true;
      btn.textContent = 'Finding your match…';
    });
    footer.appendChild(btn);

    function showFooter() {
      if (anyVoted) btn.disabled = false;
    }

    var wrap = document.createElement('div');
    wrap.appendChild(buildGrid());
    wrap.appendChild(footer);

    root.innerHTML = '';
    root.appendChild(wrap);
  }

  // ---- final stage ----

  function renderFinal(product, alternativesCount) {
    product = product || {};

    root.innerHTML =
      '<div class="final-wrap">' +
        '<div class="final-card">' +
          '<img src="' + escHtml(product.image || '') + '" alt="' + escHtml(product.title || '') + '" loading="lazy">' +
          '<div class="final-body">' +
            '<div class="final-brand">' + escHtml(product.brand || '') + '</div>' +
            '<div class="final-title">' + escHtml(product.title || '') + '</div>' +
            '<div class="final-price">' + fmtPrice(product.price) + '</div>' +
            '<div class="final-actions">' +
              '<button class="btn-primary" id="btn-accept">Looks good — send to cart</button>' +
              (alternativesCount > 0
                ? '<button class="btn-secondary" id="btn-alt">See ' + alternativesCount + ' alternative' + (alternativesCount === 1 ? '' : 's') + '</button>'
                : '') +
              '<button class="btn-cancel" id="btn-cancel">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-accept').addEventListener('click', function() {
      sendAction({ type: 'final_accept' });
    });

    var altBtn = document.getElementById('btn-alt');
    if (altBtn) {
      altBtn.addEventListener('click', function() {
        sendAction({ type: 'see_alternatives' });
      });
    }

    document.getElementById('btn-cancel').addEventListener('click', function() {
      sendAction({ type: 'final_cancel' });
    });
  }
})();
</script>
</body>
</html>`;
}
