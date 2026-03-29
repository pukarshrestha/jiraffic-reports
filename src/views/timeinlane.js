/**
 * Time in Lane Report — Time spent in each status lane per issue
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
import { searchUsers, buildUserLaneTimeJqlPerSite, searchAllIssuesWithChangelog } from '../services/jira.js';
import { injectWorklogStyles } from './worklog.js';
import { getGroups } from '../services/settings.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

let selectedUsers = [];
let dateFrom = '';
let dateTo = '';
let searchTimeout = null;
let regenTimeout = null;
let lastReportData = null;

export async function renderTimeInLane() {
  const creds = getCredentials();
  if (!creds) { navigate('/login'); return; }

  const app = document.getElementById('app');
  renderAppShell(app, 'timeinlane');
  updateBreadcrumbs([{ label: 'Time in Lane' }]);

  const now = new Date();
  dateFrom = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  dateTo = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

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

  // Inject shared WL styles (filter bar, pills, popover, tabs, accordion) + TIL-specific styles
  injectWorklogStyles();
  injectTimeInLaneStyles();

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Time in Lane</h1>
      <p class="page-subtitle">Time spent in each workflow lane per issue</p>
    </div>

    <!-- Filters — Inline pill bar (matches WL pattern) -->
    <div class="wl-filter-bar" id="til-filters">
      <div class="wl-filter-bar-left">
        <!-- Users pill -->
        <div class="wl-pill-wrapper" id="til-users-pill-wrapper">
          <button class="wl-filter-pill" id="til-users-pill" type="button">
            <span id="til-users-pill-label">Users</span>
            <svg class="wl-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Users popover -->
          <div class="wl-popover d-none" id="til-users-popover">
            <div class="wl-popover-header">Select Users</div>
            <div class="wl-popover-search">
              <svg class="wl-popover-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input class="wl-popover-search-input" type="text" id="til-user-search" placeholder="Search users..." autocomplete="off" />
            </div>
            <div id="til-user-dropdown" class="wl-popover-results d-none"></div>
            <div id="til-selected-users-list" class="wl-selected-list"></div>
          </div>
        </div>

        <!-- Date pill -->
        <div class="wl-pill-wrapper" id="til-date-pill-wrapper">
          <button class="wl-filter-pill" id="til-date-pill" type="button">
            <span id="til-date-pill-label">${now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            <svg class="wl-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Date popover -->
          <div class="wl-popover d-none" id="til-date-popover">
            <div class="wl-popover-header">
              <div class="wl-date-mode-toggle">
                <button class="wl-date-mode-btn active" data-mode="month" type="button">Month</button>
                <button class="wl-date-mode-btn" data-mode="custom" type="button">Custom</button>
              </div>
            </div>
            <div id="til-date-month-panel" class="wl-date-panel">
              <div class="wl-date-year-row">
                <button class="wl-date-nav-btn" id="til-year-prev" type="button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span class="wl-date-year-label" id="til-year-label">${now.getFullYear()}</span>
                <button class="wl-date-nav-btn" id="til-year-next" type="button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
              <div class="wl-month-grid" id="til-month-grid"></div>
            </div>
            <div id="til-date-custom-panel" class="wl-date-panel d-none">
              <div class="wl-custom-date-row">
                <label class="wl-custom-date-label">From</label>
                <input class="input wl-custom-date-input" type="date" id="til-date-from" value="${dateFrom}" />
              </div>
              <div class="wl-custom-date-row">
                <label class="wl-custom-date-label">To</label>
                <input class="input wl-custom-date-input" type="date" id="til-date-to" value="${dateTo}" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="wl-filter-bar-right">
        <button class="btn btn-default-outline btn-sm d-none" id="til-export-excel-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>
    </div>

    <div id="til-results"></div>
  `;

  // ── Users pill popover ────────────────────────
  const usersPill = document.getElementById('til-users-pill');
  const usersPopover = document.getElementById('til-users-popover');
  const datePill = document.getElementById('til-date-pill');
  const datePopover = document.getElementById('til-date-popover');

  function updateUsersPillLabel() {
    const label = document.getElementById('til-users-pill-label');
    if (selectedUsers.length === 0) {
      label.innerHTML = 'Users';
    } else if (selectedUsers.length === 1) {
      label.innerHTML = selectedUsers[0].displayName;
    } else {
      label.innerHTML = `${selectedUsers[0].displayName} <span class="wl-pill-badge">+${selectedUsers.length - 1}</span>`;
    }
  }

  function renderSelectedUsersList() {
    const list = document.getElementById('til-selected-users-list');
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
      setTimeout(() => document.getElementById('til-user-search')?.focus(), 50);
    }
  });

  // User search inside popover
  const searchInput = document.getElementById('til-user-search');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) {
      document.getElementById('til-user-dropdown').classList.add('d-none');
      return;
    }
    searchTimeout = setTimeout(() => searchAndShowUsers(query), 300);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = document.querySelector('#til-user-dropdown .user-dropdown-item:not(.d-none)');
      if (firstItem) firstItem.click();
    }
    if (e.key === 'Escape') {
      document.getElementById('til-user-dropdown').classList.add('d-none');
      closeAllPopovers();
    }
  });

  // ── Date pill popover ─────────────────────────
  let pickerYear = now.getFullYear();
  let pickerMonth = now.getMonth();
  let dateMode = 'month';

  function updateDatePillLabel() {
    const label = document.getElementById('til-date-pill-label');
    if (dateMode === 'month') {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      label.textContent = `${monthNames[pickerMonth]} ${pickerYear}`;
    } else {
      label.textContent = `${dateFrom} → ${dateTo}`;
    }
  }

  function renderMonthGrid() {
    const grid = document.getElementById('til-month-grid');
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('til-year-label').textContent = pickerYear;
    grid.innerHTML = monthNames.map((m, i) => {
      return `<button class="wl-month-cell ${i === pickerMonth ? 'selected' : ''}" data-month="${i}">${m}</button>`;
    }).join('');
    grid.querySelectorAll('.wl-month-cell').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerMonth = parseInt(btn.dataset.month);
        dateFrom = formatDate(new Date(pickerYear, pickerMonth, 1));
        dateTo = formatDate(new Date(pickerYear, pickerMonth + 1, 0));
        updateDatePillLabel();
        renderMonthGrid();
        closeAllPopovers();
        scheduleRegenerate();
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
  document.getElementById('til-year-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    pickerYear--;
    renderMonthGrid();
  });
  document.getElementById('til-year-next').addEventListener('click', (e) => {
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
      document.getElementById('til-date-month-panel').classList.toggle('d-none', dateMode !== 'month');
      document.getElementById('til-date-custom-panel').classList.toggle('d-none', dateMode !== 'custom');
    });
  });

  // Custom date inputs
  document.getElementById('til-date-from').addEventListener('change', (e) => {
    dateFrom = e.target.value;
    updateDatePillLabel();
    scheduleRegenerate();
  });
  document.getElementById('til-date-to').addEventListener('change', (e) => {
    dateTo = e.target.value;
    updateDatePillLabel();
    scheduleRegenerate();
  });

  // Close popovers on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#til-users-pill-wrapper')) {
      usersPopover.classList.add('d-none');
      usersPill.classList.remove('wl-pill-active');
    }
    if (!e.target.closest('#til-date-pill-wrapper')) {
      datePopover.classList.add('d-none');
      datePill.classList.remove('wl-pill-active');
    }
  });

  // Initialize labels
  updateUsersPillLabel();
  updateDatePillLabel();
  renderSelectedUsersList();

  // Auto-generate on load
  if (selectedUsers.length > 0) {
    generateReport();
  }
}

/* ── Auto-regenerate with debounce ───────────────── */

