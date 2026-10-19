import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, 'src');

const ELEMENT = 1;
const INTERPOLATION = 5;
const ATTRIBUTE = 6;

interface AstNode {
  type: number;
  tag?: string;
  props?: { type: number; name: string; value?: { content: string } }[];
  children?: AstNode[];
  content?: { content?: string };
}

interface Found {
  node: AstNode;
  selectable: boolean;
}

const CONTENT: Record<string, string[]> = {
  'components/ContinueHero.vue': ['server.name', 'status.address'],
  'components/TopServerHero.vue': ['server.name'],
  'components/TopSlotRow.vue': ['server.name'],
  'components/ServerCard.vue': ['server.name'],
  'components/ServerRowItem.vue': ['server.name'],
  'components/DeepLinkPrompt.vue': ['address'],
  'screens/ServerScreen.vue': [
    'card.name',
    'address',
    'ownHost',
    'part.text',
    'accountErrorText(voteError)',
  ],
  'screens/LaunchScreen.vue': ['errorText.text', 'MOJANG_HOST', 'part', "log.join('\\n')"],
  'screens/CrashScreen.vue': [
    'text.title',
    'text.text',
    'details?.evidence',
    'details.note',
    'line.text',
    "realLog.join('\\n')",
    'JSON.stringify(preview.report, null, 2)',
  ],
  'screens/LicensesScreen.vue': ['text'],
  'screens/LibraryScreen.vue': ['actionError', 'disk.storage.path'],
  'screens/SettingsScreen.vue': ['machine.folder', 'update.notes', 'officialHost'],
  'components/SettingsPrivacy.vue': ['JSON.stringify(packet.packet, null, 2)'],
  'components/SettingsAbout.vue': ['siteHost'],
  'screens/LoginScreen.vue': ['accountTitle(mc)'],
  'screens/AccountsScreen.vue': [
    'accountTitle(mc)',
    'accounts.playNick.value',
    'license.nick',
    'item.nick',
    'removeError',
  ],
  'components/LoginLicense.vue': ['error.text'],
};

const CHROME_ONLY = [
  'components/SideNav.vue',
  'components/TitleBar.vue',
  'components/UiButton.vue',
  'components/UiTabs.vue',
  'components/UiSegmented.vue',
  'components/UiSelect.vue',
  'components/UiToggle.vue',
  'components/TagChip.vue',
  'components/StateNotice.vue',
  'components/StaleNote.vue',
  'components/SkelBar.vue',
  'components/OnlineCount.vue',
  'components/PingBadge.vue',
];

const CONTROLS = new Set(['button', 'UiButton', 'UiTabs', 'UiSegmented', 'UiToggle', 'TagChip']);

function templateOf(file: string): AstNode {
  const { descriptor } = parse(readFileSync(join(root, file), 'utf8'), { filename: file });
  const ast = descriptor.template?.ast as unknown as AstNode | undefined;
  if (ast === undefined) {
    throw new Error(`${file}: no template`);
  }
  return ast;
}

function hasSelectableClass(node: AstNode): boolean {
  return (node.props ?? []).some(
    (prop) =>
      prop.type === ATTRIBUTE &&
      prop.name === 'class' &&
      (prop.value?.content ?? '').split(/\s+/).includes('selectable'),
  );
}

function walk(node: AstNode, inside: boolean, visit: (found: Found) => void): void {
  const selectable = inside || (node.type === ELEMENT && hasSelectableClass(node));
  visit({ node, selectable });
  for (const child of node.children ?? []) {
    walk(child, selectable, visit);
  }
}

function collect(file: string, match: (node: AstNode) => boolean): Found[] {
  const found: Found[] = [];
  walk(templateOf(file), false, (item) => {
    if (match(item.node)) {
      found.push(item);
    }
  });
  return found;
}

function expression(node: AstNode): string {
  return (node.content?.content ?? '').replace(/\s+/g, ' ').trim();
}

function vueFiles(dir: string): string[] {
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.vue'))
    .map((name) => `${dir}/${name}`);
}

const templates = [...vueFiles('components'), ...vueFiles('screens')];

describe('text selection', () => {
  it('app.css: the interface is not selectable, content and input fields are', () => {
    const css = readFileSync(join(root, 'styles/app.css'), 'utf8');
    const block = (selector: string): string =>
      css
        .split('\n}')
        .filter((rule) => rule.trimStart().split(/\s*\{/)[0]?.split(/,\s*/).includes(selector))
        .join('\n');
    expect(block('body')).toMatch(/user-select: none;[\s\S]*cursor: default;/);
    expect(block('img')).toContain('-webkit-user-drag: none;');
    expect(block('svg')).toContain('-webkit-user-drag: none;');
    expect(block('.selectable')).toMatch(/user-select: text;[\s\S]*cursor: text;/);
    expect(block('textarea')).toMatch(/user-select: auto;[\s\S]*cursor: text;/);
    expect(block('select')).toMatch(/user-select: none;[\s\S]*cursor: default;/);
    expect(block('::selection')).toContain('var(--lx-selection)');
  });

  it('content that gets copied lives inside .selectable', () => {
    const missing = Object.entries(CONTENT).flatMap(([file, expressions]) =>
      expressions.flatMap((wanted) => {
        const found = collect(
          file,
          (node) => node.type === INTERPOLATION && expression(node) === wanted,
        );
        if (found.length === 0) {
          return [`${file}: {{ ${wanted} }} not found`];
        }
        return found.filter((item) => !item.selectable).map(() => `${file}: {{ ${wanted} }}`);
      }),
    );
    expect(missing).toEqual([]);
  });

  it('logs and reports inside <pre> are selectable', () => {
    const plain = templates.flatMap((file) =>
      collect(file, (node) => node.type === ELEMENT && node.tag === 'pre')
        .filter((item) => !item.selectable)
        .map(() => file),
    );
    expect(plain).toEqual([]);
  });

  it('buttons, tabs, chips and the window shell are not selectable', () => {
    const controls = templates.flatMap((file) =>
      collect(
        file,
        (node) => node.type === ELEMENT && CONTROLS.has(node.tag ?? '') && hasSelectableClass(node),
      ).map((item) => `${file}: <${item.node.tag ?? ''}>`),
    );
    expect(controls).toEqual([]);
    const chrome = CHROME_ONLY.filter((file) =>
      collect(file, (node) => node.type === ELEMENT && hasSelectableClass(node)).some(Boolean),
    );
    expect(chrome).toEqual([]);
  });
});
