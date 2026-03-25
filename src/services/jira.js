/**
 * Jira API Client — Wraps common Jira REST API v3 calls
 * All requests go through the Express proxy server using OAuth Bearer tokens.
 *
 * Multi-site support: most functions query ALL selected sites in parallel
 * and merge results. Users are deduplicated by email address.
 */

import { getCredentials, getSites } from './auth.js';

/* ── Core Fetch Helpers ──────────────────────────── */

function getHeaders(site) {
  if (!site) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'X-Cloud-Id': site.cloudId,
  };
}

/**
 * Fetch from a specific site
 */
async function jiraFetchForSite(site, endpoint, options = {}) {
  const headers = getHeaders(site);
  const resp = await fetch(`/api/jira${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    credentials: 'include',
  });

  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ message: `Request failed (${resp.status})` }));
    throw new Error(error.message || error.errorMessages?.[0] || `API Error ${resp.status}`);
  }

  return resp.json();
}

/**
 * Backward compat — fetch from first site
 */
async function jiraFetch(endpoint, options = {}) {
  const site = getCredentials();
  return jiraFetchForSite(site, endpoint, options);
}

/**
 * Fetch from ALL sites in parallel, merge results via merger callback.
 * Returns merged array. Errors on individual sites are silently skipped.
 */
async function jiraFetchAll(endpoint, extractor, options = {}) {
  const sites = getSites();
  if (sites.length === 0) throw new Error('Not authenticated');

  // If only 1 site, skip the overhead
  if (sites.length === 1) {
    const data = await jiraFetchForSite(sites[0], endpoint, options);
    const items = extractor(data);
    return items.map(item => ({ ...item, _site: sites[0] }));
  }

  const results = await Promise.allSettled(
    sites.map(async site => {
      const data = await jiraFetchForSite(site, endpoint, options);
      const items = extractor(data);
      return items.map(item => ({ ...item, _site: site }));
    })
  );

  const merged = [];
  results.forEach(r => {
    if (r.status === 'fulfilled') merged.push(...r.value);
  });
  return merged;
}

/* ── Public API ──────────────────────────────────── */

/** Get current user info (from first site) */
export function getMyself() {
  return jiraFetch('/myself');
}

/** Get all accessible projects from ALL sites */
export async function getProjects() {
  const projects = await jiraFetchAll(
    '/project/search?maxResults=50&orderBy=name',
    data => data.values || data
  );
  return projects;
}

/** Get a specific project (from the site it belongs to, or first site) */
export function getProject(projectKey) {
  return jiraFetch(`/project/${projectKey}`);
}

/** Search issues with JQL on a specific site */
export async function searchIssuesOnSite(site, jql, options = {}) {
  const { maxResults = 50, fields = '', nextPageToken = '' } = options;
  const params = new URLSearchParams({ jql, maxResults: maxResults.toString() });
  if (fields) params.set('fields', fields);
  if (nextPageToken) params.set('nextPageToken', nextPageToken);
  return jiraFetchForSite(site, `/search/jql?${params}`);
}

/** Search issues with JQL (first site — backward compat) */
export async function searchIssues(jql, options = {}) {
  const site = getCredentials();
  return searchIssuesOnSite(site, jql, options);
}

/**
 * Search ALL issues across ALL sites matching JQL.
 * Each issue is tagged with `_site` (the site it came from).
 */
export async function searchAllIssues(jql, fields) {
  const sites = getSites();
  if (sites.length === 0) throw new Error('Not authenticated');

  const results = await Promise.allSettled(
    sites.map(async site => {
      const allIssues = [];
      let nextPageToken = '';
      let hasMore = true;

      while (hasMore) {
        const data = await searchIssuesOnSite(site, jql, { maxResults: 100, fields, nextPageToken });
        allIssues.push(...(data.issues || []).map(iss => ({ ...iss, _site: site })));

        if (data.nextPageToken) {
          nextPageToken = data.nextPageToken;
        } else {
          hasMore = false;
        }

        if (allIssues.length > 2000) break;
      }
      return allIssues;
    })
  );

  const merged = [];
  const seenKeys = new Set();
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      r.value.forEach(issue => {
        // Deduplicate issues by key + site cloudId
        const key = `${issue._site.cloudId}::${issue.key}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          merged.push(issue);
        }
      });
    }
  });
  return merged;
}

/** Get agile boards */
export async function getBoards(projectKeyOrId) {
  const params = projectKeyOrId ? `?projectKeyOrId=${projectKeyOrId}` : '';
  const data = await jiraFetch(`/board${params}`);
  return data.values || [];
}

