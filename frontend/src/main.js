import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { appState, loadSession } from './lib/session';
import { initTheme } from './lib/theme';
import './style.css';

initTheme();

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return { el: to.hash };
    return { top: 0 };
  },
  routes: [
    { path: '/', name: 'home', component: () => import('./views/LandingView.vue'), meta: { public: true } },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/privacy', name: 'privacy', component: () => import('./views/LegalView.vue'), meta: { public: true } },
    { path: '/terms', name: 'terms', component: () => import('./views/LegalView.vue'), meta: { public: true } },
    { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/DashboardView.vue') },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
    { path: '/ranking', name: 'ranking', component: () => import('./views/RankingView.vue') },
    { path: '/history', name: 'history', component: () => import('./views/HistoryView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue'), meta: { requiresAdmin: true } },
  ],
});

router.beforeEach(async (to) => {
  await loadSession();
  if (to.meta.public) {
    if (appState.user && to.name === 'login') return { name: 'dashboard' };
    return true;
  }
  if (!appState.user) return { name: 'login', query: { return_to: to.fullPath } };
  if (to.meta.requiresAdmin && appState.user.role !== 'admin') return { name: 'dashboard' };
  return true;
});

createApp(App).use(router).mount('#app');
