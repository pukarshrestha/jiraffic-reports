/**
 * Jira API Client — Wraps common Jira REST API v3 calls
 * All requests go through the Express proxy server.
 */

import { getCredentials } from './auth.js';

function getHeaders() {
  const creds = getCredentials();
  if (!creds) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'X-Jira-Url': creds.jiraUrl,
    'X-Jira-Email': creds.email,
    'X-Jira-Token': creds.apiToken,
  };
}

async function jiraFetch(endpoint, options = {}) {
  const headers = getHeaders();
  const resp = await fetch(`/api/jira${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ message: `Request failed (${resp.status})` }));
    throw new Error(error.message || error.errorMessages?.[0] || `API Error ${resp.status}`);
  }

  return resp.json();
}

/** Get current user info */
export function getMyself() {
  return jiraFetch('/myself');
}

/** Get all accessible projects */
export async function getProjects() {
  const data = await jiraFetch('/project/search?maxResults=50&orderBy=name');
  return data.values || data;
}

/** Get a specific project */
export function getProject(projectKey) {
  return jiraFetch(`/project/${projectKey}`);
}

/** Search issues with JQL (uses new /search/jql endpoint) */
export async function searchIssues(jql, options = {}) {
  const { maxResults = 50, fields = '', nextPageToken = '' } = options;
  const params = new URLSearchParams({
    jql,
    maxResults: maxResults.toString(),
  });
  if (fields) params.set('fields', fields);
  if (nextPageToken) params.set('nextPageToken', nextPageToken);
  return jiraFetch(`/search/jql?${params}`);
}

/** Get all issues matching JQL (handles nextPageToken pagination) */
export async function searchAllIssues(jql, fields) {
  const allIssues = [];
  let nextPageToken = '';
  let hasMore = true;

  while (hasMore) {
    const data = await searchIssues(jql, { maxResults: 100, fields, nextPageToken });
    allIssues.push(...(data.issues || []));

    if (data.nextPageToken) {
      nextPageToken = data.nextPageToken;
    } else {
      hasMore = false;
    }

    // Safety limit
    if (allIssues.length > 2000) break;
  }

  return allIssues;
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

/** Get worklogs for a specific issue */
export async function getIssueWorklogs(issueKey) {
  const data = await jiraFetch(`/issue/${issueKey}/worklog?maxResults=1000`);
  return data.worklogs || [];
}

/** Search for users (for the multi-user picker) */
export async function searchUsers(query) {
  const params = new URLSearchParams({ query, maxResults: '20' });
  return jiraFetch(`/user/search?${params}`);
}

/** Get all accessible users (for assignable user search) */
export async function findAssignableUsers(query = '') {
  const params = new URLSearchParams({ query, maxResults: '20' });
  return jiraFetch(`/user/search?${params}`);
}