function scheduleRegenerate() {
  clearTimeout(regenTimeout);
  regenTimeout = setTimeout(() => {
    if (selectedUsers.length > 0) generateReport();
  }, 500);
}

/* ── User picker ────────────────────────────────── */

function refreshUserChips() {
  const pillLabel = document.getElementById('til-users-pill-label');
  if (pillLabel) {
    if (selectedUsers.length === 0) {
      pillLabel.innerHTML = 'Users';
    } else if (selectedUsers.length === 1) {
      pillLabel.innerHTML = selectedUsers[0].displayName;
    } else {
      pillLabel.innerHTML = `${selectedUsers[0].displayName} <span class="wl-pill-badge">+${selectedUsers.length - 1}</span>`;
    }
  }
}

async function searchAndShowUsers(query) {
  const dropdown = document.getElementById('til-user-dropdown');
  try {
    const users = await searchUsers(query);
    const filtered = users.filter(u => u.accountType === 'atlassian' && !selectedUsers.some(s => s.accountId === u.accountId));
    const groups = getGroups();
    const matchingGroups = groups.filter(g => g.name.toLowerCase().includes(query.toLowerCase()) && g.users.length > 0);

    let html = '';
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
      if (filtered.length > 0) html += '<div class="dropdown-separator"></div>';
    }

    if (filtered.length > 0) {
      html += filtered.map(u => `
        <button class="user-dropdown-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}" data-avatar="${u.avatarUrls?.['48x48'] || ''}">
          ${u.avatarUrls?.['24x24']
            ? `<img src="${u.avatarUrls['24x24']}" alt="" class="dropdown-avatar-img" />`
            : `<span class="avatar avatar-sm dropdown-avatar-initial">${u.displayName.charAt(0).toUpperCase()}</span>`}
          <div>
            <div class="dropdown-item-name">${u.displayName}</div>
            ${u.emailAddress ? `<div class="dropdown-item-sub">${u.emailAddress}</div>` : ''}
          </div>
        </button>
      `).join('');
    }

    if (!html) html = '<div class="user-dropdown-empty">No users or groups found</div>';
    dropdown.innerHTML = html;
    dropdown.classList.remove('d-none');

    dropdown.querySelectorAll('.user-dropdown-group').forEach(item => {
      item.addEventListener('click', () => {
        const group = groups.find(g => g.id === item.dataset.groupId);
        if (group) {
          group.users.forEach(u => {
            if (!selectedUsers.some(s => s.accountId === u.accountId)) {
              selectedUsers.push({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrl || '' });
            }
          });
          refreshUserChips();
          document.getElementById('til-user-search').value = '';
          dropdown.classList.add('d-none');
          scheduleRegenerate();
        }
      });
    });

    dropdown.querySelectorAll('.user-dropdown-item:not(.user-dropdown-group)').forEach(item => {
      item.addEventListener('click', () => {
        const accountId = item.dataset.accountId;
        const fullUser = users.find(u => u.accountId === accountId);
        selectedUsers.push({
          accountId,
          displayName: item.dataset.name,
          emailAddress: item.dataset.email,
          avatarUrl: item.dataset.avatar || '',
          siteAccounts: fullUser?.siteAccounts || [{ accountId, siteUrl: '', siteName: '' }],
        });
        refreshUserChips();
        document.getElementById('til-user-search').value = '';
        dropdown.classList.add('d-none');
        scheduleRegenerate();
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="user-dropdown-empty">Error searching users</div>';
    dropdown.classList.remove('d-none');
  }
}

/* ── Report generation ───────────────────────────── */

const LANE_TODO = 'To Do';
const LANE_IN_PROGRESS = 'In Progress';
const LANE_IN_REVIEW = 'In Review';
const LANE_DONE = 'Done';
const LANE_ORDER = [LANE_TODO, LANE_IN_PROGRESS, LANE_IN_REVIEW];
const LANE_ORDER_ALL = [LANE_TODO, LANE_IN_PROGRESS, LANE_IN_REVIEW, LANE_DONE];

async function generateReport() {
  if (selectedUsers.length === 0) {
    showToast('warning', 'Select at least one user');
    return;
  }

  // Hide export button during loading
  const exportBtn = document.getElementById('til-export-excel-btn');
  if (exportBtn) exportBtn.classList.add('d-none');

  const results = document.getElementById('til-results');
  results.innerHTML = `
    <div class="loading-screen">
      <div class="spinner spinner-lg"></div>
      <p class="wl-loading-progress">Fetching issues and changelogs...</p>
    </div>
  `;

  try {
    const siteJqls = buildUserLaneTimeJqlPerSite(selectedUsers, dateFrom, dateTo);
    if (siteJqls.length === 0) {
      results.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="empty-state-title">No matching sites</p>
          <p class="empty-state-description">The selected users don't have accounts on any connected Jira sites.</p>
        </div>`;
      return;
    }

    // Compute previous-month date range
    const curFrom = new Date(dateFrom + 'T00:00:00');
    const prevEnd = new Date(curFrom.getTime() - 86400000); // day before current dateFrom
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
    const prevDateFrom = formatDate(prevStart);
    const prevDateTo = formatDate(prevEnd);
    const prevSiteJqls = buildUserLaneTimeJqlPerSite(selectedUsers, prevDateFrom, prevDateTo);

    // Progress callback to update loading text
    const onProgress = ({ message }) => {
      const progressEl = document.querySelector('.wl-loading-progress');
      if (progressEl) progressEl.textContent = message;
    };

    const issueFields = 'summary,status,assignee,project,issuetype,parent,created,resolutiondate';

    // Fetch current + previous month in parallel
    const [issues, prevIssues] = await Promise.all([
      searchAllIssuesWithChangelog(siteJqls, issueFields, onProgress),
      prevSiteJqls.length > 0
        ? searchAllIssuesWithChangelog(prevSiteJqls, issueFields)
        : Promise.resolve([]),
    ]);

    if (!issues.length) {
      results.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="empty-state-title">No issues found</p>
          <p class="empty-state-description">No issues with status changes found for the selected users in this date range.</p>
        </div>`;
      return;
    }

    onProgress({ message: `Processing ${issues.length} issues...` });

    const laneData = issues.map(issue => ({
      issue,
      lanes: computeLaneTimes(issue),
    }));

    const prevLaneData = prevIssues.map(issue => ({
      issue,
      lanes: computeLaneTimes(issue),
    }));

    // Store for export
    lastReportData = { laneData };

    renderResults(laneData, prevLaneData);

    // Show export button
    if (exportBtn) {
      exportBtn.classList.remove('d-none');
      exportBtn.onclick = exportToExcel;
    }
  } catch (err) {
    results.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">Error</p>
        <p class="empty-state-description">${err.message}</p>
      </div>`;
  }
}

/**
 * Parse issue changelog to compute time in each lane.
 */
function computeLaneTimes(issue) {
  const histories = issue.changelog?.histories || [];
  const lanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 }; // keep Done internally for bar calculations
  const statusChanges = [];

  histories.forEach(h => {
    const ts = new Date(h.created).getTime();
    h.items?.forEach(item => {
      if (item.field === 'status') {
        statusChanges.push({ ts, from: item.fromString, to: item.toString });
      }
    });
  });

  statusChanges.sort((a, b) => a.ts - b.ts);

  const created = new Date(issue.fields?.created || Date.now()).getTime();
  const now = Date.now();

  if (statusChanges.length === 0) {
    const currentStatus = classifyStatus(issue.fields?.status?.name || 'To Do');
    lanes[currentStatus] += now - created;
    return lanes;
  }

  const firstFrom = classifyStatus(statusChanges[0].from);
  lanes[firstFrom] += statusChanges[0].ts - created;

  for (let i = 0; i < statusChanges.length; i++) {
    const lane = classifyStatus(statusChanges[i].to);
    const start = statusChanges[i].ts;
    const end = i + 1 < statusChanges.length ? statusChanges[i + 1].ts : now;
    lanes[lane] += end - start;
  }

  return lanes;
}

function classifyStatus(statusName) {
  if (!statusName) return LANE_TODO;
  const lower = statusName.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved' || lower === 'complete' || lower === 'completed') return LANE_DONE;
  if (lower.includes('review') || lower.includes('testing') || lower.includes('qa') || lower.includes('code review') || lower.includes('validation')) return LANE_IN_REVIEW;
  if (lower.includes('progress') || lower.includes('development') || lower.includes('dev') || lower.includes('working') || lower.includes('started') || lower.includes('active') || lower.includes('implement') || lower.includes('doing') || lower.includes('in work')) return LANE_IN_PROGRESS;
  return LANE_TODO;
}

/* ── Render results with tabs ───────────────────── */

function renderResults(laneData, prevLaneData) {
  const results = document.getElementById('til-results');

  // Build a lookup: which accountIds belong to which selected user
  const accountIdToUserId = new Map();
  selectedUsers.forEach(u => {
    accountIdToUserId.set(u.accountId, u.accountId);
    if (u.siteAccounts) {
      u.siteAccounts.forEach(sa => {
        accountIdToUserId.set(sa.accountId, u.accountId);
      });
    }
  });

  // Build task groups from ALL items (so subtasks from any user are included)
  const siteGroups = new Map();
  laneData.forEach(d => {
    const siteName = d.issue._site?.name || 'Default';
    const siteUrl = d.issue._site?.url || '';
    if (!siteGroups.has(siteUrl)) siteGroups.set(siteUrl, { siteName, siteUrl, items: [] });
    siteGroups.get(siteUrl).items.push(d);
  });

  // Build task groups per site
  const allTaskGroupsBySite = [];
  for (const [, group] of siteGroups) {
    const taskGroups = buildTaskGroups(group.items, group.items);
    allTaskGroupsBySite.push({ ...group, taskGroups });
  }

  // Build previous-month task groups (for comparison)
  const prevSiteGroups = new Map();
  (prevLaneData || []).forEach(d => {
    const siteName = d.issue._site?.name || 'Default';
    const siteUrl = d.issue._site?.url || '';
    if (!prevSiteGroups.has(siteUrl)) prevSiteGroups.set(siteUrl, { siteName, siteUrl, items: [] });
    prevSiteGroups.get(siteUrl).items.push(d);
  });
  const prevAllTaskGroupsBySite = [];
  for (const [, group] of prevSiteGroups) {
    const taskGroups = buildTaskGroups(group.items, group.items);
    prevAllTaskGroupsBySite.push({ ...group, taskGroups });
  }

  // Helper: filter task groups for a specific user
  // A task group shows under user X if the PARENT's assignee matches user X
  function filterTaskGroupsForUser(userId, taskGroupsBySite) {
    const filtered = [];
    for (const sg of taskGroupsBySite) {
      const userGroups = sg.taskGroups.filter(tg => {
        const parentAssigneeId = tg.parent.issue?.fields?.assignee?.accountId;
        const resolvedUserId = parentAssigneeId ? accountIdToUserId.get(parentAssigneeId) : null;
        return resolvedUserId === userId;
      });
      if (userGroups.length > 0) {
        filtered.push({ ...sg, taskGroups: userGroups });
      }
    }
    return filtered;
  }

  // Helper: compute stats from task groups
  function computeStats(siteTaskGroups) {
    const avgLanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0 };
    let issueCount = 0;
    const cycleTimes = [];
    siteTaskGroups.forEach(sg => {
      sg.taskGroups.forEach(tg => {
        const items = tg.subtasks.length > 0 ? tg.subtasks : (tg.parent.lanes ? [tg.parent] : []);
        items.forEach(item => {
          LANE_ORDER.forEach(l => { avgLanes[l] += item.lanes[l]; });
          cycleTimes.push(item.lanes[LANE_IN_PROGRESS] + item.lanes[LANE_IN_REVIEW]);
          issueCount++;
        });
      });
    });
    if (issueCount > 0) {
      LANE_ORDER.forEach(l => { avgLanes[l] /= issueCount; });
    }

    // Derived metrics
    const avgCycleTime = avgLanes[LANE_IN_PROGRESS] + avgLanes[LANE_IN_REVIEW];
    const avgLeadTime = avgLanes[LANE_TODO] + avgCycleTime;
    const flowEfficiency = avgLeadTime > 0
      ? (avgLanes[LANE_IN_PROGRESS] / avgLeadTime * 100).toFixed(1)
      : 0;
    const devPlusReview = avgLanes[LANE_IN_PROGRESS] + avgLanes[LANE_IN_REVIEW];
    const reviewRatio = devPlusReview > 0
      ? (avgLanes[LANE_IN_REVIEW] / devPlusReview * 100).toFixed(1)
      : 0;

    // Median & P90 cycle time
    cycleTimes.sort((a, b) => a - b);
    const medianCycleTime = cycleTimes.length > 0 ? cycleTimes[Math.floor(cycleTimes.length / 2)] : 0;
    const p90CycleTime = cycleTimes.length > 0 ? cycleTimes[Math.floor(cycleTimes.length * 0.9)] : 0;

    return { avgLanes, issueCount, avgCycleTime, flowEfficiency, reviewRatio, medianCycleTime, p90CycleTime };
  }

  // Build tabs
  const showTabs = selectedUsers.length > 1;
  const tabIds = showTabs ? [...selectedUsers.map(u => u.accountId), 'all'] : [];
  const tabLabels = showTabs ? [...selectedUsers.map(u => u.displayName), 'All Users'] : [];
  const tabAvatars = showTabs ? [...selectedUsers.map(u => u.avatarUrl || ''), ''] : [];

  if (showTabs) {
    results.innerHTML = `
      <!-- Tab Bar -->
      <div class="wl-tabs" id="til-tabs">
        ${tabIds.map((id, i) => `
          <button class="wl-tab ${i === 0 ? 'active' : ''}" data-tab="${id}">
            ${id === 'all' ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` : (tabAvatars[i] ? `<img src="${tabAvatars[i]}" alt="" class="wl-tab-avatar" />` : `<span class="avatar avatar-sm wl-tab-avatar">${tabLabels[i].charAt(0).toUpperCase()}</span>`)}
            <span>${tabLabels[i]}</span>
          </button>
        `).join('')}
      </div>
      <!-- Tab Panels -->
      ${tabIds.map((id, i) => {
        const userSiteGroups = id === 'all' ? allTaskGroupsBySite : filterTaskGroupsForUser(id, allTaskGroupsBySite);
        const stats = computeStats(userSiteGroups);
        const prevUserSiteGroups = id === 'all' ? prevAllTaskGroupsBySite : filterTaskGroupsForUser(id, prevAllTaskGroupsBySite);
        const prevStats = prevUserSiteGroups.length > 0 ? computeStats(prevUserSiteGroups) : null;
        const showAssigneeCol = id === 'all';
        return `
        <div class="wl-tab-panel ${i === 0 ? 'active' : ''}" data-panel="${id}">
          ${renderStatCards(stats, prevStats)}
          ${renderLaneAccordionFromGroups(userSiteGroups, showAssigneeCol)}
        </div>`;
      }).join('')}
    `;

    // Tab switching
    document.getElementById('til-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.wl-tab');
      if (!tab) return;
      const targetId = tab.dataset.tab;
      document.querySelectorAll('#til-tabs .wl-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === targetId));
      document.querySelectorAll('#til-results .wl-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === targetId));
    });
  } else {
    // Single user — no tabs
    const allStats = computeStats(allTaskGroupsBySite);
    const prevAllStats = prevAllTaskGroupsBySite.length > 0 ? computeStats(prevAllTaskGroupsBySite) : null;
    results.innerHTML = `
      ${renderStatCards(allStats, prevAllStats)}
      ${renderLaneAccordionFromGroups(allTaskGroupsBySite, false)}
    `;
  }

  // Wire accordion toggles
  wireAccordionToggles();

  // Set bar widths via JS (percentage-based)
  document.querySelectorAll('.til-bar-segment').forEach(seg => {
    const pct = parseFloat(seg.dataset.pct) || 0;
    seg.style.width = pct + '%';
  });
}

function wireAccordionToggles() {
  document.querySelectorAll('.til-accordion-toggle').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // don't toggle on link click
      const groupId = row.dataset.group;
      row.classList.toggle('expanded');
      document.querySelectorAll(`tr[data-parent="${groupId}"]`).forEach(sub => {
        sub.classList.toggle('d-none');
      });
    });
  });
}

