/**
 * Login View — Jira credentials form with multi-site support
 */

import { validateCredentials, addSite, getSites, removeSite, saveUser, isLoggedIn } from '../services/auth.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';

export function renderLogin() {
  // Redirect if already logged in
  if (isLoggedIn()) {
    navigate('/dashboard');
    return;
  }

  const app = document.getElementById('app');
  renderLoginForm(app);
}

function renderLoginForm(container) {
  const sites = getSites();
  const hasSites = sites.length > 0;

  container.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <svg class="login-brand-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="login-logo-mask" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
              <path d="M5.10645 0C5.03887 0.238644 5 0.489715 5 0.75V8.25C5 9.10495 5.3979 9.91118 6.07617 10.4316C6.75443 10.952 7.63615 11.1275 8.46191 10.9062L15.708 8.96484C15.8084 8.93794 15.9054 8.90417 16 8.86719V16H0V0H5.10645ZM10.7783 4.59082L10.5 4.66602V4.37598C10.5956 4.44395 10.6881 4.51612 10.7783 4.59082ZM16 2.16895C15.3896 1.34202 14.6579 0.610649 13.8311 0H16V2.16895Z" fill="currentColor"/>
            </mask>
            <g mask="url(#login-logo-mask)">
              <path d="M1.75 8C1.75 11.4518 4.54822 14.25 8 14.25C11.4518 14.25 14.25 11.4518 14.25 8C14.25 4.54822 11.4518 1.75 8 1.75C4.54822 1.75 1.75 4.54822 1.75 8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </g>
            <path d="M7.75 8.25V0.75C11.2207 0.75 14.1407 3.10743 14.9962 6.30838L7.75 8.25Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
          <h1 class="login-brand-title">Jira-ffic Reports</h1>
          <p class="login-brand-subtitle">${hasSites ? 'Add another Jira site or continue to dashboard' : 'Connect your Jira account to generate custom reports and analytics'}</p>
        </div>

        ${hasSites ? renderConnectedSites(sites) : ''}

        <form id="login-form" class="login-form" autocomplete="off">
          ${hasSites ? '<h3 class="text-heading-xsmall mb-200">Add Another Site</h3>' : ''}

          <div class="form-group">
            <label class="form-label" for="jira-url">Jira Cloud URL</label>
            <input
              class="input"
              type="url"
              id="jira-url"
              placeholder="https://yourcompany.atlassian.net"
              required
              ${!hasSites ? 'autofocus' : ''}
            />
            <span class="form-label-subtle">Your Atlassian Cloud instance URL</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="jira-email">Email Address</label>
            <input
              class="input"
              type="email"
              id="jira-email"
              placeholder="you@company.com"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="jira-token">API Token</label>
            <div class="login-token-wrapper">
              <input
                class="input login-token-input"
                type="password"
                id="jira-token"
                placeholder="Your Jira API token"
                required
              />
              <button type="button" id="toggle-token-visibility" class="btn-subtle btn-icon-only login-token-toggle" aria-label="Toggle token visibility">
                <svg id="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <span class="form-label-subtle">
              <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">Generate an API token</a> from your Atlassian account settings
            </span>
          </div>

          <button type="submit" class="btn btn-primary login-submit-btn" id="login-btn">
            <span id="login-btn-text">${hasSites ? 'Add Site' : 'Connect to Jira'}</span>
            <div id="login-spinner" class="spinner spinner-sm login-spinner-inline d-none"></div>
          </button>

          <div id="login-error" class="login-error-box d-none">
            <p class="login-error-text" id="login-error-text"></p>
          </div>
        </form>

        ${hasSites ? `
          <button class="btn btn-primary login-submit-btn mt-200" id="continue-btn">
            Continue to Dashboard →
          </button>
        ` : ''}

        <div class="login-footer">
          <p>Your credentials are stored locally and never sent to third parties.</p>
        </div>
      </div>
    </div>
  `;

  // Toggle token visibility
  document.getElementById('toggle-token-visibility').addEventListener('click', () => {
    const input = document.getElementById('jira-token');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
  });

  // Handle form submission
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleLogin(container);
  });

  // Continue button
  document.getElementById('continue-btn')?.addEventListener('click', () => {
    navigate('/dashboard');
  });

  // Remove site buttons
  container.querySelectorAll('.login-site-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const siteId = btn.dataset.siteId;
      removeSite(siteId);
      showToast('info', 'Site removed');
      renderLoginForm(container); // Re-render
    });
  });
}

function renderConnectedSites(sites) {
  return `
    <div class="login-connected-sites mb-200">
      <h3 class="text-heading-xsmall mb-100">Connected Sites</h3>
      ${sites.map(s => `
        <div class="login-site-card">
          <div class="login-site-info">
            <div class="login-site-name">${s.name}</div>
            <div class="login-site-url">${s.jiraUrl}</div>
          </div>
          <button class="btn-subtle btn-icon-only login-site-remove" data-site-id="${s.id}" title="Remove site">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

async function handleLogin(container) {
  const jiraUrl = document.getElementById('jira-url').value.trim();
  const email = document.getElementById('jira-email').value.trim();
  const apiToken = document.getElementById('jira-token').value.trim();
  const loginBtn = document.getElementById('login-btn');
  const loginBtnText = document.getElementById('login-btn-text');
  const loginSpinner = document.getElementById('login-spinner');
  const errorDiv = document.getElementById('login-error');
  const errorText = document.getElementById('login-error-text');

  // Validate inputs
  if (!jiraUrl || !email || !apiToken) {
    showError(errorDiv, errorText, 'Please fill in all fields');
    return;
  }

  if (!jiraUrl.includes('atlassian.net')) {
    showError(errorDiv, errorText, 'Please enter a valid Atlassian Cloud URL (e.g., https://yourcompany.atlassian.net)');
    return;
  }

  // Check if site already added
  const existingSites = getSites();
  if (existingSites.some(s => s.jiraUrl.replace(/\/+$/, '') === jiraUrl.replace(/\/+$/, ''))) {
    showError(errorDiv, errorText, 'This Jira site is already connected.');
    return;
  }

  // Show loading state
  loginBtn.disabled = true;
  loginBtnText.textContent = 'Connecting...';
  loginSpinner.classList.remove('d-none');
  errorDiv.classList.add('d-none');

  try {
    const result = await validateCredentials(jiraUrl, email, apiToken);

    if (result.success) {
      // Extract site name from URL
      const siteName = new URL(jiraUrl).hostname.split('.')[0];
      addSite(siteName, jiraUrl, email, apiToken);
      saveUser(result.user);

      const siteCount = getSites().length;
      showToast('success', 'Site Connected!', `${siteName} added (${siteCount} site${siteCount > 1 ? 's' : ''} total)`);

      // Re-render login to show the connected sites list
      renderLoginForm(container);
    } else {
      showError(errorDiv, errorText, result.error || 'Authentication failed. Please check your credentials.');
    }
  } catch (err) {
    showError(errorDiv, errorText, err.message || 'Connection failed. Make sure the proxy server is running.');
  } finally {
    loginBtn.disabled = false;
    loginBtnText.textContent = getSites().length > 0 ? 'Add Site' : 'Connect to Jira';
    loginSpinner.classList.add('d-none');
  }
}

function showError(errorDiv, errorText, msg) {
  errorText.textContent = msg;
  errorDiv.classList.remove('d-none');
}
