/**
 * Cycle Time Report — Time from "In Progress" to "Done"
 */

import { getCredentials, getSavedUser } from '../services/auth.js';
import { searchUsers, buildUserCycleTimeJqlPerSite, searchAllIssuesWithChangelog } from '../services/jira.js';
import { getGroups } from '../services/settings.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

let selectedUsers = [];
let dateFrom = '';
let dateTo = '';
let searchTimeout = null;

export async function renderCycleTime() {
  const creds = getCredentials();
  if (!creds) { navigate('/login'); return; }

  const app = document.getElementById('app');
  renderAppShell(app, 'cycletime');
  updateBreadcrumbs([{ label: 'Cycle Time' }]);

  // Default: current month
  const now = new Date();
  dateFrom = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  dateTo = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  // Current user by default
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
      <h1 class="page-title">Cycle Time</h1>
      <p class="page-subtitle">Time from In Progress to Done — per user and project</p>
    </div>

    <div class="card mb-300" id="ct-filters">
      <div class="wl-filters-row">
        <div class="form-group wl-user-selector" id="ct-user-selector">
          <label class="form-label">Users</label>
          <div class="pos-relative">
            <input class="input wl-search-input" type="text" id="ct-user-search" placeholder="Search and add users..." autocomplete="off" />
            <svg class="wl-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <div id="ct-user-dropdown" class="user-dropdown d-none"></div>
          </div>
        </div>

        <div class="form-group wl-date-range">
          <label class="form-label">Period</label>
          <select class="input" id="ct-date-preset">
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
        <div class="form-group wl-date-custom d-none" id="ct-date-custom-from">
          <label class="form-label" for="ct-date-from">From</label>
          <input class="input" type="date" id="ct-date-from" value="${dateFrom}" />
        </div>
        <div class="form-group wl-date-custom d-none" id="ct-date-custom-to">
          <label class="form-label" for="ct-date-to">To</label>
          <input class="input" type="date" id="ct-date-to" value="${dateTo}" />
        </div>

        <button class="btn btn-primary wl-generate-btn" id="ct-generate-btn">
          Generate Report
        </button>
      </div>
      <div id="ct-user-chips" class="wl-user-chips">
        ${renderUserChips()}
      </div>
    </div>

    <div id="ct-results"></div>
  `;

  // Date preset handler
  const presetSelect = document.getElementById('ct-date-preset');
  const customFrom = document.getElementById('ct-date-custom-from');
  const customTo = document.getElementById('ct-date-custom-to');

  const currentMonthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  presetSelect.value = currentMonthValue;

  presetSelect.addEventListener('change', () => {
    const val = presetSelect.value;
    if (val === 'custom') {
      customFrom.classList.remove('d-none');
      customTo.classList.remove('d-none');
    } else {
      customFrom.classList.add('d-none');
      customTo.classList.add('d-none');
      applyDatePreset(val);
      document.getElementById('ct-date-from').value = dateFrom;
      document.getElementById('ct-date-to').value = dateTo;
      generateReport();
    }
  });

  document.getElementById('ct-date-from').addEventListener('change', (e) => { dateFrom = e.target.value; generateReport(); });
  document.getElementById('ct-date-to').addEventListener('change', (e) => { dateTo = e.target.value; generateReport(); });
  document.getElementById('ct-generate-btn').addEventListener('click', generateReport);

  // User search
  const searchInput = document.getElementById('ct-user-search');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) { document.getElementById('ct-user-dropdown').classList.add('d-none'); return; }
    searchTimeout = setTimeout(() => searchAndShowUsers(query), 300);
  });
  searchInput.addEventListener('focus', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) searchAndShowUsers(query);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ct-user-search') && !e.target.closest('#ct-user-dropdown')) {
      document.getElementById('ct-user-dropdown').classList.add('d-none');
    }
  });

  if (selectedUsers.length > 0) generateReport();
}

/* ── User picker ─────────────────────────────────── */

function renderUserChips() {
  return selectedUsers.map((user, i) => `
    <span class="user-chip" data-index="${i}">
      <span class="avatar avatar-sm wl-chip-avatar">${user.displayName.charAt(0).toUpperCase()}</span>
      <span>${user.displayName}</span>
      <button class="user-chip-remove" data-index="${i}" aria-label="Remove ${user.displayName}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </span>
  `).join('');
}

function refreshUserChips() {
  const container = document.getElementById('ct-user-chips');
  container.innerHTML = renderUserChips();
  container.querySelectorAll('.user-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedUsers.splice(parseInt(btn.dataset.index), 1);
      refreshUserChips();
    });
  });
}

async function searchAndShowUsers(query) {
  const dropdown = document.getElementById('ct-user-dropdown');
  try {
    const users = await searchUsers(query);
    const filtered = users.filter(u => u.accountType === 'atlassian' && !selectedUsers.some(s => s.accountId === u.accountId));
    const groups = getGroups();
    const matchingGroups = groups.filter(g => g.name.toLowerCase().includes(query.toLowerCase()) && g.users.length > 0);

    let html = '';
    if (matchingGroups.length > 0) {
      html += matchingGroups.map(g => `
        <button class="user-dropdown-item user-dropdown-group" data-group-id="${g.id}">
          <svg class="dropdown-group-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
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
        <button class="user-dropdown-item" data-account-id="${u.accountId}" data-name="${u.displayName}" data-email="${u.emailAddress || ''}" data-avatar="${u.avatarUrls?.['24x24'] || ''}">
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
          document.getElementById('ct-user-search').value = '';
          dropdown.classList.add('d-none');
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
        document.getElementById('ct-user-search').value = '';
        dropdown.classList.add('d-none');
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="user-dropdown-empty">Error searching users</div>';
    dropdown.classList.remove('d-none');
  }
}

