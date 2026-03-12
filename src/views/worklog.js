/**
 * Work Log View — Cross-project worklog report with multi-user support
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
import { searchAllIssues, getIssueWorklogs, searchUsers, getMyself } from '../services/jira.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

let selectedUsers = [];
let dateFrom = '';
let dateTo = '';
let searchTimeout = null;

export async function renderWorkLog() {
  const creds = getCredentials();
  if (!creds) {
    navigate('/login');
    return;
  }

  const app = document.getElementById('app');
  renderAppShell(app, 'worklog');
  updateBreadcrumbs([{ label: 'Work Log' }]);

  // Set default date range (this week: Monday to Sunday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  dateFrom = formatDate(monday);
  dateTo = formatDate(sunday);

  // Add current user by default
  const savedUser = getSavedUser();
  selectedUsers = [];
  if (savedUser) {
    selectedUsers.push({
      accountId: savedUser.accountId,
      displayName: savedUser.displayName,
      emailAddress: savedUser.emailAddress || '',
    });
  }

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Work Log</h1>
      <p class="page-subtitle">Aggregated work logs across all projects</p>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom: var(--ds-space-300);">
      <div style="display: flex; flex-wrap: wrap; gap: var(--ds-space-300); align-items: flex-end;">
        
        <!-- User Selector -->
        <div class="form-group" style="flex: 1; min-width: 280px;">
          <label class="form-label">Users</label>
          <div id="user-chips" style="display: flex; flex-wrap: wrap; gap: var(--ds-space-075); margin-bottom: var(--ds-space-100);">
            ${renderUserChips()}
          </div>
          <div style="position: relative;">
            <input class="input" type="text" id="user-search" placeholder="Search and add users..." autocomplete="off" style="padding-left: var(--ds-space-400);" />
            <svg style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ds-icon-subtle);" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <div id="user-dropdown" class="user-dropdown" style="display: none;"></div>
          </div>
        </div>

        <!-- Date Range -->
        <div class="form-group" style="min-width: 160px;">
          <label class="form-label" for="date-from">From</label>
          <input class="input" type="date" id="date-from" value="${dateFrom}" />
        </div>
        <div class="form-group" style="min-width: 160px;">
          <label class="form-label" for="date-to">To</label>
          <input class="input" type="date" id="date-to" value="${dateTo}" />
        </div>

        <button class="btn btn-primary" id="generate-btn" style="height: 36px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Generate Report
        </button>
      </div>
    </div>

    <!-- Results -->
    <div id="worklog-results"></div>
  `;

  // Inject custom styles for this view
  injectWorklogStyles();

  // Event listeners
  document.getElementById('date-from').addEventListener('change', (e) => { dateFrom = e.target.value; });
  document.getElementById('date-to').addEventListener('change', (e) => { dateTo = e.target.value; });
  document.getElementById('generate-btn').addEventListener('click', generateWorklogReport);

  // User search
  const searchInput = document.getElementById('user-search');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      document.getElementById('user-dropdown').style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(() => searchAndShowUsers(query), 300);
  });

  searchInput.addEventListener('focus', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) searchAndShowUsers(query);
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-search') && !e.target.closest('#user-dropdown')) {
      document.getElementById('user-dropdown').style.display = 'none';
    }
  });

  // Auto-generate on load
  if (selectedUsers.length > 0) {
    generateWorklogReport();
  }
}

function renderUserChips() {
  return selectedUsers.map((user, i) => `
    <span class="user-chip" data-index="${i}">
      <span class="avatar avatar-sm" style="width: 20px; height: 20px; font-size: 10px;">${user.displayName.charAt(0).toUpperCase()}</span>
      <span>${user.displayName}</span>
      <button class="user-chip-remove" data-index="${i}" aria-label="Remove ${user.displayName}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </span>
  `).join('');
}

function refreshUserChips() {
  const container = document.getElementById('user-chips');
  if (!container) return;
  container.innerHTML = renderUserChips();

  // Re-attach remove handlers
  container.querySelectorAll('.user-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      selectedUsers.splice(idx, 1);
      refreshUserChips();
    });
  });
}

async function searchAndShowUsers(query) {
  const dropdown = document.getElementById('user-dropdown');
  try {
    const users = await searchUsers(query);
    const filtered = users.filter(u =>
      u.accountType === 'atlassian' &&
      !selectedUsers.some(s => s.accountId === u.accountId)
    );

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="user-dropdown-empty">No users found</div>`;
    } else {
      dropdown.innerHTML = filtered.map(u => `
        <button class="user-dropdown-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}">
          <span class="avatar avatar-sm" style="width: 24px; height: 24px; font-size: 11px;">${u.displayName.charAt(0).toUpperCase()}</span>
          <div>
            <div style="font: var(--ds-font-body); font-weight: var(--ds-font-weight-medium);">${u.displayName}</div>
            ${u.emailAddress ? `<div style="font: var(--ds-font-body-small); color: var(--ds-text-subtlest);">${u.emailAddress}</div>` : ''}
          </div>
        </button>
      `).join('');
    }
    dropdown.style.display = '';

    dropdown.querySelectorAll('.user-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        selectedUsers.push({
          accountId: item.dataset.accountId,
          displayName: item.dataset.name,
          emailAddress: item.dataset.email,
        });
        refreshUserChips();
        document.getElementById('user-search').value = '';
        dropdown.style.display = 'none';
      });
    });
  } catch (err) {
    dropdown.innerHTML = `<div class="user-dropdown-empty">Error searching users</div>`;
    dropdown.style.display = '';
  }
}

async function generateWorklogReport() {
  const resultsDiv = document.getElementById('worklog-results');

  if (selectedUsers.length === 0) {
    showToast('warning', 'Please add at least one user');
    return;
  }
  if (!dateFrom || !dateTo) {
    showToast('warning', 'Please select a date range');
    return;
  }

  resultsDiv.innerHTML = `
    <div class="loading-screen">
      <div class="spinner spinner-lg"></div>
      <p>Fetching work logs...</p>
    </div>
  `;

  try {
    // Build JQL to find issues with worklogs by selected users in date range
    const userAccountIds = selectedUsers.map(u => `"${u.accountId}"`).join(', ');
    const jql = `worklogAuthor in (${userAccountIds}) AND worklogDate >= "${dateFrom}" AND worklogDate <= "${dateTo}" ORDER BY updated DESC`;

    const issues = await searchAllIssues(jql, 'summary,project,status,issuetype,assignee');

    if (!issues.length) {
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="empty-state-title">No work logs found</p>
          <p class="empty-state-description">No work was logged by the selected users in this date range.</p>
        </div>
      `;
      return;
    }

    // Fetch worklogs for each issue
    const issueWorklogs = [];
    for (const issue of issues) {
      try {
        const worklogs = await getIssueWorklogs(issue.key);
        // Filter worklogs to selected users and date range
        const filtered = worklogs.filter(wl => {
          const wlDate = wl.started?.substring(0, 10);
          const isInDateRange = wlDate >= dateFrom && wlDate <= dateTo;
          const isSelectedUser = selectedUsers.some(u => u.accountId === wl.author?.accountId);
          return isInDateRange && isSelectedUser;
        });

        if (filtered.length > 0) {
          issueWorklogs.push({
            issue,
            worklogs: filtered,
            totalSeconds: filtered.reduce((sum, wl) => sum + (wl.timeSpentSeconds || 0), 0),
          });
        }
      } catch {
        // Skip issues where worklog fetch fails
      }
    }

    if (!issueWorklogs.length) {
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="empty-state-title">No matching work logs</p>
          <p class="empty-state-description">Found issues but no work logs match the selected users and date range.</p>
        </div>
      `;
      return;
    }

    // Calculate totals
    const grandTotalSeconds = issueWorklogs.reduce((sum, iw) => sum + iw.totalSeconds, 0);

    // Per-user totals
    const userTotals = {};
    issueWorklogs.forEach(iw => {
      iw.worklogs.forEach(wl => {
        const userId = wl.author?.accountId;
        const userName = wl.author?.displayName || 'Unknown';
        if (!userTotals[userId]) userTotals[userId] = { name: userName, seconds: 0 };
        userTotals[userId].seconds += wl.timeSpentSeconds || 0;
      });
    });

    // Per-day totals
    const dayTotals = {};
    issueWorklogs.forEach(iw => {
      iw.worklogs.forEach(wl => {
        const day = wl.started?.substring(0, 10);
        if (!dayTotals[day]) dayTotals[day] = 0;
        dayTotals[day] += wl.timeSpentSeconds || 0;
      });
    });

    // Build user × day matrix for timesheet
    const userDayMatrix = {};
    issueWorklogs.forEach(iw => {
      iw.worklogs.forEach(wl => {
        const userId = wl.author?.accountId;
        const userName = wl.author?.displayName || 'Unknown';
        const day = wl.started?.substring(0, 10);
        if (!userDayMatrix[userId]) userDayMatrix[userId] = { name: userName, days: {} };
        if (!userDayMatrix[userId].days[day]) userDayMatrix[userId].days[day] = 0;
        userDayMatrix[userId].days[day] += wl.timeSpentSeconds || 0;
      });
    });

    // Generate all dates in selected range (so zero-log days show too)
    const allDaysInRange = [];
    const rangeStart = new Date(dateFrom + 'T00:00:00');
    const rangeEnd = new Date(dateTo + 'T00:00:00');
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
      allDaysInRange.push(d.toISOString().split('T')[0]);
    }

    const creds = getCredentials();
    const jiraUrl = creds?.jiraUrl || '';

    // Sort by date
    const sortedDays = Object.keys(dayTotals).sort();

    resultsDiv.innerHTML = `
      <!-- Summary Stats -->
      <div class="stat-grid" style="margin-bottom: var(--ds-space-300);">
        <div class="stat-card">
          <div class="stat-card-label">Total Time Logged</div>
          <div class="stat-card-value">${formatDuration(grandTotalSeconds)}</div>
          <div class="stat-card-change" style="color: var(--ds-text-subtlest);">${formatHoursDecimal(grandTotalSeconds)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Issues Worked On</div>
          <div class="stat-card-value">${issueWorklogs.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Work Log Entries</div>
          <div class="stat-card-value">${issueWorklogs.reduce((sum, iw) => sum + iw.worklogs.length, 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Avg / Day</div>
          <div class="stat-card-value">${formatDuration(Math.round(grandTotalSeconds / Math.max(sortedDays.length, 1)))}</div>
        </div>
      </div>

      <!-- Timesheet Matrix: Users × Days -->
      <div class="card" style="margin-bottom: var(--ds-space-300);">
        <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-200);">Daily Timesheet</h3>
        <div class="table-container">
          <table class="table wl-matrix-table">
            <thead>
              <tr>
                <th class="wl-matrix-user-col">Team Member</th>
                ${allDaysInRange.map(day => {
                  const d = new Date(day + 'T00:00:00');
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return `<th class="wl-matrix-day-col ${isWeekend ? 'wl-weekend' : ''}" title="${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}">
                    <div class="wl-day-header">
                      <span class="wl-day-name">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span class="wl-day-date">${d.getDate()}</span>
                    </div>
                  </th>`;
                }).join('')}
                <th class="wl-matrix-total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(userDayMatrix).map(([userId, userData]) => {
                const rowTotal = Object.values(userData.days).reduce((s, v) => s + v, 0);
                return `
                  <tr>
                    <td class="wl-matrix-user-cell">
                      <div style="display: flex; align-items: center; gap: var(--ds-space-100);">
                        <span class="avatar avatar-sm" style="width: 24px; height: 24px; font-size: 11px; flex-shrink: 0;">${userData.name.charAt(0).toUpperCase()}</span>
                        <span style="font-weight: var(--ds-font-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${userData.name}</span>
                      </div>
                    </td>
                    ${allDaysInRange.map(day => {
                      const seconds = userData.days[day] || 0;
                      const hours = seconds / 3600;
                      const isWeekend = new Date(day + 'T00:00:00').getDay() % 6 === 0;
                      let cellClass = isWeekend ? 'wl-weekend' : '';
                      if (seconds > 0) {
                        if (hours >= 8) cellClass += ' wl-cell-full';
                        else if (hours >= 4) cellClass += ' wl-cell-half';
                        else cellClass += ' wl-cell-light';
                      }
                      return `<td class="wl-matrix-cell ${cellClass}" title="${userData.name}: ${formatDuration(seconds)} on ${day}">
                        ${seconds > 0 ? formatDurationCompact(seconds) : '<span class="wl-cell-empty">—</span>'}
                      </td>`;
                    }).join('')}
                    <td class="wl-matrix-total-cell">${formatDuration(rowTotal)}<div class="wl-cell-hours">${formatHoursDecimal(rowTotal)}</div></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="wl-matrix-footer-row">
                <td style="font-weight: var(--ds-font-weight-semibold);">Total</td>
                ${allDaysInRange.map(day => {
                  const colTotal = Object.values(userDayMatrix).reduce((s, u) => s + (u.days[day] || 0), 0);
                  const isWeekend = new Date(day + 'T00:00:00').getDay() % 6 === 0;
                  return `<td class="wl-matrix-cell ${isWeekend ? 'wl-weekend' : ''}" style="font-weight: var(--ds-font-weight-semibold);">
                    ${colTotal > 0 ? formatDurationCompact(colTotal) : '—'}
                  </td>`;
                }).join('')}
                <td class="wl-matrix-total-cell" style="font-weight: var(--ds-font-weight-bold);">${formatDuration(grandTotalSeconds)}<div class="wl-cell-hours">${formatHoursDecimal(grandTotalSeconds)}</div></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Issue Details (Expandable) -->
      <div class="card">
        <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-200);">Task Details</h3>
        <div id="worklog-accordion">
          ${issueWorklogs.sort((a, b) => b.totalSeconds - a.totalSeconds).map((iw, idx) => `
            <div class="wl-accordion-item">
              <button class="wl-accordion-header" data-idx="${idx}" aria-expanded="false">
                <div class="wl-accordion-left">
                  <svg class="wl-accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  <span class="lozenge ${getStatusLozengeClass(iw.issue.fields?.status?.statusCategory?.key)}" style="flex-shrink: 0;">${iw.issue.fields?.status?.name || ''}</span>
                  <a href="${jiraUrl}/browse/${iw.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${iw.issue.key}</a>
                  <span class="wl-issue-summary">${iw.issue.fields?.summary || ''}</span>
                </div>
                <div class="wl-accordion-right">
                  <span class="lozenge lozenge-default" style="flex-shrink: 0;">${iw.issue.fields?.project?.name || iw.issue.fields?.project?.key || ''}</span>
                  <span class="wl-time-badge">${formatDuration(iw.totalSeconds)}</span>
                </div>
              </button>
              <div class="wl-accordion-body" id="wl-body-${idx}" style="display: none;">
                <table class="table" style="margin: 0;">
                  <thead><tr><th>Author</th><th>Date</th><th>Time Spent</th><th>Comment</th></tr></thead>
                  <tbody>
                    ${iw.worklogs.sort((a, b) => new Date(a.started) - new Date(b.started)).map(wl => `
                      <tr>
                        <td>
                          <div style="display: flex; align-items: center; gap: var(--ds-space-075);">
                            <span class="avatar avatar-sm" style="width: 20px; height: 20px; font-size: 10px;">${(wl.author?.displayName || '?').charAt(0).toUpperCase()}</span>
                            <span style="font: var(--ds-font-body-small);">${wl.author?.displayName || 'Unknown'}</span>
                          </div>
                        </td>
                        <td style="font: var(--ds-font-body-small); white-space: nowrap;">${wl.started ? new Date(wl.started).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
                        <td style="font-weight: var(--ds-font-weight-medium);">${wl.timeSpent || formatDuration(wl.timeSpentSeconds || 0)}</td>
                        <td style="font: var(--ds-font-body-small); color: var(--ds-text-subtle); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${extractComment(wl.comment) || '—'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Accordion toggle handlers
    document.querySelectorAll('.wl-accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const idx = header.dataset.idx;
        const body = document.getElementById(`wl-body-${idx}`);
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        header.setAttribute('aria-expanded', !isOpen);
        header.classList.toggle('expanded', !isOpen);
      });
    });

  } catch (err) {
    showToast('error', 'Failed to generate report', err.message);
    resultsDiv.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <p class="empty-state-title">Report generation failed</p>
        <p class="empty-state-description">${err.message}</p>
      </div>
    `;
  }
}

/* ── Helpers ──────────────────────────────────────── */

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatHoursDecimal(seconds) {
  return (seconds / 3600).toFixed(1) + 'h';
}

