/**
 * Work Log View — Cross-project worklog report with multi-user support
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
import { searchAllIssues, getIssueWorklogs, searchUsers, getMyself } from '../services/jira.js';
import { getSettings, getGroups, getExpectedHours, isWorkday } from '../services/settings.js';
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

  // Set default date range (current month)
  const now = new Date();
  dateFrom = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  dateTo = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

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
    <div class="page-header" id="worklog-header">
      <h1 class="page-title">Work Log</h1>
      <p class="page-subtitle">Aggregated work logs across all projects</p>
    </div>

    <!-- Filters -->
    <div class="card" id="worklog-filters" style="margin-bottom: var(--ds-space-300);">
      <div style="display: flex; flex-wrap: wrap; gap: var(--ds-space-300); align-items: flex-end;">
        
        <!-- User Selector -->
        <div class="form-group" id="worklog-user-selector" style="flex: 1; min-width: 280px;">
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
        <div class="form-group" id="worklog-date-range" style="min-width: 200px;">
          <label class="form-label">Period</label>
          <select class="input" id="date-preset">
            <optgroup label="Quick">
              <option value="this-week">This Week</option>
              <option value="last-week">Last Week</option>
            </optgroup>
            <optgroup label="Month">
              ${generateMonthOptions()}
            </optgroup>
            <option value="custom">Custom Date</option>
          </select>
        </div>
        <div class="form-group" id="worklog-date-custom" style="display: none; min-width: 140px;">
          <label class="form-label" for="date-from">From</label>
          <input class="input" type="date" id="date-from" value="${dateFrom}" />
        </div>
        <div class="form-group" id="worklog-date-custom-to" style="display: none; min-width: 140px;">
          <label class="form-label" for="date-to">To</label>
          <input class="input" type="date" id="date-to" value="${dateTo}" />
        </div>

        <button class="btn btn-primary" id="generate-btn" style="height: 36px;">
          Generate Report
        </button>
      </div>
    </div>

    <!-- Results -->
    <div id="worklog-results"></div>
  `;

  // Inject custom styles for this view
  injectWorklogStyles();

  // Date preset handler
  const presetSelect = document.getElementById('date-preset');
  const customFrom = document.getElementById('worklog-date-custom');
  const customTo = document.getElementById('worklog-date-custom-to');

  // Set default selection to current month
  const currentMonthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  presetSelect.value = currentMonthValue;

  presetSelect.addEventListener('change', () => {
    const val = presetSelect.value;
    if (val === 'custom') {
      customFrom.style.display = '';
      customTo.style.display = '';
    } else {
      customFrom.style.display = 'none';
      customTo.style.display = 'none';
      applyDatePreset(val);
    }
  });

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
    // Search Jira users
    const users = await searchUsers(query);
    const filtered = users.filter(u =>
      u.accountType === 'atlassian' &&
      !selectedUsers.some(s => s.accountId === u.accountId)
    );

    // Also search saved groups
    const groups = getGroups();
    const matchingGroups = groups.filter(g =>
      g.name.toLowerCase().includes(query.toLowerCase()) && g.users.length > 0
    );

    let html = '';

    // Groups section
    if (matchingGroups.length > 0) {
      html += matchingGroups.map(g => `
        <button class="user-dropdown-item user-dropdown-group" data-group-id="${g.id}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: var(--ds-icon-subtle);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>
            <div style="font: var(--ds-font-body); font-weight: var(--ds-font-weight-medium);">${g.name}</div>
            <div style="font: var(--ds-font-body-small); color: var(--ds-text-subtlest);">${g.users.length} member${g.users.length !== 1 ? 's' : ''}</div>
          </div>
        </button>
      `).join('');
      if (filtered.length > 0) {
        html += '<div style="border-top: 1px solid var(--ds-border); margin: 4px 0;"></div>';
      }
    }

    // Individual users
    if (filtered.length > 0) {
      html += filtered.map(u => `
        <button class="user-dropdown-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}" data-avatar="${u.avatarUrls?.['24x24'] || ''}">
          ${u.avatarUrls?.['24x24']
            ? `<img src="${u.avatarUrls['24x24']}" alt="" style="width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;" />`
            : `<span class="avatar avatar-sm" style="width: 24px; height: 24px; font-size: 11px;">${u.displayName.charAt(0).toUpperCase()}</span>`
          }
          <div>
            <div style="font: var(--ds-font-body); font-weight: var(--ds-font-weight-medium);">${u.displayName}</div>
            ${u.emailAddress ? `<div style="font: var(--ds-font-body-small); color: var(--ds-text-subtlest);">${u.emailAddress}</div>` : ''}
          </div>
        </button>
      `).join('');
    }

    if (!html) {
      html = '<div class="user-dropdown-empty">No users or groups found</div>';
    }

    dropdown.innerHTML = html;
    dropdown.style.display = '';

    // Click handler for group items
    dropdown.querySelectorAll('.user-dropdown-group').forEach(item => {
      item.addEventListener('click', () => {
        const gid = item.dataset.groupId;
        const group = groups.find(g => g.id === gid);
        if (group) {
          group.users.forEach(u => {
            if (!selectedUsers.some(s => s.accountId === u.accountId)) {
              selectedUsers.push({
                accountId: u.accountId,
                displayName: u.displayName,
                avatarUrl: u.avatarUrl || '',
              });
            }
          });
          refreshUserChips();
          document.getElementById('user-search').value = '';
          dropdown.style.display = 'none';
        }
      });
    });

    // Click handler for individual user items
    dropdown.querySelectorAll('.user-dropdown-item:not(.user-dropdown-group)').forEach(item => {
      item.addEventListener('click', () => {
        selectedUsers.push({
          accountId: item.dataset.accountId,
          displayName: item.dataset.name,
          emailAddress: item.dataset.email,
          avatarUrl: item.dataset.avatar || '',
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

    // Build per-user data for individual tabs
    const perUserData = {};
    selectedUsers.forEach(u => {
      const userId = u.accountId;
      const userIssues = [];
      issueWorklogs.forEach(iw => {
        const userWls = iw.worklogs.filter(wl => wl.author?.accountId === userId);
        if (userWls.length > 0) {
          userIssues.push({
            issue: iw.issue,
            worklogs: userWls,
            totalSeconds: userWls.reduce((s, wl) => s + (wl.timeSpentSeconds || 0), 0),
          });
        }
      });
      const totalSec = userIssues.reduce((s, iw) => s + iw.totalSeconds, 0);
      const userDays = {};
      userIssues.forEach(iw => {
        iw.worklogs.forEach(wl => {
          const day = wl.started?.substring(0, 10);
          if (!userDays[day]) userDays[day] = 0;
          userDays[day] += wl.timeSpentSeconds || 0;
        });
      });
      const daysWithLog = Object.keys(userDays).sort();
      perUserData[userId] = { name: u.displayName, issues: userIssues, totalSeconds: totalSec, days: userDays, daysWithLog };
    });

    // Build tab bar
    const tabIds = ['all', ...selectedUsers.map(u => u.accountId)];
    const tabLabels = ['All Users', ...selectedUsers.map(u => u.displayName)];

    resultsDiv.innerHTML = `
      <!-- Tab Bar -->
      <div class="wl-tabs" id="wl-tabs">
        ${tabIds.map((id, i) => `
          <button class="wl-tab ${i === 0 ? 'active' : ''}" data-tab="${id}">
            ${i === 0 ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` : `<span class="avatar avatar-sm" style="width:18px;height:18px;font-size:9px;flex-shrink:0;">${tabLabels[i].charAt(0).toUpperCase()}</span>`}
            <span>${tabLabels[i]}</span>
          </button>
        `).join('')}
      </div>

      <!-- Tab Panels -->
      ${tabIds.map((id, i) => `
        <div class="wl-tab-panel ${i === 0 ? 'active' : ''}" data-panel="${id}">
          ${id === 'all' ? renderAllUsersPanel(grandTotalSeconds, issueWorklogs, sortedDays, allDaysInRange, userDayMatrix, jiraUrl) : renderUserPanel(perUserData[id], allDaysInRange, jiraUrl, id)}
        </div>
      `).join('')}
    `;

    // Tab switching
    document.getElementById('wl-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.wl-tab');
      if (!tab) return;
      const targetId = tab.dataset.tab;
      document.querySelectorAll('.wl-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === targetId));
      document.querySelectorAll('.wl-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === targetId));
    });

    // Accordion toggle handlers (use event delegation)
    resultsDiv.addEventListener('click', (e) => {
      const header = e.target.closest('.wl-accordion-header');
      if (!header) return;
      const idx = header.dataset.idx;
      const body = document.getElementById(`wl-body-${idx}`);
      if (!body) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      header.setAttribute('aria-expanded', !isOpen);
      header.classList.toggle('expanded', !isOpen);
    });

    // Initialize calendars for each user tab
    initCalendars(perUserData, issueWorklogs, jiraUrl);

    // Task search/status filter handlers
    resultsDiv.addEventListener('input', (e) => {
      if (e.target.classList.contains('wl-task-search')) {
        filterTasks(e.target.dataset.tab);
      }
    });
    resultsDiv.addEventListener('change', (e) => {
      if (e.target.classList.contains('wl-task-status-filter')) {
        filterTasks(e.target.dataset.tab);
      }
    });

    // Day modal close
    resultsDiv.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('.wl-day-modal-close');
      const overlay = e.target.closest('.wl-day-modal-overlay');
      if (closeBtn) {
        const modal = document.getElementById(`day-modal-${closeBtn.dataset.tab}`);
        if (modal) modal.style.display = 'none';
      } else if (overlay && !e.target.closest('.wl-day-modal')) {
        overlay.style.display = 'none';
      }
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

/* ── Panel Renderers ──────────────────────────────── */