/** Get sprints for a board */
export async function getSprints(boardId, state = 'active,closed') {
  const data = await jiraFetch(`/board/${boardId}/sprint?state=${state}&maxResults=50`);
  return data.values || [];
}

/** Get issues in a sprint */
export async function getSprintIssues(sprintId, fields = 'summary,status,issuetype,assignee,story_points,customfield_10016,priority,created,resolutiondate') {
  const data = await jiraFetch(`/sprint/${sprintId}/issue?maxResults=100&fields=${fields}`);
  return data.issues || [];
}

/** Get issue statuses for a project */
export function getStatuses(projectKey) {
  return jiraFetch(`/project/${projectKey}/statuses`);
}

/** Get all issue types */
export function getIssueTypes() {
  return jiraFetch('/issuetype');
}

/** Get issue priorities */
export function getPriorities() {
  return jiraFetch('/priority');
}

/**
 * Get worklogs for a specific issue.
 * If the issue has a _site tag, use that site; otherwise try all sites.
 */
export async function getIssueWorklogs(issueKey, issueSite) {
  if (issueSite) {
    const data = await jiraFetchForSite(issueSite, `/issue/${issueKey}/worklog?maxResults=1000`);
    return data.worklogs || [];
  }
  // Fallback: try first site
  const data = await jiraFetch(`/issue/${issueKey}/worklog?maxResults=1000`);
  return data.worklogs || [];
}

/**
 * Search for users across ALL sites.
 * Deduplicates by email address.
 * Each returned user has a `siteAccounts` array: [{accountId, cloudId, siteName}]
 */
export async function searchUsers(query) {
  const sites = getSites();
  if (sites.length === 0) throw new Error('Not authenticated');

  const params = new URLSearchParams({ query, maxResults: '20' });
  const results = await Promise.allSettled(
    sites.map(async site => {
      const users = await jiraFetchForSite(site, `/user/search?${params}`);
      return users.map(u => ({ ...u, _site: site }));
    })
  );

  // Merge and deduplicate by email
  const byEmail = new Map();
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach(user => {
      const email = (user.emailAddress || '').toLowerCase();
      const key = email || user.accountId; // fallback to accountId if no email

      if (byEmail.has(key)) {
        const existing = byEmail.get(key);
        // Add this site's accountId to the siteAccounts list
        const alreadyHasSite = existing.siteAccounts.some(sa => sa.cloudId === user._site.cloudId);
        if (!alreadyHasSite) {
          existing.siteAccounts.push({
            accountId: user.accountId,
            cloudId: user._site.cloudId,
            siteUrl: user._site.url,
            siteName: user._site.name,
          });
        }
      } else {
        byEmail.set(key, {
          ...user,
          siteAccounts: [{
            accountId: user.accountId,
            cloudId: user._site.cloudId,
            siteUrl: user._site.url,
            siteName: user._site.name,
          }],
        });
      }
    });
  });

  return Array.from(byEmail.values());
}

/** Get all accessible users (for assignable user search) */
export async function findAssignableUsers(query = '') {
  return searchUsers(query);
}

/* ── Utilities for multi-site worklog queries ────── */

/**
 * Build a JQL clause for a user across sites.
 * Returns an array of { site, jql } objects — one per site the user is on.
 */
export function buildUserWorklogJqlPerSite(selectedUsers, dateFrom, dateTo) {
  const sites = getSites();
  const siteJqls = [];

  sites.forEach(site => {
    // Find accountIds for this site from the selected users' siteAccounts
    const accountIds = [];
    selectedUsers.forEach(u => {
      if (u.siteAccounts) {
        const siteAcct = u.siteAccounts.find(sa => sa.cloudId === site.cloudId);
        if (siteAcct) accountIds.push(siteAcct.accountId);
      } else if (u.accountId) {
        // Legacy single-site user
        accountIds.push(u.accountId);
      }
    });

    if (accountIds.length > 0) {
      const idList = accountIds.map(id => `"${id}"`).join(', ');
      const jql = `worklogAuthor in (${idList}) AND worklogDate >= "${dateFrom}" AND worklogDate <= "${dateTo}" ORDER BY updated DESC`;
      siteJqls.push({ site, jql });
    }
  });

  return siteJqls;
}

/**
 * Search all issues across sites using per-site JQL (for worklog queries).
 * Returns merged issues, each tagged with _site.
 */
export async function searchAllIssuesMultiSite(siteJqls, fields) {
  const results = await Promise.allSettled(
    siteJqls.map(async ({ site, jql }) => {
      const allIssues = [];
      let nextPageToken = '';
      let hasMore = true;

      while (hasMore) {
        const data = await searchIssuesOnSite(site, jql, { maxResults: 100, fields, nextPageToken });
        allIssues.push(...(data.issues || []).map(iss => ({ ...iss, _site: site })));
        nextPageToken = data.nextPageToken || '';
        hasMore = !!nextPageToken;
        if (allIssues.length > 2000) break;
      }
      return allIssues;
    })
  );

  const merged = [];
  results.forEach(r => {
    if (r.status === 'fulfilled') merged.push(...r.value);
  });
  return merged;
}

