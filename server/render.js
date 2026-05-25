// server/render.js
// Pure function: returns a self-contained HTML/CSS/JS page for one /cart session.
// No I/O, no imports from other server modules.
//
// State the page accepts:
//   { stage: 'searching', query, retailers: [{host, status, count?}] }
//   { stage: 'empty',     query }
//   { stage: 'done',      query, picks, carts }
//   { stage: 'review_opened', carts }
//
// Actions the page sends:
//   { type: 'review' }
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
<title>Cart</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  background:#fafafa;
  color:#1a1a1a;
  min-height:100vh;
  display:flex;
  flex-direction:column;
  -webkit-font-smoothing:antialiased;
}

header{
  padding:18px 32px;
  border-bottom:1px solid #e8e8e8;
  background:#fff;
  display:flex;
  align-items:baseline;
  gap:12px;
}

header .label{
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:#888;
}

header .query{
  font-size:14px;
  color:#1a1a1a;
  font-weight:500;
}

main#root{
  flex:1;
  padding:32px;
  max-width:1100px;
  margin:0 auto;
  width:100%;
}

/* ---------- searching stage ---------- */

.searching{
  display:flex;
  flex-direction:column;
  gap:24px;
}

.search-status{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px 24px;
}

@media(max-width:700px){.search-status{grid-template-columns:1fr}}

.search-row{
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px 14px;
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:10px;
  font-size:13px;
  font-variant-numeric:tabular-nums;
}

.search-row .dot{
  width:8px;
  height:8px;
  border-radius:50%;
  flex-shrink:0;
}

