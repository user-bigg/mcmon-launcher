import {
  createRouter,
  type RouteLocationNormalized,
  type Router,
  type RouterHistory,
} from 'vue-router';

export type Section =
  'home' | 'servers' | 'library' | 'skins' | 'mods' | 'owner' | 'accounts' | 'settings';

declare module 'vue-router' {
  interface RouteMeta {
    section?: Section;
    bare?: boolean;
    idle?: boolean;
  }
}

function numericId(route: RouteLocationNormalized): { serverId: number } {
  return { serverId: Number(route.params.id) };
}

function ownedId(route: RouteLocationNormalized): { serverId: number | null } {
  const { id } = route.params;
  return { serverId: typeof id === 'string' && id !== '' ? Number(id) : null };
}

export function createAppRouter(history: RouterHistory): Router {
  return createRouter({
    history,
    routes: [
      {
        path: '/',
        name: 'home',
        component: () => import('./screens/HomeScreen.vue'),
        meta: { section: 'home' },
      },
      {
        path: '/servers',
        name: 'servers',
        component: () => import('./screens/ServersScreen.vue'),
        meta: { section: 'servers' },
      },
      {
        path: '/server/:id',
        name: 'server',
        component: () => import('./screens/ServerScreen.vue'),
        props: numericId,
        meta: { section: 'servers' },
      },
      {
        path: '/launch/:id(\\d+)',
        name: 'launch',
        component: () => import('./screens/LaunchScreen.vue'),
        props: numericId,
        meta: { section: 'servers' },
      },
      {
        path: '/library',
        name: 'library',
        component: () => import('./screens/LibraryScreen.vue'),
        meta: { section: 'library' },
      },
      {
        path: '/skins',
        name: 'skins',
        component: () => import('./screens/SkinsScreen.vue'),
        meta: { section: 'skins' },
      },
      {
        path: '/mods',
        name: 'mods',
        component: () => import('./screens/ModsScreen.vue'),
        meta: { section: 'mods' },
      },
      {
        path: '/my-servers/:id(\\d+)?',
        name: 'my-servers',
        component: () => import('./screens/MyServersScreen.vue'),
        props: ownedId,
        meta: { section: 'owner' },
      },
      {
        path: '/accounts',
        name: 'accounts',
        component: () => import('./screens/AccountsScreen.vue'),
        meta: { section: 'accounts' },
      },
      {
        path: '/settings',
        name: 'settings',
        component: () => import('./screens/SettingsScreen.vue'),
        meta: { section: 'settings' },
      },
      {
        path: '/welcome',
        name: 'welcome',
        component: () => import('./screens/LoginScreen.vue'),
        meta: { bare: true },
      },
      {
        path: '/crash/:instance',
        name: 'crash',
        component: () => import('./screens/CrashScreen.vue'),
        props: (route) => ({ instanceId: String(route.params.instance) }),
        meta: { section: 'library' },
      },
      {
        path: '/licenses',
        name: 'licenses',
        component: () => import('./screens/LicensesScreen.vue'),
        meta: { section: 'settings' },
      },
      {
        path: '/idle',
        name: 'idle',
        component: { render: () => null },
        meta: { idle: true },
      },
      { path: '/:rest(.*)*', redirect: '/' },
    ],
  });
}