function renderAllUsersPanel(grandTotalSeconds, issueWorklogs, sortedDays, allDaysInRange, userDayMatrix, jiraUrl) {
  const totalEntries = issueWorklogs.reduce((sum, iw) => sum + iw.worklogs.length, 0);
  return `
    <!-- Combined Stats -->
    <div class="stat-grid" id="all-users-stats" style="margin-bottom: var(--ds-space-300);">
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
        <div class="stat-card-value">${totalEntries}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Avg / Day</div>
        <div class="stat-card-value">${formatDuration(Math.round(grandTotalSeconds / Math.max(sortedDays.length, 1)))}</div>
      </div>
    </div>

    <!-- Timesheet Matrix -->
    <div class="card" id="all-users-timesheet" style="margin-bottom: var(--ds-space-300);">
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
  `;
}

function renderUserPanel(userData, allDaysInRange, jiraUrl, tabId) {
  if (!userData || userData.issues.length === 0) {
    return `<div class="empty-state"><p class="empty-state-title">No work logs</p><p class="empty-state-description">No work was logged by this user in the selected date range.</p></div>`;
  }

  const { name, issues, totalSeconds, days, daysWithLog } = userData;
  const totalEntries = issues.reduce((s, iw) => s + iw.worklogs.length, 0);
  const expectedHours = getExpectedHours();

  // Collect all unique statuses for filter
  const allStatuses = [...new Set(issues.map(iw => iw.issue.fields?.status?.name).filter(Boolean))];

  return `
    <!-- User Stats -->
    <div class="stat-grid" id="user-stats-${tabId}" style="margin-bottom: var(--ds-space-300);">
      <div class="stat-card">
        <div class="stat-card-label">Time Logged</div>
        <div class="stat-card-value">${formatDuration(totalSeconds)}</div>
        <div class="stat-card-change" style="color: var(--ds-text-subtlest);">${formatHoursDecimal(totalSeconds)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Issues Worked On</div>
        <div class="stat-card-value">${issues.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Log Entries</div>
        <div class="stat-card-value">${totalEntries}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Avg / Day</div>
        <div class="stat-card-value">${formatDuration(Math.round(totalSeconds / Math.max(daysWithLog.length, 1)))}</div>
      </div>
    </div>

    <!-- Daily Calendar -->
    <div class="card" id="user-daily-${tabId}" style="margin-bottom: var(--ds-space-300);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--ds-space-200); flex-wrap: wrap; gap: var(--ds-space-100);">
        <h3 style="font: var(--ds-font-heading-small); margin: 0;">Daily Breakdown</h3>
        <div style="display: flex; align-items: center; gap: var(--ds-space-100);">
          <div class="wl-cal-nav">
            <button class="btn btn-subtle btn-icon-only wl-cal-prev" data-tab="${tabId}" title="Previous" style="width: 28px; height: 28px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="wl-cal-label" id="cal-label-${tabId}"></span>
            <button class="btn btn-subtle btn-icon-only wl-cal-next" data-tab="${tabId}" title="Next" style="width: 28px; height: 28px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="wl-cal-view-toggle">
            <button class="wl-cal-view-btn active" data-view="month" data-tab="${tabId}">Month</button>
            <button class="wl-cal-view-btn" data-view="week" data-tab="${tabId}">Week</button>
          </div>
        </div>
      </div>
      <div class="wl-calendar-grid" id="cal-grid-${tabId}" data-days='${JSON.stringify(days)}' data-expected="${expectedHours}"></div>
      <div class="wl-cal-legend" style="margin-top: var(--ds-space-150);">
        <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot" style="background: var(--ds-background-success);"></span> ≥ ${expectedHours}h</span>
        <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot" style="background: var(--ds-background-warning);"></span> &lt; ${expectedHours}h</span>
        <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot" style="background: var(--ds-background-danger);"></span> No log (workday)</span>
        <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot" style="background: var(--ds-background-neutral);"></span> Holiday</span>
      </div>
    </div>

    <!-- Day Detail Modal (hidden) -->
    <div class="wl-day-modal-overlay" id="day-modal-${tabId}" style="display: none;">
      <div class="wl-day-modal">
        <div class="wl-day-modal-header">
          <h3 id="day-modal-title-${tabId}" style="font: var(--ds-font-heading-small); margin: 0;"></h3>
          <button class="btn btn-subtle btn-icon-only wl-day-modal-close" data-tab="${tabId}" style="width: 28px; height: 28px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="day-modal-content-${tabId}"></div>
      </div>
    </div>

    <!-- Task Details -->
    <div class="card" id="user-tasks-${tabId}">
      <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-150);">Task Details</h3>
      <div style="display: flex; gap: var(--ds-space-100); margin-bottom: var(--ds-space-200); flex-wrap: wrap;">
        <input class="input wl-task-search" data-tab="${tabId}" type="text" placeholder="Search by task name or key..." style="flex: 1; min-width: 200px; height: 32px; font-size: 13px;" />
        <select class="input wl-task-status-filter" data-tab="${tabId}" style="width: auto; min-width: 140px; height: 32px; font-size: 13px;">
          <option value="">All statuses</option>
          ${allStatuses.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <div class="wl-task-list" data-tab="${tabId}">
        ${renderTaskAccordionItems(issues, jiraUrl, tabId)}
      </div>
    </div>
  `;
}

