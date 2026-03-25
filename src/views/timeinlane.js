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

  // Inject shared WL styles (filter bar, pills, popover, tabs) + TIL-specific styles
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
            <div id="til-date-custom-panel" class="wl-date-custom-panel d-none">
              <div class="wl-date-custom-field">
                <label class="wl-date-custom-label">From</label>
                <input class="wl-date-custom-input" type="date" id="til-date-from" value="${dateFrom}" />
              </div>
              <div class="wl-date-custom-field">
                <label class="wl-date-custom-label">To</label>
                <input class="wl-date-custom-input" type="date" id="til-date-to" value="${dateTo}" />
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
      label.innerHTML = `${selectedUsers[0].displayName} <span class="wl-pill-count">+${selectedUsers.length - 1}</span>`;
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
      <div class="wl-selected-item" data-index="${i}">
        <div class="wl-selected-left">
          ${user.avatarUrl
            ? `<img src="${user.avatarUrl}" alt="" class="wl-selected-avatar" />`
            : `<span class="avatar avatar-xs">${user.displayName.charAt(0).toUpperCase()}</span>`
          }
          <span class="wl-selected-name">${user.displayName}</span>
        </div>
        <button class="wl-selected-remove" data-index="${i}" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');
    list.querySelectorAll('.wl-selected-remove').forEach(btn => {
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
      const firstItem = document.querySelector('#til-user-dropdown .wl-popover-result-item:not(.d-none)');
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
      return `<button class="wl-month-btn ${i === pickerMonth ? 'active' : ''}" data-month="${i}">${m}</button>`;
    }).join('');
    grid.querySelectorAll('.wl-month-btn').forEach(btn => {
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
      pillLabel.innerHTML = `${selectedUsers[0].displayName} <span class="wl-pill-count">+${selectedUsers.length - 1}</span>`;
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
        <button class="wl-popover-result-item til-dropdown-group" data-group-id="${g.id}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--ds-text-subtlest); flex-shrink: 0;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>
            <div class="wl-popover-result-name">${g.name}</div>
            <div class="wl-popover-result-email">${g.users.length} member${g.users.length !== 1 ? 's' : ''}</div>
          </div>
        </button>
      `).join('');
      if (filtered.length > 0) html += '<div class="wl-popover-separator"></div>';
    }

    if (filtered.length > 0) {
      html += filtered.map(u => `
        <button class="wl-popover-result-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}" data-avatar="${u.avatarUrls?.['48x48'] || ''}">
          ${u.avatarUrls?.['24x24']
            ? `<img src="${u.avatarUrls['24x24']}" alt="" class="wl-popover-result-avatar" />`
            : `<span class="avatar avatar-sm" style="width:24px;height:24px;font-size:11px;">${u.displayName.charAt(0).toUpperCase()}</span>`}
          <div>
            <div class="wl-popover-result-name">${u.displayName}</div>
            ${u.emailAddress ? `<div class="wl-popover-result-email">${u.emailAddress}</div>` : ''}
          </div>
        </button>
      `).join('');
    }

    if (!html) html = '<div class="wl-popover-empty">No users or groups found</div>';
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
          document.getElementById('til-user-search').value = '';
          dropdown.classList.add('d-none');
          scheduleRegenerate();
        }
      });
    });

    dropdown.querySelectorAll('.wl-popover-result-item:not(.til-dropdown-group)').forEach(item => {
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
    dropdown.innerHTML = '<div class="wl-popover-empty">Error searching users</div>';
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

    // Update progress
    const progressEl = document.querySelector('.wl-loading-progress');
    if (progressEl) progressEl.textContent = 'Searching issues...';

    const issues = await searchAllIssuesWithChangelog(siteJqls, 'summary,status,assignee,project,issuetype,created,resolutiondate');

    if (!issues.length) {
      results.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="empty-state-title">No issues found</p>
          <p class="empty-state-description">No issues with status changes found for the selected users in this date range.</p>
        </div>`;
      return;
    }

    if (progressEl) progressEl.textContent = `Processing ${issues.length} issues...`;

    const laneData = issues.map(issue => ({
      issue,
      lanes: computeLaneTimes(issue),
    }));

    // Store for export
    lastReportData = { laneData };

    renderResults(laneData);

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
 * Returns { 'To Do': ms, 'In Progress': ms, 'In Review': ms, 'Done': ms }
 */
function computeLaneTimes(issue) {
  const histories = issue.changelog?.histories || [];
  const lanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 };
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

function renderResults(laneData) {
  const results = document.getElementById('til-results');

  // Summary averages (global)
  const avgLanes = { [LANE_TODO]: 0, [LANE_IN_PROGRESS]: 0, [LANE_IN_REVIEW]: 0, [LANE_DONE]: 0 };
  laneData.forEach(d => {
    LANE_ORDER.forEach(lane => { avgLanes[lane] += d.lanes[lane]; });
  });
  LANE_ORDER.forEach(lane => { avgLanes[lane] /= laneData.length; });

  // Group issues by assignee
  const perUser = {};
  selectedUsers.forEach(u => {
    perUser[u.accountId] = { user: u, items: [] };
  });
  // Also prepare an "unassigned" bucket
  laneData.forEach(d => {
    const assigneeId = d.issue.fields?.assignee?.accountId;
    if (assigneeId && perUser[assigneeId]) {
      perUser[assigneeId].items.push(d);
    } else {
      // Try to match by looking through all selected user accounts
      let matched = false;
      for (const u of selectedUsers) {
        if (u.siteAccounts) {
          for (const sa of u.siteAccounts) {
            if (sa.accountId === assigneeId) {
              perUser[u.accountId].items.push(d);
              matched = true;
              break;
            }
          }
        }
        if (matched) break;
      }
      if (!matched) {
        // Add to first user's bucket or create unassigned
        const firstKey = selectedUsers[0]?.accountId;
        if (firstKey && perUser[firstKey]) {
          perUser[firstKey].items.push(d);
        }
      }
    }
  });

  // Build tabs
  const showTabs = selectedUsers.length > 1;
  const tabIds = showTabs ? [...selectedUsers.map(u => u.accountId), 'all'] : [];
  const tabLabels = showTabs ? [...selectedUsers.map(u => u.displayName), 'All Users'] : [];
  const tabAvatars = showTabs ? [...selectedUsers.map(u => u.avatarUrl || ''), ''] : [];

  const statCardsHtml = renderStatCards(avgLanes, laneData.length);

  if (showTabs) {
    results.innerHTML = `
      ${statCardsHtml}
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
      ${tabIds.map((id, i) => `
        <div class="wl-tab-panel ${i === 0 ? 'active' : ''}" data-panel="${id}">
          ${id === 'all'
            ? renderLaneTable(laneData, true)
            : renderLaneTable(perUser[id]?.items || [], false)
          }
        </div>
      `).join('')}
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
    results.innerHTML = `
      ${statCardsHtml}
      ${renderLaneTable(laneData, false)}
    `;
  }

  // Set bar widths via JS (percentage-based)
  document.querySelectorAll('.til-bar-segment').forEach(seg => {
    const pct = parseFloat(seg.dataset.pct) || 0;
    seg.style.width = pct + '%';
  });
}

function renderStatCards(avgLanes, issueCount) {
  return `
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
        <div class="stat-card-value">${issueCount}</div>
      </div>
    </div>
  `;
}

function renderLaneTable(items, showAssignee) {
  if (!items.length) {
    return `
      <div class="card mb-300">
        <div class="empty-state">
          <p class="empty-state-title">No issues</p>
          <p class="empty-state-description">No issues found for this user in the selected date range.</p>
        </div>
      </div>`;
  }

  // Site grouping
  const siteGroups = new Map();
  items.forEach(d => {
    const siteName = d.issue._site?.name || 'Default';
    const siteUrl = d.issue._site?.url || '';
    const key = siteUrl;
    if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
    siteGroups.get(key).items.push(d);
  });
  const multiSite = siteGroups.size > 1;
  const colSpan = showAssignee ? 8 : 7;

  return `
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
              ${showAssignee ? '<th>Assignee</th>' : ''}
              <th class="til-bar-header">Lane Distribution</th>
              <th>To Do</th>
              <th>In Progress</th>
              <th>In Review</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from(siteGroups.values()).map(group => `
              ${multiSite ? `<tr class="ct-site-group-row"><td colspan="${colSpan}"><div class="wl-site-group-title">${group.siteName}</div></td></tr>` : ''}
              ${group.items.map(d => {
                const total = LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0);
                const pctTodo = total > 0 ? (d.lanes[LANE_TODO] / total * 100) : 0;
                const pctProgress = total > 0 ? (d.lanes[LANE_IN_PROGRESS] / total * 100) : 0;
                const pctReview = total > 0 ? (d.lanes[LANE_IN_REVIEW] / total * 100) : 0;
                const pctDone = total > 0 ? (d.lanes[LANE_DONE] / total * 100) : 0;
                const assigneeName = d.issue.fields?.assignee?.displayName || 'Unassigned';
                return `
                <tr>
                  <td><a href="${group.siteUrl}/browse/${d.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${d.issue.key}</a></td>
                  <td class="text-truncate ct-summary-cell">${d.issue.fields?.summary || ''}</td>
                  ${showAssignee ? `<td class="til-assignee-cell">${assigneeName}</td>` : ''}
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
  const headers = ['Key', 'Summary', 'Assignee', 'To Do', 'In Progress', 'In Review', 'Total'];
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
    const row = ws.addRow([
      d.issue.key,
      d.issue.fields?.summary || '',
      assigneeName,
      formatMs(d.lanes[LANE_TODO]),
      formatMs(d.lanes[LANE_IN_PROGRESS]),
      formatMs(d.lanes[LANE_IN_REVIEW]),
      formatMs(total),
    ]);
    row.eachCell((cell, colNum) => {
      cell.border = border;
      cell.alignment = colNum >= 4 ? centerAlign : { vertical: 'middle' };
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
    .til-assignee-cell {
      white-space: nowrap;
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtle);
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Selected users in popover ─────────────────── */
    .wl-selected-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}