/* ── Report generation ───────────────────────────── */

async function generateReport() {
  if (selectedUsers.length === 0) {
    showToast('warning', 'Select at least one user');
    return;
  }

  const results = document.getElementById('ct-results');
  results.innerHTML = `
    <div class="card mb-300">
      <div class="ct-loading">
        <div class="spinner"></div>
        <p class="ct-loading-text">Fetching issues and changelogs...</p>
      </div>
    </div>
  `;

  try {
    const siteJqls = buildUserCycleTimeJqlPerSite(selectedUsers, dateFrom, dateTo);
    console.log('[CycleTime] selectedUsers:', selectedUsers);
    console.log('[CycleTime] siteJqls:', siteJqls);
    if (siteJqls.length === 0) {
      results.innerHTML = '<div class="card"><div class="empty-state"><p class="empty-state-title">No sites available</p><p class="empty-state-description">The selected user(s) could not be mapped to any connected site.</p></div></div>';
      return;
    }

    const issues = await searchAllIssuesWithChangelog(siteJqls, 'summary,status,assignee,project,issuetype,created,resolutiondate');
    console.log('[CycleTime] issues returned:', issues.length, issues.slice(0, 3));

    // Parse changelogs → compute cycle times
    const cycleData = issues.map(issue => {
      const ct = computeCycleTime(issue);
      return { issue, ...ct };
    }).filter(d => d.cycleTimeMs !== null);
    console.log('[CycleTime] cycleData (with cycle time):', cycleData.length);

    renderResults(cycleData);
  } catch (err) {
    console.error('[CycleTime] Error:', err);
    results.innerHTML = `<div class="card"><div class="empty-state"><p class="empty-state-title">Error</p><p class="empty-state-description">${err.message}</p></div></div>`;
  }
}

/**
 * Parse issue changelog to find first "In Progress" and final "Done" transitions.
 * Returns { cycleTimeMs, inProgressDate, doneDate }
 */