function renderTaskAccordionItems(issues, jiraUrl, tabId) {
  return issues.sort((a, b) => b.totalSeconds - a.totalSeconds).map((iw, idx) => {
    const bodyId = `wl-body-${tabId}-${idx}`;
    return `
      <div class="wl-accordion-item" data-task-key="${iw.issue.key}" data-task-summary="${(iw.issue.fields?.summary || '').toLowerCase()}" data-task-status="${iw.issue.fields?.status?.name || ''}">
        <button class="wl-accordion-header" data-idx="${tabId}-${idx}" aria-expanded="false">
          <div class="wl-accordion-left">
            <svg class="wl-accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            <a href="${jiraUrl}/browse/${iw.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${iw.issue.key}</a>
            <span class="wl-issue-summary">${iw.issue.fields?.summary || ''}</span>
          </div>
          <div class="wl-accordion-right">
            <span class="lozenge lozenge-default" style="flex-shrink: 0;">${iw.issue.fields?.project?.name || iw.issue.fields?.project?.key || ''}</span>
            <span class="lozenge ${getStatusLozengeClass(iw.issue.fields?.status?.statusCategory?.key)}" style="flex-shrink: 0;">${iw.issue.fields?.status?.name || ''}</span>
            <span class="wl-time-badge">${formatDuration(iw.totalSeconds)}</span>
          </div>
        </button>
        <div class="wl-accordion-body" id="${bodyId}" style="display: none;">
          <table class="table" style="margin: 0;">
            <thead><tr><th>Date</th><th>Time Spent</th><th>Comment</th></tr></thead>
            <tbody>
              ${iw.worklogs.sort((a, b) => new Date(a.started) - new Date(b.started)).map(wl => `
                <tr>
                  <td style="font: var(--ds-font-body-small); white-space: nowrap;">${wl.started ? new Date(wl.started).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
                  <td style="font-weight: var(--ds-font-weight-medium);">${wl.timeSpent || formatDuration(wl.timeSpentSeconds || 0)}</td>
                  <td style="font: var(--ds-font-body-small); color: var(--ds-text-subtle); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${extractComment(wl.comment) || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Calendar Logic ──────────────────────────────── */

// Store calendar state per tab
const calendarStates = {};

function initCalendars(perUserData, issueWorklogs, jiraUrl) {
  Object.keys(perUserData).forEach(tabId => {
    const gridEl = document.getElementById(`cal-grid-${tabId}`);
    if (!gridEl) return;

    const days = JSON.parse(gridEl.dataset.days || '{}');
    const expected = parseFloat(gridEl.dataset.expected || '7');

    // Determine initial view range from the data
    const now = new Date();
    calendarStates[tabId] = {
      view: 'month',
      year: now.getFullYear(),
      month: now.getMonth(),
      weekStart: getWeekStart(now),
      days,
      expected,
      userData: perUserData[tabId],
      issueWorklogs,
      jiraUrl,
    };

    renderCalendarGrid(tabId);
    attachCalendarNavHandlers(tabId);
  });
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderCalendarGrid(tabId) {
  const state = calendarStates[tabId];
  if (!state) return;

  const gridEl = document.getElementById(`cal-grid-${tabId}`);
  const labelEl = document.getElementById(`cal-label-${tabId}`);
  if (!gridEl || !labelEl) return;

  const { view, year, month, weekStart, days, expected } = state;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let cells = '';
  let datesToRender = [];

  if (view === 'month') {
    labelEl.textContent = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    // Fill in leading empty cells for the first week
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Mon=0 based

    // Add header row
    cells += dayNames.map(d => `<div class="wl-cal-header-cell">${d}</div>`).join('');
    // Add empty cells before month start
    for (let i = 0; i < startDow; i++) cells += '<div class="wl-cal-cell wl-cal-empty"></div>';
    // Fill in days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      datesToRender.push(dateStr);
    }
  } else {
    // Week view
    const ws = new Date(weekStart);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    labelEl.textContent = `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    cells += dayNames.map(d => `<div class="wl-cal-header-cell">${d}</div>`).join('');
    for (let i = 0; i < 7; i++) {
      const dd = new Date(ws);
      dd.setDate(ws.getDate() + i);
      datesToRender.push(formatDate(dd));
    }
  }

  datesToRender.forEach(dateStr => {
    const seconds = days[dateStr] || 0;
    const hours = seconds / 3600;
    const workday = isWorkday(dateStr);
    const d = new Date(dateStr + 'T00:00:00');
    const isToday = formatDate(new Date()) === dateStr;

    let colorClass = '';
    if (!workday) {
      colorClass = 'wl-cal-holiday';
    } else if (hours >= expected) {
      colorClass = 'wl-cal-over';
    } else if (hours > 0) {
      colorClass = 'wl-cal-under';
    } else {
      colorClass = 'wl-cal-zero';
    }

    cells += `
      <div class="wl-cal-cell ${colorClass} ${isToday ? 'wl-cal-today' : ''}" data-date="${dateStr}" data-tab="${tabId}" title="${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${hours > 0 ? formatDuration(seconds) : 'No log'}">
        <div class="wl-cal-date">${d.getDate()}</div>
        <div class="wl-cal-hours">${hours > 0 ? formatHoursDecimal(seconds) : ''}</div>
      </div>
    `;
  });

  gridEl.innerHTML = cells;
  gridEl.classList.toggle('wl-cal-week-view', view === 'week');

  // Day click → modal
  gridEl.querySelectorAll('.wl-cal-cell:not(.wl-cal-empty)').forEach(cell => {
    cell.addEventListener('click', () => {
      const clickedDate = cell.dataset.date;
      const clickedTab = cell.dataset.tab;
      showDayModal(clickedTab, clickedDate);
    });
  });
}

function attachCalendarNavHandlers(tabId) {
  const container = document.getElementById(`user-daily-${tabId}`);
  if (!container) return;

  container.querySelector('.wl-cal-prev')?.addEventListener('click', () => {
    const state = calendarStates[tabId];
    if (state.view === 'month') {
      state.month--;
      if (state.month < 0) { state.month = 11; state.year--; }
    } else {
      const ws = new Date(state.weekStart);
      ws.setDate(ws.getDate() - 7);
      state.weekStart = ws;
    }
    renderCalendarGrid(tabId);
  });

  container.querySelector('.wl-cal-next')?.addEventListener('click', () => {
    const state = calendarStates[tabId];
    if (state.view === 'month') {
      state.month++;
      if (state.month > 11) { state.month = 0; state.year++; }
    } else {
      const ws = new Date(state.weekStart);
      ws.setDate(ws.getDate() + 7);
      state.weekStart = ws;
    }
    renderCalendarGrid(tabId);
  });

  container.querySelectorAll('.wl-cal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = calendarStates[tabId];
      state.view = btn.dataset.view;
      container.querySelectorAll('.wl-cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
      if (state.view === 'week') {
        state.weekStart = getWeekStart(new Date(state.year, state.month, 1));
      }
      renderCalendarGrid(tabId);
    });
  });
}

function showDayModal(tabId, dateStr) {
  const state = calendarStates[tabId];
  if (!state) return;
  const modal = document.getElementById(`day-modal-${tabId}`);
  const titleEl = document.getElementById(`day-modal-title-${tabId}`);
  const contentEl = document.getElementById(`day-modal-content-${tabId}`);
  if (!modal || !titleEl || !contentEl) return;

  const d = new Date(dateStr + 'T00:00:00');
  titleEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Find all tasks with worklogs on this day
  const { userData } = state;
  if (!userData) { contentEl.innerHTML = '<p style="color: var(--ds-text-subtlest);">No data</p>'; modal.style.display = ''; return; }

  const jiraUrl = state.jiraUrl || '';
  const dayTasks = [];
  userData.issues.forEach(iw => {
    const dayWls = iw.worklogs.filter(wl => wl.started?.substring(0, 10) === dateStr);
    if (dayWls.length > 0) {
      const totalSec = dayWls.reduce((s, w) => s + (w.timeSpentSeconds || 0), 0);
      dayTasks.push({ issue: iw.issue, worklogs: dayWls, totalSeconds: totalSec });
    }
  });

  if (dayTasks.length === 0) {
    contentEl.innerHTML = '<p style="padding: var(--ds-space-200); color: var(--ds-text-subtlest); text-align: center;">No work logged on this day.</p>';
  } else {
    const totalDaySec = dayTasks.reduce((s, t) => s + t.totalSeconds, 0);
    contentEl.innerHTML = `
      <div style="margin-bottom: var(--ds-space-150); font: var(--ds-font-body-small); color: var(--ds-text-subtle);">
        Total: <strong>${formatDuration(totalDaySec)}</strong> across ${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''}
      </div>
      ${dayTasks.map(t => `
        <div style="border: 1px solid var(--ds-border); border-radius: var(--ds-radius-200); padding: var(--ds-space-150); margin-bottom: var(--ds-space-100);">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-100); margin-bottom: var(--ds-space-075);">
            <div style="display: flex; align-items: center; gap: var(--ds-space-075); min-width: 0;">
              <a href="${jiraUrl}/browse/${t.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${t.issue.key}</a>
              <span style="font: var(--ds-font-body-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.issue.fields?.summary || ''}</span>
            </div>
            <span class="wl-time-badge">${formatDuration(t.totalSeconds)}</span>
          </div>
          ${t.worklogs.map(wl => `
            <div style="display: flex; justify-content: space-between; padding: 4px 0; font: var(--ds-font-body-small); color: var(--ds-text-subtle); border-top: 1px solid var(--ds-border);">
              <span>${wl.timeSpent || formatDuration(wl.timeSpentSeconds || 0)}</span>
              <span style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${extractComment(wl.comment) || '—'}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
  }
  modal.style.display = '';
}

function filterTasks(tabId) {
  const search = document.querySelector(`.wl-task-search[data-tab="${tabId}"]`)?.value?.toLowerCase() || '';
  const status = document.querySelector(`.wl-task-status-filter[data-tab="${tabId}"]`)?.value || '';
  const items = document.querySelectorAll(`.wl-task-list[data-tab="${tabId}"] .wl-accordion-item`);

  items.forEach(item => {
    const key = item.dataset.taskKey?.toLowerCase() || '';
    const summary = item.dataset.taskSummary || '';
    const itemStatus = item.dataset.taskStatus || '';

    const matchesSearch = !search || key.includes(search) || summary.includes(search);
    const matchesStatus = !status || itemStatus === status;
    item.style.display = matchesSearch && matchesStatus ? '' : 'none';
  });
}


function generateMonthOptions() {
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    options.push(`<option value="${value}">${label}</option>`);
  }
  return options.join('');
}

function applyDatePreset(preset) {
  const now = new Date();
  if (preset === 'this-week') {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    dateFrom = formatDate(monday);
    dateTo = formatDate(sunday);
  } else if (preset === 'last-week') {
    const dayOfWeek = now.getDay();
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    dateFrom = formatDate(lastMonday);
    dateTo = formatDate(lastSunday);
  } else {
    // Monthly: value format is "YYYY-MM"
    const [year, month] = preset.split('-').map(Number);
    dateFrom = formatDate(new Date(year, month - 1, 1));
    dateTo = formatDate(new Date(year, month, 0));
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

    /* Tabs */
    .wl-tabs {
      display: flex;
      gap: var(--ds-space-050);
      border-bottom: 2px solid var(--ds-border);
      margin-bottom: var(--ds-space-300);
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .wl-tab {
      display: flex;
      align-items: center;
      gap: var(--ds-space-075);
      padding: var(--ds-space-100) var(--ds-space-200);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      cursor: pointer;
      color: var(--ds-text-subtle);
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-medium);
      white-space: nowrap;
      transition: color var(--ds-duration-fast), border-color var(--ds-duration-fast);
    }
    .wl-tab:hover {
      color: var(--ds-text);
    }
    .wl-tab.active {
      color: var(--ds-link);
      border-bottom-color: var(--ds-link);
    }
    .wl-tab-panel {
      display: none;
    }
    .wl-tab-panel.active {
      display: block;
    }

    /* Calendar Grid */
    .wl-calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
    }
    .wl-calendar-grid.wl-cal-week-view {
      grid-template-columns: repeat(7, 1fr);
    }
    .wl-cal-header-cell {
      text-align: center;
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-semibold);
      color: var(--ds-text-subtlest);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 10px;
      padding: var(--ds-space-050) 0;
    }
    .wl-cal-cell {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--ds-space-100) var(--ds-space-050);
      border-radius: var(--ds-radius-200);
      cursor: pointer;
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
      min-height: 56px;
      border: 2px solid transparent;
    }
    .wl-cal-cell:hover:not(.wl-cal-empty) {
      border-color: var(--ds-border-focused);
      transform: scale(1.04);
      z-index: 1;
    }
    .wl-cal-cell.wl-cal-empty {
      cursor: default;
    }
    .wl-cal-cell.wl-cal-today {
      border-color: var(--ds-border-brand);
    }
    .wl-cal-date {
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
      font-size: 14px;
    }
    .wl-cal-hours {
      font: var(--ds-font-body-small);
      font-size: 11px;
      font-weight: var(--ds-font-weight-medium);
      margin-top: 2px;
    }
    .wl-cal-over {
      background: var(--ds-background-success);
      color: var(--ds-text-success);
    }
    .wl-cal-under {
      background: var(--ds-background-warning);
      color: var(--ds-text-warning);
    }
    .wl-cal-zero {
      background: var(--ds-background-danger);
      color: var(--ds-text-danger);
    }
    .wl-cal-holiday {
      background: var(--ds-background-neutral);
      color: var(--ds-text-subtlest);
      opacity: 0.7;
    }

    /* Calendar Nav */
    .wl-cal-nav {
      display: flex;
      align-items: center;
      gap: var(--ds-space-050);
    }
    .wl-cal-label {
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
      min-width: 140px;
      text-align: center;
    }
    .wl-cal-view-toggle {
      display: flex;
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      overflow: hidden;
    }
    .wl-cal-view-btn {
      padding: var(--ds-space-050) var(--ds-space-150);
      background: var(--ds-surface);
      border: none;
      cursor: pointer;
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text-subtle);
      transition: all var(--ds-duration-fast);
    }
    .wl-cal-view-btn.active {
      background: var(--ds-background-brand-bold);
      color: white;
    }
    .wl-cal-view-btn:not(.active):hover {
      background: var(--ds-background-neutral-hovered);
    }

    /* Calendar Legend */
    .wl-cal-legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-200);
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtle);
    }
    .wl-cal-legend-item {
      display: flex;
      align-items: center;
      gap: var(--ds-space-050);
    }
    .wl-cal-legend-dot {
      width: 12px;
      height: 12px;
      border-radius: var(--ds-radius-100);
      flex-shrink: 0;
    }

    /* Day Detail Modal */
    .wl-day-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--ds-space-300);
    }
    .wl-day-modal {
      background: var(--ds-surface-overlay);
      border-radius: var(--ds-radius-300);
      box-shadow: var(--ds-shadow-overlay);
      max-width: 540px;
      width: 100%;
      max-height: 80vh;
      overflow-y: auto;
      padding: var(--ds-space-300);
    }
    .wl-day-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--ds-space-200);
    }
  `;
  document.head.appendChild(style);
}
