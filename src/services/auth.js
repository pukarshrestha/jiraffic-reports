/**
 * Auth Service — Manage Jira credentials and sessions
 *
 * Supports multiple Jira Cloud sites.
 * Stores credentials as an array in localStorage.
 * Deduplication of users across sites is handled in jira.js.
 */

const SITES_KEY = 'jiraffic-sites';

/* ── Multi-Site Storage ──────────────────────────── */

/**
 * Get all saved Jira sites
 * @returns {Array<{id: string, name: string, jiraUrl: string, email: string, apiToken: string}>}
 */
export function getSites() {
  try {
    const raw = localStorage.getItem(SITES_KEY);
    if (!raw) return [];
    return JSON.parse(atob(raw));
  } catch {
    return [];
  }
}

function saveSites(sites) {
  localStorage.setItem(SITES_KEY, btoa(JSON.stringify(sites)));
}

/**
 * Add a new site. Returns the site object.
 */
export function addSite(name, jiraUrl, email, apiToken) {
  const sites = getSites();
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
  const site = {
    id,
    name: name || new URL(jiraUrl).hostname.split('.')[0],
    jiraUrl: jiraUrl.replace(/\/+$/, ''),
    email,
    apiToken,
  };
  sites.push(site);
  saveSites(sites);
  return site;
}

/**
 * Remove a site by ID
 */
export function removeSite(id) {
  const sites = getSites().filter(s => s.id !== id);
  saveSites(sites);
  return sites;
}

/**
 * Backward compat — get first site's credentials
 */
export function getCredentials() {
  const sites = getSites();
  if (sites.length === 0) return null;
  return sites[0];
}

export function isLoggedIn() {
  return getSites().length > 0;
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

/* ── User Info ───────────────────────────────────── */

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

/* ── Login State ─────────────────────────────────── */

export function clearCredentials() {
  localStorage.removeItem(SITES_KEY);
}

export function logout() {
  clearCredentials();
  clearUser();
}
