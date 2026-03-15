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
import { renderReport } from './views/report.js';
import { renderWorkLog } from './views/worklog.js';
import { renderCycleTime } from './views/cycletime.js';
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
registerRoute('/report/jql', () => renderReport('jql'));
registerRoute('/report/worklog', () => authGuard(() => renderWorkLog()));
registerRoute('/report/cycletime', () => authGuard(() => renderCycleTime()));
registerRoute('/report/timeinlane', () => authGuard(() => renderTimeInLane()));
registerRoute('/settings', () => authGuard(() => renderSettings()));

// Override the router to handle dynamic report routes
const originalHashHandler = () => {
  const hash = window.location.hash.slice(1) || '/login';

  // Check for /report/:type/:projectKey pattern
  const reportMatch = hash.match(/^\/report\/(\w+)\/(.+)$/);
  if (reportMatch) {
    const [, type, projectKey] = reportMatch;
    authGuard(() => renderReport(type, projectKey));
    return;
  }
};

window.addEventListener('hashchange', originalHashHandler);

// Initialize router
initRouter();

// Also handle the dynamic routes on initial load
if (window.location.hash) {
  originalHashHandler();
}