function computeCycleTime(issue) {
  const histories = issue.changelog?.histories || [];
  let inProgressDate = null;
  let doneDate = null;

  // Sort by created ascending
  const sorted = [...histories].sort((a, b) => new Date(a.created) - new Date(b.created));

  for (const history of sorted) {
    for (const item of (history.items || [])) {
      if (item.field !== 'status') continue;

      const toCatKey = item.to ? getStatusCategoryKey(item.toString, issue) : null;

      // First time entering "In Progress" (indeterminate category)
      if (!inProgressDate && toCatKey === 'indeterminate') {
        inProgressDate = new Date(history.created);
      }

      // Last time entering "Done"
      if (toCatKey === 'done') {
        doneDate = new Date(history.created);
      }
    }
  }

  // Fallback: use resolutiondate as done date
  if (!doneDate && issue.fields?.resolutiondate) {
    doneDate = new Date(issue.fields.resolutiondate);
  }

  // Fallback: use created as in-progress start
  if (!inProgressDate && doneDate) {
    inProgressDate = new Date(issue.fields?.created);
  }

  if (inProgressDate && doneDate && doneDate > inProgressDate) {
    return { cycleTimeMs: doneDate - inProgressDate, inProgressDate, doneDate };
  }
  return { cycleTimeMs: null, inProgressDate: null, doneDate: null };
}

/**
 * Map status name to category key.
 * Uses the issue's current status category if available, otherwise guesses from name.
 */
function getStatusCategoryKey(statusName, issue) {
  if (!statusName) return null;
  const lower = statusName.toLowerCase();

  // Direct matches from current issue status
  if (issue.fields?.status?.name === statusName && issue.fields?.status?.statusCategory?.key) {
    return issue.fields.status.statusCategory.key;
  }

  // Heuristic mapping
  const doneNames = ['done', 'closed', 'resolved', 'complete', 'completed'];
  const todoNames = ['to do', 'open', 'new', 'backlog', 'created'];
  const reviewNames = ['in review', 'code review', 'review', 'in qa', 'qa', 'testing'];

  if (doneNames.some(n => lower === n)) return 'done';
  if (todoNames.some(n => lower === n)) return 'new';
  if (reviewNames.some(n => lower === n)) return 'indeterminate';

  // Default: anything else is "in progress"
  return 'indeterminate';
}

