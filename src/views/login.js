/**
 * Login View — Jira credentials form
 */

import { validateCredentials, saveCredentials, saveUser, isLoggedIn } from '../services/auth.js';
import { showToast } from '../utils/toast.js';
import { navigate } from '../utils/router.js';

export function renderLogin() {
  // Redirect if already logged in
  if (isLoggedIn()) {
    navigate('/dashboard');
    return;
  }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <svg class="login-brand-icon" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="var(--ds-background-brand-bold)"/>
            <path d="M10 21.5L16 10.5L22 21.5H10Z" fill="white" opacity="0.9"/>
            <path d="M8 23H24V25H8V23Z" fill="white" opacity="0.7"/>
          </svg>
          <h1 class="login-brand-title">Jira-ffic Reports</h1>
          <p class="login-brand-subtitle">Connect your Jira account to generate custom reports and analytics</p>
        </div>

        <form id="login-form" class="login-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label" for="jira-url">Jira Cloud URL</label>
            <input
              class="input"
              type="url"
              id="jira-url"
              placeholder="https://yourcompany.atlassian.net"
              required
              autofocus
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

          <div class="checkbox-group">
            <input type="checkbox" id="remember-me" checked />
            <label for="remember-me">Remember me</label>
          </div>

          <button type="submit" class="btn btn-primary login-submit-btn" id="login-btn">
            <span id="login-btn-text">Connect to Jira</span>
            <div id="login-spinner" class="spinner spinner-sm login-spinner-inline d-none"></div>
          </button>

          <div id="login-error" class="login-error-box d-none">
            <p class="login-error-text" id="login-error-text"></p>
          </div>
        </form>

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
    await handleLogin();
  });
}

async function handleLogin() {
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

  // Show loading state
  loginBtn.disabled = true;
  loginBtnText.textContent = 'Connecting...';
  loginSpinner.classList.remove('d-none');
  errorDiv.classList.add('d-none');

  try {
    const result = await validateCredentials(jiraUrl, email, apiToken);

    if (result.success) {
      saveCredentials(jiraUrl, email, apiToken);
      saveUser(result.user);
      showToast('success', 'Connected!', `Welcome, ${result.user.displayName}`);
      navigate('/dashboard');
    } else {
      showError(errorDiv, errorText, result.error || 'Authentication failed. Please check your credentials.');
    }
  } catch (err) {
    showError(errorDiv, errorText, err.message || 'Connection failed. Make sure the proxy server is running.');
  } finally {
    loginBtn.disabled = false;
    loginBtnText.textContent = 'Connect to Jira';
    loginSpinner.classList.add('d-none');
  }
}

function showError(errorDiv, errorText, msg) {
  errorText.textContent = msg;
  errorDiv.classList.remove('d-none');
}
