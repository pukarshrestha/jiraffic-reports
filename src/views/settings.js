/**
 * Settings View — Work week, expected hours, and user groups
 */

import { getCredentials } from '../services/auth.js';
import { getSettings, saveSettings, getGroups, saveGroups } from '../services/settings.js';
import { searchUsers } from '../services/jira.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';
import { renderAppShell, updateBreadcrumbs } from '../components/shell.js';

let groupSearchTimeout = null;

export function renderSettings() {
  const creds = getCredentials();
  if (!creds) {
    navigate('/login');
    return;
  }

  const app = document.getElementById('app');
  renderAppShell(app, 'settings');
  updateBreadcrumbs([{ label: 'Settings' }]);

  const settings = getSettings();
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <div class="page-header" id="settings-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Configure application preferences</p>
    </div>

    <!-- Work Week -->
    <div class="card" id="settings-workweek" style="margin-bottom: var(--ds-space-300);">
      <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-050);">Work Week</h3>
      <p style="font: var(--ds-font-body-small); color: var(--ds-text-subtle); margin-bottom: var(--ds-space-200);">Define which days are workdays. This affects calendar highlighting and daily averages.</p>
      <div id="workweek-toggles" style="display: flex; gap: var(--ds-space-100); flex-wrap: wrap;">
        ${renderWorkWeekToggles(settings.workWeek)}
      </div>
    </div>

    <!-- Expected Hours -->
    <div class="card" id="settings-expected-hours" style="margin-bottom: var(--ds-space-300);">
      <h3 style="font: var(--ds-font-heading-small); margin-bottom: var(--ds-space-050);">Expected Work Hours</h3>
      <p style="font: var(--ds-font-body-small); color: var(--ds-text-subtle); margin-bottom: var(--ds-space-200);">Expected work hours per day. Used to color-code daily logs.</p>
      <div style="display: flex; align-items: center; gap: var(--ds-space-150);">
        <input class="input" type="number" id="expected-hours-input" min="1" max="24" step="0.5" value="${settings.expectedHoursPerDay}" style="width: 100px;" />
        <span style="font: var(--ds-font-body); color: var(--ds-text-subtle);">hours per day</span>
      </div>
    </div>

    <!-- User Groups -->
    <div class="card" id="settings-groups" style="margin-bottom: var(--ds-space-300);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--ds-space-050);">
        <h3 style="font: var(--ds-font-heading-small);">User Groups</h3>
        <button class="btn btn-primary" id="add-group-btn" style="height: 32px; font-size: 13px;">
          + New Group
        </button>
      </div>
      <p style="font: var(--ds-font-body-small); color: var(--ds-text-subtle); margin-bottom: var(--ds-space-200);">Create reusable groups of team members for quick selection in reports.</p>
      <div id="groups-list">
        ${renderGroupsList(settings.groups || [])}
      </div>
    </div>
  `;

  injectSettingsStyles();
  attachSettingsListeners(settings);
}

function renderWorkWeekToggles(workWeek) {
  const days = [
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
    { key: 'sun', label: 'Sun' },
  ];
  return days.map(d => `
    <button class="settings-day-toggle ${workWeek[d.key] ? 'active' : ''}" data-day="${d.key}" title="${workWeek[d.key] ? 'Workday — click to mark as holiday' : 'Holiday — click to mark as workday'}">
      ${d.label}
    </button>
  `).join('');
}

function renderGroupsList(groups) {
  if (!groups.length) {
    return `<div style="text-align: center; padding: var(--ds-space-300); color: var(--ds-text-subtlest); font: var(--ds-font-body-small);">No groups created yet. Click "New Group" to get started.</div>`;
  }
  return groups.map((g, i) => `
    <div class="settings-group-card" data-group-idx="${i}">
      <div class="settings-group-header">
        <div style="display: flex; align-items: center; gap: var(--ds-space-100); flex: 1; min-width: 0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: var(--ds-icon-subtle);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <input class="input settings-group-name" data-group-idx="${i}" value="${g.name}" placeholder="Group name" style="flex: 1; height: 28px; font-size: 13px; font-weight: 600;" />
        </div>
        <div style="display: flex; align-items: center; gap: var(--ds-space-050);">
          <span style="font: var(--ds-font-body-small); color: var(--ds-text-subtlest);">${g.users.length} member${g.users.length !== 1 ? 's' : ''}</span>
          <button class="btn btn-subtle btn-icon-only settings-delete-group" data-group-idx="${i}" title="Delete group" style="width: 28px; height: 28px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="settings-group-members">
        ${g.users.map((u, ui) => `
          <span class="settings-user-chip">
            <span class="avatar avatar-sm" style="width: 18px; height: 18px; font-size: 9px;">${(u.displayName || '?').charAt(0).toUpperCase()}</span>
            ${u.displayName}
            <button class="settings-chip-remove" data-group-idx="${i}" data-user-idx="${ui}" title="Remove">&times;</button>
          </span>
        `).join('')}
      </div>
      <div style="position: relative; margin-top: var(--ds-space-100);">
        <input class="input settings-group-user-search" data-group-idx="${i}" placeholder="Search and add users..." style="height: 28px; font-size: 12px; padding-left: var(--ds-space-300);" />
        <svg style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--ds-icon-subtle);" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <div class="settings-group-dropdown" data-group-idx="${i}" style="display: none;"></div>
      </div>
    </div>
  `).join('');
}

function attachSettingsListeners(settings) {
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
        dropdown.style.display = 'none';
        return;
      }
      groupSearchTimeout = setTimeout(async () => {
        try {
          const users = await searchUsers(query);
          const existing = settings.groups[groupIdx].users.map(u => u.accountId);
          const results = users.filter(u => u.accountType === 'atlassian' && !existing.includes(u.accountId));
          if (!results.length) {
            dropdown.innerHTML = '<div style="padding: 8px 12px; color: var(--ds-text-subtlest); font-size: 12px;">No matching users</div>';
          } else {
            dropdown.innerHTML = results.map(u => `
              <div class="settings-dropdown-item" data-account-id="${u.accountId}" data-display-name="${u.displayName}" data-avatar="${u.avatarUrls?.['24x24'] || ''}">
                <span class="avatar avatar-sm" style="width: 20px; height: 20px; font-size: 10px;">${(u.displayName || '?').charAt(0).toUpperCase()}</span>
                <span>${u.displayName}</span>
              </div>
            `).join('');
          }
          dropdown.style.display = '';

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
              dropdown.style.display = 'none';
              document.getElementById('groups-list').innerHTML = renderGroupsList(settings.groups);
              attachGroupListeners(settings);
            });
          });
        } catch {
          dropdown.innerHTML = '<div style="padding: 8px 12px; color: var(--ds-text-danger); font-size: 12px;">Search failed</div>';
          dropdown.style.display = '';
        }
      }, 300);
    });

    // Close dropdown on blur
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const dropdown = document.querySelector(`.settings-group-dropdown[data-group-idx="${groupIdx}"]`);
        if (dropdown) dropdown.style.display = 'none';
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
      color: white;
    }

    .settings-group-card {
      border: 1px solid var(--ds-border);
      border-radius: var(--ds-radius-200);
      padding: var(--ds-space-200);
      margin-bottom: var(--ds-space-150);
      background: var(--ds-surface-sunken);
    }
    .settings-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-100);
      margin-bottom: var(--ds-space-100);
    }
    .settings-group-members {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-075);
      min-height: 24px;
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
  `;
  document.head.appendChild(style);
}
