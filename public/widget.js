/* Vela CRM — chat for your website.
   <script src="https://crm.your-company.ru/widget.js" data-key="KEY" async></script>
   Messages go to «Коммуникации» in the CRM, operator replies appear here. No cookies, no third parties. */
(function () {
  var script = document.currentScript || document.querySelector('script[data-key][src*="widget.js"]');
  if (!script || window.__velaChat) return;
  window.__velaChat = true;
  var key = script.getAttribute('data-key');
  var color = script.getAttribute('data-color') || '#0FA596';
  var base = new URL(script.src, location.href).origin + '/api/public/chat/' + encodeURIComponent(key);
  var store = 'vela-chat-' + key;
  var state = { visitor: '', name: '', seen: 0, last: 0, open: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem(store) || '{}')); } catch (e) { /* private mode */ }
  if (!/^[a-z0-9]{12,48}$/i.test(state.visitor)) {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    state.visitor = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function save() { try { localStorage.setItem(store, JSON.stringify({ visitor: state.visitor, name: state.name, seen: state.seen })); } catch (e) { /* ignore */ } }
  save();

  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.innerHTML =
    '<style>' +
    ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.btn{width:56px;height:56px;border-radius:50%;border:0;background:' + color + ';color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;position:relative}' +
    '.btn:focus-visible,.send:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}' +
    '.badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;line-height:20px;display:none}' +
    '.panel{position:absolute;right:0;bottom:72px;width:min(360px,calc(100vw - 40px));height:min(520px,calc(100vh - 120px));background:#fff;color:#0f172a;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}' +
    '.panel.open{display:flex}' +
    '.head{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:8px}' +
    '.head b{flex:1;font-size:15px}.head small{display:block;font-weight:400;opacity:.85;font-size:12px}' +
    '.x{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px}' +
    '.list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f8fafc}' +
    '.m{max-width:85%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
    '.in{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}' +
    '.out{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}' +
    '.who{display:block;font-size:11px;color:#64748b;margin-bottom:2px}' +
    '.hint{font-size:13px;color:#64748b;text-align:center;margin:auto 0}' +
    '.form{border-top:1px solid #e2e8f0;padding:10px;display:flex;flex-direction:column;gap:8px;background:#fff}' +
    '.row{display:flex;gap:8px;align-items:flex-end}' +
    'input,textarea{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:14px;color:#0f172a;background:#fff;resize:none}' +
    'input:focus,textarea:focus{outline:2px solid ' + color + ';border-color:transparent}' +
    '.send{flex-shrink:0;height:38px;padding:0 14px;border:0;border-radius:10px;background:' + color + ';color:#fff;font-weight:600;font-size:14px;cursor:pointer}' +
    '.send:disabled{opacity:.5;cursor:default}.err{color:#dc2626;font-size:12px;display:none}' +
    '</style>' +
    '<div class="panel" role="dialog" aria-label="Чат с компанией">' +
    '<div class="head"><b><span class="title">Напишите нам</span><small class="sub">Обычно отвечаем в течение нескольких минут</small></b><button class="x" type="button" aria-label="Закрыть чат">×</button></div>' +
    '<div class="list" aria-live="polite"><p class="hint greet">Здравствуйте! Напишите вопрос — ответим здесь же.</p></div>' +
    '<form class="form"><input class="name" type="text" maxlength="80" placeholder="Как к вам обращаться?" aria-label="Ваше имя">' +
    '<div class="row"><textarea class="text" rows="2" maxlength="2000" placeholder="Сообщение…" aria-label="Сообщение"></textarea><button class="send" type="submit">Отправить</button></div>' +
    '<span class="err" role="alert"></span></form></div>' +
    '<button class="btn" type="button" aria-label="Открыть чат"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="badge"></span></button>';

  var $ = function (s) { return root.querySelector(s); };
  var panel = $('.panel'), list = $('.list'), badge = $('.badge'), text = $('.text'), nameInput = $('.name'), send = $('.send'), err = $('.err');
  nameInput.value = state.name || '';
  if (state.name) nameInput.style.display = 'none';
  var messages = [];

  function render() {
    if (!messages.length) return;
    var greet = $('.greet');
    if (greet) greet.remove();
    list.querySelectorAll('.m').forEach(function (n) { n.remove(); });
    messages.forEach(function (m) {
      var div = document.createElement('div');
      div.className = 'm ' + (m.direction === 'in' ? 'in' : 'out');
      if (m.direction === 'out' && m.operator) { var w = document.createElement('span'); w.className = 'who'; w.textContent = m.operator; div.appendChild(w); }
      div.appendChild(document.createTextNode(String(m.text).replace(/\n\nСтраница: .*$/, '')));
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }
  function unread() {
    var n = messages.filter(function (m) { return m.direction === 'out' && m.id > state.seen; }).length;
    badge.textContent = n; badge.style.display = n && !state.open ? 'block' : 'none';
  }
  function markSeen() { if (messages.length) { state.seen = messages[messages.length - 1].id; save(); } unread(); }

  function poll() {
    fetch(base + '/messages?visitor=' + state.visitor + '&after=' + state.last).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.messages || !d.messages.length) return;
      messages = messages.concat(d.messages);
      state.last = messages[messages.length - 1].id;
      render();
      if (state.open) markSeen(); else unread();
    }).catch(function () { /* offline: try again later */ });
  }

  function toggle(v) {
    state.open = v;
    panel.classList.toggle('open', v);
    $('.btn').setAttribute('aria-label', v ? 'Свернуть чат' : 'Открыть чат');
    if (v) { markSeen(); setTimeout(function () { text.focus(); }, 50); }
  }
  $('.btn').addEventListener('click', function () { toggle(!state.open); });
  $('.x').addEventListener('click', function () { toggle(false); });
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape') toggle(false); });
  text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.form').requestSubmit ? $('.form').requestSubmit() : submit(e); } });
  $('.form').addEventListener('submit', submit);

  function submit(e) {
    e.preventDefault();
    var t = text.value.trim();
    if (!t) return;
    if (nameInput.value.trim()) { state.name = nameInput.value.trim(); save(); }
    send.disabled = true; err.style.display = 'none';
    fetch(base + '/messages', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ visitor: state.visitor, name: state.name, text: t, page: location.href }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Ошибка'); }); })
      .then(function () { text.value = ''; nameInput.style.display = 'none'; poll(); })
      .catch(function (x) { err.textContent = x.message || 'Не удалось отправить, попробуйте ещё раз'; err.style.display = 'block'; })
      .then(function () { send.disabled = false; });
  }

  fetch(base).then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
    if (!info) return;
    if (info.title) $('.title').textContent = info.company || info.title;
    if (info.greeting) { var g = $('.greet'); if (g) g.textContent = info.greeting; }
    (document.body || document.documentElement).appendChild(host);
    poll();
    // often while the chat is open, rarely in the background (for the unread badge)
    setInterval(function () { if (state.open) poll(); }, 4000);
    setInterval(function () { if (!state.open && !document.hidden) poll(); }, 30000);
  }).catch(function () { /* chat switched off */ });
})();
