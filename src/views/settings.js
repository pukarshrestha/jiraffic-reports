/**
 * Settings View — Work week, expected hours, holidays, and user groups
 */

import { getCredentials, getAccessibleSites, getSelectedSiteIds, saveSelectedSiteIds, loadSitesCache, addAnotherAccount, removeAccount, getAccountsInfo } from '../services/auth.js';
import { getSettings, saveSettings, getGroups, saveGroups, getHolidays, saveHolidays } from '../services/settings.js';
import { searchUsers } from '../services/jira.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';
import ExcelJS from 'exceljs';

let groupSearchTimeout = null;
let _accessibleSites = [];
let _accounts = [];

export async function renderSettings() {
  const creds = getCredentials();
  if (!creds) {
    navigate('/login');
    return;
  }

  const app = document.getElementById('app');
  renderAppShell(app, 'settings');
  updateBreadcrumbs([{ label: 'Settings' }]);

  // Load accessible sites and accounts from server
  _accessibleSites = await getAccessibleSites();
  _accounts = await getAccountsInfo();

  const settings = getSettings();
  const content = document.getElementById('page-content');
  const holidays = settings.holidays || [];

  content.innerHTML = `
    <div class="page-header" id="settings-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Configure application preferences</p>
    </div>

    <!-- Connected Sites -->
    <div class="card mb-300" id="settings-sites">
      <div class="settings-section-title-row">
        <h3 class="text-heading-small">Connected Sites</h3>
        <button class="btn btn-primary settings-add-group-btn" id="add-account-btn">
          + Add Atlassian Account
        </button>
      </div>
      <p class="settings-section-desc">All Jira Cloud sites from your connected Atlassian accounts are used for reports. Add more accounts to aggregate data across organizations.</p>
      <div id="sites-list">${renderSitesList()}</div>
    </div>

    <!-- Work Week -->
    <div class="card mb-300" id="settings-workweek">
      <h3 class="settings-section-title">Work Week</h3>
      <p class="settings-section-desc">Define which days are workdays. This affects calendar highlighting and daily averages.</p>
      <div id="workweek-toggles" class="settings-workweek-row">
        ${renderWorkWeekToggles(settings.workWeek)}
      </div>
    </div>

    <!-- Expected Hours -->
    <div class="card mb-300" id="settings-expected-hours">
      <h3 class="settings-section-title">Expected Work Hours</h3>
      <p class="settings-section-desc">Expected work hours per day. Used to color-code daily logs.</p>
      <div class="settings-hours-row">
        <input class="input settings-hours-input" type="number" id="expected-hours-input" min="1" max="24" step="0.5" value="${settings.expectedHoursPerDay}" />
        <span class="settings-hours-label">hours per day</span>
      </div>
    </div>

    <!-- Holidays -->
    <div class="card mb-300" id="settings-holidays">
      <div class="settings-section-title-row">
        <h3 class="text-heading-small">Holidays</h3>
        <div class="flex-row-gap-100">
          <span id="holiday-count" class="settings-holiday-count">${holidays.length} holiday${holidays.length !== 1 ? 's' : ''}</span>
          ${holidays.length > 0 ? `<button class="btn btn-subtle settings-clear-holidays-btn" id="clear-holidays-btn">Clear All</button>` : ''}
          <label class="btn btn-primary settings-upload-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Excel
            <input type="file" id="holiday-upload" accept=".xlsx,.xls,.csv" class="d-none" />
          </label>
        </div>
      </div>
      <p class="settings-section-desc">Upload an Excel file (.xlsx, .xls, .csv) with <strong>Date</strong> and <strong>Holiday Name</strong> columns. The dates will be marked as holidays across the application.</p>
      <div id="holiday-list">
        ${renderHolidayList(holidays)}
      </div>
    </div>

    <!-- User Groups -->
    <div class="card mb-300" id="settings-groups">
      <div class="settings-section-title-row">
        <h3 class="text-heading-small">User Groups</h3>
        <button class="btn btn-primary settings-add-group-btn" id="add-group-btn">
          + New Group
        </button>
      </div>
      <p class="settings-section-desc">Create reusable groups of team members for quick selection in reports.</p>
      <div id="groups-list">
        ${renderGroupsList(settings.groups || [])}
      </div>
    </div>
  `;

  injectSettingsStyles();
  attachSettingsListeners(settings);
}