const INFO_ICON = `<svg class="stat-card-info-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

const TREND_UP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
const TREND_DOWN = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

/**
 * Render a stat card with info tooltip and optional trend indicator.
 * @param {string} label
 * @param {string} value
 * @param {string} tooltip
 * @param {string} [hint]
 * @param {{ pct: number, isInverse?: boolean }} [trend] — pct is % change, isInverse means lower is better
 */
function statCardWithInfo(label, value, tooltip, hint, trend) {
  let trendHtml = '';
  if (trend && isFinite(trend.pct) && trend.pct !== 0) {
    const isUp = trend.pct > 0;
    // For inverse metrics (time, cycle time), going up is bad (red), going down is good (green)
    // For normal metrics (efficiency), going up is good (green)
    const isPositive = trend.isInverse ? !isUp : isUp;
    const cls = isPositive ? 'positive' : 'negative';
    const arrow = isUp ? TREND_UP : TREND_DOWN;
    const absPct = Math.abs(trend.pct).toFixed(0);
    trendHtml = `<div class="stat-card-trend ${cls}">${arrow} ${absPct}%</div>`;
  } else if (trend && trend.pct === 0) {
    trendHtml = `<div class="stat-card-trend neutral">— no change</div>`;
  }

  return `
    <div class="stat-card">
      <div class="stat-card-header">
        <div class="stat-card-label">${label}</div>
        <div class="stat-card-info-wrapper">
          ${INFO_ICON}
          <div class="stat-card-tooltip">${tooltip}</div>
        </div>
      </div>
      <div class="stat-card-value">${value}</div>
      ${trendHtml}
      ${hint ? `<div class="stat-card-hint">${hint}</div>` : ''}
    </div>`;
}

/**
 * Compute percentage change: ((cur - prev) / prev) * 100.
 * Returns null if no previous data.
 */
function pctChange(cur, prev) {
  if (prev == null || prev === 0) return cur > 0 ? 100 : null;
  return ((cur - prev) / prev) * 100;
}

function renderStatCards(stats, prevStats) {
  const { avgLanes, issueCount, avgCycleTime, flowEfficiency, reviewRatio, medianCycleTime, p90CycleTime } = stats;

  // Build trend objects — null if no previous data
  function trend(cur, prev, isInverse) {
    if (prevStats == null) return null;
    const delta = pctChange(cur, prev);
    if (delta == null) return null;
    return { pct: delta, isInverse };
  }

  const pTodo    = prevStats ? trend(avgLanes[LANE_TODO], prevStats.avgLanes[LANE_TODO], true) : null;
  const pProg    = prevStats ? trend(avgLanes[LANE_IN_PROGRESS], prevStats.avgLanes[LANE_IN_PROGRESS], true) : null;
  const pReview  = prevStats ? trend(avgLanes[LANE_IN_REVIEW], prevStats.avgLanes[LANE_IN_REVIEW], true) : null;
  const pCount   = prevStats ? trend(issueCount, prevStats.issueCount, false) : null;
  const pCycle   = prevStats ? trend(avgCycleTime, prevStats.avgCycleTime, true) : null;
  const pFlow    = prevStats ? trend(parseFloat(flowEfficiency), parseFloat(prevStats.flowEfficiency), false) : null;
  const pRR      = prevStats ? trend(parseFloat(reviewRatio), parseFloat(prevStats.reviewRatio), true) : null;
  const pMedian  = prevStats ? trend(medianCycleTime, prevStats.medianCycleTime, true) : null;
  const pP90     = prevStats ? trend(p90CycleTime, prevStats.p90CycleTime, true) : null;

  return `
    <div class="stat-grid mb-300">
      ${statCardWithInfo('AVG IN TO DO', formatMs(avgLanes[LANE_TODO]),
        'How long issues sit in the backlog before anyone starts working on them. E.g. if this is 3 days, issues wait about 3 days after creation before work begins.',
        null, pTodo)}
      ${statCardWithInfo('AVG IN PROGRESS', formatMs(avgLanes[LANE_IN_PROGRESS]),
        'How long issues are actively being worked on. E.g. if this is 5 days, it takes about 5 days of development time per issue on average.',
        null, pProg)}
      ${statCardWithInfo('AVG IN REVIEW', formatMs(avgLanes[LANE_IN_REVIEW]),
        'How long issues spend waiting for or going through code review, QA, or testing. A high number may signal a review bottleneck.',
        null, pReview)}
      ${statCardWithInfo('ISSUES TRACKED', `${issueCount}`,
        'Total number of issues included in this report for the selected users and date range.',
        null, pCount)}
    </div>
    <div class="stat-grid stat-grid-5 mb-300">
      ${statCardWithInfo('AVG CYCLE TIME', formatMs(avgCycleTime),
        'Average time from when work starts to when it\u2019s done (In Progress + In Review). E.g. if this is 7 days, a typical issue takes about a week from start to finish.',
        'In Progress + In Review', pCycle)}
      ${statCardWithInfo('FLOW EFFICIENCY', `${flowEfficiency}%`,
        'What percentage of total time is spent actively working vs. waiting. E.g. 80% means issues spend 80% of their life being worked on and only 20% waiting in To Do.',
        'Active work \u00f7 total time', pFlow)}
      ${statCardWithInfo('REVIEW RATIO', `${reviewRatio}%`,
        'How much of the active cycle is spent in review vs. development. E.g. 30% means for every 7h of dev, there\u2019s about 3h of review time.',
        'In Review \u00f7 (In Progress + In Review)', pRR)}
      ${statCardWithInfo('MEDIAN CYCLE TIME', formatMs(medianCycleTime),
        'The middle value when all cycle times are sorted. Unlike the average, this isn\u2019t skewed by one very slow issue. It shows what a \u201ctypical\u201d issue looks like.',
        '50th percentile', pMedian)}
      ${statCardWithInfo('P90 CYCLE TIME', formatMs(p90CycleTime),
        '90% of issues finish faster than this. It shows your worst-case realistic delivery time. E.g. if P90 is 14 days, only 1 in 10 issues takes longer than 2 weeks.',
        '90th percentile', pP90)}
    </div>
  `;
}

function renderTableHeader(showAssigneeInHeader) {
  return `
    <tr>
      <th class="til-col-key">Key</th>
      <th class="til-col-summary">Summary</th>
      <th class="til-col-assignee">Assignee</th>
      <th class="til-col-bar">Lane Distribution</th>
      <th class="til-col-time">To Do</th>
      <th class="til-col-time">In Progress</th>
      <th class="til-col-time">In Review</th>
      <th class="til-col-total">Total</th>
    </tr>
  `;
}

/* ── Render from pre-built task groups ──────────── */

function renderLaneAccordionFromGroups(siteTaskGroups, showAssigneeInHeader) {
  const hasAny = siteTaskGroups.some(sg => sg.taskGroups.length > 0);
  if (!hasAny) {
    return `
      <div class="card mb-300">
        <div class="empty-state">
          <p class="empty-state-title">No issues</p>
          <p class="empty-state-description">No issues found for this user in the selected date range.</p>
        </div>
      </div>`;
  }

  const colSpan = 8; // always 8 columns now (assignee always present)

  let html = `
    <div class="card mb-300">
      <h3 class="text-heading-small mb-150">Lane Breakdown</h3>
      <div class="til-legend">
        <span class="til-legend-item"><span class="til-legend-dot til-dot-todo"></span> To Do</span>
        <span class="til-legend-item"><span class="til-legend-dot til-dot-progress"></span> In Progress</span>
        <span class="til-legend-item"><span class="til-legend-dot til-dot-review"></span> In Review</span>
      </div>
  `;

  for (const sg of siteTaskGroups) {
    html += `
      <div class="table-container til-table-wrapper">
        <table class="table til-table">
          <thead class="til-sticky-head">
            <tr class="til-site-row"><td colspan="${colSpan}"><div class="wl-site-group-title">${sg.siteName}</div></td></tr>
            ${renderTableHeader(showAssigneeInHeader)}
          </thead>
          <tbody>
    `;

    let rowIdx = 0;
    sg.taskGroups.forEach(tg => {
      if (tg.subtasks.length === 0) {
        html += renderSoloRow(tg.parent, sg.siteUrl, rowIdx);
      } else {
        html += renderTaskAccordion(tg, sg.siteUrl, rowIdx);
      }
      rowIdx++;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;
  }

  html += `</div>`;
  return html;
}

/**
 * Group items into parent→subtask hierarchy.
 * 
 * An issue is a "subtask" if issue.fields.parent exists.
 * If the parent key itself is also in the items list, group them.
 * Otherwise, use the parent key/summary from the subtask's parent field.
 * Issues without a parent become standalone entries.
 */
function buildTaskGroups(items, allItems) {
  allItems = allItems || items; // fallback if not provided
  const byKey = new Map();  // key → laneData item
  const subtaskOf = new Map(); // subtask key → parent key

  // First pass: index all issues and identify subtasks
  items.forEach(d => {
    byKey.set(d.issue.key, d);
    if (d.issue.fields?.parent) {
      subtaskOf.set(d.issue.key, d.issue.fields.parent.key);
    }
  });

  // Build groups: parentKey → { parent info, subtasks[] }
  const groups = new Map();
  const consumed = new Set();

  items.forEach(d => {
    if (subtaskOf.has(d.issue.key)) {
      // This issue is a subtask
      const parentKey = subtaskOf.get(d.issue.key);
      if (!groups.has(parentKey)) {
        // Create group from parent data (either from items list or from the subtask's parent field)
        const parentItem = byKey.get(parentKey);
        groups.set(parentKey, {
          parent: parentItem || {
            issue: {
              key: parentKey,
              fields: {
                summary: d.issue.fields.parent.fields?.summary || parentKey,
                assignee: null,
                issuetype: d.issue.fields.parent.fields?.issuetype || null,
              },
              _site: d.issue._site,
            },
            lanes: null, // Will compute as sum
          },
          subtasks: [],
          parentInItems: !!parentItem,
        });
        if (parentItem) consumed.add(parentKey);
      }
      if (!groups.get(parentKey).subtasks.some(s => s.issue.key === d.issue.key)) {
        groups.get(parentKey).subtasks.push(d);
      }
      consumed.add(d.issue.key);
    }
  });

  // Second pass: add standalone issues (not a subtask, not consumed as a parent)
  items.forEach(d => {
    if (!consumed.has(d.issue.key)) {
      groups.set(d.issue.key, { parent: d, subtasks: [], parentInItems: true });
    }
  });

  // Third pass: for parents with subtasks, also pull in subtasks from allItems
  // that weren't in the filtered items (e.g. subtasks assigned to other users)
  for (const [parentKey, tg] of groups) {
    if (tg.subtasks.length > 0 || consumed.has(parentKey)) {
      allItems.forEach(d => {
        if (d.issue.fields?.parent?.key === parentKey && !tg.subtasks.some(s => s.issue.key === d.issue.key)) {
          tg.subtasks.push(d);
        }
      });
    }
  }

  // Compute aggregate lanes for parents with subtasks
  for (const [, tg] of groups) {
    if (tg.subtasks.length > 0) {
      const aggLanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 };
      tg.subtasks.forEach(st => {
        LANE_ORDER_ALL.forEach(l => { aggLanes[l] += st.lanes[l]; });
      });
      // If parent has its own lane data, add it too
      if (tg.parent.lanes) {
        LANE_ORDER_ALL.forEach(l => { aggLanes[l] += tg.parent.lanes[l]; });
      }
      tg.aggLanes = aggLanes;
    }
  }

  return Array.from(groups.values());
}

function renderLaneBarHtml(lanes) {
  // Use only the 3 visible lanes for total so segments fill 100% of the bar
  const visibleTotal = LANE_ORDER.reduce((s, l) => s + lanes[l], 0);
  const pctTodo = visibleTotal > 0 ? (lanes[LANE_TODO] / visibleTotal * 100) : 0;
  const pctProgress = visibleTotal > 0 ? (lanes[LANE_IN_PROGRESS] / visibleTotal * 100) : 0;
  const pctReview = visibleTotal > 0 ? (lanes[LANE_IN_REVIEW] / visibleTotal * 100) : 0;
  return `
    <div class="til-bar">
      <div class="til-bar-segment til-seg-todo" data-pct="${pctTodo.toFixed(1)}"></div>
      <div class="til-bar-segment til-seg-progress" data-pct="${pctProgress.toFixed(1)}"></div>
      <div class="til-bar-segment til-seg-review" data-pct="${pctReview.toFixed(1)}"></div>
    </div>
  `;
}

function renderSoloRow(d, siteUrl, rowIdx) {
  const total = LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0);
  return `
    <tr class="til-parent-row">
      <td class="til-col-key"><a href="${siteUrl}/browse/${d.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${d.issue.key}</a></td>
      <td class="til-col-summary text-truncate">${d.issue.fields?.summary || ''}</td>
      <td class="til-col-assignee"></td>
      <td class="til-col-bar til-bar-cell">${renderLaneBarHtml(d.lanes)}</td>
      <td class="til-col-time til-time-cell">${formatMs(d.lanes[LANE_TODO])}</td>
      <td class="til-col-time til-time-cell">${formatMs(d.lanes[LANE_IN_PROGRESS])}</td>
      <td class="til-col-time til-time-cell">${formatMs(d.lanes[LANE_IN_REVIEW])}</td>
      <td class="til-col-total til-time-cell"><span class="wl-time-badge">${formatMs(total)}</span></td>
    </tr>
  `;
}

function renderTaskAccordion(tg, siteUrl, rowIdx) {
  const lanes = tg.aggLanes || tg.parent.lanes || { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 };
  const total = LANE_ORDER.reduce((s, l) => s + lanes[l], 0);
  const parentKey = tg.parent.issue.key;
  const parentSummary = tg.parent.issue.fields?.summary || '';
  const groupId = `tg-${parentKey.replace(/[^a-zA-Z0-9]/g, '-')}`;

  let html = `
    <tr class="til-parent-row til-accordion-toggle" data-group="${groupId}">
      <td class="til-col-key">
        <div class="til-key-with-chevron">
          <svg class="til-accordion-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          <a href="${siteUrl}/browse/${parentKey}" target="_blank" rel="noopener" class="wl-issue-key" onclick="event.stopPropagation()">${parentKey}</a>
        </div>
      </td>
      <td class="til-col-summary">
        <div class="til-summary-with-badge">
          <span class="text-truncate">${parentSummary}</span>
          <span class="til-subtask-count">${tg.subtasks.length} subtask${tg.subtasks.length !== 1 ? 's' : ''}</span>
        </div>
      </td>
      <td class="til-col-assignee"></td>
      <td class="til-col-bar til-bar-cell">${renderLaneBarHtml(lanes)}</td>
      <td class="til-col-time til-time-cell">${formatMs(lanes[LANE_TODO])}</td>
      <td class="til-col-time til-time-cell">${formatMs(lanes[LANE_IN_PROGRESS])}</td>
      <td class="til-col-time til-time-cell">${formatMs(lanes[LANE_IN_REVIEW])}</td>
      <td class="til-col-total til-time-cell"><span class="wl-time-badge">${formatMs(total)}</span></td>
    </tr>
  `;

  // Subtask rows (hidden by default) — always show assignee with avatar
  tg.subtasks.forEach(d => {
    const stTotal = LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0);
    const assignee = d.issue.fields?.assignee;
    const assigneeName = assignee?.displayName || 'Unassigned';
    const avatarUrl = assignee?.avatarUrls?.['24x24'] || assignee?.avatarUrls?.['16x16'] || '';
    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" alt="" class="til-subtask-avatar" />`
      : `<span class="til-subtask-avatar-fallback">${assigneeName.charAt(0).toUpperCase()}</span>`;
    html += `
    <tr class="til-subtask-row d-none" data-parent="${groupId}">
      <td class="til-col-key til-indent"><a href="${siteUrl}/browse/${d.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${d.issue.key}</a></td>
      <td class="til-col-summary text-truncate">${d.issue.fields?.summary || ''}</td>
      <td class="til-col-assignee til-assignee-cell">
        <div class="til-assignee-with-avatar">
          ${avatarHtml}
          <span>${assigneeName}</span>
        </div>
      </td>
      <td class="til-col-bar til-bar-cell">${renderLaneBarHtml(d.lanes)}</td>
      <td class="til-col-time til-time-cell">${formatMs(d.lanes[LANE_TODO])}</td>
      <td class="til-col-time til-time-cell">${formatMs(d.lanes[LANE_IN_PROGRESS])}</td>
      <td class="til-col-time til-time-cell">${formatMs(d.lanes[LANE_IN_REVIEW])}</td>
      <td class="til-col-total til-time-cell"><span class="wl-time-badge">${formatMs(stTotal)}</span></td>
    </tr>`;
  });

  return html;
}

