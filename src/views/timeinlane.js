/**
 * Time in Lane Report — Time spent in each status lane per issue
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
import { searchUsers, buildUserLaneTimeJqlPerSite, searchAllIssuesWithChangelog } from '../services/jira.js';
import { getGroups } from '../services/settings.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

let selectedUsers = [];
let dateFrom = '';
let dateTo = '';
let searchTimeout = null;
let regenTimeout = null;

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

  // Inject custom styles
  injectTimeInLaneStyles();

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Time in Lane</h1>
      <p class="page-subtitle">Time spent in each workflow lane per issue</p>
    </div>

    <!-- Filters — Inline pill bar -->
    <div class="til-filter-bar" id="til-filters">
      <div class="til-filter-bar-left">
        <!-- Users pill -->
        <div class="til-pill-wrapper" id="til-users-pill-wrapper">
          <button class="til-filter-pill" id="til-users-pill" type="button">
            <span id="til-users-pill-label">Users</span>
            <svg class="til-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Users popover -->
          <div class="til-popover d-none" id="til-users-popover">
            <div class="til-popover-header">SELECT USERS</div>
            <div class="til-popover-body">
              <div class="til-search-wrap">
                <svg class="til-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input class="til-search-input" type="text" id="til-user-search" placeholder="Search users..." autocomplete="off" />
              </div>
              <div id="til-user-dropdown" class="til-user-dropdown d-none"></div>
              <div id="til-selected-users-list" class="til-selected-users-list"></div>
            </div>
          </div>
        </div>

        <!-- Date pill -->
        <div class="til-pill-wrapper" id="til-date-pill-wrapper">
          <button class="til-filter-pill" id="til-date-pill" type="button">
            <span id="til-date-pill-label">${now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            <svg class="til-pill-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <!-- Date popover -->
          <div class="til-popover d-none" id="til-date-popover">
            <div class="til-date-mode-bar">
              <button class="til-date-mode-btn active" data-mode="month">Month</button>
              <button class="til-date-mode-btn" data-mode="custom">Custom</button>
            </div>
            <div id="til-date-month-panel" class="til-date-month-panel">
              <div class="til-year-nav">
                <button class="til-year-btn" id="til-year-prev" type="button">&lsaquo;</button>
                <span class="til-year-label" id="til-year-label">${now.getFullYear()}</span>
                <button class="til-year-btn" id="til-year-next" type="button">&rsaquo;</button>
              </div>
              <div class="til-month-grid" id="til-month-grid"></div>
            </div>
            <div id="til-date-custom-panel" class="til-date-custom-panel d-none">
              <div class="til-custom-field">
                <label class="til-custom-label">From</label>
                <input class="til-custom-input" type="date" id="til-date-from" value="${dateFrom}" />
              </div>
              <div class="til-custom-field">
                <label class="til-custom-label">To</label>
                <input class="til-custom-input" type="date" id="til-date-to" value="${dateTo}" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- User row (avatar + name) -->
    <div id="til-user-row" class="til-user-row">
      ${renderUserRow()}
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
      label.innerHTML = `${selectedUsers[0].displayName} <span class="til-pill-badge">+${selectedUsers.length - 1}</span>`;
    }
  }

  function renderSelectedUsersList() {
    const list = document.getElementById('til-selected-users-list');
    if (!list) return;
    if (selectedUsers.length === 0) {
      list.innerHTML = '<div class="til-selected-empty">No users selected</div>';
      return;
    }
    list.innerHTML = selectedUsers.map((user, i) => `
      <div class="til-selected-user-item" data-index="${i}">
        <div class="til-selected-user-left">
          ${user.avatarUrl
            ? `<img src="${user.avatarUrl}" alt="" class="til-selected-avatar-img" />`
            : `<span class="avatar avatar-xs">${user.displayName.charAt(0).toUpperCase()}</span>`
          }
          <span class="til-selected-user-name">${user.displayName}</span>
        </div>
        <button class="til-selected-user-remove" data-index="${i}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');
    list.querySelectorAll('.til-selected-user-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        selectedUsers.splice(idx, 1);
        renderSelectedUsersList();
        updateUsersPillLabel();
        refreshUserRow();
        scheduleRegenerate();
      });
    });
  }

  function closeAllPopovers() {
    usersPopover.classList.add('d-none');
    datePopover.classList.add('d-none');
    usersPill.classList.remove('til-pill-active');
    datePill.classList.remove('til-pill-active');
  }

  usersPill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !usersPopover.classList.contains('d-none');
    closeAllPopovers();
    if (!isOpen) {
      usersPopover.classList.remove('d-none');
      usersPill.classList.add('til-pill-active');
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
      const firstItem = document.querySelector('#til-user-dropdown .til-dropdown-item:not(.d-none)');
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
      const isActive = i === pickerMonth && pickerYear === pickerYear;
      return `<button class="til-month-btn ${i === pickerMonth ? 'active' : ''}" data-month="${i}">${m}</button>`;
    }).join('');
    grid.querySelectorAll('.til-month-btn').forEach(btn => {
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
      datePill.classList.add('til-pill-active');
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
  datePopover.querySelectorAll('.til-date-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dateMode = btn.dataset.mode;
      datePopover.querySelectorAll('.til-date-mode-btn').forEach(b => b.classList.remove('active'));
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
      usersPill.classList.remove('til-pill-active');
    }
    if (!e.target.closest('#til-date-pill-wrapper')) {
      datePopover.classList.add('d-none');
      datePill.classList.remove('til-pill-active');
    }
  });

  // Initialize labels
  updateUsersPillLabel();
  updateDatePillLabel();

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

/* ── User row display ────────────────────────────── */

