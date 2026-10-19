// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { launcherPlugin } from '../composables/stores';
import { stubLauncher, TEST_NOW } from '../testing';
import CopyButton from './CopyButton.vue';
import OnlineChart from './OnlineChart.vue';
import OnlineCount from './OnlineCount.vue';
import PingBadge from './PingBadge.vue';
import ScoreCell from './ScoreCell.vue';
import ScoreSplit from './ScoreSplit.vue';
import TrendValue from './TrendValue.vue';
import UiButton from './UiButton.vue';
import { ru } from '@shared/i18n/ru';

function plugin(stub = stubLauncher()): ReturnType<typeof launcherPlugin> {
  return launcherPlugin({ api: stub.api, demo: false, now: () => TEST_NOW, random: () => 0 });
}

describe('external links', () => {
  it('http and other schemes do not open', async () => {
    const stub = stubLauncher();
    for (const href of ['http://mc-mon.ru/', 'file:///C:/Windows', 'javascript:alert(1)']) {
      const button = mount(UiButton, { props: { href }, global: { plugins: [plugin(stub)] } });
      await button.trigger('click');
    }
    expect(stub.api.openExternal).not.toHaveBeenCalled();
  });
});

describe('small components', () => {
  it("ping without data — 'no data', not 0 ms", () => {
    const badge = mount(PingBadge, { props: { ms: null } });
    expect(badge.text()).toContain(ru.server.pingUnknown);
  });

  it('online growth at zero is not drawn, otherwise an arrow and a label', () => {
    expect(
      mount(TrendValue, { props: { value: 0 } })
        .find('.trend')
        .exists(),
    ).toBe(false);
    const down = mount(TrendValue, { props: { value: -7 } });
    expect(down.find('.trend').classes()).toContain('is-down');
    expect(down.text()).toContain('7%');
  });

  it('two charts on one page get different gradient ids', () => {
    const points = [
      { at: '2026-10-03T00:00:00Z', online: 10 },
      { at: '2026-10-03T12:00:00Z', online: 20 },
    ];
    const pair = mount(
      defineComponent({
        render: () => [
          h(OnlineChart, { points, label: 'a' }),
          h(OnlineChart, { points, label: 'b' }),
        ],
      }),
    );
    const ids = pair.findAll('linearGradient').map((item) => item.attributes('id'));
    expect(new Set(ids).size).toBe(2);
  });
});

describe('score cell', () => {
  function cell(energy: number, votes: number): ReturnType<typeof mount> {
    return mount(ScoreCell, { props: { energy, votes } });
  }

  it('shows the shortened sum, a press opens the card with the exact sum and both parts', async () => {
    const score = cell(9000, 3345);
    expect(score.find('.score-value').text()).toBe('12K');
    expect(score.find('.lx-visually-hidden').text()).toContain('12\u00a0345');
    await score.trigger('pointerenter');
    expect(document.body.querySelector('.score-tip')).toBeNull();
    await score.trigger('click');
    expect(score.attributes('aria-expanded')).toBe('true');
    const tip = document.body.querySelector('.score-tip');
    expect(tip?.querySelector('.tip-total')?.textContent).toBe('12\u00a0345');
    expect(tip?.querySelector('.tip-energy')?.textContent).toContain('9\u00a0000');
    expect(tip?.querySelector('.tip-votes')?.textContent).toContain('3\u00a0345');
    await score.trigger('click');
    expect(document.body.querySelector('.score-tip')).toBeNull();
    expect(score.attributes('aria-expanded')).toBe('false');
  });

  it('a press on the card closes it and goes no further', async () => {
    const score = cell(9000, 3345);
    await score.trigger('click');
    const tip = document.body.querySelector('.score-tip');
    const reached = vi.fn();
    document.body.addEventListener('click', reached, { once: true });
    tip?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.body.querySelector('.score-tip')).not.toBeNull();
    tip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await score.vm.$nextTick();
    document.body.removeEventListener('click', reached);
    expect(document.body.querySelector('.score-tip')).toBeNull();
    expect(reached).not.toHaveBeenCalled();
  });

  it('the card closes on a press outside, Escape, scroll and blur', async () => {
    const score = cell(9000, 3345);
    const closes = [
      (): unknown => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
      (): unknown => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
      (): unknown => document.dispatchEvent(new Event('scroll')),
      (): unknown => score.trigger('blur'),
    ];
    for (const close of closes) {
      await score.trigger('click');
      expect(document.body.querySelector('.score-tip')).not.toBeNull();
      await close();
      await score.vm.$nextTick();
      expect(document.body.querySelector('.score-tip')).toBeNull();
    }
  });

  it('takes the colour of the larger part, energy wins a tie', () => {
    expect(cell(800, 0).attributes('data-score')).toBe('energy');
    expect(cell(100, 100).attributes('data-score')).toBe('energy');
    expect(cell(0, 140).attributes('data-score')).toBe('votes');
  });

  it('draws one line segment per non-zero part', () => {
    expect(cell(1200, 312).findAll('.score-part')).toHaveLength(2);
    expect(cell(800, 0).findAll('.score-part')).toHaveLength(1);
  });

  it('zero is a grey 0 with an empty line and its own hint', () => {
    const score = cell(0, 0);
    expect(score.find('.score-value').text()).toBe('0');
    expect(score.attributes('data-score')).toBe('none');
    expect(score.findAll('.score-part')).toHaveLength(0);
    expect(score.find('.lx-visually-hidden').text()).toBe(ru.server.scoreEmpty);
  });
});

