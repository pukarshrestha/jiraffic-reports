/**
 * Auth Service — OAuth 2.0 session management
 *
 * Session is managed server-side via signed cookies.
 * Client stores only UI preferences (selected sites, cached user info).
 */

const SELECTED_SITES_KEY = 'jiraffic-selected-sites';
let _cachedStatus = null;
let _cachedStatusTime = 0;
const STATUS_CACHE_TTL = 5000; // 5 seconds

/* ── Session Status ─────────────────────────────────── */

/**
 * Check if user is logged in (async — calls server)
 * Caches result for STATUS_CACHE_TTL ms to avoid spamming.
 */
export async function checkAuthStatus() {
  if (_cachedStatus && (Date.now() - _cachedStatusTime < STATUS_CACHE_TTL)) {
    return _cachedStatus;
  }

  try {
    const resp = await fetch('/auth/status', { credentials: 'include' });
    const data = await resp.json();
    _cachedStatus = data;
    _cachedStatusTime = Date.now();
    return data;
  } catch {
    return { loggedIn: false };
  }
}

/**
 * Check if logged in (async)
 */
export async function isLoggedIn() {
  const status = await checkAuthStatus();
  return status.loggedIn;
}

/**
 * Invalidate cached auth status (call after login/logout)
 */
export function invalidateAuthCache() {
  _cachedStatus = null;
  _cachedStatusTime = 0;
}

/* ── Accessible Sites ───────────────────────────────── */

/**
 * Fetch all accessible Jira sites from the server
 * @returns {Promise<Array<{cloudId, name, url, avatarUrl, accountEmail}>>}
 */
export async function getAccessibleSites() {
  try {
    const resp = await fetch('/auth/sites', { credentials: 'include' });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.sites || [];
  } catch {
    return [];
  }
}

/**
 * Get info about all connected accounts
 * @returns {Promise<Array<{email, displayName, sitesCount}>>}
 */
export async function getAccountsInfo() {
  try {
    const resp = await fetch('/auth/sites', { credentials: 'include' });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.accounts || [];
  } catch {
    return [];
  }
}

/* ── Selected Sites (localStorage) ──────────────────── */

/**
 * Get the user's selected site cloudIds.
 * If none selected, return all accessible sites (default: all selected).
 */
export function getSelectedSiteIds() {
  try {
    const raw = localStorage.getItem(SELECTED_SITES_KEY);
    if (!raw) return null; // null = "all sites"
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save selected site cloudIds
 * @param {string[]} cloudIds
 */
export function saveSelectedSiteIds(cloudIds) {
  localStorage.setItem(SELECTED_SITES_KEY, JSON.stringify(cloudIds));
}

/**
 * Get selected sites as full objects (filtered from accessible sites).
 * If no selection saved, returns all accessible sites.
 * @returns {Promise<Array<{cloudId, name, url}>>}
 */
export async function getSelectedSites() {
  const allSites = await getAccessibleSites();
  const selectedIds = getSelectedSiteIds();

  if (!selectedIds) {
    // All sites selected by default
    return allSites;
  }

  return allSites.filter(s => selectedIds.includes(s.cloudId));
}

/**
 * Sync alias — returns sites from cache (for use in synchronous contexts).
 * Must call loadSitesCache() first during app init.
 */
let _sitesCache = [];

export function getSites() {
  return _sitesCache;
}

export async function loadSitesCache() {
  _sitesCache = await getSelectedSites();
  return _sitesCache;
}

/* ── User Info ──────────────────────────────────────── */

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

/* ── Login / Logout ─────────────────────────────────── */

/**
 * Initiate OAuth login — redirects to server which redirects to Atlassian
 */
export function startOAuthLogin() {
  window.location.href = '/auth/login';
}

/**
 * Add another Atlassian account — keeps existing session
 */
export function addAnotherAccount() {
  window.location.href = '/auth/login?addAccount=true';
}

/**
 * Remove a connected account by email
 */
export async function removeAccount(email) {
  try {
    const resp = await fetch('/auth/remove-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    if (resp.ok) {
      invalidateAuthCache();
      _sitesCache = [];
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Logout — clear server session + local data
 */
export async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Ignore fetch errors on logout
  }
  clearUser();
  localStorage.removeItem(SELECTED_SITES_KEY);
  invalidateAuthCache();
  _sitesCache = [];
}

/* ── Legacy compat — getCredentials returns first site ── */

export function getCredentials() {
  const sites = getSites();
  if (sites.length === 0) return null;
  return sites[0];
}
