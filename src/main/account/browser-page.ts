import { ru } from '@shared/i18n/ru';

export type BrowserPageState = 'ok' | 'fail';

// One self-contained page for the browser tab: the loopback answers under
// `default-src 'none'; style-src 'unsafe-inline'`, so no scripts, files or data: addresses.
const TEMPLATE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>{{title}} · MC Monitor</title>
<style>
*{box-sizing:border-box}
:root{color-scheme:dark;--bg:#0a0e13;--surface:#10161d;--line:#22303d;--text:#e7edf3;--muted:#8a9aab;--dim:#8292a3;--ok:#4ade80;--ok-soft:rgba(74,222,128,.12);--fail:#f87171;--fail-soft:rgba(248,113,113,.12);--brand:#4ade80}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","Noto Sans",Arial,sans-serif;display:grid;-webkit-text-size-adjust:100%}
.logo{display:block;image-rendering:pixelated}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;user-select:none}
.brand b{color:var(--brand);font-weight:700}
.mark{display:none;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.ok .mark-ok,.fail .mark-fail{display:block}
.ok .badge{color:var(--ok);background:var(--ok-soft)}
.fail .badge{color:var(--fail);background:var(--fail-soft)}
h1{margin:0;font-weight:700;letter-spacing:-.015em;text-wrap:balance}
p{margin:0;text-wrap:pretty}
.text{color:var(--muted);text-wrap:balance}
.hint{color:var(--dim);font-size:14px}
@media (prefers-reduced-motion:no-preference){.badge{animation:pop .32s cubic-bezier(.2,.8,.2,1) both}@keyframes pop{from{opacity:0;transform:scale(.8)}}}
body{place-items:center;padding:24px 16px}
main{width:min(420px,100%);display:grid;gap:20px;justify-items:center}
.logo{width:28px;height:28px;border-radius:5px}
.brand{font-size:18px}
.card{width:100%;display:grid;justify-items:center;gap:8px;padding:32px 24px 24px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:18px}
.badge{display:grid;place-items:center;width:64px;height:64px;margin-bottom:10px;border-radius:16px}
.mark{width:36px;height:36px}
h1{font-size:22px;line-height:1.25}
.hint{width:100%;margin-top:14px;padding-top:16px;border-top:1px solid var(--line)}
</style>
</head>
<body class="{{state}}">
<main>
<div class="brand"><svg class="logo" aria-hidden="true" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="0" y="0" width="16" height="1" fill="#7cc44a"/><rect x="0" y="1" width="1" height="1" fill="#62a43d"/><rect x="1" y="1" width="1" height="1" fill="#5d9e3a"/><rect x="2" y="1" width="2" height="1" fill="#62a43d"/><rect x="4" y="1" width="1" height="1" fill="#5d9e3a"/><rect x="5" y="1" width="1" height="1" fill="#62a43d"/><rect x="6" y="1" width="1" height="1" fill="#5d9e3a"/><rect x="7" y="1" width="2" height="1" fill="#c8ff8a"/><rect x="9" y="1" width="1" height="1" fill="#5d9e3a"/><rect x="10" y="1" width="2" height="1" fill="#62a43d"/><rect x="12" y="1" width="2" height="1" fill="#5d9e3a"/><rect x="14" y="1" width="1" height="1" fill="#62a43d"/><rect x="15" y="1" width="1" height="1" fill="#5d9e3a"/><rect x="0" y="2" width="1" height="1" fill="#62a43d"/><rect x="1" y="2" width="1" height="1" fill="#5d9e3a"/><rect x="2" y="2" width="2" height="1" fill="#62a43d"/><rect x="4" y="2" width="2" height="1" fill="#5d9e3a"/><rect x="6" y="2" width="1" height="1" fill="#62a43d"/><rect x="7" y="2" width="2" height="1" fill="#c8ff8a"/><rect x="9" y="2" width="1" height="1" fill="#62a43d"/><rect x="10" y="2" width="1" height="1" fill="#5d9e3a"/><rect x="11" y="2" width="2" height="1" fill="#62a43d"/><rect x="13" y="2" width="1" height="1" fill="#5d9e3a"/><rect x="14" y="2" width="1" height="1" fill="#62a43d"/><rect x="15" y="2" width="1" height="1" fill="#5d9e3a"/><rect x="0" y="3" width="2" height="1" fill="#5d9e3a"/><rect x="2" y="3" width="3" height="1" fill="#62a43d"/><rect x="5" y="3" width="1" height="1" fill="#5d9e3a"/><rect x="6" y="3" width="3" height="1" fill="#c8ff8a"/><rect x="9" y="3" width="1" height="1" fill="#5d9e3a"/><rect x="10" y="3" width="2" height="1" fill="#62a43d"/><rect x="12" y="3" width="1" height="1" fill="#5d9e3a"/><rect x="13" y="3" width="2" height="1" fill="#62a43d"/><rect x="15" y="3" width="1" height="1" fill="#5d9e3a"/><rect x="0" y="4" width="1" height="1" fill="#62a43d"/><rect x="1" y="4" width="1" height="1" fill="#5d9e3a"/><rect x="2" y="4" width="1" height="1" fill="#62a43d"/><rect x="3" y="4" width="2" height="1" fill="#c8ff8a"/><rect x="5" y="4" width="1" height="1" fill="#62a43d"/><rect x="6" y="4" width="1" height="1" fill="#c8ff8a"/><rect x="7" y="4" width="1" height="1" fill="#80603f"/><rect x="8" y="4" width="1" height="1" fill="#c8ff8a"/><rect x="9" y="4" width="1" height="1" fill="#62a43d"/><rect x="10" y="4" width="1" height="1" fill="#5d9e3a"/><rect x="11" y="4" width="1" height="1" fill="#62a43d"/><rect x="12" y="4" width="1" height="1" fill="#5d9e3a"/><rect x="13" y="4" width="2" height="1" fill="#c8ff8a"/><rect x="15" y="4" width="1" height="1" fill="#62a43d"/><rect x="0" y="5" width="7" height="1" fill="#c8ff8a"/><rect x="7" y="5" width="1" height="1" fill="#80603f"/><rect x="8" y="5" width="2" height="1" fill="#c8ff8a"/><rect x="10" y="5" width="1" height="1" fill="#62a43d"/><rect x="11" y="5" width="1" height="1" fill="#5d9e3a"/><rect x="12" y="5" width="4" height="1" fill="#c8ff8a"/><rect x="0" y="6" width="3" height="1" fill="#7a563b"/><rect x="3" y="6" width="2" height="1" fill="#80603f"/><rect x="5" y="6" width="1" height="1" fill="#7a563b"/><rect x="6" y="6" width="1" height="1" fill="#80603f"/><rect x="7" y="6" width="1" height="1" fill="#7a563b"/><rect x="8" y="6" width="1" height="1" fill="#80603f"/><rect x="9" y="6" width="1" height="1" fill="#c8ff8a"/><rect x="10" y="6" width="2" height="1" fill="#62a43d"/><rect x="12" y="6" width="1" height="1" fill="#c8ff8a"/><rect x="13" y="6" width="1" height="1" fill="#7a563b"/><rect x="14" y="6" width="1" height="1" fill="#80603f"/><rect x="15" y="6" width="1" height="1" fill="#7a563b"/><rect x="0" y="7" width="1" height="1" fill="#80603f"/><rect x="1" y="7" width="1" height="1" fill="#7a563b"/><rect x="2" y="7" width="1" height="1" fill="#664630"/><rect x="3" y="7" width="1" height="1" fill="#7a563b"/><rect x="4" y="7" width="4" height="1" fill="#80603f"/><rect x="8" y="7" width="1" height="1" fill="#7a563b"/><rect x="9" y="7" width="1" height="1" fill="#c8ff8a"/><rect x="10" y="7" width="2" height="1" fill="#62a43d"/><rect x="12" y="7" width="1" height="1" fill="#c8ff8a"/><rect x="13" y="7" width="1" height="1" fill="#664630"/><rect x="14" y="7" width="2" height="1" fill="#7a563b"/><rect x="0" y="8" width="1" height="1" fill="#80603f"/><rect x="1" y="8" width="4" height="1" fill="#7a563b"/><rect x="5" y="8" width="4" height="1" fill="#80603f"/><rect x="9" y="8" width="1" height="1" fill="#c8ff8a"/><rect x="10" y="8" width="1" height="1" fill="#62a43d"/><rect x="11" y="8" width="2" height="1" fill="#c8ff8a"/><rect x="13" y="8" width="1" height="1" fill="#80603f"/><rect x="14" y="8" width="1" height="1" fill="#7a563b"/><rect x="15" y="8" width="1" height="1" fill="#664630"/><rect x="0" y="9" width="1" height="1" fill="#7a563b"/><rect x="1" y="9" width="3" height="1" fill="#80603f"/><rect x="4" y="9" width="1" height="1" fill="#664630"/><rect x="5" y="9" width="1" height="1" fill="#80603f"/><rect x="6" y="9" width="1" height="1" fill="#7a563b"/><rect x="7" y="9" width="1" height="1" fill="#80603f"/><rect x="8" y="9" width="1" height="1" fill="#7a563b"/><rect x="9" y="9" width="3" height="1" fill="#c8ff8a"/><rect x="12" y="9" width="1" height="1" fill="#7a563b"/><rect x="13" y="9" width="1" height="1" fill="#80603f"/><rect x="14" y="9" width="1" height="1" fill="#664630"/><rect x="15" y="9" width="1" height="1" fill="#7a563b"/><rect x="0" y="10" width="1" height="1" fill="#664630"/><rect x="1" y="10" width="1" height="1" fill="#80603f"/><rect x="2" y="10" width="1" height="1" fill="#7a563b"/><rect x="3" y="10" width="1" height="1" fill="#80603f"/><rect x="4" y="10" width="2" height="1" fill="#7a563b"/><rect x="6" y="10" width="1" height="1" fill="#80603f"/><rect x="7" y="10" width="2" height="1" fill="#7a563b"/><rect x="9" y="10" width="1" height="1" fill="#80603f"/><rect x="10" y="10" width="2" height="1" fill="#c8ff8a"/><rect x="12" y="10" width="1" height="1" fill="#664630"/><rect x="13" y="10" width="1" height="1" fill="#80603f"/><rect x="14" y="10" width="2" height="1" fill="#7a563b"/><rect x="0" y="11" width="1" height="1" fill="#80603f"/><rect x="1" y="11" width="1" height="1" fill="#7a563b"/><rect x="2" y="11" width="1" height="1" fill="#80603f"/><rect x="3" y="11" width="1" height="1" fill="#7a563b"/><rect x="4" y="11" width="1" height="1" fill="#80603f"/><rect x="5" y="11" width="1" height="1" fill="#7a563b"/><rect x="6" y="11" width="3" height="1" fill="#80603f"/><rect x="9" y="11" width="1" height="1" fill="#7a563b"/><rect x="10" y="11" width="2" height="1" fill="#c8ff8a"/><rect x="12" y="11" width="1" height="1" fill="#80603f"/><rect x="13" y="11" width="3" height="1" fill="#7a563b"/><rect x="0" y="12" width="2" height="1" fill="#80603f"/><rect x="2" y="12" width="1" height="1" fill="#7a563b"/><rect x="3" y="12" width="1" height="1" fill="#80603f"/><rect x="4" y="12" width="1" height="1" fill="#7a563b"/><rect x="5" y="12" width="2" height="1" fill="#80603f"/><rect x="7" y="12" width="1" height="1" fill="#7a563b"/><rect x="8" y="12" width="1" height="1" fill="#664630"/><rect x="9" y="12" width="1" height="1" fill="#80603f"/><rect x="10" y="12" width="2" height="1" fill="#c8ff8a"/><rect x="12" y="12" width="3" height="1" fill="#80603f"/><rect x="15" y="12" width="1" height="1" fill="#7a563b"/><rect x="0" y="13" width="6" height="1" fill="#7a563b"/><rect x="6" y="13" width="1" height="1" fill="#80603f"/><rect x="7" y="13" width="1" height="1" fill="#7a563b"/><rect x="8" y="13" width="1" height="1" fill="#80603f"/><rect x="9" y="13" width="1" height="1" fill="#7a563b"/><rect x="10" y="13" width="2" height="1" fill="#80603f"/><rect x="12" y="13" width="2" height="1" fill="#7a563b"/><rect x="14" y="13" width="1" height="1" fill="#80603f"/><rect x="15" y="13" width="1" height="1" fill="#664630"/><rect x="0" y="14" width="2" height="1" fill="#80603f"/><rect x="2" y="14" width="1" height="1" fill="#7a563b"/><rect x="3" y="14" width="4" height="1" fill="#80603f"/><rect x="7" y="14" width="2" height="1" fill="#7a563b"/><rect x="9" y="14" width="1" height="1" fill="#80603f"/><rect x="10" y="14" width="1" height="1" fill="#7a563b"/><rect x="11" y="14" width="1" height="1" fill="#664630"/><rect x="12" y="14" width="1" height="1" fill="#80603f"/><rect x="13" y="14" width="2" height="1" fill="#7a563b"/><rect x="15" y="14" width="1" height="1" fill="#80603f"/><rect x="0" y="15" width="1" height="1" fill="#7a563b"/><rect x="1" y="15" width="1" height="1" fill="#664630"/><rect x="2" y="15" width="2" height="1" fill="#7a563b"/><rect x="4" y="15" width="2" height="1" fill="#80603f"/><rect x="6" y="15" width="2" height="1" fill="#7a563b"/><rect x="8" y="15" width="1" height="1" fill="#80603f"/><rect x="9" y="15" width="1" height="1" fill="#7a563b"/><rect x="10" y="15" width="2" height="1" fill="#80603f"/><rect x="12" y="15" width="1" height="1" fill="#7a563b"/><rect x="13" y="15" width="1" height="1" fill="#80603f"/><rect x="14" y="15" width="1" height="1" fill="#7a563b"/><rect x="15" y="15" width="1" height="1" fill="#80603f"/></svg>
<span>MC <b>Monitor</b></span></div>
<section class="card" role="status">
<div class="badge"><svg class="mark mark-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><svg class="mark mark-fail" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></div>
<h1>{{title}}</h1>
<p class="text">{{text}}</p>
<p class="hint">{{hint}}</p>
</section>
</main>
</body>
</html>`;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function browserPage(state: BrowserPageState, title: string, text: string): string {
  return TEMPLATE.replaceAll('{{state}}', state)
    .replaceAll('{{title}}', () => escapeHtml(title))
    .replaceAll('{{text}}', () => escapeHtml(text).replaceAll('\n', '<br>'))
    .replaceAll('{{hint}}', () => escapeHtml(ru.account.callback.hint));
}
