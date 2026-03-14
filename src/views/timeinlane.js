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
    });
  }

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Time in Lane</h1>
      <p class="page-subtitle">Time spent in each workflow lane per issue</p>
    </div>

    <div class="card mb-300" id="til-filters">
      <div class="wl-filters-row">
        <div class="form-group wl-user-selector" id="til-user-selector">
          <label class="form-label">Users</label>
          <div class="pos-relative">
            <input class="input wl-search-input" type="text" id="til-user-search" placeholder="Search and add users..." autocomplete="off" />
            <svg class="wl-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <div id="til-user-dropdown" class="user-dropdown d-none"></div>
          </div>
        </div>

        <div class="form-group wl-date-range">
          <label class="form-label">Period</label>
          <select class="input" id="til-date-preset">
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
        <div class="form-group wl-date-custom d-none" id="til-date-custom-from">
          <label class="form-label" for="til-date-from">From</label>
          <input class="input" type="date" id="til-date-from" value="${dateFrom}" />
        </div>
        <div class="form-group wl-date-custom d-none" id="til-date-custom-to">
          <label class="form-label" for="til-date-to">To</label>
          <input class="input" type="date" id="til-date-to" value="${dateTo}" />
        </div>

        <button class="btn btn-primary wl-generate-btn" id="til-generate-btn">
          Generate Report
        </button>
      </div>
      <div id="til-user-chips" class="wl-user-chips">
        ${renderUserChips()}
      </div>
    </div>

    <div id="til-results"></div>
  `;

  // Date preset
  const presetSelect = document.getElementById('til-date-preset');
  const customFrom = document.getElementById('til-date-custom-from');
  const customTo = document.getElementById('til-date-custom-to');

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
      document.getElementById('til-date-from').value = dateFrom;
      document.getElementById('til-date-to').value = dateTo;
      generateReport();
    }
  });

  document.getElementById('til-date-from').addEventListener('change', (e) => { dateFrom = e.target.value; generateReport(); });
  document.getElementById('til-date-to').addEventListener('change', (e) => { dateTo = e.target.value; generateReport(); });
  document.getElementById('til-generate-btn').addEventListener('click', generateReport);

  // User search
  const searchInput = document.getElementById('til-user-search');
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) { document.getElementById('til-user-dropdown').classList.add('d-none'); return; }
    searchTimeout = setTimeout(() => searchAndShowUsers(query), 300);
  });
  searchInput.addEventListener('focus', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) searchAndShowUsers(query);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#til-user-search') && !e.target.closest('#til-user-dropdown')) {
      document.getElementById('til-user-dropdown').classList.add('d-none');
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
  const container = document.getElementById('til-user-chips');
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
          document.getElementById('til-user-search').value = '';
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
        document.getElementById('til-user-search').value = '';
        dropdown.classList.add('d-none');
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

  // Track status transitions
  let currentLane = LANE_TODO;
  let lastTransition = new Date(issue.fields?.created);
  const now = new Date();

  for (const history of sorted) {
    for (const item of (history.items || [])) {
      if (item.field !== 'status') continue;

      const transitionTime = new Date(history.created);
      const durationMs = transitionTime - lastTransition;

      // Add duration to current lane
      if (durationMs > 0 && lanes[currentLane] !== undefined) {
        lanes[currentLane] += durationMs;
      }

      // Determine new lane
      currentLane = classifyStatus(item.toString);
      lastTransition = transitionTime;
    }
  }

  // Add time in current lane up to now or resolution
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

  // Default: treat unknown as in-progress
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
    const siteUrl = d.issue._site?.jiraUrl || '';
    const key = siteUrl;
    if (!siteGroups.has(key)) siteGroups.set(key, { siteName, siteUrl, items: [] });
    siteGroups.get(key).items.push(d);
  });
  const multiSite = siteGroups.size > 1;

  // Find max total for bar scaling
  const maxTotal = Math.max(...laneData.map(d => LANE_ORDER.reduce((s, l) => s + d.lanes[l], 0)), 1);

  results.innerHTML = `
    <div class="stat-grid mb-300">
      <div class="stat-card">
        <div class="stat-card-label">Avg in To Do</div>
        <div class="stat-card-value">${formatMs(avgLanes[LANE_TODO])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Avg in Progress</div>
        <div class="stat-card-value">${formatMs(avgLanes[LANE_IN_PROGRESS])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Avg in Review</div>
        <div class="stat-card-value">${formatMs(avgLanes[LANE_IN_REVIEW])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Issues Tracked</div>
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
        <table class="table">
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
