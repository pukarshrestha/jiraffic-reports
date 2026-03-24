/**
 * Work Log View — Cross-project worklog report with multi-user support
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
import { searchAllIssues, getIssueWorklogs, searchUsers, getMyself, buildUserWorklogJqlPerSite, searchAllIssuesMultiSite } from '../services/jira.js';
import { getSettings, getGroups, getExpectedHours, isWorkday, getHolidayOnDate } from '../services/settings.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';


let selectedUsers = [];
let dateFrom = '';
let dateTo = '';
let searchTimeout = null;
let lastReportData = null;
let regenTimeout = null;

// Timesheet weekly navigation state
let timesheetState = { allDays: [], userMatrix: {}, weekIndex: 0, jiraUrl: '' };

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
      avatarUrl: savedUser.avatarUrls?.['48x48'] || savedUser.avatarUrl || '',
    });
  }

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header" id="worklog-header">
      <h1 class="page-title">Work Log</h1>
      <p class="page-subtitle">Aggregated work logs across all projects</p>
    </div>

    <!-- Filters — Inline pill bar -->
    <div class="wl-filter-bar" id="worklog-filters">
      <div class="wl-filter-bar-left">
        <!-- Users pill -->
        <div class="wl-pill-wrapper" id="wl-users-pill-wrapper">
          <button class="wl-filter-pill" id="wl-users-pill" type="button">
            <span id="wl-users-pill-label">Users</span>
            <svg class="wl-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Users popover -->
          <div class="wl-popover d-none" id="wl-users-popover">
            <div class="wl-popover-header">Select Users</div>
            <div class="wl-popover-search">
              <svg class="wl-popover-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input class="wl-popover-search-input" type="text" id="user-search" placeholder="Search users..." autocomplete="off" />
            </div>
            <div id="user-dropdown" class="wl-popover-results d-none"></div>
            <div id="wl-selected-users-list" class="wl-selected-list"></div>
          </div>
        </div>

        <!-- Date pill -->
        <div class="wl-pill-wrapper" id="wl-date-pill-wrapper">
          <button class="wl-filter-pill" id="wl-date-pill" type="button">
            <span id="wl-date-pill-label">March 2026</span>
            <svg class="wl-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Date popover -->
          <div class="wl-popover d-none" id="wl-date-popover">
            <div class="wl-popover-header">
              <div class="wl-date-mode-toggle">
                <button class="wl-date-mode-btn active" data-mode="month" type="button">Month</button>
                <button class="wl-date-mode-btn" data-mode="custom" type="button">Custom</button>
              </div>
            </div>
            <div id="wl-date-month-panel" class="wl-date-panel">
              <div class="wl-date-year-row">
                <button class="wl-date-nav-btn" id="wl-year-prev" type="button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span class="wl-date-year-label" id="wl-year-label">2026</span>
                <button class="wl-date-nav-btn" id="wl-year-next" type="button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
              <div class="wl-month-grid" id="wl-month-grid"></div>
            </div>
            <div id="wl-date-custom-panel" class="wl-date-panel d-none">
              <div class="wl-custom-date-row">
                <label class="wl-custom-date-label">From</label>
                <input class="input wl-custom-date-input" type="date" id="date-from" value="${dateFrom}" />
              </div>
              <div class="wl-custom-date-row">
                <label class="wl-custom-date-label">To</label>
                <input class="input wl-custom-date-input" type="date" id="date-to" value="${dateTo}" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="wl-filter-bar-right">
        <button class="btn btn-default-outline btn-sm d-none" id="export-excel-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>
    </div>

    <!-- Results -->
    <div id="worklog-results"></div>
  `;

  // Inject custom styles for this view
  injectWorklogStyles();

  // ── Users pill popover ────────────────────────
  const usersPill = document.getElementById('wl-users-pill');
  const usersPopover = document.getElementById('wl-users-popover');
  const datePill = document.getElementById('wl-date-pill');
  const datePopover = document.getElementById('wl-date-popover');

  function updateUsersPillLabel() {
    const label = document.getElementById('wl-users-pill-label');
    if (selectedUsers.length === 0) {
      label.innerHTML = 'Users';
    } else if (selectedUsers.length === 1) {
      label.innerHTML = selectedUsers[0].displayName;
    } else {
      label.innerHTML = `${selectedUsers[0].displayName} <span class="wl-pill-badge">+${selectedUsers.length - 1}</span>`;
    }
  }

  function renderSelectedUsersList() {
    const list = document.getElementById('wl-selected-users-list');
    if (!list) return;
    if (selectedUsers.length === 0) {
      list.innerHTML = '<div class="wl-selected-empty">No users selected</div>';
      return;
    }
    list.innerHTML = selectedUsers.map((user, i) => `
      <div class="wl-selected-user-item" data-index="${i}">
        <div class="wl-selected-user-left">
          ${user.avatarUrl
            ? `<img src="${user.avatarUrl}" alt="" class="avatar avatar-xs wl-avatar-img" />`
            : `<span class="avatar avatar-xs">${user.displayName.charAt(0).toUpperCase()}</span>`
          }
          <span class="wl-selected-user-name">${user.displayName}</span>
        </div>
        <button class="wl-selected-user-remove" data-index="${i}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');
    list.querySelectorAll('.wl-selected-user-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        selectedUsers.splice(idx, 1);
        renderSelectedUsersList();
        updateUsersPillLabel();
        scheduleRegenerate();
      });
    });
  }

  function closeAllPopovers() {
    usersPopover.classList.add('d-none');
    datePopover.classList.add('d-none');
    usersPill.classList.remove('wl-pill-active');
    datePill.classList.remove('wl-pill-active');
  }

  usersPill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !usersPopover.classList.contains('d-none');
    closeAllPopovers();
    if (!isOpen) {
      usersPopover.classList.remove('d-none');
      usersPill.classList.add('wl-pill-active');
      renderSelectedUsersList();
      setTimeout(() => document.getElementById('user-search')?.focus(), 50);
    }
  });

  // User search inside popover
  const searchInput = document.getElementById('user-search');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      document.getElementById('user-dropdown').classList.add('d-none');
      return;
    }
    searchTimeout = setTimeout(() => searchAndShowUsers(query), 300);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = document.querySelector('#user-dropdown .user-dropdown-item:not(.d-none)');
      if (firstItem) firstItem.click();
    }
    if (e.key === 'Escape') {
      document.getElementById('user-dropdown').classList.add('d-none');
      closeAllPopovers();
    }
  });

  // ── Date pill popover ─────────────────────────
  let pickerYear = now.getFullYear();
  let pickerMonth = now.getMonth();
  let dateMode = 'month'; // 'month' or 'custom'

  function updateDatePillLabel() {
    const label = document.getElementById('wl-date-pill-label');
    if (dateMode === 'month') {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      label.textContent = `${monthNames[pickerMonth]} ${pickerYear}`;
    } else {
      const from = document.getElementById('date-from')?.value || dateFrom;
      const to = document.getElementById('date-to')?.value || dateTo;
      label.textContent = `${from} → ${to}`;
    }
    datePill.classList.add('wl-pill-active');
  }

  function renderMonthGrid() {
    const grid = document.getElementById('wl-month-grid');
    const yearLabel = document.getElementById('wl-year-label');
    if (!grid || !yearLabel) return;
    yearLabel.textContent = pickerYear;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    grid.innerHTML = monthNames.map((name, i) => `
      <button class="wl-month-cell${i === pickerMonth && pickerYear === new Date().getFullYear() ? ' active' : ''}${i === pickerMonth ? ' selected' : ''}"
              data-month="${i}" type="button">${name}</button>
    `).join('');
    grid.querySelectorAll('.wl-month-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        pickerMonth = parseInt(cell.dataset.month);
        dateFrom = formatDate(new Date(pickerYear, pickerMonth, 1));
        dateTo = formatDate(new Date(pickerYear, pickerMonth + 1, 0));
        updateDatePillLabel();
        renderMonthGrid();
        closeAllPopovers();
        generateWorklogReport();
      });
    });
  }

  datePill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !datePopover.classList.contains('d-none');
    closeAllPopovers();
    if (!isOpen) {
      datePopover.classList.remove('d-none');
      datePill.classList.add('wl-pill-active');
      renderMonthGrid();
    }
  });

  // Year navigation
  document.getElementById('wl-year-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    pickerYear--;
    renderMonthGrid();
  });
  document.getElementById('wl-year-next').addEventListener('click', (e) => {
    e.stopPropagation();
    pickerYear++;
    renderMonthGrid();
  });

  // Date mode toggle (Month / Custom)
  datePopover.querySelectorAll('.wl-date-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dateMode = btn.dataset.mode;
      datePopover.querySelectorAll('.wl-date-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('wl-date-month-panel').classList.toggle('d-none', dateMode !== 'month');
      document.getElementById('wl-date-custom-panel').classList.toggle('d-none', dateMode !== 'custom');
    });
  });

  // Custom date inputs
  document.getElementById('date-from').addEventListener('change', (e) => {
    dateFrom = e.target.value;
    updateDatePillLabel();
    generateWorklogReport();
  });
  document.getElementById('date-to').addEventListener('change', (e) => {
    dateTo = e.target.value;
    updateDatePillLabel();
    generateWorklogReport();
  });

  // Close popovers on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#wl-users-pill-wrapper')) {
      usersPopover.classList.add('d-none');
      usersPill.classList.remove('wl-pill-active');
    }
    if (!e.target.closest('#wl-date-pill-wrapper')) {
      datePopover.classList.add('d-none');
      datePill.classList.remove('wl-pill-active');
    }
  });

  // Initialize labels and state
  updateUsersPillLabel();
  updateDatePillLabel();
  renderSelectedUsersList();

  // Auto-generate on load
  if (selectedUsers.length > 0) {
    generateWorklogReport();
  }
}

function renderUserChips() { return ''; }

function refreshUserChips() {
  // Update pill label and selected users list in popover
  const pillLabel = document.getElementById('wl-users-pill-label');
  if (pillLabel) {
    if (selectedUsers.length === 0) {
      pillLabel.innerHTML = 'Users';
    } else if (selectedUsers.length === 1) {
      pillLabel.innerHTML = selectedUsers[0].displayName;
    } else {
      pillLabel.innerHTML = `${selectedUsers[0].displayName} <span class="wl-pill-badge">+${selectedUsers.length - 1}</span>`;
    }
  }
  // Re-render selected list in popover if open
  const list = document.getElementById('wl-selected-users-list');
  if (list && !document.getElementById('wl-users-popover')?.classList.contains('d-none')) {
    // Trigger re-render from within popover
    const event = new CustomEvent('wl-refresh-selected');
    document.dispatchEvent(event);
  }
}

function scheduleRegenerate() {
  clearTimeout(regenTimeout);
  regenTimeout = setTimeout(() => {
    if (selectedUsers.length > 0) {
      generateWorklogReport();
    } else {
      // Clear results when no users
      const resultsDiv = document.getElementById('worklog-results');
      if (resultsDiv) resultsDiv.innerHTML = '';
      const exportBtn = document.getElementById('export-excel-btn');
      if (exportBtn) exportBtn.classList.add('d-none');
      lastReportData = null;
    }
  }, 500);
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
          <svg class="dropdown-group-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>
            <div class="dropdown-item-name">${g.name}</div>
            <div class="dropdown-item-sub">${g.users.length} member${g.users.length !== 1 ? 's' : ''}</div>
          </div>
        </button>
      `).join('');
      if (filtered.length > 0) {
        html += '<div class="dropdown-separator"></div>';
      }
    }

    // Individual users
    if (filtered.length > 0) {
      html += filtered.map(u => `
        <button class="user-dropdown-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}" data-avatar="${u.avatarUrls?.['24x24'] || ''}">
          ${u.avatarUrls?.['24x24']
          ? `<img src="${u.avatarUrls['24x24']}" alt="" class="dropdown-avatar-img" />`
          : `<span class="avatar avatar-sm dropdown-avatar-initial">${u.displayName.charAt(0).toUpperCase()}</span>`
        }
          <div>
            <div class="dropdown-item-name">${u.displayName}</div>
            ${u.emailAddress ? `<div class="dropdown-item-sub">${u.emailAddress}</div>` : ''}
          </div>
        </button>
      `).join('');
    }

    if (!html) {
      html = '<div class="user-dropdown-empty">No users or groups found</div>';
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove('d-none');

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
          dropdown.classList.add('d-none');
          scheduleRegenerate();
        }
      });
    });

    // Click handler for individual user items
    dropdown.querySelectorAll('.user-dropdown-item:not(.user-dropdown-group)').forEach(item => {
      item.addEventListener('click', () => {
        const accountId = item.dataset.accountId;
        // Find the full user object from the fetched results to get siteAccounts
        const fullUser = users.find(u => u.accountId === accountId);
        selectedUsers.push({
          accountId,
          displayName: item.dataset.name,
          emailAddress: item.dataset.email,
          avatarUrl: item.dataset.avatar || '',
          siteAccounts: fullUser?.siteAccounts || [{ accountId, siteUrl: '', siteName: '' }],
        });
        refreshUserChips();
        document.getElementById('user-search').value = '';
        dropdown.classList.add('d-none');
        scheduleRegenerate();
      });
    });
  } catch (err) {
    dropdown.innerHTML = `<div class="user-dropdown-empty">Error searching users</div>`;
    dropdown.classList.remove('d-none');
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

  // Hide export button during loading
  const exportBtn = document.getElementById('export-excel-btn');
  if (exportBtn) exportBtn.classList.add('d-none');

  resultsDiv.innerHTML = `
    <div class="loading-screen">
      <div class="spinner spinner-lg"></div>
      <p class="wl-loading-progress">Fetching work logs...</p>
    </div>
  `;

  try {
    // Build per-site JQL queries using the correct accountId per site
    const siteJqls = buildUserWorklogJqlPerSite(selectedUsers, dateFrom, dateTo);

    if (siteJqls.length === 0) {
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="empty-state-title">No matching sites</p>
          <p class="empty-state-description">The selected users don't have accounts on any connected Jira sites.</p>
        </div>
      `;
      return;
    }

    const issues = await searchAllIssuesMultiSite(siteJqls, 'summary,project,status,issuetype,assignee');

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

    // Fetch worklogs in parallel batches of 5
    const issueWorklogs = [];
    const batchSize = 5;
    for (let i = 0; i < issues.length; i += batchSize) {
      const batch = issues.slice(i, i + batchSize);
      // Update progress
      const progressEl = document.querySelector('.wl-loading-progress');
      if (progressEl) progressEl.textContent = `Fetching worklogs (${Math.min(i + batchSize, issues.length)}/${issues.length} issues)...`;
      const results = await Promise.allSettled(batch.map(async (issue) => {
        const worklogs = await getIssueWorklogs(issue.key, issue._site);
        const filtered = worklogs.filter(wl => {
          const wlDate = wl.started?.substring(0, 10);
          const isInDateRange = wlDate >= dateFrom && wlDate <= dateTo;
          const authorId = wl.author?.accountId;
          const isSelectedUser = selectedUsers.some(u => {
            if (u.accountId === authorId) return true;
            if (u.siteAccounts) return u.siteAccounts.some(sa => sa.accountId === authorId);
            return false;
          });
          return isInDateRange && isSelectedUser;
        });
        if (filtered.length > 0) {
          return {
            issue,
            worklogs: filtered,
            totalSeconds: filtered.reduce((sum, wl) => sum + (wl.timeSpentSeconds || 0), 0),
          };
        }
        return null;
      }));
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) issueWorklogs.push(r.value);
        else if (r.status === 'rejected') console.error('Worklog fetch error:', r.reason);
      });
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
      allDaysInRange.push(formatDate(d));
    }

    const creds = getCredentials();
    const jiraUrl = creds?.url || '';

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

    // Build tab bar — users first, "All Users" last
    const tabIds = [...selectedUsers.map(u => u.accountId), 'all'];
    const tabLabels = [...selectedUsers.map(u => u.displayName), 'All Users'];
    const tabAvatars = [...selectedUsers.map(u => u.avatarUrl || ''), ''];

    resultsDiv.innerHTML = `
      <!-- Tab Bar -->
      <div class="wl-tabs" id="wl-tabs">
        ${tabIds.map((id, i) => `
          <button class="wl-tab ${i === 0 ? 'active' : ''}" data-tab="${id}">
            ${id === 'all' ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` : (tabAvatars[i] ? `<img src="${tabAvatars[i]}" alt="" class="avatar avatar-sm wl-chip-avatar wl-avatar-img flex-shrink-0" />` : `<span class="avatar avatar-sm wl-chip-avatar flex-shrink-0">${tabLabels[i].charAt(0).toUpperCase()}</span>`)}
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
      const isOpen = !body.classList.contains('d-none');
      body.classList.toggle('d-none', isOpen);
      header.setAttribute('aria-expanded', !isOpen);
      header.classList.toggle('expanded', !isOpen);
    });

    // Initialize calendars for each user tab
    initCalendars(perUserData, issueWorklogs, jiraUrl);

    // Breakdown toggle (Calendar ↔ Tasks)
    resultsDiv.addEventListener('click', (e) => {
      const btn = e.target.closest('.wl-breakdown-btn');
      if (!btn) return;
      const view = btn.dataset.view;
      const tabId = btn.dataset.tab;
      const container = document.getElementById(`user-daily-${tabId}`);
      if (!container) return;

      // Toggle active button
      container.querySelectorAll('.wl-breakdown-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
      // Toggle panels
      container.querySelectorAll('.wl-breakdown-panel').forEach(p => p.classList.toggle('active', p.dataset.breakdown === view));
      // Show/hide calendar controls
      const calControls = container.querySelector('.wl-panel-controls');
      if (calControls) calControls.style.display = view === 'calendar' ? '' : 'none';

      // Lazy render task list on first activation
      if (view === 'tasks') {
        const tasksPanel = container.querySelector('[data-breakdown="tasks"]');
        if (tasksPanel && !tasksPanel.dataset.rendered) {
          tasksPanel.innerHTML = renderTaskList(perUserData[tabId], jiraUrl, tabId);
          tasksPanel.dataset.rendered = 'true';
          // Attach accordion handlers
          tasksPanel.querySelectorAll('.wl-accordion-header').forEach(header => {
            header.addEventListener('click', () => {
              const idx = header.dataset.idx;
              const body = document.getElementById(`wl-body-${idx}`);
              if (!body) return;
              const isOpen = !body.classList.contains('d-none');
              body.classList.toggle('d-none', isOpen);
              header.setAttribute('aria-expanded', !isOpen);
              header.classList.toggle('expanded', !isOpen);
            });
          });
        }
      }
    });

    // Initialize timesheet weekly navigation
    timesheetState = { allDays: allDaysInRange, userMatrix: userDayMatrix, weekIndex: 0, jiraUrl };
    renderTimesheetWeek();

    // Store report data for export
    lastReportData = { allDaysInRange, userDayMatrix, perUserData };
    const exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
      exportBtn.classList.remove('d-none');
      exportBtn.onclick = exportToExcel;
    }
    document.getElementById('ts-week-prev')?.addEventListener('click', () => {
      if (timesheetState.weekIndex > 0) {
        timesheetState.weekIndex--;
        renderTimesheetWeek();
      }
    });
    document.getElementById('ts-week-next')?.addEventListener('click', () => {
      if (timesheetState.weekIndex < getTimesheetTotalWeeks() - 1) {
        timesheetState.weekIndex++;
        renderTimesheetWeek();
      }
    });

    /* TASK_DETAILS_DISABLED — uncomment when re-enabling task search/filter
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
    TASK_DETAILS_DISABLED */

    // Day modal close + Escape key
    resultsDiv.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('.wl-day-modal-close');
      const overlay = e.target.closest('.wl-day-modal-overlay');
      if (closeBtn) {
        const modal = document.getElementById(`day-modal-${closeBtn.dataset.tab}`);
        if (modal) modal.classList.remove('wl-modal-visible');
      } else if (overlay && !e.target.closest('.wl-day-modal')) {
        overlay.classList.remove('wl-modal-visible');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.wl-day-modal-overlay.wl-modal-visible').forEach(m => m.classList.remove('wl-modal-visible'));
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
  const expectedHours = getExpectedHours();
  const workdayCount = countWorkdaysInRange(dateFrom, dateTo);
  const totalExpectedHours = expectedHours * workdayCount;
  return `
    <!-- Combined Stats -->
    <div class="stat-grid mb-300" id="all-users-stats">
      <div class="stat-card">
        <div class="stat-card-label">Total Time Logged</div>
        <div class="stat-card-value">${formatDuration(grandTotalSeconds)}</div>
        <div class="stat-card-secondary">of ${totalExpectedHours}h expected (${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''})</div>
        ${renderDiffBadge(grandTotalSeconds, totalExpectedHours)}
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
        <div class="stat-card-label">Avg / Logged Day</div>
        <div class="stat-card-value">${formatDuration(Math.round(grandTotalSeconds / Math.max(sortedDays.length, 1)))}</div>
        <div class="stat-card-secondary">${sortedDays.length} day${sortedDays.length !== 1 ? 's' : ''} with logs</div>
      </div>
    </div>

    <!-- Timesheet Matrix -->
    <div class="card mb-300" id="all-users-timesheet">
      <div class="wl-panel-header">
        <h3 class="text-heading-small m-0">Daily Timesheet</h3>
        <div class="wl-cal-nav">
          <button class="btn btn-subtle btn-icon-only wl-nav-btn" id="ts-week-prev" title="Previous week">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="wl-cal-label" id="ts-week-label"></span>
          <button class="btn btn-subtle btn-icon-only wl-nav-btn" id="ts-week-next" title="Next week">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
      <div id="ts-week-body"></div>
    </div>
  `;
}

