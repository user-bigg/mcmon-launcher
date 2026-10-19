import card from './card.json';

export const PAYLOAD =
  '<script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)>{{ 7*7 }}${7*7}%s%n';

export const HOSTILE_MARKDOWN = [
  `## ${PAYLOAD}`,
  '[клик](javascript:alert(1)) [данные](data:text/html,<script>alert(1)</script>) [файл](file:///C:/Windows/System32/calc.exe)',
  '[[вложенная](javascript:alert(1))](https://ok.example) ![<img src=x onerror=alert(1)>](https://evil.example/t.png)',
  '- <iframe src="javascript:alert(1)"></iframe>\n- `<script>alert(2)</script>`\n- [сайт](https://ok.example/путь)',
  '<a href="javascript:alert(1)">ссылка</a> <style>*{display:none}</style> \u0000 \u202Eexe.txt',
].join('\n\n');

export function hostileCard(): Record<string, unknown> {
  return {
    ...card,
    name: `Сервер ${PAYLOAD}`,
    description: PAYLOAD,
    description_md: HOSTILE_MARKDOWN,
    rules_md: PAYLOAD,
    tags: ['pvp', '<script>', 'javascript:alert(1)', 'a'.repeat(33)],
    wipe_label: PAYLOAD.slice(0, 80),
    icon_url: 'https://evil.example/icon.png',
    cover: { scene: '../../../etc', time: 'day' },
    links: {
      site: 'javascript:alert(1)',
      discord: 'data:text/html,<script>alert(1)</script>',
      telegram: 'http://t.me/evil',
      vk: 'file:///C:/Windows/System32/calc.exe',
      youtube: 'https://youtube.com/@ok',
      tiktok: 'https://www.tiktok.com/@ok',
      evil: 'https://evil.example',
    },
    site_url: 'javascript:alert(1)',
    launch: { kind: 'own_launcher', url: 'javascript:alert(1)', label: PAYLOAD.slice(0, 80) },
    top_slot: { tier: 'gold', advertiser: PAYLOAD, erid: PAYLOAD, url: 'javascript:alert(1)' },
  };
}
