/**
 * Dashboard View — Main app dashboard with project overview and report tiles
 */

import { getCredentials, getSavedUser, logout } from '../services/auth.js';
import { getProjects, searchIssues } from '../services/jira.js';
import { statusSummary } from '../services/reports.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { toggleTheme, getTheme } from '../utils/theme.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

let projects = [];

export async function renderDashboard() {
  const creds = getCredentials();
  if (!creds) {
    navigate('/login');
    return;
  }

  const app = document.getElementById('app');
  renderAppShell(app, 'dashboard');
  updateBreadcrumbs([{ label: 'Dashboard' }]);

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header" id="dashboard-header">
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">Overview of your Jira projects and reports</p>
    </div>

    <div id="dashboard-stats" class="stat-grid" style="margin-bottom: var(--ds-space-400);">
      <div class="stat-card skeleton"><div style="height: 60px;"></div></div>
      <div class="stat-card skeleton"><div style="height: 60px;"></div></div>
      <div class="stat-card skeleton"><div style="height: 60px;"></div></div>
      <div class="stat-card skeleton"><div style="height: 60px;"></div></div>
    </div>

    <div id="dashboard-projects" style="margin-bottom: var(--ds-space-300);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--ds-space-200);">
        <h2 style="font: var(--ds-font-heading-medium);">Projects</h2>
        <div style="position: relative;">
          <input class="input" type="search" id="project-search" placeholder="Search projects..." style="width: 240px; padding-left: var(--ds-space-400);" />
          <svg style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ds-icon-subtle);" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
      </div>
      <div id="projects-grid" class="grid grid-3">
        ${skeletonCards(6)}
      </div>
      <div id="projects-empty" class="empty-state" style="display: none;">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="8" y1="21" x2="8" y2="3"/></svg>
        <p class="empty-state-title">No projects found</p>
        <p class="empty-state-description">No Jira projects match your search or your account doesn't have access to any projects.</p>
      </div>
    </div>
  `;

  // Search handler
  document.getElementById('project-search').addEventListener('input', (e) => {
    filterProjects(e.target.value);
  });

  // Load data
  await loadDashboardData();
}

async function loadDashboardData() {
  try {
    projects = await getProjects();
    renderProjectCards(projects);
    await loadStats();
  } catch (err) {
    showToast('error', 'Failed to load data', err.message);
    if (err.message.includes('401') || err.message.includes('Authentication')) {
      logout();
      navigate('/login');
    }
  }
}

async function loadStats() {
  try {
    // Get a quick overview of issues
    const myIssues = await searchIssues('assignee = currentUser() ORDER BY updated DESC', {
      maxResults: 50,
      fields: 'status,issuetype,priority,assignee',
    });

    const summary = statusSummary(myIssues.issues || []);

    document.getElementById('dashboard-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-card-label">My Open Issues</div>
        <div class="stat-card-value">${summary.toDo + summary.inProgress}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">To Do</div>
        <div class="stat-card-value" style="color: var(--ds-text-information);">${summary.toDo}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">In Progress</div>
        <div class="stat-card-value" style="color: var(--ds-text-warning);">${summary.inProgress}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Done</div>
        <div class="stat-card-value" style="color: var(--ds-text-success);">${summary.done}</div>
      </div>
    `;
  } catch {
    document.getElementById('dashboard-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-card-label">Projects</div>
        <div class="stat-card-value">${projects.length}</div>
      </div>
    `;
  }
}

function renderProjectCards(projectList) {
  const grid = document.getElementById('projects-grid');
  const empty = document.getElementById('projects-empty');

  if (projectList.length === 0) {
    grid.style.display = 'none';
    empty.style.display = '';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';

  grid.innerHTML = projectList.map(project => `
    <div class="card card-interactive project-card" data-project-key="${project.key}" tabindex="0">
      <div class="card-header">
        <div style="display: flex; align-items: center; gap: var(--ds-space-100);">
          ${project.avatarUrls?.['32x32']
            ? `<img src="${project.avatarUrls['32x32']}" alt="" style="width: 24px; height: 24px; border-radius: var(--ds-radius-100);" />`
            : `<div class="avatar avatar-sm" style="border-radius: var(--ds-radius-100); font-size: 11px;">${project.key.charAt(0)}</div>`
          }
          <div>
            <div class="card-title" style="font: var(--ds-font-heading-xsmall);">${project.name}</div>
            <div class="card-subtitle">${project.key}</div>
          </div>
        </div>
      </div>
      <div class="card-body">
        <span class="lozenge lozenge-info">${project.projectTypeKey || 'software'}</span>
        ${project.style === 'next-gen' ? '<span class="lozenge lozenge-discovery" style="margin-left: var(--ds-space-050);">Team-managed</span>' : ''}
      </div>
    </div>
  `).join('');

  // Add click handlers
  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.projectKey;
      navigate(`/report/${key}`);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') card.click();
    });
  });
}

function filterProjects(query) {
  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.key.toLowerCase().includes(query.toLowerCase())
  );
  renderProjectCards(filtered);
}


function skeletonCards(count) {
  return Array(count).fill(`
    <div class="card">
      <div class="skeleton skeleton-heading"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text" style="width: 40%;"></div>
    </div>
  `).join('');
}