function getTimesheetTotalWeeks() {
  return Math.max(1, Math.ceil(timesheetState.allDays.length / 7));
}

function renderTimesheetWeek() {
  const { allDays, userMatrix, weekIndex } = timesheetState;
  const totalWeeks = getTimesheetTotalWeeks();
  const start = weekIndex * 7;
  const weekDays = allDays.slice(start, start + 7);

  // Update label
  const labelEl = document.getElementById('ts-week-label');
  const bodyEl = document.getElementById('ts-week-body');
  if (!labelEl || !bodyEl || weekDays.length === 0) return;

  const ws = new Date(weekDays[0] + 'T00:00:00');
  const we = new Date(weekDays[weekDays.length - 1] + 'T00:00:00');
  labelEl.textContent = `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  // Disable buttons at boundaries
  const prevBtn = document.getElementById('ts-week-prev');
  const nextBtn = document.getElementById('ts-week-next');
  if (prevBtn) prevBtn.disabled = weekIndex <= 0;
  if (nextBtn) nextBtn.disabled = weekIndex >= totalWeeks - 1;

  // Calculate grand total for this week
  let weekGrandTotal = 0;

  const rows = Object.entries(userMatrix).map(([userId, userData]) => {
    let rowTotal = 0;
    const cells = weekDays.map(day => {
      const seconds = userData.days[day] || 0;
      rowTotal += seconds;
      const hours = seconds / 3600;
      const isNonWorkday = !isWorkday(day);
      let cellClass = isNonWorkday ? 'wl-weekend' : '';
      if (seconds > 0) {
        if (hours >= 8) cellClass += ' wl-cell-full';
        else if (hours >= 4) cellClass += ' wl-cell-half';
        else cellClass += ' wl-cell-light';
      }
      return `<td class="wl-matrix-cell ${cellClass}" title="${userData.name}: ${formatDuration(seconds)} on ${day}">
        ${seconds > 0 ? formatDurationCompact(seconds) : '<span class="wl-cell-empty">—</span>'}
      </td>`;
    }).join('');
    weekGrandTotal += rowTotal;
    return `<tr>
      <td class="wl-matrix-user-cell">
        <div class="wl-matrix-user-row">
          <span class="avatar avatar-sm wl-matrix-avatar">${userData.name.charAt(0).toUpperCase()}</span>
          <span class="wl-matrix-user-name">${userData.name}</span>
        </div>
      </td>
      ${cells}
      <td class="wl-matrix-total-cell">${formatDuration(rowTotal)}<div class="wl-cell-hours">${formatHoursDecimal(rowTotal)}</div></td>
    </tr>`;
  }).join('');

  const footerCells = weekDays.map(day => {
    const colTotal = Object.values(userMatrix).reduce((s, u) => s + (u.days[day] || 0), 0);
    const isNonWorkday = !isWorkday(day);
    return `<td class="wl-matrix-cell ${isNonWorkday ? 'wl-weekend' : ''} text-semibold">
      ${colTotal > 0 ? formatDurationCompact(colTotal) : '—'}
    </td>`;
  }).join('');

  bodyEl.innerHTML = `
    <div class="table-container">
      <table class="table wl-matrix-table">
        <thead>
          <tr>
            <th class="wl-matrix-user-col">Team Member</th>
            ${weekDays.map(day => {
    const d = new Date(day + 'T00:00:00');
    const isNonWorkday = !isWorkday(day);
    return `<th class="wl-matrix-day-col ${isNonWorkday ? 'wl-weekend' : ''}" title="${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}">
                <div class="wl-day-header">
                  <span class="wl-day-name">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span class="wl-day-date">${d.getDate()}</span>
                </div>
              </th>`;
  }).join('')}
            <th class="wl-matrix-total-col">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="wl-matrix-footer-row">
            <td class="text-semibold">Total</td>
            ${footerCells}
            <td class="wl-matrix-total-cell text-bold">${formatDuration(weekGrandTotal)}<div class="wl-cell-hours">${formatHoursDecimal(weekGrandTotal)}</div></td>
          </tr>
        </tfoot>
      </table>
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
  // const allStatuses = [...new Set(issues.map(iw => iw.issue.fields?.status?.name).filter(Boolean))]; /* TASK_DETAILS_DISABLED */

  return `
    <!-- User Stats -->
    <div class="stat-grid mb-300" id="user-stats-${tabId}">
      <div class="stat-card">
        <div class="stat-card-label">Time Logged</div>
        <div class="stat-card-value">${formatDuration(totalSeconds)}</div>
        <div class="stat-card-secondary">of ${expectedHours * countWorkdaysInRange(dateFrom, dateTo)}h expected</div>
        ${renderDiffBadge(totalSeconds, expectedHours * countWorkdaysInRange(dateFrom, dateTo))}
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
        <div class="stat-card-label">Avg / Logged Day</div>
        <div class="stat-card-value">${formatDuration(Math.round(totalSeconds / Math.max(daysWithLog.length, 1)))}</div>
        <div class="stat-card-secondary">${daysWithLog.length} day${daysWithLog.length !== 1 ? 's' : ''} with logs</div>
      </div>
    </div>

    <!-- Daily Calendar / Tasks Toggle -->
    <div class="card mb-300" id="user-daily-${tabId}">
      <div class="wl-panel-header">
        <div class="wl-panel-header-left">
          <div class="wl-breakdown-toggle">
            <button class="wl-breakdown-btn active" data-view="calendar" data-tab="${tabId}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Calendar
            </button>
            <button class="wl-breakdown-btn" data-view="tasks" data-tab="${tabId}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Tasks
            </button>
          </div>
        </div>
        <div class="wl-panel-controls">
          <div class="wl-cal-nav d-none" id="cal-nav-${tabId}">
            <button class="btn btn-subtle btn-icon-only wl-cal-prev wl-nav-btn" data-tab="${tabId}" title="Previous">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="wl-cal-label" id="cal-label-${tabId}"></span>
            <button class="btn btn-subtle btn-icon-only wl-cal-next wl-nav-btn" data-tab="${tabId}" title="Next">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <span class="wl-cal-label-month text-subtle" id="cal-label-month-${tabId}"></span>
          <div class="wl-cal-view-toggle" id="cal-view-toggle-${tabId}">
            <button class="wl-cal-view-btn active" data-view="month" data-tab="${tabId}">Month</button>
            <button class="wl-cal-view-btn" data-view="week" data-tab="${tabId}">Week</button>
          </div>
        </div>
      </div>

      <!-- Calendar View -->
      <div class="wl-breakdown-panel active" data-breakdown="calendar" data-tab="${tabId}">
        <div class="wl-calendar-grid" id="cal-grid-${tabId}" data-days='${JSON.stringify(days)}' data-expected="${expectedHours}"></div>
        <div class="wl-cal-legend mt-150">
          <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot wl-legend-dot-success"></span> ≥ ${expectedHours}h</span>
          <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot wl-legend-dot-warning"></span> &lt; ${expectedHours}h</span>
          <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot wl-legend-dot-danger"></span> No log (workday)</span>
          <span class="wl-cal-legend-item"><span class="wl-cal-legend-dot wl-legend-dot-neutral"></span> Holiday</span>
        </div>
      </div>

      <!-- Tasks View (lazy rendered) -->
      <div class="wl-breakdown-panel" data-breakdown="tasks" data-tab="${tabId}"></div>
    </div>

    <!-- Day Detail Modal (hidden) -->
    <div class="wl-day-modal-overlay" id="day-modal-${tabId}">
      <div class="wl-day-modal">
        <div class="wl-day-modal-header">
          <h3 id="day-modal-title-${tabId}" class="wl-modal-title"></h3>
          <button class="btn btn-subtle btn-icon-only wl-day-modal-close wl-nav-btn" data-tab="${tabId}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="day-modal-content-${tabId}"></div>
      </div>
    </div>
  `;
}