.search-row.pending .dot{background:#e8e8e8;animation:pulse 1.2s ease-in-out infinite}
.search-row.done    .dot{background:#52a052}
.search-row.error   .dot{background:#c87070}

.search-row .host{flex:1;font-weight:500;color:#1a1a1a}
.search-row .count{color:#888;font-size:12px}

@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}

.skeleton-grid{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:16px;
}

@media(max-width:900px){.skeleton-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){.skeleton-grid{grid-template-columns:repeat(2,1fr)}}

.skeleton-card{
  aspect-ratio:3/4;
  background:#eee;
  border-radius:12px;
  position:relative;
  overflow:hidden;
}

.skeleton-card::after{
  content:'';
  position:absolute;
  inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);
  animation:shimmer 1.6s linear infinite;
}

@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}

/* ---------- done stage ---------- */

.done-header{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  margin-bottom:24px;
  gap:16px;
  flex-wrap:wrap;
}

.done-header h2{
  font-size:22px;
  font-weight:500;
  letter-spacing:-.015em;
}

.done-header .sub{
  font-size:13px;
  color:#888;
}

.picks-grid{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:16px;
  margin-bottom:32px;
}

@media(max-width:1000px){.picks-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.picks-grid{grid-template-columns:repeat(2,1fr)}}

.pick{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:12px;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  transition:transform .15s,box-shadow .15s;
}

.pick:hover{
  transform:translateY(-1px);
  box-shadow:0 6px 16px -8px rgba(0,0,0,.12);
}

.pick a.thumb{
  display:block;
  aspect-ratio:1/1;
  background:#f0f0f0;
  overflow:hidden;
}

.pick img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
  transition:transform .4s;
}

.pick:hover img{transform:scale(1.03)}

.pick-body{padding:12px 14px 14px;flex:1;display:flex;flex-direction:column;gap:4px}

.pick-brand{
  font-size:10px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:#888;
}

.pick-title{
  font-size:13px;
  line-height:1.35;
  color:#1a1a1a;
  font-weight:500;
  flex:1;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
}

.pick-price{
  font-size:13px;
  color:#1a1a1a;
  font-weight:600;
  font-variant-numeric:tabular-nums;
}

.review-bar{
  display:flex;
  justify-content:center;
  padding:8px 0 16px;
}

.btn-review{
  border:none;
  background:#1a1a1a;
  color:#fff;
  font:inherit;
  font-size:15px;
  font-weight:500;
  padding:14px 32px;
  border-radius:999px;
  cursor:pointer;
  transition:transform .12s,background .12s;
  letter-spacing:-.005em;
}

.btn-review:hover{background:#000;transform:translateY(-1px)}
.btn-review:active{transform:translateY(0)}
.btn-review:disabled{background:#888;cursor:default;transform:none}

.btn-review .arrow{
  display:inline-block;
  margin-left:8px;
  transition:transform .15s;
}

.btn-review:hover .arrow{transform:translateX(4px)}

.cart-summary{
  text-align:center;
  font-size:12px;
  color:#888;
  margin-top:14px;
}

/* ---------- empty stage ---------- */

.empty{
  text-align:center;
  padding:60px 20px;
  color:#666;
}

.empty h2{
  font-size:18px;
  font-weight:500;
  margin-bottom:8px;
  color:#1a1a1a;
}

.empty p{font-size:14px;color:#888}

/* ---------- review_opened stage ---------- */

.review-opened{
  text-align:center;
  padding:60px 20px;
  color:#1a1a1a;
}

.review-opened h2{
  font-size:18px;
  font-weight:500;
  margin-bottom:6px;
}

.review-opened p{font-size:13px;color:#888}

/* ---------- common ---------- */

.center-msg{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:50vh;gap:14px;color:#555;font-size:14px;text-align:center;
}

.spinner{
  width:28px;height:28px;border:2px solid #e0e0e0;border-top-color:#1a1a1a;
  border-radius:50%;animation:spin .7s linear infinite;
}

@keyframes spin{to{transform:rotate(360deg)}}

#root>*{animation:fadein .18s ease}
@keyframes fadein{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<header>
  <span class="label">Cart</span>
  <span class="query" id="query-display"></span>
</header>
<main id="root">
  <div class="center-msg"><div class="spinner"></div><p>Loading…</p></div>
</main>
<script>
window.__SESSION__ = ${sessionJson};

(function() {
  var SESSION = window.__SESSION__;
  var id = SESSION.id;
  var token = SESSION.token;
  var baseUrl = SESSION.baseUrl;

  var root = document.getElementById('root');
  var queryDisplay = document.getElementById('query-display');
  var state = null;

  var es = new EventSource(baseUrl + '/r/' + id + '/events?token=' + token);

  es.addEventListener('state', function(e) {
    state = JSON.parse(e.data);
    render();
  });

  es.addEventListener('closed', function() {
    es.close();
    if (state && state.stage === 'review_opened') return;
    root.innerHTML = '<div class="center-msg"><p>Session closed.</p></div>';
  });

  es.onerror = function() { es.close(); };

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
      fetch(url, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }).catch(function() {});
    }
  });

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtPrice(p) {
    if (p == null || p === '') return '';
    var s = String(p);
    return /^[\\$€£¥]/.test(s) ? escHtml(s) : '$' + escHtml(s);
  }

  function shortHost(h) {
    return String(h || '').replace(/^www\\./, '').replace(/\\.com$/, '');
  }

  function render() {
    if (!state) return;
    if (state.query && queryDisplay.textContent !== state.query) {
      queryDisplay.textContent = state.query;
    }
    if (state.stage === 'searching') return renderSearching();
    if (state.stage === 'done')      return renderDone();
    if (state.stage === 'empty')     return renderEmpty();
    if (state.stage === 'review_opened') return renderReviewOpened();
  }

  function renderSearching() {
    var rows = (state.retailers || []).map(function(r) {
      var label = r.status === 'pending' ? 'Searching…'
        : r.status === 'done' ? (r.count + ' result' + (r.count === 1 ? '' : 's'))
        : 'Skipped';
      return ''
        + '<div class="search-row ' + r.status + '">'
          + '<span class="dot"></span>'
          + '<span class="host">' + escHtml(shortHost(r.host)) + '</span>'
          + '<span class="count">' + escHtml(label) + '</span>'
        + '</div>';
    }).join('');

    var skeletons = '';
    for (var i = 0; i < 5; i++) skeletons += '<div class="skeleton-card"></div>';

    root.innerHTML = ''
      + '<div class="searching">'
        + '<div class="search-status">' + rows + '</div>'
        + '<div class="skeleton-grid">' + skeletons + '</div>'
      + '</div>';
  }

  function renderDone() {
    var picks = state.picks || [];
    var carts = state.carts || [];
    var cartCount = carts.length;
    var picksCount = picks.length;

    var cards = picks.map(function(p) {
      return ''
        + '<article class="pick">'
          + '<a class="thumb" href="' + escHtml(p.url || '#') + '" target="_blank" rel="noopener">'
            + (p.image ? '<img loading="lazy" src="' + escHtml(p.image) + '" alt="">' : '')
          + '</a>'
          + '<div class="pick-body">'
            + '<div class="pick-brand">' + escHtml(shortHost(p.host)) + '</div>'
            + '<div class="pick-title">' + escHtml(p.title || '') + '</div>'
            + '<div class="pick-price">' + fmtPrice(p.price) + '</div>'
          + '</div>'
        + '</article>';
    }).join('');

    var label = picksCount + ' picks queued';
    var cartLabel = cartCount === 1
      ? 'one cart waiting at ' + shortHost(carts[0].host)
      : (cartCount + ' carts across ' + carts.map(function(c) { return shortHost(c.host); }).join(', '));

    root.innerHTML = ''
      + '<div class="done-header">'
        + '<h2>' + escHtml(label) + '</h2>'
        + '<span class="sub">' + escHtml(cartLabel) + '</span>'
      + '</div>'
      + '<div class="picks-grid">' + cards + '</div>'
      + '<div class="review-bar">'
        + '<button type="button" class="btn-review" id="btn-review">'
          + 'Review ' + (cartCount === 1 ? 'cart' : 'your ' + cartCount + ' carts')
          + '<span class="arrow">→</span>'
        + '</button>'
      + '</div>'
      + '<p class="cart-summary">'
        + 'Clicking opens ' + (cartCount === 1 ? 'a tab' : cartCount + ' tabs')
        + ' — each cart at the retailer\\'s site.'
      + '</p>';

    document.getElementById('btn-review').addEventListener('click', function(e) {
      e.currentTarget.disabled = true;
      e.currentTarget.innerHTML = 'Opening…';
      sendAction({ type: 'review' });
    });
  }

  function renderEmpty() {
    root.innerHTML = ''
      + '<div class="empty">'
        + '<h2>Nothing matched.</h2>'
        + '<p>Try a different query, or add more retailers via <code>/cart-profile</code>.</p>'
      + '</div>';
  }

  function renderReviewOpened() {
    var carts = state.carts || [];
    var line = carts.length === 1
      ? 'Opened ' + shortHost(carts[0].host) + ' in a new tab.'
      : 'Opened ' + carts.length + ' tabs.';
    root.innerHTML = ''
      + '<div class="review-opened">'
        + '<h2>Carts opened.</h2>'
        + '<p>' + escHtml(line) + ' Check the cart for any items you want to keep.</p>'
      + '</div>';
  }
})();
</script>
</body>
</html>`;
}
