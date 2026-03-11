/**
 * Report View — Renders charts and data for specific report types
 */

import { getCredentials, logout } from '../services/auth.js';
import { getProjects, searchIssues, searchAllIssues, getBoards, getSprints, getSprintIssues } from '../services/jira.js';
import { issuesByStatus, issuesByType, issuesByPriority, assigneeWorkload, sprintVelocity, createdVsResolved, statusSummary } from '../services/reports.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';
import Chart from 'chart.js/auto';

// ADS-inspired chart colors
const CHART_COLORS = {
  light: {
    blue: '#0052cc',
    teal: '#00b8d9',
    green: '#36b37e',
    yellow: '#ffab00',
    orange: '#ff5630',
    purple: '#6554c0',
    pink: '#e774bb',
    neutral: '#8993a4',
  },
  dark: {
    blue: '#579dff',
    teal: '#60c6d2',
    green: '#4bce97',
    yellow: '#e2b203',
    orange: '#f87462',
    purple: '#9f8fef',
    pink: '#e774bb',
    neutral: '#8c9bab',
  },
};

function getColors() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  return Object.values(CHART_COLORS[theme] || CHART_COLORS.light);
}

function getChartDefaults() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    color: isDark ? '#9fadbc' : '#626f86',
    borderColor: isDark ? '#a6c5e229' : '#0b120e24',
    gridColor: isDark ? '#a6c5e214' : '#0515240a',
    fontFamily: '"Inter", "Atlassian Sans", ui-sans-serif, sans-serif',
  };
}

let activeCharts = [];

function destroyCharts() {
  activeCharts.forEach(c => c.destroy());
  activeCharts = [];
}