/* TASK_DETAILS_DISABLED — uncomment when re-enabling
function renderTaskAccordionItemsGrouped(issues, jiraUrl, tabId) {
  const siteGroups = new Map();
  issues.sort((a, b) => b.totalSeconds - a.totalSeconds).forEach(iw => {
    const siteName = iw.issue._site?.name || 'Default';
    const siteUrl = iw.issue._site?.url || jiraUrl;
    const key = siteUrl;
    if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
    siteGroups.get(key).items.push(iw);
  });

  const multiSite = siteGroups.size > 1;
  let globalIdx = 0;

  return Array.from(siteGroups.values()).map(group => {
    const header = multiSite ? `<div class="wl-site-group-title">${group.siteName}</div>` : '';
    const items = group.items.map(iw => {
      const idx = globalIdx++;
      const bodyId = `wl-body-${tabId}-${idx}`;
      return `
        <div class="wl-accordion-item" data-task-key="${iw.issue.key}" data-task-summary="${(iw.issue.fields?.summary || '').toLowerCase()}" data-task-status="${iw.issue.fields?.status?.name || ''}">
          <button class="wl-accordion-header" data-idx="${tabId}-${idx}" aria-expanded="false">
            <div class="wl-accordion-left">
              <svg class="wl-accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              <a href="${group.siteUrl}/browse/${iw.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${iw.issue.key}</a>
              <span class="wl-issue-summary">${iw.issue.fields?.summary || ''}</span>
            </div>
            <div class="wl-accordion-right">
              <span class="lozenge ${getStatusLozengeClass(iw.issue.fields?.status?.statusCategory?.key)} flex-shrink-0">${iw.issue.fields?.status?.name || ''}</span>
              <span class="lozenge lozenge-default flex-shrink-0">${iw.issue.fields?.project?.name || iw.issue.fields?.project?.key || ''}</span>
              <span class="wl-time-badge">${formatDuration(iw.totalSeconds)}</span>
            </div>
          </button>
          <div class="wl-accordion-body d-none" id="${bodyId}">
            <table class="table wl-table-no-margin">
              <thead><tr><th>Date</th><th>Time Spent</th><th>Comment</th></tr></thead>
              <tbody>
                ${iw.worklogs.sort((a, b) => new Date(a.started) - new Date(b.started)).map(wl => `
                  <tr>
                    <td class="wl-worklog-date-cell">${wl.started ? new Date(wl.started).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
                    <td class="text-medium">${wl.timeSpent || formatDuration(wl.timeSpentSeconds || 0)}</td>
                    <td class="wl-worklog-comment-cell">${extractComment(wl.comment) || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
    return header + items;
  }).join('');
}
TASK_DETAILS_DISABLED */

