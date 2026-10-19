import { ru } from '@shared/i18n/ru';
import logo from '../../renderer/src/assets/logo.svg?raw';
import tokens from '../../renderer/src/styles/tokens.css?raw';
import { RECOVERY_ACTION_PREFIX, type RecoveryView } from './recovery';

// The page must not depend on anything the failed renderer was loading: one document, styles
// inline, no scripts. The buttons are links the main process intercepts in will-navigate.
// The block hangs from the top instead of being centred, so the mark stays in one place when
// a line is added or removed between two failures.
const STYLE = `
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:grid;grid-template-rows:auto 1fr;font-size:14px;line-height:1.5;color-scheme:dark;user-select:none;cursor:default}
.bar{display:flex;align-items:center;justify-content:space-between;height:40px;padding-left:14px;border-bottom:1px solid var(--mc-border);-webkit-app-region:drag}
.brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.brand svg{width:18px;height:18px;border-radius:3px}
.close{display:grid;place-items:center;width:46px;height:40px;color:var(--mc-text-muted);-webkit-app-region:no-drag;cursor:default}
.close:hover{background:var(--mc-danger);color:var(--mc-bg)}
.close svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.2}
main{align-self:start;justify-self:center;width:min(440px,100%);padding:clamp(40px,22vh,220px) 24px 24px;text-align:center}
.mark svg{width:56px;height:56px;border-radius:10px}
h1{margin:20px 0 8px;font-size:22px;line-height:1.25;letter-spacing:-.015em;text-wrap:balance}
p{margin:0;color:var(--mc-text-muted);text-wrap:balance}
.note+.note{margin-top:8px}
.restart{display:inline-block;margin-top:24px;padding:10px 22px;border-radius:var(--mc-radius-sm);background:var(--mc-accent);color:var(--mc-bg);font-weight:600;text-decoration:none;cursor:default}
.restart:hover{background:var(--mc-accent-strong)}
a:focus-visible{outline:2px solid var(--mc-text);outline-offset:2px}
.close:focus-visible{outline-offset:-2px}
`;

const CLOSE_ICON =
  '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function paragraph(className: string, text: string | null): string {
  return text === null ? '' : `<p class="${className}">${escapeHtml(text)}</p>`;
}

function decorative(svg: string): string {
  return svg.replace(/<title>[^<]*<\/title>/, '').replace('<svg ', '<svg aria-hidden="true" ');
}

export function recoveryPage(view: RecoveryView): string {
  const mark = decorative(logo);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(ru.app.title)}</title>
<style>${tokens}${STYLE}</style>
</head>
<body>
<header class="bar">
<div class="brand">${mark}<span>${escapeHtml(ru.app.name)}</span></div>
<a class="close" href="${RECOVERY_ACTION_PREFIX}close" aria-label="${escapeHtml(ru.window.close)}" title="${escapeHtml(ru.window.close)}" draggable="false">${CLOSE_ICON}</a>
</header>
<main>
<div class="mark">${mark}</div>
<h1>${escapeHtml(ru.recovery.title[view.kind])}</h1>
${paragraph('note', ru.recovery.text)}
${paragraph('note', view.playing ? ru.recovery.game : null)}
${paragraph('note', view.reported ? ru.recovery.reported : null)}
<a class="restart" href="${RECOVERY_ACTION_PREFIX}restart" draggable="false">${escapeHtml(ru.recovery.restart)}</a>
</main>
</body>
</html>`;
}

export function recoveryPageUrl(view: RecoveryView): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(recoveryPage(view))}`;
}