export async function renderReport(reportType, projectKey) {
  const creds = getCredentials();
  if (!creds) {
    navigate('/login');
    return;
  }

  destroyCharts();

  const app = document.getElementById('app');
  renderAppShell(app, reportType);

  const reportNames = {
    velocity: 'Sprint Velocity',
    distribution: 'Issue Distribution',
    workload: 'Team Workload',
    trend: 'Created vs Resolved',
    jql: 'JQL Query',
  };

  updateBreadcrumbs([
    { label: reportNames[reportType] || 'Report' },
  ]);

  const content = document.getElementById('page-content');

  if (reportType === 'jql') {
    renderJQLView(content);
    return;
  }

  // Show project selector if no project specified
  if (!projectKey) {
    await renderProjectSelector(content, reportType, reportNames[reportType]);
    return;
  }

  content.innerHTML = `
    <div class="page-header" style="display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h1 class="page-title">${reportNames[reportType] || 'Report'}</h1>
        <p class="page-subtitle">Project: ${projectKey}</p>
      </div>
      <button class="btn btn-default" id="back-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Change Project
      </button>
    </div>
    <div id="report-container">
      <div class="loading-screen">
        <div class="spinner spinner-lg"></div>
        <p>Generating report...</p>
      </div>
    </div>
  `;

  document.getElementById('back-btn').addEventListener('click', () => {
    navigate(`/report/${reportType}`);
  });

  try {
    switch (reportType) {
      case 'velocity':
        await renderVelocityReport(projectKey);
        break;
      case 'distribution':
        await renderDistributionReport(projectKey);
        break;
      case 'workload':
        await renderWorkloadReport(projectKey);
        break;
      case 'trend':
        await renderTrendReport(projectKey);
        break;
      default:
        content.innerHTML = `<div class="empty-state"><p class="empty-state-title">Unknown report type</p></div>`;
    }
  } catch (err) {
    showToast('error', 'Report failed', err.message);
    document.getElementById('report-container').innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <p class="empty-state-title">Failed to generate report</p>
        <p class="empty-state-description">${err.message}</p>
      </div>
    `;
  }
}

async function renderProjectSelector(content, reportType, reportName) {
  content.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${reportName}</h1>
      <p class="page-subtitle">Select a project to generate the report</p>
    </div>
    <div id="project-list" class="grid grid-3">
      <div class="card skeleton"><div style="height: 60px;"></div></div>
      <div class="card skeleton"><div style="height: 60px;"></div></div>
      <div class="card skeleton"><div style="height: 60px;"></div></div>
    </div>
  `;

  try {
    const projects = await getProjects();
    const grid = document.getElementById('project-list');

    grid.innerHTML = projects.map(project => `
      <div class="card card-interactive" data-project-key="${project.key}" tabindex="0" style="cursor: pointer;">
        <div style="display: flex; align-items: center; gap: var(--ds-space-100);">
          ${project.avatarUrls?.['32x32']
            ? `<img src="${project.avatarUrls['32x32']}" alt="" style="width: 24px; height: 24px; border-radius: var(--ds-radius-100);" />`
            : `<div class="avatar avatar-sm" style="border-radius: var(--ds-radius-100); font-size: 11px;">${project.key.charAt(0)}</div>`
          }
          <div>
            <div style="font: var(--ds-font-heading-xsmall);">${project.name}</div>
            <div style="font: var(--ds-font-body-small); color: var(--ds-text-subtle);">${project.key}</div>
          </div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.card-interactive').forEach(card => {
      const handler = () => navigate(`/report/${reportType}/${card.dataset.projectKey}`);
      card.addEventListener('click', handler);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
    });
  } catch (err) {
    showToast('error', 'Failed to load projects', err.message);
  }
}

/* ── Velocity Report ─────────────────────────────── */
async function renderVelocityReport(projectKey) {
  const container = document.getElementById('report-container');

  const boards = await getBoards(projectKey);
  if (!boards.length) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">No agile boards found</p><p class="empty-state-description">This project doesn't have any Scrum boards. Sprint velocity requires a Scrum board.</p></div>`;
    return;
  }

  const scrumBoard = boards.find(b => b.type === 'scrum') || boards[0];
  const sprints = await getSprints(scrumBoard.id);

  if (!sprints.length) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">No sprints found</p><p class="empty-state-description">This board doesn't have any completed or active sprints.</p></div>`;
    return;
  }

  // Get last 10 sprints
  const recentSprints = sprints.slice(-10);
  const sprintIssuesMap = {};
  for (const sprint of recentSprints) {
    sprintIssuesMap[sprint.id] = await getSprintIssues(sprint.id);
  }

  const data = sprintVelocity(recentSprints, sprintIssuesMap);
  const colors = getColors();
  const defaults = getChartDefaults();

  container.innerHTML = `
    <div class="grid grid-2" style="margin-bottom: var(--ds-space-300);">
      <div class="card">
        <canvas id="velocity-chart" height="300"></canvas>
      </div>
      <div class="card">
        <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-200);">Sprint Details</h3>
        <div class="table-container">
          <table class="table">
            <thead><tr><th>Sprint</th><th>Committed</th><th>Completed</th><th>Rate</th></tr></thead>
            <tbody>
              ${data.sprints.map(s => `
                <tr>
                  <td>${s.name}</td>
                  <td>${s.committed}</td>
                  <td>${s.completed}</td>
                  <td>
                    <span class="lozenge ${s.committed > 0 && (s.completed / s.committed) >= 0.8 ? 'lozenge-success' : 'lozenge-warning'}">
                      ${s.committed > 0 ? Math.round((s.completed / s.committed) * 100) : 0}%
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const chart = new Chart(document.getElementById('velocity-chart'), {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Committed', data: data.committed, backgroundColor: colors[0] + '80', borderColor: colors[0], borderWidth: 2 },
        { label: 'Completed', data: data.completed, backgroundColor: colors[2] + '80', borderColor: colors[2], borderWidth: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: defaults.color, font: { family: defaults.fontFamily } } },
        title: { display: true, text: 'Sprint Velocity', color: defaults.color, font: { family: defaults.fontFamily, size: 16, weight: '600' } },
      },
      scales: {
        x: { ticks: { color: defaults.color, font: { family: defaults.fontFamily } }, grid: { color: defaults.gridColor } },
        y: { beginAtZero: true, ticks: { color: defaults.color, font: { family: defaults.fontFamily } }, grid: { color: defaults.gridColor } },
      },
    },
  });
  activeCharts.push(chart);
}

