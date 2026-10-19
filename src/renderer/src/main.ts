import { createApp } from 'vue';
import { createWebHashHistory } from 'vue-router';
import { ru } from '@shared/i18n/ru';
import App from './App.vue';
import type { LauncherContext } from './composables/context';
import { launcherPlugin } from './composables/stores';
import { useAccounts } from './composables/useAccounts';
import { createTrack, trackScreens } from './composables/useTrack';
import { mountApp } from './lib/boot';
import { isDemoMode } from './lib/demo';
import { openLoginOnFirstRun } from './lib/first-run';
import { keepSelectionOnLinks, limitSelectAll } from './lib/selection';
import { createAppRouter } from './router';

document.title = ru.app.title;
keepSelectionOnLinks(document);
limitSelectAll(document);
const context: LauncherContext = {
  api: window.launcher,
  demo: isDemoMode(import.meta.env),
  now: () => new Date(),
  random: () => Math.random(),
};
const router = createAppRouter(createWebHashHistory());
trackScreens(router, createTrack(context));
const app = createApp(App).use(launcherPlugin(context)).use(router);
openLoginOnFirstRun(
  router,
  app.runWithContext(() => useAccounts()),
);
const root = document.getElementById('app');
if (root === null) {
  window.launcher.window.reportBoot(false);
} else {
  mountApp(app, root, (mounted) => {
    window.launcher.window.reportBoot(mounted);
  });
}