/* ── Calendar Logic ──────────────────────────────── */

// Store calendar state per tab
const calendarStates = {};

function initCalendars(perUserData, issueWorklogs, jiraUrl) {
  // Set initial calendar month/year from dateFrom (start of selected range)
  const rangeStart = new Date(dateFrom + 'T00:00:00');
  const rangeEnd = new Date(dateTo + 'T00:00:00');
  // Determine if this is a custom multi-month range
  const isMultiMonth = rangeStart.getMonth() !== rangeEnd.getMonth() || rangeStart.getFullYear() !== rangeEnd.getFullYear();

  Object.keys(perUserData).forEach(tabId => {
    const gridEl = document.getElementById(`cal-grid-${tabId}`);
    if (!gridEl) return;

    const days = JSON.parse(gridEl.dataset.days || '{}');
    const expected = parseFloat(gridEl.dataset.expected || '7');

    calendarStates[tabId] = {
      view: 'month',
      year: rangeStart.getFullYear(),
      month: rangeStart.getMonth(),
      weekStart: getWeekStart(rangeStart),
      days,
      expected,
      userData: perUserData[tabId],
      issueWorklogs,
      jiraUrl,
      isMultiMonth,
    };

    renderCalendarGrid(tabId);
    attachCalendarNavHandlers(tabId);
  });
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderCalendarGrid(tabId) {
  const state = calendarStates[tabId];
  if (!state) return;

  const gridEl = document.getElementById(`cal-grid-${tabId}`);
  const labelEl = document.getElementById(`cal-label-${tabId}`);
  const labelMonthEl = document.getElementById(`cal-label-month-${tabId}`);
  const navEl = document.getElementById(`cal-nav-${tabId}`);
  if (!gridEl) return;

  const { view, year, month, weekStart, days, expected } = state;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Toggle nav visibility: show in week view, or in month view if multi-month
  if (navEl) navEl.classList.toggle('d-none', view === 'month' && !state.isMultiMonth);
  if (labelMonthEl) labelMonthEl.classList.toggle('d-none', view === 'week' || state.isMultiMonth);

  let cells = '';
  let datesToRender = [];

  if (view === 'month') {
    if (labelMonthEl) labelMonthEl.textContent = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    // Fill in leading empty cells for the first week
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // Sun=0 based

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
    if (labelEl) labelEl.textContent = `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
    const holiday = getHolidayOnDate(dateStr);
    const d = new Date(dateStr + 'T00:00:00');
    const isToday = formatDate(new Date()) === dateStr;

    let colorClass = '';
    if (holiday || !workday) {
      colorClass = 'wl-cal-holiday';
    } else if (hours > 9) {
      colorClass = 'wl-cal-overlog';
    } else if (hours >= expected) {
      colorClass = 'wl-cal-over';
    } else if (hours > 0) {
      colorClass = 'wl-cal-under';
    } else {
      colorClass = 'wl-cal-zero';
    }

    const tooltipParts = [d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })];
    if (holiday) tooltipParts.push(`🎉 ${holiday.name}`);
    if (hours > 0) tooltipParts.push(formatDuration(seconds));
    else if (!holiday) tooltipParts.push('No log');

    cells += `
      <div class="wl-cal-cell ${colorClass} ${isToday ? 'wl-cal-today' : ''}" data-date="${dateStr}" data-tab="${tabId}" title="${tooltipParts.join(' — ')}">
        <div class="wl-cal-date">${d.getDate()}</div>
        ${holiday ? `<div class="wl-cal-holiday-name">${holiday.name}</div>` : `<div class="wl-cal-hours">${hours > 0 ? formatHoursDecimal(seconds) : ''}</div>`}
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

/**
 * Load worklog data for the current calendar view period and re-render.
 * Shows a loading overlay while data is being fetched.
 */
async function loadCalendarData(tabId) {
  const state = calendarStates[tabId];
  if (!state) return;

  // Compute the date range for the current view
  let rangeFrom, rangeTo;
  if (state.view === 'month') {
    const firstDay = new Date(state.year, state.month, 1);
    const lastDay = new Date(state.year, state.month + 1, 0);
    rangeFrom = formatDate(firstDay);
    rangeTo = formatDate(lastDay);
  } else {
    const ws = new Date(state.weekStart);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    rangeFrom = formatDate(ws);
    rangeTo = formatDate(we);
  }

  // Check if we already have data covering this range
  const hasExistingData = Object.keys(state.days).some(d => d >= rangeFrom && d <= rangeTo);
  // If range is within the original dateFrom..dateTo, we already have complete data
  const withinOriginalRange = rangeFrom >= dateFrom && rangeTo <= dateTo;

  if (withinOriginalRange || hasExistingData) {
    // Data already available from the initial load — just re-render
    renderCalendarGrid(tabId);
    return;
  }

  // Show loading state on the calendar grid
  const gridEl = document.getElementById(`cal-grid-${tabId}`);
  if (gridEl) {
    gridEl.innerHTML = `<div class="wl-cal-loading"><div class="spinner"></div></div>`;
  }

  try {
    // Fetch worklogs for this user in the new date range
    const userId = tabId;
    const user = selectedUsers.find(u => u.accountId === userId);
    if (!user) { renderCalendarGrid(tabId); return; }

    // Build per-site JQL for this user
    const siteJqls = buildUserWorklogJqlPerSite([user], rangeFrom, rangeTo);
    const issues = siteJqls.length > 0
      ? await searchAllIssuesMultiSite(siteJqls, 'summary,project,status,issuetype,assignee')
      : [];

    // Fetch and filter worklogs
    const newDays = {};
    const newIssues = [];
    for (const issue of issues) {
      try {
        const worklogs = await getIssueWorklogs(issue.key, issue._site);
        const filtered = worklogs.filter(wl => {
          const wlDate = wl.started?.substring(0, 10);
          const authorId = wl.author?.accountId;
          const isUserMatch = authorId === userId || (user.siteAccounts && user.siteAccounts.some(sa => sa.accountId === authorId));
          return wlDate >= rangeFrom && wlDate <= rangeTo && isUserMatch;
        });
        if (filtered.length > 0) {
          newIssues.push({ issue, worklogs: filtered, totalSeconds: filtered.reduce((s, wl) => s + (wl.timeSpentSeconds || 0), 0) });
          filtered.forEach(wl => {
            const day = wl.started?.substring(0, 10);
            if (!newDays[day]) newDays[day] = 0;
            newDays[day] += wl.timeSpentSeconds || 0;
          });
        }
      } catch (fetchErr) { console.error('Calendar data fetch error:', fetchErr); }
    }

    // Merge new days into existing state
    Object.assign(state.days, newDays);

    // Also merge into userData.issues for the day modal
    if (state.userData) {
      newIssues.forEach(ni => {
        const existing = state.userData.issues.find(iw => iw.issue.key === ni.issue.key);
        if (existing) {
          // Add new worklogs that aren't already present
          ni.worklogs.forEach(wl => {
            if (!existing.worklogs.some(ew => ew.id === wl.id)) {
              existing.worklogs.push(wl);
              existing.totalSeconds += wl.timeSpentSeconds || 0;
            }
          });
        } else {
          state.userData.issues.push(ni);
        }
      });
      // Update days map
      Object.assign(state.userData.days || {}, newDays);
    }

    renderCalendarGrid(tabId);
  } catch (err) {
    // On error, just render with what we have
    renderCalendarGrid(tabId);
  }
}

function attachCalendarNavHandlers(tabId) {
  const container = document.getElementById(`user-daily-${tabId}`);
  if (!container) return;

  // Nav buttons removed — calendar is locked to selected date range

  container.querySelector('.wl-cal-prev')?.addEventListener('click', async () => {
    const state = calendarStates[tabId];
    if (state.view === 'week') {
      // Week nav — clamp within selected date range
      const ws = new Date(state.weekStart);
      ws.setDate(ws.getDate() - 7);
      const rangeStart = new Date(dateFrom + 'T00:00:00');
      if (ws < rangeStart) return;
      state.weekStart = ws;
      await loadCalendarData(tabId);
    } else if (state.view === 'month' && state.isMultiMonth) {
      // Month nav for custom multi-month ranges
      state.month--;
      if (state.month < 0) { state.month = 11; state.year--; }
      // Clamp: don't go before dateFrom month
      const fromDate = new Date(dateFrom + 'T00:00:00');
      if (state.year < fromDate.getFullYear() || (state.year === fromDate.getFullYear() && state.month < fromDate.getMonth())) {
        state.month = fromDate.getMonth(); state.year = fromDate.getFullYear();
        return;
      }
      await loadCalendarData(tabId);
    }
  });

  container.querySelector('.wl-cal-next')?.addEventListener('click', async () => {
    const state = calendarStates[tabId];
    if (state.view === 'week') {
      // Week nav — clamp within selected date range
      const ws = new Date(state.weekStart);
      ws.setDate(ws.getDate() + 7);
      const rangeEnd = new Date(dateTo + 'T00:00:00');
      if (ws > rangeEnd) return;
      state.weekStart = ws;
      await loadCalendarData(tabId);
    } else if (state.view === 'month' && state.isMultiMonth) {
      // Month nav for custom multi-month ranges
      state.month++;
      if (state.month > 11) { state.month = 0; state.year++; }
      // Clamp: don't go beyond dateTo month
      const toDate = new Date(dateTo + 'T00:00:00');
      if (state.year > toDate.getFullYear() || (state.year === toDate.getFullYear() && state.month > toDate.getMonth())) {
        state.month = toDate.getMonth(); state.year = toDate.getFullYear();
        return;
      }
      await loadCalendarData(tabId);
    }
  });

  container.querySelectorAll('.wl-cal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = calendarStates[tabId];
      state.view = btn.dataset.view;
      container.querySelectorAll('.wl-cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
      if (state.view === 'week') {
        // Set to the first week within the selected month
        state.weekStart = getWeekStart(new Date(state.year, state.month, 1));
      }
      // Toggle nav visibility
      const navEl = document.getElementById(`cal-nav-${tabId}`);
      const labelMonthEl = document.getElementById(`cal-label-month-${tabId}`);
      if (navEl) navEl.classList.toggle('d-none', state.view === 'month' && !state.isMultiMonth);
      if (labelMonthEl) labelMonthEl.classList.toggle('d-none', state.view === 'week' || state.isMultiMonth);
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
  if (!userData) { contentEl.innerHTML = '<p class="text-subtlest">No data</p>'; modal.classList.add('wl-modal-visible'); return; }

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
    contentEl.innerHTML = '<p class="settings-empty-state">No work logged on this day.</p>';
  } else {
    const totalDaySec = dayTasks.reduce((s, t) => s + t.totalSeconds, 0);

    // Group by site
    const siteGroups = new Map();
    dayTasks.forEach(t => {
      const siteName = t.issue._site?.name || 'Default';
      const siteUrl = t.issue._site?.url || jiraUrl;
      const key = siteUrl;
      if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
      siteGroups.get(key).items.push(t);
    });

    const multiSite = siteGroups.size > 1;

    contentEl.innerHTML = `
      <div class="wl-day-modal-summary">
        Total: <strong>${formatDuration(totalDaySec)}</strong> across ${dayTasks.length} task${dayTasks.length !== 1 ? 's' : ''}
      </div>
      ${Array.from(siteGroups.values()).map(group => `
        ${multiSite ? `<div class="wl-site-group-title">${group.siteName}</div>` : ''}
        ${group.items.map(t => `
          <div class="wl-day-task-card">
            <div class="wl-day-task-header">
              <div class="flex-row-gap-075 wl-day-task-key-col">
                <a href="${group.siteUrl}/browse/${t.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${t.issue.key}</a>
                <span class="text-body-small text-truncate">${t.issue.fields?.summary || ''}</span>
              </div>
              <span class="wl-time-badge">${formatDuration(t.totalSeconds)}</span>
            </div>
          </div>
        `).join('')}
      `).join('')}
    `;
  }
  modal.classList.add('wl-modal-visible');
}

/* TASK_DETAILS_DISABLED — uncomment when re-enabling
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
TASK_DETAILS_DISABLED */



/* ── Excel Export ─────────────────────────────────── */

async function exportToExcel() {
  if (!lastReportData) {
    showToast('warning', 'Generate a report first');
    return;
  }

  // Dynamic import — only load exceljs + file-saver when needed
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);

  const { perUserData } = lastReportData;
  const expectedHoursPerDay = getExpectedHours();
  const userIds = Object.keys(perUserData);
  const userNames = userIds.map(id => perUserData[id].name);
  const colCount = 1 + userNames.length;

  // Use current dateFrom/dateTo for the export range (matches the selected preset)
  const allDaysInRange = [];
  const fromDate = new Date(dateFrom + 'T00:00:00');
  const toDate = new Date(dateTo + 'T00:00:00');
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    allDaysInRange.push(d.toISOString().split('T')[0]);
  }

  const wb = new ExcelJS.Workbook();
  const sheetLabel = fromDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const ws = wb.addWorksheet(sheetLabel.substring(0, 31));

  // Shared styles
  const border = {
    top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
  };
  const centerAlign = { horizontal: 'center', vertical: 'middle' };

  // ── Row 1: Title ══
  const fmtFrom = new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
  const fmtTo = new Date(dateTo + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
  const titleLabel = userNames.length === 1
    ? `Work Log Export - ${userNames[0]} - ${fmtFrom} - ${fmtTo}`
    : `Work Log Export - ${fmtFrom} - ${fmtTo}`;
  const titleRow = ws.addRow([titleLabel]);
  ws.mergeCells(1, 1, 1, colCount);
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1F4E79' } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 28;

  // ── Row 2: Header ──
  const headerRow = ws.addRow(['Date', ...userNames]);
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = centerAlign;
    cell.border = border;
  });
  headerRow.height = 22;

  // ── Data rows ──
  allDaysInRange.forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dayLabel = `${dateStr} (${d.toLocaleDateString('en-US', { weekday: 'short' })})`;
    const workday = isWorkday(dateStr);
    const holiday = getHolidayOnDate(dateStr);

    const vals = [dayLabel];
    userIds.forEach(userId => {
      const seconds = perUserData[userId]?.days?.[dateStr] || 0;
      const hours = Math.round((seconds / 3600) * 100) / 100;
      if (holiday || !workday) {
        vals.push('—');
      } else {
        vals.push(hours > 0 ? `${hours}h` : '0h');
      }
    });

    const row = ws.addRow(vals);
    row.getCell(1).font = { size: 10 };
    row.getCell(1).border = border;

    userIds.forEach((userId, idx) => {
      const cell = row.getCell(idx + 2);
      cell.alignment = centerAlign;
      cell.border = border;
      cell.font = { size: 10 };

      const seconds = perUserData[userId]?.days?.[dateStr] || 0;
      const hours = seconds / 3600;

      if (holiday || !workday) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
        cell.font = { size: 10, color: { argb: 'FF808080' } };
      } else if (hours > 9) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBD4B4' } };
        cell.font = { size: 10, color: { argb: 'FFBF4F00' } };
      } else if (hours >= expectedHoursPerDay) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
        cell.font = { size: 10, color: { argb: 'FF006100' } };
      } else if (hours > 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
        cell.font = { size: 10, color: { argb: 'FF9C5700' } };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        cell.font = { size: 10, color: { argb: 'FF9C0006' } };
      }
    });
  });

  // ── Summary rows ──
  const summaryFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
  const summaryFont = { bold: true, size: 11 };
  const workdayCount = countWorkdaysInRange(dateFrom, dateTo);
  const totalExpectedHours = expectedHoursPerDay * workdayCount;

  // Total row
  const totalVals = ['Total'];
  userIds.forEach(userId => {
    const totalSec = perUserData[userId]?.totalSeconds || 0;
    totalVals.push(`${(Math.round((totalSec / 3600) * 100) / 100)}h`);
  });
  const totalRow = ws.addRow(totalVals);
  totalRow.eachCell(cell => {
    cell.fill = summaryFill;
    cell.font = summaryFont;
    cell.alignment = centerAlign;
    cell.border = border;
  });

  // Expected row
  const expectedVals = ['Expected'];
  userIds.forEach(() => expectedVals.push(`${totalExpectedHours}h`));
  const expectedRow = ws.addRow(expectedVals);
  expectedRow.eachCell(cell => {
    cell.fill = summaryFill;
    cell.font = summaryFont;
    cell.alignment = centerAlign;
    cell.border = border;
  });

  // Diff % row
  const diffVals = ['Diff %'];
  userIds.forEach(userId => {
    const totalSec = perUserData[userId]?.totalSeconds || 0;
    const totalHours = totalSec / 3600;
    const diffPct = totalExpectedHours > 0 ? Math.round(((totalHours - totalExpectedHours) / totalExpectedHours) * 100) : 0;
    diffVals.push(`${diffPct >= 0 ? '+' : ''}${diffPct}%`);
  });
  const diffRow = ws.addRow(diffVals);
  diffRow.eachCell((cell, colNum) => {
    cell.alignment = centerAlign;
    cell.border = border;
    cell.font = { bold: true, size: 11 };
    if (colNum > 1) {
      const userId = userIds[colNum - 2];
      const totalSec = perUserData[userId]?.totalSeconds || 0;
      const totalHours = totalSec / 3600;
      const diffPct = totalExpectedHours > 0 ? ((totalHours - totalExpectedHours) / totalExpectedHours) * 100 : 0;
      if (diffPct >= 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
        cell.font = { bold: true, size: 11, color: { argb: 'FF006100' } };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        cell.font = { bold: true, size: 11, color: { argb: 'FF9C0006' } };
      }
    } else {
      cell.fill = summaryFill;
    }
  });

  // ── Empty row + Legend ──
  ws.addRow([]);
  const legendItems = [
    ['Green', 'Met expected hours (≥' + expectedHoursPerDay + 'h)', 'FFC6EFCE', 'FF006100'],
    ['Yellow', 'Underlogged (<' + expectedHoursPerDay + 'h but >0)', 'FFFFEB9C', 'FF9C5700'],
    ['Orange', 'Overlogged (>9h)', 'FFFBD4B4', 'FFBF4F00'],
    ['Red', 'No log (0h)', 'FFFFC7CE', 'FF9C0006'],
    ['Gray', 'Weekend / Holiday', 'FFD9D9D9', 'FF808080'],
  ];
  legendItems.forEach(([label, desc, bg, fg]) => {
    const row = ws.addRow([label, desc]);
    const colorCell = row.getCell(1);
    colorCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    colorCell.font = { bold: true, size: 9, color: { argb: fg } };
    colorCell.alignment = centerAlign;
    row.getCell(2).font = { size: 9, color: { argb: 'FF666666' } };
  });

  // Column widths
  ws.getColumn(1).width = 24;
  for (let i = 2; i <= colCount; i++) ws.getColumn(i).width = 16;

  // Generate and download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const fileName = `WorkLog_${dateFrom}_to_${dateTo}.xlsx`;
  saveAs(blob, fileName);
  showToast('success', `Exported to ${fileName}`);
}