/* ── Excel export ──────────────────────────────── */

async function exportToExcel() {
  if (!lastReportData) {
    showToast('warning', 'Generate a report first');
    return;
  }

  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);

  const { laneData } = lastReportData;
  const wb = new ExcelJS.Workbook();

  const fmtFrom = new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
  const fmtTo = new Date(dateTo + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
  const titleLabel = selectedUsers.length === 1
    ? `Time in Lane - ${selectedUsers[0].displayName} - ${fmtFrom} to ${fmtTo}`
    : `Time in Lane - ${fmtFrom} to ${fmtTo}`;

  const sheetLabel = new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const ws = wb.addWorksheet(sheetLabel.substring(0, 31));

  const border = {
    top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
  };
  const centerAlign = { horizontal: 'center', vertical: 'middle' };
  const headers = ['Key', 'Summary', 'Assignee', 'Parent', 'To Do', 'In Progress', 'In Review', 'Total'];
  const colCount = headers.length;

  // Title row
  const titleRow = ws.addRow([titleLabel]);
  ws.mergeCells(1, 1, 1, colCount);
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1F4E79' } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 28;

  // Header row
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = centerAlign;
    cell.border = border;
  });
  headerRow.height = 22;

  // Data rows
  laneData.forEach(d => {
    const total = LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0);
    const assigneeName = d.issue.fields?.assignee?.displayName || 'Unassigned';
    const parentKey = d.issue.fields?.parent?.key || '';
    const row = ws.addRow([
      d.issue.key,
      d.issue.fields?.summary || '',
      assigneeName,
      parentKey,
      formatMs(d.lanes[LANE_TODO]),
      formatMs(d.lanes[LANE_IN_PROGRESS]),
      formatMs(d.lanes[LANE_IN_REVIEW]),
      formatMs(total),
    ]);
    row.eachCell((cell, colNum) => {
      cell.border = border;
      cell.alignment = colNum >= 5 ? centerAlign : { vertical: 'middle' };
      cell.font = { size: 11 };
    });
  });

  // Auto-width columns
  ws.columns.forEach((col, i) => {
    let maxLen = headers[i].length;
    col.eachCell({ includeEmpty: false }, cell => {
      const len = cell.value ? cell.value.toString().length : 0;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 4, 50);
  });

  const buf = await wb.xlsx.writeBuffer();
  const fileName = `time-in-lane-${dateFrom}-to-${dateTo}.xlsx`;
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
  showToast('success', `Exported ${fileName}`);
}