function renderUserRow() {
  if (selectedUsers.length === 0) return '';
  return selectedUsers.map(user => `
    <a class="til-user-row-item">
      ${user.avatarUrl
        ? `<img src="${user.avatarUrl}" alt="" class="til-user-row-avatar" />`
        : `<span class="avatar avatar-sm">${user.displayName.charAt(0).toUpperCase()}</span>`
      }
      <span>${user.displayName}</span>
    </a>
  `).join('<span class="til-user-row-separator">·</span>');
}

function refreshUserRow() {
  const row = document.getElementById('til-user-row');
  if (row) row.innerHTML = renderUserRow();
}

/* ── User picker ────────────────────────────────── */

function refreshUserChips() {
  // Update pill label
  const pillLabel = document.getElementById('til-users-pill-label');
  if (pillLabel) {
    if (selectedUsers.length === 0) {
      pillLabel.innerHTML = 'Users';
    } else if (selectedUsers.length === 1) {
      pillLabel.innerHTML = selectedUsers[0].displayName;
    } else {
      pillLabel.innerHTML = `${selectedUsers[0].displayName} <span class="til-pill-badge">+${selectedUsers.length - 1}</span>`;
    }
  }
  refreshUserRow();
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
        <button class="til-dropdown-item til-dropdown-group" data-group-id="${g.id}">
          <svg class="til-dropdown-group-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>
            <div class="til-dropdown-name">${g.name}</div>
            <div class="til-dropdown-sub">${g.users.length} member${g.users.length !== 1 ? 's' : ''}</div>
          </div>
        </button>
      `).join('');
      if (filtered.length > 0) html += '<div class="til-dropdown-separator"></div>';
    }

    if (filtered.length > 0) {
      html += filtered.map(u => `
        <button class="til-dropdown-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}" data-avatar="${u.avatarUrls?.['48x48'] || ''}">
          ${u.avatarUrls?.['24x24']
            ? `<img src="${u.avatarUrls['24x24']}" alt="" class="til-dropdown-avatar-img" />`
            : `<span class="avatar avatar-sm til-dropdown-avatar-initial">${u.displayName.charAt(0).toUpperCase()}</span>`}
          <div>
            <div class="til-dropdown-name">${u.displayName}</div>
            ${u.emailAddress ? `<div class="til-dropdown-sub">${u.emailAddress}</div>` : ''}
          </div>
        </button>
      `).join('');
    }

    if (!html) html = '<div class="til-dropdown-empty">No users or groups found</div>';
    dropdown.innerHTML = html;
    dropdown.classList.remove('d-none');

    dropdown.querySelectorAll('.til-dropdown-group').forEach(item => {
      item.addEventListener('click', () => {
        const group = groups.find(g => g.id === item.dataset.groupId);
        if (group) {
          group.users.forEach(u => {
            if (!selectedUsers.some(s => s.accountId === u.accountId)) {
              selectedUsers.push({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrl || '' });
            }
          });
          refreshUserChips();
          const list = document.getElementById('til-selected-users-list');
          if (list && !list.closest('.d-none')) {
            // Re-render selected list in popover if open
            const renderFn = () => {
              if (list) {
                list.innerHTML = selectedUsers.map((user, i) => `
                  <div class="til-selected-user-item" data-index="${i}">
                    <div class="til-selected-user-left">
                      ${user.avatarUrl
                        ? `<img src="${user.avatarUrl}" alt="" class="til-selected-avatar-img" />`
                        : `<span class="avatar avatar-xs">${user.displayName.charAt(0).toUpperCase()}</span>`
                      }
                      <span class="til-selected-user-name">${user.displayName}</span>
                    </div>
                    <button class="til-selected-user-remove" data-index="${i}" type="button">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                `).join('');
              }
            };
            renderFn();
          }
          document.getElementById('til-user-search').value = '';
          dropdown.classList.add('d-none');
          scheduleRegenerate();
        }
      });
    });

    dropdown.querySelectorAll('.til-dropdown-item:not(.til-dropdown-group)').forEach(item => {
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
        const list = document.getElementById('til-selected-users-list');
        if (list && !list.closest('.d-none')) {
          // trigger a full re-render of selected list
          const event = new Event('click');
          document.getElementById('til-users-pill')?.dispatchEvent(event);
        }
        document.getElementById('til-user-search').value = '';
        dropdown.classList.add('d-none');
        scheduleRegenerate();
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="til-dropdown-empty">Error searching users</div>';
    dropdown.classList.remove('d-none');
  }
}

/* ── Report generation ───────────────────────────── */

const LANE_TODO = 'To Do';
const LANE_IN_PROGRESS = 'In Progress';
const LANE_IN_REVIEW = 'In Review';
const LANE_DONE = 'Done';
const LANE_ORDER = [LANE_TODO, LANE_IN_PROGRESS, LANE_IN_REVIEW, LANE_DONE];

async function generateReport() {
  if (selectedUsers.length === 0) {
    showToast('warning', 'Select at least one user');
    return;
  }

  const results = document.getElementById('til-results');
  results.innerHTML = `
    <div class="card mb-300">
      <div class="ct-loading">
        <div class="spinner"></div>
        <p class="ct-loading-text">Fetching issues and changelogs...</p>
      </div>
    </div>
  `;

  try {
    const siteJqls = buildUserLaneTimeJqlPerSite(selectedUsers, dateFrom, dateTo);
    if (siteJqls.length === 0) {
      results.innerHTML = '<div class="card"><div class="empty-state"><p class="empty-state-title">No sites available</p></div></div>';
      return;
    }

    const issues = await searchAllIssuesWithChangelog(siteJqls, 'summary,status,assignee,project,issuetype,created,resolutiondate');
    const laneData = issues.map(issue => ({
      issue,
      lanes: computeLaneTimes(issue),
    }));

    renderResults(laneData);
  } catch (err) {
    results.innerHTML = `<div class="card"><div class="empty-state"><p class="empty-state-title">Error</p><p class="empty-state-description">${err.message}</p></div></div>`;
  }
}

/**
 * Parse issue changelog to compute time in each lane.
 * Returns { 'To Do': ms, 'In Progress': ms, 'In Review': ms, 'Done': ms }
 */
function computeLaneTimes(issue) {
  const histories = issue.changelog?.histories || [];
  const sorted = [...histories].sort((a, b) => new Date(a.created) - new Date(b.created));

  const lanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 };

  let currentLane = LANE_TODO;
  let lastTransition = new Date(issue.fields?.created);
  const now = new Date();

  for (const history of sorted) {
    for (const item of (history.items || [])) {
      if (item.field !== 'status') continue;

      const transitionTime = new Date(history.created);
      const durationMs = transitionTime - lastTransition;

      if (durationMs > 0 && lanes[currentLane] !== undefined) {
        lanes[currentLane] += durationMs;
      }

      currentLane = classifyStatus(item.toString);
      lastTransition = transitionTime;
    }
  }

  const endDate = issue.fields?.resolutiondate ? new Date(issue.fields.resolutiondate) : now;
  const remaining = endDate - lastTransition;
  if (remaining > 0 && lanes[currentLane] !== undefined) {
    lanes[currentLane] += remaining;
  }

  return lanes;
}

/**
 * Classify a status name into one of the 4 lane categories.
 */
function classifyStatus(statusName) {
  if (!statusName) return LANE_TODO;
  const lower = statusName.toLowerCase();

  const doneNames = ['done', 'closed', 'resolved', 'complete', 'completed'];
  const reviewNames = ['in review', 'code review', 'review', 'in qa', 'qa', 'testing', 'peer review'];
  const progressNames = ['in progress', 'in development', 'development', 'dev', 'working', 'active'];
  const todoNames = ['to do', 'open', 'new', 'backlog', 'created', 'selected for development', 'ready'];

  if (doneNames.some(n => lower === n || lower.includes(n))) return LANE_DONE;
  if (reviewNames.some(n => lower === n || lower.includes(n))) return LANE_IN_REVIEW;
  if (progressNames.some(n => lower === n || lower.includes(n))) return LANE_IN_PROGRESS;
  if (todoNames.some(n => lower === n || lower.includes(n))) return LANE_TODO;

  return LANE_IN_PROGRESS;
}

function renderResults(laneData) {
  const results = document.getElementById('til-results');

  if (laneData.length === 0) {
    results.innerHTML = '<div class="card"><div class="empty-state"><p class="empty-state-title">No data</p><p class="empty-state-description">No issues with status changes in this period.</p></div></div>';
    return;
  }

  // Summary averages
  const avgLanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 };
  laneData.forEach(d => {
    LANE_ORDER.forEach(lane => { avgLanes[lane] += d.lanes[lane]; });
  });
  LANE_ORDER.forEach(lane => { avgLanes[lane] /= laneData.length; });

  // Site grouping
  const siteGroups = new Map();
  laneData.forEach(d => {
    const siteName = d.issue._site?.name || 'Default';
    const siteUrl = d.issue._site?.url || '';
    const key = siteUrl;
    if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
    siteGroups.get(key).items.push(d);
  });
  const multiSite = siteGroups.size > 1;

  const maxTotal = Math.max(...laneData.map(d => LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0)), 1);

  results.innerHTML = `
    <div class="stat-grid mb-300">
      <div class="stat-card">
        <div class="stat-card-label">AVG IN TO DO</div>
        <div class="stat-card-value">${formatMs(avgLanes[LANE_TODO])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">AVG IN PROGRESS</div>
        <div class="stat-card-value">${formatMs(avgLanes[LANE_IN_PROGRESS])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">AVG IN REVIEW</div>
        <div class="stat-card-value">${formatMs(avgLanes[LANE_IN_REVIEW])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">ISSUES TRACKED</div>
        <div class="stat-card-value">${laneData.length}</div>
      </div>
    </div>

    <div class="card mb-300">
      <h3 class="text-heading-small mb-150">Lane Breakdown</h3>
      <div class="til-legend">
        <span class="til-legend-item"><span class="til-legend-dot til-dot-todo"></span> To Do</span>
        <span class="til-legend-item"><span class="til-legend-dot til-dot-progress"></span> In Progress</span>
        <span class="til-legend-item"><span class="til-legend-dot til-dot-review"></span> In Review</span>
        <span class="til-legend-item"><span class="til-legend-dot til-dot-done"></span> Done</span>
      </div>
      <div class="table-container">
        <table class="table til-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th class="til-bar-header">Lane Distribution</th>
              <th>To Do</th>
              <th>In Progress</th>
              <th>In Review</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from(siteGroups.values()).map(group => `
              ${multiSite ? `<tr class="ct-site-group-row"><td colspan="7"><div class="wl-site-group-title">${group.siteName}</div></td></tr>` : ''}
              ${group.items.map(d => {
                const total = LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0);
                const pctTodo = total > 0 ? (d.lanes[LANE_TODO] / total * 100) : 0;
                const pctProgress = total > 0 ? (d.lanes[LANE_IN_PROGRESS] / total * 100) : 0;
                const pctReview = total > 0 ? (d.lanes[LANE_IN_REVIEW] / total * 100) : 0;
                const pctDone = total > 0 ? (d.lanes[LANE_DONE] / total * 100) : 0;
                return `
                <tr>
                  <td><a href="${group.siteUrl}/browse/${d.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${d.issue.key}</a></td>
                  <td class="text-truncate ct-summary-cell">${d.issue.fields?.summary || ''}</td>
                  <td class="til-bar-cell">
                    <div class="til-bar">
                      <div class="til-bar-segment til-seg-todo" data-pct="${pctTodo.toFixed(1)}"></div>
                      <div class="til-bar-segment til-seg-progress" data-pct="${pctProgress.toFixed(1)}"></div>
                      <div class="til-bar-segment til-seg-review" data-pct="${pctReview.toFixed(1)}"></div>
                      <div class="til-bar-segment til-seg-done" data-pct="${pctDone.toFixed(1)}"></div>
                    </div>
                  </td>
                  <td class="til-time-cell">${formatMs(d.lanes[LANE_TODO])}</td>
                  <td class="til-time-cell">${formatMs(d.lanes[LANE_IN_PROGRESS])}</td>
                  <td class="til-time-cell">${formatMs(d.lanes[LANE_IN_REVIEW])}</td>
                  <td class="til-time-cell"><span class="wl-time-badge">${formatMs(total)}</span></td>
                </tr>`;
              }).join('')}
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Set bar widths via JS (percentage-based)
  document.querySelectorAll('.til-bar-segment').forEach(seg => {
    const pct = parseFloat(seg.dataset.pct) || 0;
    seg.style.width = pct + '%';
  });
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
    /* ── Filter bar layout ──────────────────────────── */
    .til-filter-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-100);
      margin-bottom: var(--ds-space-200);
    }
    .til-filter-bar-left {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
    }
    .til-pill-wrapper {
      position: relative;
    }

    /* ── Pills (ADS Dropdown Menu triggers) ──────── */
    .til-filter-pill {
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
    .til-filter-pill:hover {
      background: var(--ds-background-neutral-subtle-hovered);
      color: var(--ds-text);
    }
    .til-filter-pill.til-pill-active {
      background: rgba(76, 154, 255, 0.08);
      border-color: var(--ds-border-brand);
      color: var(--ds-text-brand);
    }
    .til-filter-pill.til-pill-active:hover {
      background: rgba(76, 154, 255, 0.14);
    }
    .til-pill-chevron {
      flex-shrink: 0;
      width: 12px;
      height: 12px;
      opacity: 0.7;
    }
    .til-filter-pill.til-pill-active .til-pill-chevron {
      opacity: 1;
    }
    .til-pill-badge {
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

    /* ── Popover ────────────────────────────────────── */
    .til-popover {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 300px;
      background: var(--ds-surface-overlay);
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      box-shadow: var(--ds-shadow-overlay);
      z-index: 400;
      animation: til-popover-in 0.15s ease-out;
    }
    @keyframes til-popover-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .til-popover-header {
      padding: 12px 16px 8px;
      font: var(--ds-font-body-small);
      font-weight: 600;
      color: var(--ds-text-subtle);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .til-popover-body {
      padding: 0 12px 12px;
    }

    /* ── Search within popover ──────────────────────── */
    .til-search-wrap {
      position: relative;
      margin-bottom: 8px;
    }
    .til-search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--ds-text-subtlest);
      pointer-events: none;
    }
    .til-search-input {
      width: 100%;
      padding: 6px 10px 6px 32px;
      background: var(--ds-background-input);
      border: 1px solid var(--ds-border-input);
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      color: var(--ds-text);
      outline: none;
      box-sizing: border-box;
    }
    .til-search-input:focus {
      border-color: var(--ds-border-focused);
      box-shadow: 0 0 0 1px var(--ds-border-focused);
    }

    /* ── User dropdown in popover ───────────────────── */
    .til-user-dropdown {
      max-height: 200px;
      overflow-y: auto;
      margin-bottom: 8px;
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-100);
      background: var(--ds-surface-overlay);
    }
    .til-dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 12px;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
      font: var(--ds-font-body-small);
      color: var(--ds-text);
      transition: background 0.1s;
    }
    .til-dropdown-item:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .til-dropdown-avatar-img {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
    }
    .til-dropdown-name {
      font-weight: 500;
    }
    .til-dropdown-sub {
      font-size: 11px;
      color: var(--ds-text-subtlest);
    }
    .til-dropdown-separator {
      height: 1px;
      background: var(--ds-border);
      margin: 4px 0;
    }
    .til-dropdown-empty {
      padding: 12px;
      text-align: center;
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtlest);
    }
    .til-dropdown-group-icon {
      color: var(--ds-text-subtlest);
    }

    /* ── Selected users list in popover ─────────────── */
    .til-selected-users-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .til-selected-user-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: var(--ds-radius-100);
      transition: background 0.1s;
    }
    .til-selected-user-item:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .til-selected-user-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .til-selected-user-name {
      font: var(--ds-font-body-small);
      color: var(--ds-text);
    }
    .til-selected-user-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      background: none;
      cursor: pointer;
      color: var(--ds-text-subtlest);
      border-radius: var(--ds-radius-050);
      transition: background 0.1s, color 0.1s;
    }
    .til-selected-user-remove:hover {
      background: var(--ds-background-danger-bold);
      color: var(--ds-text-inverse);
    }
    .til-selected-empty {
      padding: 8px;
      text-align: center;
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtlest);
    }
    .til-selected-avatar-img {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .til-avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }

    /* ── Date popover ──────────────────────────────── */
    .til-date-mode-bar {
      display: flex;
      border-bottom: 1px solid var(--ds-border);
    }
    .til-date-mode-btn {
      flex: 1;
      padding: 10px;
      background: none;
      border: none;
      font: var(--ds-font-body-small);
      font-weight: 500;
      color: var(--ds-text-subtle);
      cursor: pointer;
      text-align: center;
      border-bottom: 2px solid transparent;
      transition: color 0.1s, border-color 0.1s;
    }
    .til-date-mode-btn:hover {
      color: var(--ds-text);
    }
    .til-date-mode-btn.active {
      color: var(--ds-text-brand);
      border-bottom-color: var(--ds-border-brand);
    }
    .til-date-month-panel {
      padding: 12px;
    }
    .til-year-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--ds-space-200);
      margin-bottom: 12px;
    }
    .til-year-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-100);
      background: var(--ds-background-neutral-subtle);
      font-size: 16px;
      color: var(--ds-text-subtle);
      cursor: pointer;
      transition: background 0.1s;
    }
    .til-year-btn:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .til-year-label {
      font: var(--ds-font-heading-small);
      color: var(--ds-text);
      min-width: 60px;
      text-align: center;
    }
    .til-month-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .til-month-btn {
      padding: 8px 4px;
      background: var(--ds-background-neutral-subtle);
      border: 1px solid transparent;
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      color: var(--ds-text);
      cursor: pointer;
      text-align: center;
      transition: background 0.1s, border-color 0.1s;
    }
    .til-month-btn:hover {
      background: var(--ds-background-neutral-subtle-hovered);
    }
    .til-month-btn.active {
      background: var(--ds-background-brand-bold);
      color: var(--ds-text-inverse);
      border-color: var(--ds-border-brand);
    }
    .til-date-custom-panel {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .til-custom-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .til-custom-label {
      font: var(--ds-font-body-small);
      font-weight: 500;
      color: var(--ds-text-subtle);
    }
    .til-custom-input {
      padding: 6px 10px;
      background: var(--ds-background-input);
      border: 1px solid var(--ds-border-input);
      border-radius: var(--ds-radius-100);
      font: var(--ds-font-body-small);
      color: var(--ds-text);
      outline: none;
    }
    .til-custom-input:focus {
      border-color: var(--ds-border-focused);
      box-shadow: 0 0 0 1px var(--ds-border-focused);
    }

    /* ── User row ──────────────────────────────────── */
    .til-user-row {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      margin-bottom: var(--ds-space-200);
      flex-wrap: wrap;
    }
    .til-user-row-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: var(--ds-font-body-small);
      color: var(--ds-text-brand);
      text-decoration: none;
    }
    .til-user-row-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .til-user-row-separator {
      color: var(--ds-text-subtlest);
    }

    /* ── Table spacing fix ──────────────────────────── */
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
    .til-table .til-bar-cell {
      min-width: 200px;
      padding: 10px 12px;
    }
    .til-table .til-time-cell {
      white-space: nowrap;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .til-table .ct-summary-cell {
      max-width: 280px;
    }
  `;
  document.head.appendChild(style);
}
