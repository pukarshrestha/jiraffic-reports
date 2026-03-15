/**
 * Login View — OAuth 2.0 sign-in with Atlassian
 */

import { isLoggedIn, startOAuthLogin } from '../services/auth.js';
import { navigate } from '../utils/router.js';

export async function renderLogin() {
  // Redirect if already logged in
  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    navigate('/dashboard');
    return;
  }

  // Check for OAuth error in URL
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');

  const app = document.getElementById('app');

  app.innerHTML = `
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
          <p class="login-brand-subtitle">Connect your Atlassian account to generate custom reports and analytics across all your Jira sites.</p>
        </div>

        ${error ? `
          <div class="login-error-box">
            <p class="login-error-text">${getErrorMessage(error)}</p>
          </div>
        ` : ''}

        <button class="btn btn-primary login-submit-btn login-oauth-btn" id="oauth-login-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.004 2C6.48 2 2 6.478 2 12.002c0 5.522 4.48 10 10.004 10 5.522 0 10-4.478 10-10C22.004 6.478 17.526 2 12.004 2z" fill="currentColor" opacity="0.15"/>
            <path d="M15.73 8.27a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06l1.47 1.47 3.97-3.97a.75.75 0 0 1 1.06 0z" fill="currentColor"/>
          </svg>
          <span>Sign in with Atlassian</span>
        </button>

        <div class="login-footer">
          <p>You'll be redirected to Atlassian to authorize access. All your Jira Cloud sites will be auto-discovered.</p>
        </div>
      </div>
    </div>
  `;

  // Handle OAuth login
  document.getElementById('oauth-login-btn').addEventListener('click', () => {
    startOAuthLogin();
  });
}

function getErrorMessage(error) {
  switch (error) {
    case 'oauth_denied':
      return 'Authorization was denied. Please try again and grant access to continue.';
    case 'missing_params':
      return 'Missing authorization parameters. Please try signing in again.';
    case 'invalid_state':
      return 'Invalid session state. Please try signing in again.';
    case 'token_exchange':
      return 'Failed to complete authorization. Please check your OAuth app configuration.';
    case 'server_error':
      return 'A server error occurred. Please try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}