describe('online count in words', () => {
  function count(
    online: number,
    status: 'online' | 'offline' = 'online',
  ): ReturnType<typeof mount> {
    return mount(OnlineCount, { props: { online, status, worded: true } });
  }

  it('the word follows the number', () => {
    expect(count(1).find('.word').text()).toBe(ru.server.playing[0]);
    expect(count(2412).find('.word').text()).toBe(ru.server.playing[1]);
    expect(count(2412).text()).toContain('2\u00a0412');
  });

  it('an empty server and a server that is down have their own words', () => {
    expect(count(0).text()).toBe(ru.server.nobody);
    expect(count(0, 'offline').text()).toBe(ru.server.offline);
  });

  it('without the flag the number stays bare', () => {
    const bare = mount(OnlineCount, { props: { online: 5 } });
    expect(bare.find('.word').exists()).toBe(false);
  });
});

describe('score split', () => {
  it('a missing part is a grey zero and has no segment', () => {
    const split = mount(ScoreSplit, { props: { energy: 800, votes: 0 } });
    expect(split.find('[data-split-energy]').classes()).toContain('is-energy');
    expect(split.find('[data-split-votes]').text()).toBe('0');
    expect(split.find('[data-split-votes]').classes()).toContain('is-none');
    expect(split.findAll('.split-part')).toHaveLength(1);
  });

  it('both parts draw two segments, large numbers are shortened', () => {
    const split = mount(ScoreSplit, { props: { energy: 128400, votes: 2184 } });
    expect(split.find('[data-split-energy]').text()).toBe('128K');
    expect(split.find('[data-split-votes]').text()).toBe('2\u00a0184');
    expect(split.findAll('.split-part')).toHaveLength(2);
  });
});

describe('copy button', () => {
  function clipboard(writeText: () => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  }

  it('a successful copy turns into a check mark and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    clipboard(writeText);
    const button = mount(CopyButton, { props: { text: 'play.example.ru', label: 'Copy' } });
    await button.trigger('click');
    await Promise.resolve();
    await button.vm.$nextTick();
    expect(writeText).toHaveBeenCalledWith('play.example.ru');
    expect(button.classes()).toContain('is-copied');
    expect(button.find('[role="status"]').text()).toBe(ru.common.copied);
    expect(button.emitted('copied')).toHaveLength(1);
  });

  it('a failed copy changes nothing', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    const button = mount(CopyButton, { props: { text: 'play.example.ru', label: 'Copy' } });
    await button.trigger('click');
    await Promise.resolve();
    await button.vm.$nextTick();
    expect(button.classes()).not.toContain('is-copied');
    expect(button.emitted('copied')).toBeUndefined();
  });
});