/**
 * Get the changelog for a specific issue.
 */
export async function getIssueChangelog(issueKey, issueSite) {
  const site = issueSite || getCredentials();
  const data = await jiraFetchForSite(site, `/issue/${issueKey}?expand=changelog&fields=summary,status,assignee,project,issuetype,created,resolutiondate`);
  return data;
}

/**
 * Build per-site JQL for resolved issues by user within a date range.
 * Used by Cycle Time report.
 */
export function buildUserCycleTimeJqlPerSite(selectedUsers, dateFrom, dateTo) {
  const sites = getSites();
  const siteJqls = [];

  sites.forEach(site => {
    const accountIds = [];
    selectedUsers.forEach(u => {
      if (u.siteAccounts) {
        const siteAcct = u.siteAccounts.find(sa => sa.cloudId === site.cloudId);
        if (siteAcct) accountIds.push(siteAcct.accountId);
      } else if (u.accountId) {
        accountIds.push(u.accountId);
      }
    });

    if (accountIds.length > 0) {
      const idList = accountIds.map(id => `"${id}"`).join(', ');
      const jql = `assignee in (${idList}) AND statusCategory = Done AND resolved >= "${dateFrom}" AND resolved <= "${dateTo}" ORDER BY resolved DESC`;
      siteJqls.push({ site, jql });
    }
  });

  return siteJqls;
}

/**
 * Build per-site JQL for issues that had status changes during a date range.
 * Used by Time in Lane report.
 */
export function buildUserLaneTimeJqlPerSite(selectedUsers, dateFrom, dateTo) {
  const sites = getSites();
  const siteJqls = [];

  sites.forEach(site => {
    const accountIds = [];
    selectedUsers.forEach(u => {
      if (u.siteAccounts) {
        const siteAcct = u.siteAccounts.find(sa => sa.cloudId === site.cloudId);
        if (siteAcct) accountIds.push(siteAcct.accountId);
      } else if (u.accountId) {
        accountIds.push(u.accountId);
      }
    });

    if (accountIds.length > 0) {
      const idList = accountIds.map(id => `"${id}"`).join(', ');
      const jql = `assignee in (${idList}) AND status changed DURING ("${dateFrom}", "${dateTo}") ORDER BY updated DESC`;
      siteJqls.push({ site, jql });
    }
  });

  return siteJqls;
}

/**
 * Search issues across sites, then fetch changelog for each issue.
 * Two-step approach: uses searchIssuesOnSite (proven) + individual changelog fetch.
 */
export async function searchAllIssuesWithChangelog(siteJqls, fields, onProgress) {
  // Step 1: Fetch issues using the same pattern as searchAllIssuesMultiSite
  if (onProgress) onProgress({ phase: 'search', current: 0, total: 0, message: 'Searching issues...' });

  const results = await Promise.allSettled(
    siteJqls.map(async ({ site, jql }) => {
      const allIssues = [];
      let nextPageToken = '';
      let hasMore = true;

      while (hasMore) {
        const data = await searchIssuesOnSite(site, jql, { maxResults: 100, fields, nextPageToken });
        allIssues.push(...(data.issues || []).map(iss => ({ ...iss, _site: site })));
        nextPageToken = data.nextPageToken || '';
        hasMore = !!nextPageToken;
        if (allIssues.length > 500) break; // Limit for changelog fetching
      }
      return allIssues;
    })
  );

  const merged = [];
  results.forEach(r => {
    if (r.status === 'fulfilled') merged.push(...r.value);
  });

  if (onProgress) onProgress({ phase: 'changelog', current: 0, total: merged.length, message: `Loading changelogs (0/${merged.length})...` });

  // Step 2: Fetch changelog for each issue (in batches of 10)
  const batchSize = 10;
  for (let i = 0; i < merged.length; i += batchSize) {
    const batch = merged.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async issue => {
        try {
          const data = await jiraFetchForSite(issue._site, `/issue/${issue.key}?expand=changelog&fields=summary`);
          issue.changelog = data.changelog || { histories: [] };
        } catch {
          issue.changelog = { histories: [] };
        }
      })
    );
    const done = Math.min(i + batchSize, merged.length);
    if (onProgress) onProgress({ phase: 'changelog', current: done, total: merged.length, message: `Loading changelogs (${done}/${merged.length})...` });
  }

  return merged;
}
