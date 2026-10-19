<script setup lang="ts">
const { label, disabled } = defineProps<{ label: string; disabled?: boolean }>();
const checked = defineModel<boolean>({ default: false });

function toggle(): void {
  if (!disabled) {
    checked.value = !checked.value;
  }
}
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :aria-checked="checked"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 20px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--mc-border-strong);
  background: var(--mc-surface-3);
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--mc-text-muted);
}

.switch[aria-checked='true'] {
  background: var(--mc-accent);
  border-color: var(--mc-accent);
}

.switch[aria-checked='true'] .knob {
  background: var(--lx-on-accent);
  transform: translateX(14px);
}

@media (prefers-reduced-motion: no-preference) {
  .knob {
    transition: transform 0.15s ease;
  }
}
.switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