/* ── Distribution Report ─────────────────────────── */
async function renderDistributionReport(projectKey) {
  const container = document.getElementById('report-container');
  const jql = `project = "${projectKey}" ORDER BY created DESC`;
  const result = await searchIssues(jql, { maxResults: 100, fields: 'status,issuetype,priority,assignee' });
  const issues = result.issues || [];

  if (!issues.length) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">No issues found</p></div>`;
    return;
  }

  const byStatus = issuesByStatus(issues);
  const byType = issuesByType(issues);
  const byPriority = issuesByPriority(issues);
  const colors = getColors();
  const defaults = getChartDefaults();

  container.innerHTML = `
    <div class="stat-grid" style="margin-bottom: var(--ds-space-300);">
      <div class="stat-card">
        <div class="stat-card-label">Total Issues</div>
        <div class="stat-card-value">${result.total}</div>
      </div>
      ${byStatus.labels.map((label, i) => `
        <div class="stat-card">
          <div class="stat-card-label">${label}</div>
          <div class="stat-card-value">${byStatus.values[i]}</div>
        </div>
      `).join('')}
    </div>
    <div class="grid grid-3" style="margin-bottom: var(--ds-space-300);">
      <div class="card"><canvas id="status-chart" height="280"></canvas></div>
      <div class="card"><canvas id="type-chart" height="280"></canvas></div>
      <div class="card"><canvas id="priority-chart" height="280"></canvas></div>
    </div>
  `;

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: defaults.color, font: { family: defaults.fontFamily }, padding: 12, usePointStyle: true } },
    },
  };

  activeCharts.push(
    new Chart(document.getElementById('status-chart'), {
      type: 'doughnut',
      data: { labels: byStatus.labels, datasets: [{ data: byStatus.values, backgroundColor: colors.slice(0, byStatus.labels.length), borderWidth: 0 }] },
      options: { ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: 'By Status', color: defaults.color, font: { family: defaults.fontFamily, size: 14, weight: '600' } } } },
    }),
    new Chart(document.getElementById('type-chart'), {
      type: 'doughnut',
      data: { labels: byType.labels, datasets: [{ data: byType.values, backgroundColor: colors.slice(0, byType.labels.length), borderWidth: 0 }] },
      options: { ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: 'By Type', color: defaults.color, font: { family: defaults.fontFamily, size: 14, weight: '600' } } } },
    }),
    new Chart(document.getElementById('priority-chart'), {
      type: 'doughnut',
      data: { labels: byPriority.labels, datasets: [{ data: byPriority.values, backgroundColor: colors.slice(0, byPriority.labels.length), borderWidth: 0 }] },
      options: { ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: 'By Priority', color: defaults.color, font: { family: defaults.fontFamily, size: 14, weight: '600' } } } },
    }),
  );
}

/* ── Workload Report ─────────────────────────────── */
async function renderWorkloadReport(projectKey) {
  const container = document.getElementById('report-container');
  const jql = `project = "${projectKey}" AND status != Done ORDER BY assignee ASC`;
  const result = await searchIssues(jql, { maxResults: 100, fields: 'status,assignee,issuetype' });
  const issues = result.issues || [];

  if (!issues.length) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">No open issues found</p></div>`;
    return;
  }

  const workload = assigneeWorkload(issues);
  const colors = getColors();
  const defaults = getChartDefaults();

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <canvas id="workload-chart" height="400"></canvas>
      </div>
      <div class="card">
        <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-200);">Team Members</h3>
        <div class="table-container">
          <table class="table">
            <thead><tr><th>Assignee</th><th>Issues</th><th>Load</th></tr></thead>
            <tbody>
              ${workload.labels.map((name, i) => {
                const pct = Math.round((workload.values[i] / workload.total) * 100);
                return `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: var(--ds-space-100);">
                        <div class="avatar avatar-sm">${name.charAt(0).toUpperCase()}</div>
                        ${name}
                      </div>
                    </td>
                    <td>${workload.values[i]}</td>
                    <td>
                      <div class="progress-bar" style="width: 100px;">
                        <div class="progress-bar-fill ${pct > 30 ? 'warning' : ''} ${pct > 50 ? 'danger' : ''}" style="width: ${pct}%;"></div>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const chart = new Chart(document.getElementById('workload-chart'), {
    type: 'bar',
    data: {
      labels: workload.labels,
      datasets: [{
        label: 'Open Issues',
        data: workload.values,
        backgroundColor: colors.map(c => c + '80'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Issues per Team Member', color: defaults.color, font: { family: defaults.fontFamily, size: 16, weight: '600' } },
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: defaults.color, font: { family: defaults.fontFamily } }, grid: { color: defaults.gridColor } },
        y: { ticks: { color: defaults.color, font: { family: defaults.fontFamily } }, grid: { display: false } },
      },
    },
  });
  activeCharts.push(chart);
}

/* ── Trend Report ────────────────────────────────── */
async function renderTrendReport(projectKey) {
  const container = document.getElementById('report-container');
  const jql = `project = "${projectKey}" AND created >= -90d ORDER BY created DESC`;
  const issues = await searchAllIssues(jql, 'created,resolutiondate,status');

  if (!issues.length) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">No issues found in the last 90 days</p></div>`;
    return;
  }

  const data = createdVsResolved(issues);
  const colors = getColors();
  const defaults = getChartDefaults();

  container.innerHTML = `
    <div class="card" style="margin-bottom: var(--ds-space-300);">
      <canvas id="trend-chart" height="350"></canvas>
    </div>
  `;

  const chart = new Chart(document.getElementById('trend-chart'), {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Created',
          data: data.created,
          borderColor: colors[4],
          backgroundColor: colors[4] + '20',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: 'Resolved',
          data: data.resolved,
          borderColor: colors[2],
          backgroundColor: colors[2] + '20',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: defaults.color, font: { family: defaults.fontFamily }, usePointStyle: true } },
        title: { display: true, text: 'Created vs Resolved (Last 12 Weeks)', color: defaults.color, font: { family: defaults.fontFamily, size: 16, weight: '600' } },
      },
      scales: {
        x: { ticks: { color: defaults.color, font: { family: defaults.fontFamily } }, grid: { color: defaults.gridColor } },
        y: { beginAtZero: true, ticks: { color: defaults.color, font: { family: defaults.fontFamily } }, grid: { color: defaults.gridColor } },
      },
    },
  });
  activeCharts.push(chart);
}

