/**
 * Auth Service — Manage Jira credentials and sessions
 *
 * Stores base64-encoded credentials in localStorage.
 * Validates by testing /rest/api/3/myself endpoint.
 */

const AUTH_KEY = 'jiraffic-auth';

export function getCredentials() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(atob(raw));
  } catch {
    return null;
  }
}

export function saveCredentials(jiraUrl, email, apiToken) {
  const creds = { jiraUrl: jiraUrl.replace(/\/+$/, ''), email, apiToken };
  localStorage.setItem(AUTH_KEY, btoa(JSON.stringify(creds)));
  return creds;
}

export function clearCredentials() {
  localStorage.removeItem(AUTH_KEY);
}

export function isLoggedIn() {
  return !!getCredentials();
}

/**
 * Validate credentials by calling Jira's /myself endpoint
 */
export async function validateCredentials(jiraUrl, email, apiToken) {
  const url = jiraUrl.replace(/\/+$/, '');
  try {
    const resp = await fetch('/api/jira/myself', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Jira-Url': url,
        'X-Jira-Email': email,
        'X-Jira-Token': apiToken,
      },
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(errorData.message || `Authentication failed (${resp.status})`);
    }

    const user = await resp.json();
    return { success: true, user };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get the saved user info (fetched after login)
 */
export function getSavedUser() {
  try {
    const raw = localStorage.getItem('jiraffic-user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveUser(user) {
  localStorage.setItem('jiraffic-user', JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem('jiraffic-user');
}

export function logout() {
  clearCredentials();
  clearUser();
}