/* ── Helpers ──────────────────────────────────────── */

function formatMs(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return min > 0 ? `${hours}h ${min}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 7) return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  return `${days}d`;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ── Injected Styles ─────────────────────────────── */

function injectTimeInLaneStyles() {
  if (document.getElementById('til-injected-styles')) return;
  const style = document.createElement('style');
  style.id = 'til-injected-styles';
  style.textContent = `
    /* ── Tab avatar ─────────────────────────────────── */
    .wl-tab-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }

    /* ── Sticky table header ─────────────────────────── */
    .til-table-wrapper {
      position: relative;
      margin-bottom: var(--ds-space-200);
    }
    .til-sticky-head {
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .til-sticky-head th {
      background: var(--ds-surface) !important;
    }
    .til-site-row td {
      padding: 0 !important;
      border-bottom: none !important;
    }

    /* ── Table base ────────────────────────────────── */
    .til-table th,
    .til-table td {
      padding: 10px 12px;
      vertical-align: middle;
    }
    .til-table th {
      font: var(--ds-font-body-small);
      font-weight: 600;
      color: var(--ds-text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .til-table td {
      font: var(--ds-font-body-small);
    }

    /* ── Column widths ────────────────────────────── */
    .til-col-key { width: 100px; white-space: nowrap; }
    .til-col-summary { min-width: 200px; max-width: 350px; }
    .til-col-assignee { width: 140px; }
    .til-col-bar { min-width: 160px; }
    .til-col-time { width: 90px; white-space: nowrap; }
    .til-col-total { width: 80px; white-space: nowrap; }

    /* ── Time cells: left-aligned ─────────────────── */
    .til-table .til-time-cell {
      white-space: nowrap;
      text-align: left;
      font-variant-numeric: tabular-nums;
    }
    .til-table .til-bar-cell {
      min-width: 160px;
    }

    /* ── Parent rows ──────────────────────────────── */
    .til-parent-row {
      background: var(--ds-surface);
      transition: background-color var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .til-parent-row:hover {
      background: var(--ds-surface-hovered);
    }
    .til-accordion-toggle {
      cursor: pointer;
    }

    /* ── Key + chevron layout ─────────────────────── */
    .til-key-with-chevron {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .til-accordion-chevron {
      flex-shrink: 0;
      color: var(--ds-icon-subtle);
      transition: transform var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .til-accordion-toggle.expanded .til-accordion-chevron {
      transform: rotate(180deg);
    }

    /* ── Summary + badge layout ───────────────────── */
    .til-summary-with-badge {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
    }
    .til-summary-with-badge .text-truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .til-subtask-count {
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtlest);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Subtask rows ─────────────────────────────── */
    .til-subtask-row {
      background: var(--ds-surface-sunken);
    }
    .til-subtask-row:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .til-indent {
      padding-left: 36px !important;
    }

    /* ── Assignee cell ────────────────────────────── */
    .til-assignee-cell {
      white-space: nowrap;
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtle);
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .til-assignee-with-avatar {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .til-subtask-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .til-subtask-avatar-fallback {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--ds-background-neutral-bold);
      color: var(--ds-text-inverse);
      font: var(--ds-font-body-small);
      font-weight: 600;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}
