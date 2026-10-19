<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue';
import { svgIcon } from './icon';
import { icons, type IconName } from './icons';

const props = defineProps<{ name: IconName }>();
const host = useTemplateRef<HTMLSpanElement>('host');

function render(): void {
  host.value?.replaceChildren(svgIcon(icons[props.name]));
}

onMounted(render);
watch(() => props.name, render);
</script>

<template>
  <span ref="host" class="bi" :data-icon="name" aria-hidden="true" />
</template>