function renderSitesList() {
  if (_accessibleSites.length === 0) {
    return '<p class="settings-empty-state">No accessible Jira sites found. Try logging out and back in.</p>';
  }

  // Group sites by account
  const hasMultipleAccounts = _accounts.length > 1;

  if (_accounts.length === 0) {
    // Fallback: just list sites without account grouping
    return `
      <div class="settings-sites-list">
        ${_accessibleSites.map(s => `
          <div class="settings-site-item">
            <div class="settings-site-item-info">
              <div class="login-site-name">${s.name}</div>
              <div class="login-site-url">${s.url}</div>
            </div>
            <span class="lozenge lozenge-success">Connected</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  return _accounts.map((acct, idx) => `
    <div class="settings-account-group">
      <div class="settings-account-header">
        <div class="settings-account-info">
          <span class="avatar avatar-sm">${(acct.displayName || acct.email || '?').charAt(0).toUpperCase()}</span>
          <div>
            <div class="settings-account-name">${acct.displayName || acct.email}</div>
            <div class="settings-account-email">${acct.email} · ${acct.sitesCount} site${acct.sitesCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
        ${hasMultipleAccounts ? `
          <button class="btn btn-subtle btn-icon-only settings-remove-account" data-account-email="${acct.email}" title="Remove account">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        ` : ''}
      </div>
      <div class="settings-account-sites">
        ${_accessibleSites
          .filter(s => s.accountEmail === acct.email)
          .map(s => `
            <div class="settings-site-item">
              <div class="settings-site-item-info">
                <div class="login-site-name">${s.name}</div>
                <div class="login-site-url">${s.url}</div>
              </div>
              <span class="lozenge lozenge-success">Connected</span>
            </div>
          `).join('')}
      </div>
    </div>
  `).join('');
}

function renderWorkWeekToggles(workWeek) {
  const days = [
    { key: 'sun', label: 'Sun' },
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
  ];
  return days.map(d => `
    <button class="settings-day-toggle ${workWeek[d.key] ? 'active' : ''}" data-day="${d.key}" title="${workWeek[d.key] ? 'Workday — click to mark as holiday' : 'Holiday — click to mark as workday'}">
      ${d.label}
    </button>
  `).join('');
}

function renderHolidayList(holidays) {
  if (!holidays.length) {
    return `<div class="settings-empty-state">No holidays uploaded yet. Upload an Excel file to add holidays.</div>`;
  }
  // Sort by date
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  return `
    <div class="settings-holiday-table-wrap">
      <table class="table settings-holiday-table">
        <thead>
          <tr>
            <th class="settings-holiday-date-col">Date</th>
            <th>Holiday Name</th>
            <th class="settings-holiday-action-col"></th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((h, i) => {
    const d = new Date(h.date + 'T00:00:00');
    return `
              <tr>
                <td class="text-medium">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td>${h.name || '—'}</td>
                <td>
                  <button class="btn btn-subtle btn-icon-only settings-remove-holiday settings-remove-btn" data-date="${h.date}" title="Remove">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </td>
              </tr>
            `;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGroupsList(groups) {
  if (!groups.length) {
    return `<div class="settings-empty-state-lg">No groups created yet. Click "New Group" to get started.</div>`;
  }
  return groups.map((g, i) => `
    <div class="settings-group-card" data-group-idx="${i}">
      <div class="settings-group-inputs-row">
        <div class="settings-group-field">
          <label class="settings-field-label" for="group-name-${i}">Group Name</label>
          <input class="input settings-group-name settings-group-name-input" id="group-name-${i}" data-group-idx="${i}" value="${g.name}" placeholder="Enter group name" />
        </div>
        <div class="settings-group-field pos-relative" id="settings-group-user-search-${i}">
          <label class="settings-field-label">Search Users</label>
          <input class="input settings-group-user-search settings-group-search-input" data-group-idx="${i}" placeholder="Search and add users..." />
          <svg class="settings-group-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div class="settings-group-dropdown d-none" data-group-idx="${i}"></div>
        </div>
      </div>
      <div class="settings-group-members" id="settings-group-members-${i}">
        ${g.users.map((u, ui) => `
          <span class="settings-user-chip">
            <span class="avatar avatar-sm wl-chip-avatar">${(u.displayName || '?').charAt(0).toUpperCase()}</span>
            ${u.displayName}
            <button class="settings-chip-remove" data-group-idx="${i}" data-user-idx="${ui}" title="Remove">&times;</button>
          </span>
        `).join('')}
      </div>
      <div class="settings-group-footer">
        <span class="settings-group-member-count">${g.users.length} member${g.users.length !== 1 ? 's' : ''}</span>
        <button class="btn btn-subtle btn-icon-only settings-delete-group settings-delete-group-btn" data-group-idx="${i}" title="Delete group">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function attachSettingsListeners(settings) {
  // Add another Atlassian account
  document.getElementById('add-account-btn')?.addEventListener('click', () => {
    addAnotherAccount();
  });

  // Remove account buttons
  document.querySelectorAll('.settings-remove-account').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.accountEmail;
      if (confirm(`Remove the account ${email}? Sites from this account will no longer be included in reports.`)) {
        const success = await removeAccount(email);
        if (success) {
          showToast('success', 'Account removed');
          _accessibleSites = await getAccessibleSites();
          _accounts = await getAccountsInfo();
          await loadSitesCache();
          document.getElementById('sites-list').innerHTML = renderSitesList();
          // Re-attach remove listeners
          document.querySelectorAll('.settings-remove-account').forEach(b => {
            b.addEventListener('click', async () => {
              const em = b.dataset.accountEmail;
              if (confirm(`Remove the account ${em}?`)) {
                const ok = await removeAccount(em);
                if (ok) {
                  showToast('success', 'Account removed');
                  renderSettings();
                }
              }
            });
          });
        } else {
          showToast('error', 'Failed to remove account');
        }
      }
    });
  });

  // Work week toggles
  document.getElementById('workweek-toggles').addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-day-toggle');
    if (!btn) return;
    const day = btn.dataset.day;
    settings.workWeek[day] = !settings.workWeek[day];
    btn.classList.toggle('active', settings.workWeek[day]);
    btn.title = settings.workWeek[day] ? 'Workday — click to mark as holiday' : 'Holiday — click to mark as workday';
    saveSettings(settings);
    showToast('success', 'Work week updated');
  });

  // Expected hours
  document.getElementById('expected-hours-input').addEventListener('change', (e) => {
    const val = parseFloat(e.target.value);
    if (val > 0 && val <= 24) {
      settings.expectedHoursPerDay = val;
      saveSettings(settings);
      showToast('success', 'Expected hours updated');
    }
  });

  // Holiday upload
  document.getElementById('holiday-upload').addEventListener('change', handleHolidayUpload);

  // Clear holidays
  document.getElementById('clear-holidays-btn')?.addEventListener('click', () => {
    if (confirm('Remove all holidays?')) {
      saveHolidays([]);
      settings.holidays = [];
      document.getElementById('holiday-list').innerHTML = renderHolidayList([]);
      document.getElementById('holiday-count').textContent = '0 holidays';
      const clearBtn = document.getElementById('clear-holidays-btn');
      if (clearBtn) clearBtn.remove();
      showToast('success', 'All holidays cleared');
    }
  });

  // Remove individual holiday (delegation)
  document.getElementById('holiday-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-remove-holiday');
    if (!btn) return;
    const dateToRemove = btn.dataset.date;
    settings.holidays = (settings.holidays || []).filter(h => h.date !== dateToRemove);
    saveSettings(settings);
    document.getElementById('holiday-list').innerHTML = renderHolidayList(settings.holidays);
    document.getElementById('holiday-count').textContent = `${settings.holidays.length} holiday${settings.holidays.length !== 1 ? 's' : ''}`;
    showToast('success', 'Holiday removed');
  });

  // Add group
  document.getElementById('add-group-btn').addEventListener('click', () => {
    if (!settings.groups) settings.groups = [];
    settings.groups.push({ id: Date.now().toString(), name: '', users: [] });
    saveSettings(settings);
    document.getElementById('groups-list').innerHTML = renderGroupsList(settings.groups);
    attachGroupListeners(settings);
    // Focus the new group name input
    const inputs = document.querySelectorAll('.settings-group-name');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  attachGroupListeners(settings);
}

function handleHolidayUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = new ExcelJS.Workbook();

      // Detect file type and read accordingly
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'csv') {
        await workbook.csv.load(data.buffer);
      } else {
        await workbook.xlsx.load(data.buffer);
      }

      const firstSheet = workbook.worksheets[0];
      if (!firstSheet || firstSheet.rowCount < 2) {
        showToast('error', 'Empty file', 'The file needs at least a header row and one data row.');
        return;
      }

      // Read all rows into array-of-arrays
      const rows = [];
      firstSheet.eachRow((row) => {
        rows.push(row.values.slice(1)); // ExcelJS row.values is 1-indexed
      });

      if (rows.length < 2) {
        showToast('error', 'Empty file', 'The file needs at least a header row and one data row.');
        return;
      }

      // Find column indices (case-insensitive)
      const header = rows[0].map(h => (h || '').toString().toLowerCase().trim());
      let dateCol = header.findIndex(h => h === 'date' || h === 'holiday date');
      let nameCol = header.findIndex(h => h === 'name' || h === 'holiday name' || h === 'holiday' || h === 'description');

      // Fallback: assume first two columns
      if (dateCol === -1) dateCol = 0;
      if (nameCol === -1) nameCol = dateCol === 0 ? 1 : 0;

      const holidays = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[dateCol]) continue;

        let dateStr = '';
        const rawDate = row[dateCol];

        if (rawDate instanceof Date) {
          // ExcelJS returns Date objects for date cells
          dateStr = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`;
        } else if (typeof rawDate === 'number') {
          // Excel serial date number fallback
          const epoch = new Date(1899, 11, 30);
          const d = new Date(epoch.getTime() + rawDate * 86400000);
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } else {
          // Try parsing as string
          const parsed = new Date(rawDate);
          if (!isNaN(parsed.getTime())) {
            dateStr = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
          }
        }

        if (dateStr) {
          holidays.push({
            date: dateStr,
            name: (row[nameCol] || '').toString().trim() || 'Holiday',
          });
        }
      }

      if (holidays.length === 0) {
        showToast('error', 'No valid dates found', 'Make sure the file has a Date column with valid dates.');
        return;
      }

      // Merge with existing (replace duplicates)
      const existing = getHolidays();
      const merged = [...existing];
      holidays.forEach(h => {
        const idx = merged.findIndex(e => e.date === h.date);
        if (idx >= 0) merged[idx] = h;
        else merged.push(h);
      });

      saveHolidays(merged);
      const settingsReloaded = getSettings();

      document.getElementById('holiday-list').innerHTML = renderHolidayList(merged);
      document.getElementById('holiday-count').textContent = `${merged.length} holiday${merged.length !== 1 ? 's' : ''}`;
      showToast('success', `${holidays.length} holidays imported`, `${holidays.length} dates loaded from ${file.name}`);
    } catch (err) {
      showToast('error', 'Failed to parse file', err.message);
    }
    // Reset the input so the same file can be re-uploaded
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

function attachGroupListeners(settings) {
  // Group name editing
  document.querySelectorAll('.settings-group-name').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.groupIdx);
      settings.groups[idx].name = e.target.value.trim();
      saveSettings(settings);
    });
  });

  // Delete group
  document.querySelectorAll('.settings-delete-group').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.groupIdx);
      settings.groups.splice(idx, 1);
      saveSettings(settings);
      document.getElementById('groups-list').innerHTML = renderGroupsList(settings.groups);
      attachGroupListeners(settings);
      showToast('success', 'Group deleted');
    });
  });

  // Remove user from group
  document.querySelectorAll('.settings-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const gi = parseInt(e.target.dataset.groupIdx);
      const ui = parseInt(e.target.dataset.userIdx);
      settings.groups[gi].users.splice(ui, 1);
      saveSettings(settings);
      document.getElementById('groups-list').innerHTML = renderGroupsList(settings.groups);
      attachGroupListeners(settings);
    });
  });

  // User search in groups
  document.querySelectorAll('.settings-group-user-search').forEach(input => {
    const groupIdx = parseInt(input.dataset.groupIdx);

    input.addEventListener('input', () => {
      clearTimeout(groupSearchTimeout);
      const query = input.value.trim();
      const dropdown = document.querySelector(`.settings-group-dropdown[data-group-idx="${groupIdx}"]`);
      if (!query || query.length < 2) {
        dropdown.classList.add('d-none');
        return;
      }
      groupSearchTimeout = setTimeout(async () => {
        try {
          const users = await searchUsers(query);
          const existing = settings.groups[groupIdx].users.map(u => u.accountId);
          const results = users.filter(u => u.accountType === 'atlassian' && !existing.includes(u.accountId));
          if (!results.length) {
            dropdown.innerHTML = '<div class="settings-empty-state">No matching users</div>';
          } else {
            dropdown.innerHTML = results.map(u => `
              <div class="settings-dropdown-item" data-account-id="${u.accountId}" data-display-name="${u.displayName}" data-avatar="${u.avatarUrls?.['24x24'] || ''}">
                <span class="avatar avatar-sm wl-chip-avatar">${(u.displayName || '?').charAt(0).toUpperCase()}</span>
                <span>${u.displayName}</span>
              </div>
            `).join('');
          }
          dropdown.classList.remove('d-none');

          // Click handler for dropdown items
          dropdown.querySelectorAll('.settings-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
              settings.groups[groupIdx].users.push({
                accountId: item.dataset.accountId,
                displayName: item.dataset.displayName,
                avatarUrl: item.dataset.avatar || '',
              });
              saveSettings(settings);
              input.value = '';
              dropdown.classList.add('d-none');
              document.getElementById('groups-list').innerHTML = renderGroupsList(settings.groups);
              attachGroupListeners(settings);
            });
          });
        } catch {
          dropdown.innerHTML = '<div class="settings-empty-state text-danger">Search failed</div>';
          dropdown.classList.remove('d-none');
        }
      }, 300);
    });

    // Close dropdown on blur
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const dropdown = document.querySelector(`.settings-group-dropdown[data-group-idx="${groupIdx}"]`);
        if (dropdown) dropdown.classList.add('d-none');
      }, 200);
    });
  });
}

function injectSettingsStyles() {
  if (document.getElementById('settings-styles')) return;
  const style = document.createElement('style');
  style.id = 'settings-styles';
  style.textContent = `
    .settings-day-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 40px;
      border-radius: var(--ds-radius-200);
      border: 2px solid var(--ds-border);
      background: var(--ds-surface);
      color: var(--ds-text-subtle);
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
      cursor: pointer;
      transition: all var(--ds-duration-fast) var(--ds-easing-standard);
    }
    .settings-day-toggle:hover {
      border-color: var(--ds-border-focused);
    }
    .settings-day-toggle.active {
      background: var(--ds-background-brand-bold);
      border-color: var(--ds-background-brand-bold);
      color: var(--ds-text-inverse);
    }

    .settings-account-group {
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      margin-top: var(--ds-space-150);
      overflow: hidden;
    }
    .settings-account-group + .settings-account-group {
      margin-top: var(--ds-space-150);
    }
    .settings-account-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--ds-space-150) var(--ds-space-200);
      background: var(--ds-surface-sunken);
      border-bottom: 1px solid var(--ds-border);
    }
    .settings-account-info {
      display: flex;
      align-items: center;
      gap: var(--ds-space-150);
    }
    .settings-account-name {
      font: var(--ds-font-body);
      font-weight: var(--ds-font-weight-semibold);
      color: var(--ds-text);
    }
    .settings-account-email {
      font: var(--ds-font-body-small);
      color: var(--ds-text-subtle);
    }
    .settings-account-sites {
      padding: var(--ds-space-100) var(--ds-space-200);
    }
    .settings-site-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--ds-space-100) 0;
    }
    .settings-site-item + .settings-site-item {
      border-top: 1px solid var(--ds-border);
    }
    .settings-site-item-info {
      min-width: 0;
    }
    .settings-sites-list {
      margin-top: var(--ds-space-100);
    }

    .settings-group-card {
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      padding: var(--ds-space-200);
      margin-bottom: var(--ds-space-150);
      background: var(--ds-surface-sunken);
    }
    .settings-group-inputs-row {
      display: flex;
      gap: var(--ds-space-200);
      align-items: flex-end;
    }
    .settings-group-field {
      flex: 1;
      min-width: 0;
    }
    .settings-field-label {
      display: block;
      font: var(--ds-font-body-small);
      font-weight: var(--ds-font-weight-semibold);
      color: var(--ds-text-subtle);
      margin-bottom: var(--ds-space-050);
    }
    .settings-group-members {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-075);
      min-height: 24px;
      margin-top: var(--ds-space-150);
    }
    .settings-group-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid var(--ds-border);
      margin-top: var(--ds-space-200);
      padding-top: var(--ds-space-150);
    }
    @media (max-width: 768px) {
      .settings-group-inputs-row {
        flex-direction: column;
        gap: var(--ds-space-150);
      }
    }
    .settings-user-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--ds-space-050);
      padding: 2px 8px 2px 4px;
      background: var(--ds-background-neutral);
      border-radius: var(--ds-radius-200);
      font: var(--ds-font-body-small);
      font-size: 12px;
    }
    .settings-chip-remove {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--ds-icon-subtle);
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
    }
    .settings-chip-remove:hover {
      color: var(--ds-icon-danger);
    }

    .settings-group-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 10;
      background: var(--ds-surface-overlay);
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      box-shadow: var(--ds-shadow-overlay);
      max-height: 200px;
      overflow-y: auto;
      margin-top: 4px;
    }
    .settings-dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--ds-space-100);
      padding: 8px 12px;
      cursor: pointer;
      font: var(--ds-font-body-small);
      transition: background var(--ds-duration-fast);
    }
    .settings-dropdown-item:hover {
      background: var(--ds-background-neutral-hovered);
    }

    .settings-holiday-table-wrap {
      max-height: 320px;
      overflow-y: auto;
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
    }
    .settings-holiday-table-wrap .table {
      margin: 0;
    }
    .settings-holiday-table-wrap .table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--ds-surface);
    }
  `;
  document.head.appendChild(style);
}
