/**
 * Report View — JQL Query
 */

import { getCredentials } from '../services/auth.js';
import { searchIssues } from '../services/jira.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

export async function renderReport(reportType) {
  const creds = getCredentials();
  if (!creds) {
    navigate('/login');
    return;
  }

  const app = document.getElementById('app');
  renderAppShell(app, reportType);

  if (reportType === 'jql') {
    updateBreadcrumbs([{ label: 'JQL Query' }]);
    renderJQLView(document.getElementById('page-content'));
  } else {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div class="empty-state"><p class="empty-state-title">Unknown report type</p></div>`;
  }
}

/* ── JQL Query View ──────────────────────────────── */
function renderJQLView(content) {
  content.innerHTML = `
    <div class="page-header" id="jql-header">
      <h1 class="page-title">JQL Query</h1>
      <p class="page-subtitle">Run custom JQL queries and view results</p>
    </div>

    <div class="card" id="jql-query-input" style="margin-bottom: var(--ds-space-300);">
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
      <div id="jql-results-summary" style="margin-bottom: var(--ds-space-150); font: var(--ds-font-body-small); color: var(--ds-text-subtle);">
        Showing ${issues.length} of ${result.total || issues.length} results
      </div>
      <div class="table-container" id="jql-results-table">
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
