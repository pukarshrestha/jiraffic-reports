/**
 * Jira-ffic Reports — Main Entry Point
 */

import './styles/tokens.css';
import './styles/reset.css';
import './styles/components.css';
import './styles/layout.css';

import { initTheme } from './utils/theme.js';
import { registerRoute, initRouter, navigate } from './utils/router.js';
import { isLoggedIn } from './services/auth.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReport } from './views/report.js';
import { renderWorkLog } from './views/worklog.js';

// Initialize theme
initTheme();

// Register routes
registerRoute('/login', renderLogin);
registerRoute('/dashboard', () => {
  if (!isLoggedIn()) return navigate('/login');
  renderDashboard();
});

// Report routes
registerRoute('/report/jql', () => renderReport('jql'));
registerRoute('/report/worklog', () => {
  if (!isLoggedIn()) return navigate('/login');
  renderWorkLog();
});

// Override the router to handle dynamic report routes
const originalHashHandler = () => {
  const hash = window.location.hash.slice(1) || '/login';

  // Check for /report/:type/:projectKey pattern
  const reportMatch = hash.match(/^\/report\/(\w+)\/(.+)$/);
  if (reportMatch) {
    const [, type, projectKey] = reportMatch;
    if (!isLoggedIn()) return navigate('/login');
    renderReport(type, projectKey);
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
