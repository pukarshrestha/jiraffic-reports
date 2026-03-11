/**
 * App Shell — Sidebar + Top Bar
 */

import { getSavedUser, logout } from '../services/auth.js';
import { navigate, getCurrentRoute } from '../utils/router.js';
import { toggleTheme, getTheme } from '../utils/theme.js';

export function renderAppShell(container, activeView = 'dashboard') {
  const user = getSavedUser();
  const theme = getTheme();
  const initials = user?.displayName
    ? user.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  container.innerHTML = `
    <div class="app-shell">
      <!-- Sidebar -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <a href="#/dashboard" class="sidebar-logo">
            <svg class="sidebar-logo-icon" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="var(--ds-background-brand-bold)"/>
              <path d="M10 21.5L16 10.5L22 21.5H10Z" fill="white" opacity="0.9"/>
              <path d="M8 23H24V25H8V23Z" fill="white" opacity="0.7"/>
            </svg>
            <span class="sidebar-logo-text">Jira-ffic Reports</span>
          </a>
        </div>

        <nav class="sidebar-nav">
          <div class="sidebar-section">
            <div class="sidebar-section-title">Main</div>
            <button class="sidebar-item ${activeView === 'dashboard' ? 'active' : ''}" data-nav="dashboard">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Dashboard
            </button>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-section-title">Reports</div>
            <button class="sidebar-item ${activeView === 'velocity' ? 'active' : ''}" data-nav="report/velocity">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Sprint Velocity
            </button>
            <button class="sidebar-item ${activeView === 'distribution' ? 'active' : ''}" data-nav="report/distribution">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
              Issue Distribution
            </button>
            <button class="sidebar-item ${activeView === 'workload' ? 'active' : ''}" data-nav="report/workload">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Team Workload
            </button>
            <button class="sidebar-item ${activeView === 'trend' ? 'active' : ''}" data-nav="report/trend">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              Created vs Resolved
            </button>
            <button class="sidebar-item ${activeView === 'worklog' ? 'active' : ''}" data-nav="report/worklog">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Work Log
            </button>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-section-title">Tools</div>
            <button class="sidebar-item ${activeView === 'jql' ? 'active' : ''}" data-nav="report/jql">
              <svg class="sidebar-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              JQL Query
            </button>
          </div>
        </nav>

        <div class="sidebar-footer">
          <div style="display: flex; align-items: center; gap: var(--ds-space-100);">
            <div class="avatar avatar-sm">${initials}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font: var(--ds-font-body-small); font-weight: var(--ds-font-weight-medium); color: var(--ds-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user?.displayName || 'User'}</div>
              <div style="font: var(--ds-font-body-small); color: var(--ds-text-subtlest); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user?.emailAddress || ''}</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <header class="topbar">
          <div class="topbar-left">
            <button class="topbar-hamburger" id="hamburger-btn" aria-label="Toggle sidebar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <nav class="topbar-breadcrumbs" id="breadcrumbs">
              <a href="#/dashboard">Home</a>
            </nav>
          </div>
          <div class="topbar-right">
            <button class="theme-toggle ${theme === 'dark' ? 'dark' : ''}" id="theme-toggle" aria-label="Toggle dark mode">
              <div class="theme-toggle-icons">
                <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </div>
            </button>
            <button class="btn btn-subtle btn-icon-only" id="logout-btn" data-tooltip="Logout" aria-label="Logout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </header>

        <div class="page-content" id="page-content">
          <div class="loading-screen">
            <div class="spinner spinner-lg"></div>
            <p>Loading...</p>
          </div>
        </div>
      </main>
    </div>
  `;

  // Event listeners
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const newTheme = toggleTheme();
    document.getElementById('theme-toggle').classList.toggle('dark', newTheme === 'dark');
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
    navigate('/login');
  });

  document.getElementById('hamburger-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Navigation
  container.querySelectorAll('.sidebar-item[data-nav]').forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.nav;
      navigate(`/${target}`);
      document.getElementById('sidebar').classList.remove('open');
    });
  });

  // Close sidebar on overlay click (mobile)
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const hamburger = document.getElementById('hamburger-btn');
    if (sidebar?.classList.contains('open') && !sidebar.contains(e.target) && !hamburger.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}

export function updateBreadcrumbs(items) {
  const bc = document.getElementById('breadcrumbs');
  if (!bc) return;

  const parts = [
    `<a href="#/dashboard">Home</a>`,
    ...items.map((item, i) => {
      const isLast = i === items.length - 1;
      if (isLast) {
        return `<span class="separator">/</span><span>${item.label}</span>`;
      }
      return `<span class="separator">/</span><a href="${item.href || '#'}">${item.label}</a>`;
    }),
  ];

  bc.innerHTML = parts.join('');
}
