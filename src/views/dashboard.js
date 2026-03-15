/**
 * Dashboard View — Main app dashboard with project overview and report tiles
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
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

    <div id="dashboard-stats" class="stat-grid mb-400">
      <div class="stat-card skeleton"><div class="skeleton-height-60"></div></div>
      <div class="stat-card skeleton"><div class="skeleton-height-60"></div></div>
      <div class="stat-card skeleton"><div class="skeleton-height-60"></div></div>
      <div class="stat-card skeleton"><div class="skeleton-height-60"></div></div>
    </div>

    <div id="dashboard-projects" class="mb-300">
      <div class="dashboard-projects-header">
        <h2 class="text-heading-medium">Projects</h2>
        <div class="project-search-wrapper">
          <input class="input project-search-input" type="search" id="project-search" placeholder="Search projects..." />
          <svg class="search-icon-absolute" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
      </div>
      <div id="projects-grid" class="grid grid-3">
        ${skeletonCards(6)}
      </div>
      <div id="projects-empty" class="empty-state d-none">
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
        <div class="stat-card-value text-info">${summary.toDo}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">In Progress</div>
        <div class="stat-card-value text-warning">${summary.inProgress}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Done</div>
        <div class="stat-card-value text-success">${summary.done}</div>
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
    grid.classList.add('d-none');
    empty.classList.remove('d-none');
    return;
  }

  grid.classList.remove('d-none');
  empty.classList.add('d-none');

  grid.innerHTML = projectList.map(project => `
    <div class="card card-interactive project-card" data-project-key="${project.key}" tabindex="0">
      <div class="card-header">
        <div class="flex-row-gap-100">
          ${project.avatarUrls?.['32x32']
            ? `<img src="${project.avatarUrls['32x32']}" alt="" class="project-card-avatar" />`
            : `<div class="avatar avatar-sm project-card-avatar">${project.key.charAt(0)}</div>`
          }
          <div>
            <div class="card-title text-heading-xsmall">${project.name}</div>
            <div class="card-subtitle">${project.key}</div>
          </div>
        </div>
      </div>
      <div class="card-body">
        <span class="lozenge lozenge-info">${project.projectTypeKey || 'software'}</span>
        ${project.style === 'next-gen' ? '<span class="lozenge lozenge-discovery ml-050">Team-managed</span>' : ''}
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
      <div class="skeleton skeleton-text skeleton-text-40"></div>
    </div>
  `).join('');
}