/* ── Helpers ──────────────────────────────────────── */

function renderDiffBadge(actualSeconds, expectedHours) {
  if (expectedHours <= 0) return '';
  const actualHours = actualSeconds / 3600;
  const diffPct = Math.round(((actualHours - expectedHours) / expectedHours) * 100);
  const cls = diffPct >= 0 ? 'positive' : 'negative';
  const sign = diffPct >= 0 ? '+' : '';
  const label = diffPct >= 0 ? 'above target' : 'below target';
  return `<div class="stat-card-change ${cls}">${sign}${diffPct}% ${label}</div>`;
}

function renderTaskList(userData, jiraUrl, tabId) {
  if (!userData || userData.issues.length === 0) {
    return '<div class="settings-empty-state">No tasks to display.</div>';
  }

  const { issues } = userData;
  // Group by site
  const siteGroups = new Map();
  issues.sort((a, b) => b.totalSeconds - a.totalSeconds).forEach(iw => {
    const siteName = iw.issue._site?.name || 'Default';
    const siteUrl = iw.issue._site?.url || jiraUrl;
    const key = siteUrl;
    if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
    siteGroups.get(key).items.push(iw);
  });

  const multiSite = siteGroups.size > 1;
  let globalIdx = 0;

  const content = Array.from(siteGroups.values()).map(group => {
    const header = multiSite ? `<div class="wl-site-group-title">${group.siteName}</div>` : '';
    const items = group.items.map(iw => {
      const idx = globalIdx++;
      const bodyId = `wl-body-${tabId}-task-${idx}`;
      return `
        <div class="wl-accordion-item">
          <button class="wl-accordion-header" data-idx="${tabId}-task-${idx}" aria-expanded="false">
            <div class="wl-accordion-left">
              <svg class="wl-accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              <a href="${group.siteUrl}/browse/${iw.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${iw.issue.key}</a>
              <span class="wl-issue-summary">${iw.issue.fields?.summary || ''}</span>
            </div>
            <div class="wl-accordion-right">
              <span class="lozenge ${getStatusLozengeClass(iw.issue.fields?.status?.statusCategory?.key)} flex-shrink-0">${iw.issue.fields?.status?.name || ''}</span>
              <span class="lozenge lozenge-default flex-shrink-0">${iw.issue.fields?.project?.name || iw.issue.fields?.project?.key || ''}</span>
              <span class="wl-time-badge">${formatDuration(iw.totalSeconds)}</span>
            </div>
          </button>
          <div class="wl-accordion-body d-none" id="${bodyId}">
            <table class="table wl-table-no-margin">
              <thead><tr><th>Date</th><th>Time Spent</th><th>Comment</th></tr></thead>
              <tbody>
                ${iw.worklogs.sort((a, b) => new Date(a.started) - new Date(b.started)).map(wl => `
                  <tr>
                    <td class="wl-worklog-date-cell">${wl.started ? new Date(wl.started).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
                    <td class="text-medium">${wl.timeSpent || formatDuration(wl.timeSpentSeconds || 0)}</td>
                    <td class="wl-worklog-comment-cell">${extractComment(wl.comment) || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
    return header + items;
  }).join('');

  return `
    <div class="wl-task-list-summary mb-150">
      <span class="text-subtle">${issues.length} task${issues.length !== 1 ? 's' : ''} · ${issues.reduce((s, iw) => s + iw.worklogs.length, 0)} entries · ${formatDuration(userData.totalSeconds)} total</span>
    </div>
    <div class="wl-task-list" data-tab="${tabId}">
      ${content}
    </div>
  `;
}


function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function countWorkdaysInRange(from, to) {
  let count = 0;
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    if (isWorkday(formatDate(d))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
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
    /* ── Inline Filter Bar ─────────────────────────── */
    .wl-filter-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-150);
      padding: var(--ds-space-100) 0;
      margin-bottom: var(--ds-space-200);
      border-bottom: 1px solid var(--ds-border);
    }
    .wl-filter-bar-left {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      flex-wrap: wrap;
    }
    .wl-filter-bar-right {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
    }
    .wl-pill-wrapper {
      position: relative;
    }
    .wl-filter-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 0 12px;
      background: transparent;
      border: 1px solid var(--ds-border);
      border-radius: 4px;
      font-family: var(--ds-font-family-body);
      font-size: 14px;
      font-weight: 500;
      line-height: 20px;
      color: var(--ds-text-subtle);
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
    }
    .wl-filter-pill:hover {
      background: var(--ds-background-neutral-subtle-hovered);
      color: var(--ds-text);
    }
    .wl-filter-pill.wl-pill-active {
      background: rgba(76, 154, 255, 0.08);
      border-color: var(--ds-border-brand);
      color: var(--ds-text-brand);
    }
    .wl-filter-pill.wl-pill-active:hover {
      background: rgba(76, 154, 255, 0.14);
    }
    .wl-pill-chevron {
      flex-shrink: 0;
      width: 12px;
      height: 12px;
      opacity: 0.7;
    }
    .wl-filter-pill.wl-pill-active .wl-pill-chevron {
      opacity: 1;
    }
    .wl-pill-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 18px;
      padding: 0 5px;
      background: rgba(76, 154, 255, 0.2);
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--ds-text-brand);
      line-height: 1;
      margin-left: 2px;
    }

    /* ── Popover ─────────────────────────────────────── */
    .wl-popover {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 300px;
      background: var(--ds-surface-overlay);
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      box-shadow: var(--ds-shadow-overlay);
      z-index: 400;
      animation: wl-popover-in 0.15s ease-out;
    }
    @keyframes wl-popover-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .wl-popover-header {
      padding: var(--ds-space-150) var(--ds-space-150) var(--ds-space-075);
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-semibold);
      color: var(--ds-text-subtlest);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 11px;
    }
    .wl-popover-search {
      padding: 0 var(--ds-space-150) var(--ds-space-100);
      position: relative;
    }
    .wl-popover-search-icon {
      position: absolute;
      left: calc(var(--ds-space-150) + 8px);
      top: 50%;
      transform: translateY(-50%);
      color: var(--ds-icon-subtle);
      pointer-events: none;
    }
    .wl-popover-search-input {
      width: 100%;
      padding: 6px 8px 6px 30px;
      background: var(--ds-background-input);
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-100);
      color: var(--ds-text);
      font: var(--ds-font-body-small);
      outline: none;
      transition: border-color var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-popover-search-input:focus {
      border-color: var(--ds-border-focused);
      box-shadow: 0 0 0 1px var(--ds-border-focused);
    }
    .wl-popover-results {
      max-height: 180px;
      overflow-y: auto;
      border-top: 1px solid var(--ds-border);
    }

    /* ── Selected Users List ──────────────────────── */
    .wl-selected-list {
      border-top: 1px solid var(--ds-border);
      padding: var(--ds-space-075) 0;
      max-height: 200px;
      overflow-y: auto;
    }
    .wl-selected-user-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--ds-space-050) var(--ds-space-150);
      transition: background-color var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-selected-user-item:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .wl-selected-user-left {
      display: flex;
      align-items: center;
      gap: var(--ds-space-075);
      min-width: 0;
    }
    .wl-selected-user-name {
      font: var(--ds-font-body-small);
      color: var(--ds-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wl-selected-user-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      background: none;
      border: none;
      border-radius: var(--ds-radius-round);
      cursor: pointer;
      color: var(--ds-icon-subtle);
      padding: 0;
      flex-shrink: 0;
    }
    .wl-selected-user-remove:hover {
      background: var(--ds-background-danger-bold);
      color: var(--ds-text-inverse);
    }
    .wl-selected-empty {
      padding: var(--ds-space-150);
      text-align: center;
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtlest);
    }

    /* ── Date Popover ─────────────────────────────── */
    .wl-date-mode-toggle {
      display: flex;
      gap: var(--ds-space-050);
      background: var(--ds-background-neutral);
      border-radius: var(--ds-radius-100);
      padding: 2px;
    }
    .wl-date-mode-btn {
      flex: 1;
      padding: 4px 12px;
      background: none;
      border: none;
      border-radius: var(--ds-radius-050);
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text-subtle);
      cursor: pointer;
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-date-mode-btn.active {
      background: var(--ds-surface);
      color: var(--ds-text);
      box-shadow: var(--ds-shadow-raised);
    }
    .wl-date-panel {
      padding: var(--ds-space-150);
    }
    .wl-date-year-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--ds-space-150);
    }
    .wl-date-year-label {
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
      color: var(--ds-text);
    }
    .wl-date-nav-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: none;
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-100);
      cursor: pointer;
      color: var(--ds-icon);
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-date-nav-btn:hover {
      background: var(--ds-background-neutral-hovered);
      border-color: var(--ds-border-bold);
    }
    .wl-month-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--ds-space-050);
    }
    .wl-month-cell {
      padding: 8px 4px;
      background: none;
      border: 1px solid transparent;
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text);
      cursor: pointer;
      text-align: center;
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .wl-month-cell:hover {
      background: var(--ds-background-neutral-hovered);
      border-color: var(--ds-border);
    }
    .wl-month-cell.selected {
      background: var(--ds-background-brand-bold);
      color: var(--ds-text-inverse);
      border-color: var(--ds-background-brand-bold);
    }
    .wl-month-cell.active:not(.selected) {
      border-color: var(--ds-border-brand);
      color: var(--ds-text-brand);
    }

    /* ── Custom Date Panel ────────────────────────── */
    .wl-custom-date-row {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      margin-bottom: var(--ds-space-100);
    }
    .wl-custom-date-row:last-child { margin-bottom: 0; }
    .wl-custom-date-label {
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text-subtle);
      min-width: 36px;
    }
    .wl-custom-date-input {
      flex: 1;
    }
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
      padding: var(--ds-space-150) var(--ds-space-075);
      border-radius: var(--ds-radius-200);
      cursor: pointer;
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
      min-height: 68px;
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
      position: absolute;
      top: 4px;
      right: 6px;
      font-size: 11px;
      font-weight: var(--ds-font-weight-medium);
      opacity: 0.8;
    }
    .wl-cal-hours {
      font-size: 16px;
      font-weight: var(--ds-font-weight-bold);
      line-height: 1;
    }
    .wl-cal-overlog {
      background: color-mix(in srgb, #E56910 18%, transparent);
      color: #E56910;
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
    .wl-cal-holiday-name {
      font-size: 9px;
      line-height: 1.2;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
      margin-top: 2px;
    }
    /* Calendar Nav */
    .wl-cal-nav {
      display: flex;
      align-items: center;
      gap: var(--ds-space-050);
    }
    .wl-cal-nav.d-none {
      display: none;
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
      color: var(--ds-text);
      transition: all var(--ds-duration-fast);
    }
    .wl-cal-view-btn.active {
      background: var(--ds-background-brand-bold);
      color: var(--ds-text-inverse);
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
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--ds-space-300);
    }
    .wl-day-modal-overlay.wl-modal-visible {
      display: flex;
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

    /* Avatar images */
    .wl-avatar-img {
      width: 24px;
      height: 24px;
      border-radius: var(--ds-radius-round);
      object-fit: cover;
    }

    /* Panel header layout */
    .wl-panel-header-left {
      display: flex;
      align-items: center;
      gap: var(--ds-space-150);
    }

    /* Breakdown toggle (Calendar | Tasks) */
    .wl-breakdown-toggle {
      display: flex;
      gap: 2px;
      background: var(--ds-background-neutral);
      border-radius: var(--ds-radius-100);
      padding: 2px;
    }
    .wl-breakdown-btn {
      display: flex;
      align-items: center;
      gap: var(--ds-space-050);
      padding: var(--ds-space-050) var(--ds-space-100);
      border: none;
      background: none;
      border-radius: var(--ds-radius-050);
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text-subtle);
      cursor: pointer;
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
      white-space: nowrap;
    }
    .wl-breakdown-btn:hover {
      color: var(--ds-text);
    }
    .wl-breakdown-btn.active {
      background: var(--ds-surface);
      color: var(--ds-text);
      box-shadow: var(--ds-shadow-raised);
    }
    .wl-breakdown-panel {
      display: none;
    }
    .wl-breakdown-panel.active {
      display: block;
    }

    /* Task list summary */
    .wl-task-list-summary {
      padding: var(--ds-space-100) 0;
      border-bottom: 1px solid var(--ds-border);
    }

    /* Day modal summary */
    .wl-day-modal-summary {
      padding: var(--ds-space-100) var(--ds-space-150);
      background: var(--ds-background-neutral);
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtle);
      margin-bottom: var(--ds-space-200);
    }

    /* Day modal worklog entries */
    .wl-day-task-worklogs {
      padding: var(--ds-space-075) var(--ds-space-150);
      border-top: 1px solid var(--ds-border);
      background: var(--ds-surface-sunken);
      border-radius: 0 0 var(--ds-radius-100) var(--ds-radius-100);
    }
    .wl-day-worklog-entry {
      display: flex;
      gap: var(--ds-space-100);
      padding: var(--ds-space-050) 0;
      font: var(--ds-font-body-small);
    }
    .wl-day-worklog-entry + .wl-day-worklog-entry {
      border-top: 1px solid var(--ds-border);
    }
    .wl-day-worklog-time {
      flex-shrink: 0;
      font-weight: var(--ds-font-weight-medium);
      color: var(--ds-text);
      min-width: 48px;
    }
    .wl-day-worklog-comment {
      color: var(--ds-text-subtle);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}
