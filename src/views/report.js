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

    <div class="card mb-300" id="jql-query-input">
      <div class="form-group">
        <label class="form-label" for="jql-input">JQL Query</label>
        <div class="jql-input-row">
          <input class="input flex-1" type="text" id="jql-input" placeholder='project = "PROJ" AND status = "In Progress" ORDER BY created DESC' />
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
      <div class="jql-results-summary" id="jql-results-summary">
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
                  <td><a href="${getCredentials()?.url}/browse/${issue.key}" target="_blank" rel="noopener" class="issue-key-link">${issue.key}</a></td>
                  <td class="issue-summary-cell">${issue.fields?.summary || ''}</td>
                  <td><span class="lozenge ${lozengeClass}">${issue.fields?.status?.name || ''}</span></td>
                  <td>${issue.fields?.issuetype?.name || ''}</td>
                  <td>${issue.fields?.priority?.name || ''}</td>
                  <td>
                    ${issue.fields?.assignee
                      ? `<div class="assignee-cell"><div class="avatar avatar-sm">${issue.fields.assignee.displayName?.charAt(0) || '?'}</div><span class="text-body-small">${issue.fields.assignee.displayName}</span></div>`
                      : '<span class="unassigned-text">Unassigned</span>'
                    }
                  </td>
                  <td class="date-cell">${issue.fields?.created ? new Date(issue.fields.created).toLocaleDateString() : ''}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    resultsDiv.innerHTML = `
      <div class="jql-error-box">
        <p class="jql-error-title">Query failed</p>
        <p class="jql-error-message">${err.message}</p>
      </div>
    `;
  }
}
