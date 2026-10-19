<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useExternal } from '../composables/useExternal';
import BiIcon from './BiIcon.vue';
import type { IconName } from './icons';

type Variant = 'play' | 'play-soft' | 'primary' | 'danger' | 'vote' | 'ghost';
type Size = 'sm' | 'md' | 'lg';
type ButtonType = 'button' | 'submit';

const {
  variant = 'ghost',
  size = 'md',
  icon,
  to,
  href,
  label,
  iconOnly,
  block,
  disabled,
  type = 'button',
} = defineProps<{
  variant?: Variant | undefined;
  size?: Size | undefined;
  icon?: IconName | undefined;
  to?: string | undefined;
  href?: string | undefined;
  label?: string | undefined;
  iconOnly?: boolean | undefined;
  block?: boolean | undefined;
  disabled?: boolean | undefined;
  type?: ButtonType | undefined;
}>();

const emit = defineEmits<{ click: [] }>();
const external = useExternal();

function onExternal(event: MouseEvent): void {
  event.preventDefault();
  if (href !== undefined) {
    void external.open(href);
  }
  emit('click');
}
</script>

<template>
  <RouterLink
    v-if="to !== undefined"
    :to="to"
    class="btn"
    :class="[`is-${variant}`, `is-${size}`, { 'is-icon': iconOnly, 'is-block': block }]"
    :aria-label="label"
    :title="iconOnly ? label : undefined"
  >
    <BiIcon v-if="icon" :name="icon" />
    <slot />
  </RouterLink>
  <a
    v-else-if="href !== undefined"
    :href="href"
    rel="noopener noreferrer"
    class="btn"
    :class="[`is-${variant}`, `is-${size}`, { 'is-icon': iconOnly, 'is-block': block }]"
    :aria-label="label"
    :title="iconOnly ? label : undefined"
    @click="onExternal"
  >
    <BiIcon v-if="icon" :name="icon" />
    <slot />
  </a>
  <button
    v-else
    :type="type"
    class="btn"
    :class="[`is-${variant}`, `is-${size}`, { 'is-icon': iconOnly, 'is-block': block }]"
    :aria-label="label"
    :title="iconOnly ? label : undefined"
    :disabled="disabled"
    @click="emit('click')"
  >
    <BiIcon v-if="icon" :name="icon" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex-shrink: 0;
  height: 38px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--mc-radius-sm);
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  cursor: default;
}

.btn.is-sm {
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
}

.btn.is-lg {
  height: 48px;
  padding: 0 28px;
  font-size: 16px;
  border-radius: var(--mc-radius);
}

.btn.is-icon {
  width: 38px;
  padding: 0;
}

.btn.is-icon.is-sm {
  width: 32px;
}

.btn.is-icon.is-lg {
  width: 48px;
}

.btn.is-block {
  flex: 1 1 0;
  min-width: 0;
}

.is-play {
  background: var(--mc-violet);
  border-color: var(--mc-violet);
  color: var(--lx-on-accent);
  font-weight: 700;
}

.is-play.is-lg {
  box-shadow: 0 8px 28px color-mix(in srgb, var(--mc-violet) 28%, transparent);
}

.is-play:hover:not(:disabled) {
  background: var(--lx-violet-hover);
  border-color: var(--lx-violet-hover);
}

.btn:disabled {
  opacity: 0.55;
}

.is-play-soft {
  background: var(--mc-violet-soft);
  color: var(--mc-violet);
  font-weight: 600;
}

.is-play-soft:hover:not(:disabled) {
  background: var(--mc-violet);
  color: var(--lx-on-accent);
}

.is-primary {
  background: var(--mc-accent);
  border-color: var(--mc-accent);
  color: var(--lx-on-accent);
  font-weight: 600;
}

.is-primary:hover:not(:disabled) {
  background: var(--lx-accent-hover);
  border-color: var(--lx-accent-hover);
}

.is-danger {
  background: var(--lx-danger-soft);
  border-color: color-mix(in srgb, var(--mc-danger) 45%, transparent);
  color: var(--mc-danger);
  font-weight: 600;
}

.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--mc-danger) 22%, transparent);
  border-color: var(--mc-danger);
}

.is-vote {
  background: var(--mc-gold-soft);
  border-color: color-mix(in srgb, var(--mc-gold) 40%, transparent);
  color: var(--mc-gold);
  font-weight: 600;
}

.is-vote:hover:not(:disabled) {
  background: var(--mc-gold);
  color: var(--lx-on-accent);
}

.is-ghost {
  background: var(--mc-surface-2);
  border-color: var(--mc-border);
  color: var(--mc-text);
}

.is-ghost:hover:not(:disabled) {
  background: var(--mc-surface-3);
  border-color: var(--mc-border-strong);
}
</style>