function formatDurationCompact(seconds) {
  if (!seconds || seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

function getStatusLozengeClass(statusCategoryKey) {
  if (statusCategoryKey === 'done') return 'lozenge-success';
  if (statusCategoryKey === 'indeterminate') return 'lozenge-info';
  return 'lozenge-default';
}

function extractComment(comment) {
  if (!comment) return '';
  if (typeof comment === 'string') return comment;
  // Jira ADF format
  if (comment.content) {
    return comment.content
      .map(block => {
        if (block.content) {
          return block.content.map(inline => inline.text || '').join('');
        }
        return '';
      })
      .join(' ')
      .trim();
  }
  return '';
}

function injectWorklogStyles() {
  if (document.getElementById('worklog-styles')) return;
  const style = document.createElement('style');
  style.id = 'worklog-styles';
  style.textContent = `
    /* User chips */
    .user-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--ds-space-075);
      padding: var(--ds-space-025) var(--ds-space-075) var(--ds-space-025) var(--ds-space-050);
      background: var(--ds-background-neutral);
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text);
      white-space: nowrap;
    }
    .user-chip-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      background: none;
      border: none;
      border-radius: var(--ds-radius-round);
      cursor: pointer;
      color: var(--ds-icon-subtle);
      padding: 0;
    }
    .user-chip-remove:hover {
      background: var(--ds-background-neutral-hovered);
      color: var(--ds-text-danger);
    }

    /* User dropdown */
    .user-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--ds-surface-overlay);
      border-radius: var(--ds-radius-200);
      box-shadow: var(--ds-shadow-overlay);
      z-index: 300;
      max-height: 240px;
      overflow-y: auto;
      margin-top: var(--ds-space-050);
    }
    .user-dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      padding: var(--ds-space-100) var(--ds-space-150);
      width: 100%;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
      color: var(--ds-text);
      transition: background-color var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .user-dropdown-item:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .user-dropdown-empty {
      padding: var(--ds-space-200);
      text-align: center;
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtlest);
    }

    /* Accordion */
    .wl-accordion-item {
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      margin-bottom: var(--ds-space-100);
      overflow: hidden;
    }
    .wl-accordion-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-150);
      width: 100%;
      padding: var(--ds-space-150) var(--ds-space-200);
      background: var(--ds-surface);
      border: none;
      cursor: pointer;
      text-align: left;
      color: var(--ds-text);
      transition: background-color var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-accordion-header:hover {
      background: var(--ds-surface-hovered);
    }
    .wl-accordion-left {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      min-width: 0;
      flex: 1;
    }
    .wl-accordion-right {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      flex-shrink: 0;
    }
    .wl-accordion-chevron {
      flex-shrink: 0;
      color: var(--ds-icon-subtle);
      transition: transform var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-accordion-header.expanded .wl-accordion-chevron {
      transform: rotate(180deg);
    }
    .wl-issue-key {
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
      color: var(--ds-link);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .wl-issue-key:hover {
      text-decoration: underline;
    }
    .wl-issue-summary {
      font: var(--ds-font-body);
      color: var(--ds-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wl-time-badge {
      display: inline-flex;
      align-items: center;
      padding: var(--ds-space-025) var(--ds-space-100);
      background: var(--ds-background-brand-subtlest);
      color: var(--ds-text-brand);
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-semibold);
      white-space: nowrap;
    }
    .wl-accordion-body {
      border-top: 1px solid var(--ds-border);
      background: var(--ds-surface-sunken);
    }
    .wl-accordion-body .table {
      margin: 0;
    }
    .wl-accordion-body .table th {
      background: var(--ds-surface-sunken);
    }

    /* Matrix table */
    .wl-matrix-table {
      border-collapse: separate;
      border-spacing: 0;
    }
    .wl-matrix-user-col {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--ds-surface) !important;
      min-width: 160px;
      max-width: 200px;
    }
    .wl-matrix-user-cell {
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--ds-surface) !important;
    }
    .wl-matrix-day-col {
      text-align: center;
      min-width: 64px;
      padding: var(--ds-space-075) var(--ds-space-050) !important;
    }
    .wl-day-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
    }
    .wl-day-name {
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 10px;
      color: var(--ds-text-subtlest);
    }
    .wl-day-date {
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
    }
    .wl-matrix-cell {
      text-align: center;
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      padding: var(--ds-space-100) var(--ds-space-050) !important;
      white-space: nowrap;
      transition: background-color var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-matrix-total-col,
    .wl-matrix-total-cell {
      text-align: center;
      font-weight: var(--ds-font-weight-semibold);
      background: var(--ds-background-neutral-subtle) !important;
      min-width: 72px;
    }
    .wl-cell-hours {
      font: var(--ds-font-body-small);
      font-size: 10px;
      color: var(--ds-text-subtlest);
      font-weight: 400;
    }
    .wl-cell-empty {
      color: var(--ds-text-disabled);
    }
    .wl-cell-full {
      background: var(--ds-background-success) !important;
      color: var(--ds-text-success);
    }
    .wl-cell-half {
      background: var(--ds-background-warning) !important;
      color: var(--ds-text-warning);
    }
    .wl-cell-light {
      background: var(--ds-background-neutral-subtle) !important;
    }
    .wl-weekend {
      background: var(--ds-background-neutral) !important;
      opacity: 0.7;
    }
    .wl-matrix-footer-row td {
      background: var(--ds-surface-sunken) !important;
    }
    .wl-matrix-footer-row .wl-matrix-cell {
      font-weight: var(--ds-font-weight-semibold) !important;
    }

    @media (max-width: 768px) {
      .wl-accordion-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .wl-accordion-right {
        margin-left: var(--ds-space-300);
      }
    }
  `;
  document.head.appendChild(style);
}
