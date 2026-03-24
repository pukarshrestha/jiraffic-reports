/**
 * Jira-ffic Reports — Main Entry Point
 */

import './styles/tokens.css';
import './styles/reset.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/views.css';

import { initTheme } from './utils/theme.js';
import { registerRoute, initRouter, navigate } from './utils/router.js';
import { isLoggedIn, loadSitesCache, checkAuthStatus, saveUser } from './services/auth.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderWorkLog } from './views/worklog.js';
import { renderTimeInLane } from './views/timeinlane.js';
import { renderSettings } from './views/settings.js';

// Initialize theme
initTheme();

/**
 * Async auth guard — checks server session and loads sites cache
 */
async function authGuard(callback) {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    navigate('/login');
    return;
  }

  // Cache user info from auth status if available
  const status = await checkAuthStatus();
  if (status.user) {
    saveUser(status.user);
  }

  // Load sites cache for synchronous access in jira.js
  await loadSitesCache();

  callback();
}

// Register routes
registerRoute('/login', () => renderLogin());
registerRoute('/dashboard', () => authGuard(() => renderDashboard()));

// Report routes
registerRoute('/report/worklog', () => authGuard(() => renderWorkLog()));
registerRoute('/report/timeinlane', () => authGuard(() => renderTimeInLane()));
registerRoute('/settings', () => authGuard(() => renderSettings()));

// Initialize router
initRouter();