/* ── JQL Query View ──────────────────────────────── */
function renderJQLView(content) {
  content.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">JQL Query</h1>
      <p class="page-subtitle">Run custom JQL queries and view results</p>
    </div>

    <div class="card" style="margin-bottom: var(--ds-space-300);">
      <div class="form-group">
        <label class="form-label" for="jql-input">JQL Query</label>
        <div style="display: flex; gap: var(--ds-space-100);">
          <input class="input" type="text" id="jql-input" placeholder='project = "PROJ" AND status = "In Progress" ORDER BY created DESC' style="flex: 1;" />
          <button class="btn btn-primary" id="jql-run-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run
          </button>
        </div>
        <span class="form-label-subtle">
          <a href="https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jql/" target="_blank" rel="noopener">JQL syntax guide</a>
        </span>
      </div>
    </div>

    <div id="jql-results"></div>
  `;

  document.getElementById('jql-run-btn').addEventListener('click', async () => {
    const jql = document.getElementById('jql-input').value.trim();
    if (!jql) {
      showToast('warning', 'Please enter a JQL query');
      return;
    }
    await executeJQL(jql);
  });

  document.getElementById('jql-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('jql-run-btn').click();
    }
  });
}

async function executeJQL(jql) {
  const resultsDiv = document.getElementById('jql-results');
  resultsDiv.innerHTML = `<div class="loading-screen"><div class="spinner"></div><p>Running query...</p></div>`;

  try {
    const result = await searchIssues(jql, { maxResults: 50, fields: 'summary,status,issuetype,assignee,priority,created,updated' });
    const issues = result.issues || [];

    if (!issues.length) {
      resultsDiv.innerHTML = `<div class="empty-state"><p class="empty-state-title">No results</p><p class="empty-state-description">Your JQL query returned no results. Try modifying the query.</p></div>`;
      return;
    }

    resultsDiv.innerHTML = `
      <div style="margin-bottom: var(--ds-space-150); font: var(--ds-font-body-small); color: var(--ds-text-subtle);">
        Showing ${issues.length} of ${result.total} results
      </div>
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${issues.map(issue => {
              const statusCat = issue.fields?.status?.statusCategory?.key;
              const lozengeClass = statusCat === 'done' ? 'lozenge-success' : statusCat === 'indeterminate' ? 'lozenge-info' : 'lozenge-default';
              return `
                <tr>
                  <td><a href="${getCredentials()?.jiraUrl}/browse/${issue.key}" target="_blank" rel="noopener" style="font-weight: var(--ds-font-weight-medium);">${issue.key}</a></td>
                  <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${issue.fields?.summary || ''}</td>
                  <td><span class="lozenge ${lozengeClass}">${issue.fields?.status?.name || ''}</span></td>
                  <td>${issue.fields?.issuetype?.name || ''}</td>
                  <td>${issue.fields?.priority?.name || ''}</td>
                  <td>
                    ${issue.fields?.assignee
                      ? `<div style="display: flex; align-items: center; gap: var(--ds-space-075);"><div class="avatar avatar-sm">${issue.fields.assignee.displayName?.charAt(0) || '?'}</div><span style="font: var(--ds-font-body-small);">${issue.fields.assignee.displayName}</span></div>`
                      : '<span style="color: var(--ds-text-subtlest);">Unassigned</span>'
                    }
                  </td>
                  <td style="font: var(--ds-font-body-small); color: var(--ds-text-subtle); white-space: nowrap;">${issue.fields?.created ? new Date(issue.fields.created).toLocaleDateString() : ''}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    resultsDiv.innerHTML = `
      <div style="padding: var(--ds-space-200); background-color: var(--ds-background-danger); border-radius: var(--ds-radius-200);">
        <p style="font: var(--ds-font-body); font-weight: var(--ds-font-weight-medium); color: var(--ds-text-danger); margin-bottom: var(--ds-space-050);">Query failed</p>
        <p style="font: var(--ds-font-body-small); color: var(--ds-text-danger);">${err.message}</p>
      </div>
    `;
  }
}
