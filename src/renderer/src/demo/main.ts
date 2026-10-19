import { createApp, h, type VNode } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomeRowsDemo from './HomeRowsDemo.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:any(.*)*', component: { render: (): VNode => h('span') } }],
});

createApp(HomeRowsDemo).use(router).mount('#app');