function renderResults(cycleData) {
  const results = document.getElementById('ct-results');

  if (cycleData.length === 0) {
    results.innerHTML = '<div class="card"><div class="empty-state"><p class="empty-state-title">No cycle time data</p><p class="empty-state-description">No issues were resolved in this period with status transitions.</p></div></div>';
    return;
  }

  // Stats
  const times = cycleData.map(d => d.cycleTimeMs);
  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const fastestMs = sorted[0];
  const slowestMs = sorted[sorted.length - 1];

  // Per user
  const byUser = {};
  cycleData.forEach(d => {
    const name = d.issue.fields?.assignee?.displayName || 'Unassigned';
    if (!byUser[name]) byUser[name] = { times: [], count: 0 };
    byUser[name].times.push(d.cycleTimeMs);
    byUser[name].count++;
  });

  // Per project
  const byProject = {};
  cycleData.forEach(d => {
    const proj = d.issue.fields?.project?.name || d.issue.fields?.project?.key || 'Unknown';
    if (!byProject[proj]) byProject[proj] = { times: [], count: 0 };
    byProject[proj].times.push(d.cycleTimeMs);
    byProject[proj].count++;
  });

  // Group by site (for the issue list)
  const siteGroups = new Map();
  cycleData.sort((a, b) => b.cycleTimeMs - a.cycleTimeMs).forEach(d => {
    const siteName = d.issue._site?.name || 'Default';
    const siteUrl = d.issue._site?.jiraUrl || '';
    const key = siteUrl;
    if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
    siteGroups.get(key).items.push(d);
  });
  const multiSite = siteGroups.size > 1;

  results.innerHTML = `
    <div class="stat-grid mb-300">
      <div class="stat-card">
        <div class="stat-card-label">Avg Cycle Time</div>
        <div class="stat-card-value">${formatMs(avgMs)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Median</div>
        <div class="stat-card-value">${formatMs(medianMs)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Issues Resolved</div>
        <div class="stat-card-value">${cycleData.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Fastest / Slowest</div>
        <div class="stat-card-value">${formatMs(fastestMs)} / ${formatMs(slowestMs)}</div>
      </div>
    </div>

    <div class="ct-tables-row mb-300">
      <div class="card ct-table-card">
        <h3 class="text-heading-small mb-150">Per User</h3>
        <div class="table-container">
          <table class="table">
            <thead><tr><th>User</th><th>Avg Cycle Time</th><th>Issues</th></tr></thead>
            <tbody>
              ${Object.entries(byUser).sort((a, b) => avg(a[1].times) - avg(b[1].times)).map(([name, data]) => `
                <tr>
                  <td class="ct-user-cell">
                    <span class="avatar avatar-sm wl-chip-avatar">${name.charAt(0).toUpperCase()}</span>
                    <span>${name}</span>
                  </td>
                  <td>${formatMs(avg(data.times))}</td>
                  <td>${data.count}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card ct-table-card">
        <h3 class="text-heading-small mb-150">Per Project</h3>
        <div class="table-container">
          <table class="table">
            <thead><tr><th>Project</th><th>Avg Cycle Time</th><th>Issues</th></tr></thead>
            <tbody>
              ${Object.entries(byProject).sort((a, b) => avg(a[1].times) - avg(b[1].times)).map(([name, data]) => `
                <tr>
                  <td>${name}</td>
                  <td>${formatMs(avg(data.times))}</td>
                  <td>${data.count}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="text-heading-small mb-150">Issue Details</h3>
      <div class="table-container">
        <table class="table">
          <thead><tr><th>Key</th><th>Summary</th><th>Assignee</th><th>Project</th><th>Cycle Time</th></tr></thead>
          <tbody>
            ${Array.from(siteGroups.values()).map(group => `
              ${multiSite ? `<tr class="ct-site-group-row"><td colspan="5"><div class="wl-site-group-title">${group.siteName}</div></td></tr>` : ''}
              ${group.items.map(d => `
                <tr>
                  <td><a href="${group.siteUrl}/browse/${d.issue.key}" target="_blank" rel="noopener" class="wl-issue-key">${d.issue.key}</a></td>
                  <td class="text-truncate ct-summary-cell">${d.issue.fields?.summary || ''}</td>
                  <td>${d.issue.fields?.assignee?.displayName || 'Unassigned'}</td>
                  <td><span class="lozenge lozenge-default">${d.issue.fields?.project?.name || d.issue.fields?.project?.key || ''}</span></td>
                  <td class="ct-time-cell"><span class="wl-time-badge">${formatMs(d.cycleTimeMs)}</span></td>
                </tr>
              `).join('')}
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ── Helpers ──────────────────────────────────────── */

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

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
  return date.toISOString().split('T')[0];
}

function generateMonthOptions() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `<option value="${value}">${label}</option>`;
  }).join('');
}

function applyDatePreset(preset) {
  const now = new Date();
  if (preset === 'this-week') {
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    dateFrom = formatDate(mon);
    dateTo = formatDate(sun);
  } else if (preset === 'last-week') {
    const dow = now.getDay();
    const thisMon = new Date(now);
    thisMon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    const lastMon = new Date(thisMon);
    lastMon.setDate(thisMon.getDate() - 7);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);
    dateFrom = formatDate(lastMon);
    dateTo = formatDate(lastSun);
  } else {
    const [year, month] = preset.split('-').map(Number);
    dateFrom = formatDate(new Date(year, month - 1, 1));
    dateTo = formatDate(new Date(year, month, 0));
  }
}
