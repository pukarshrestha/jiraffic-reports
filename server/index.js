/**
 * Jira-ffic Reports — Express Server
 * 
 * Handles OAuth 2.0 (3LO) flow with Atlassian and proxies
 * Jira API requests using Bearer tokens.
 * 
 * Supports multiple Atlassian accounts — each OAuth login adds
 * its sites to the session. The proxy maps cloudId → correct token.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;

const CLIENT_ID = process.env.ATLASSIAN_CLIENT_ID;
const CLIENT_SECRET = process.env.ATLASSIAN_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'jiraffic-dev-secret';
const CALLBACK_URL = 'http://localhost:5173/auth/callback';

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const ATLASSIAN_API_BASE = 'https://api.atlassian.com';

const SCOPES = [
  'read:jira-work',
  'read:jira-user',
  'offline_access',
];

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

/* ── In-Memory Session Store ────────────────────────── */

/**
 * Session structure:
 * {
 *   accounts: [
 *     {
 *       accountEmail: string,       // Atlassian account identifier
 *       accessToken: string,
 *       refreshToken: string,
 *       expiresAt: number,
 *       sites: [{ cloudId, name, url, avatarUrl }],
 *       user: { displayName, emailAddress, ... }
 *     }
 *   ]
 * }
 */
const sessions = new Map();
// Map<state, { createdAt }> for CSRF protection
const pendingStates = new Map();

/**
 * Get session from signed cookie
 */
function getSession(req) {
  const sessionId = req.signedCookies?.['jiraffic-session'];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { sessionId, ...session };
}

/**
 * Find the account that owns a given cloudId
 */
function findAccountForCloudId(session, cloudId) {
  if (!session?.accounts) return null;
  return session.accounts.find(acct =>
    acct.sites.some(s => s.cloudId === cloudId)
  );
}

/**
 * Refresh access token for a specific account if expired
 */
async function refreshAccountToken(account) {
  if (!account || !account.refreshToken) return false;

  // Refresh if token expires within 60 seconds
  if (account.expiresAt > Date.now() + 60000) return true;

  try {
    const resp = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: account.refreshToken,
      }),
    });

    if (!resp.ok) {
      console.error('Token refresh failed:', resp.status);
      return false;
    }

    const data = await resp.json();
    account.accessToken = data.access_token;
    account.refreshToken = data.refresh_token || account.refreshToken;
    account.expiresAt = Date.now() + (data.expires_in * 1000);

    console.log(`🔄 Token refreshed for ${account.accountEmail || 'account'}`);
    return true;
  } catch (err) {
    console.error('Token refresh error:', err.message);
    return false;
  }
}

/**
 * Get all sites across all accounts (flattened, deduplicated by cloudId)
 */
function getAllSites(session) {
  if (!session?.accounts) return [];
  const seen = new Set();
  const sites = [];
  for (const acct of session.accounts) {
    for (const site of acct.sites) {
      if (!seen.has(site.cloudId)) {
        seen.add(site.cloudId);
        sites.push({ ...site, accountEmail: acct.accountEmail || acct.user?.emailAddress });
      }
    }
  }
  return sites;
}

/* ── OAuth Routes ───────────────────────────────────── */

/**
 * GET /auth/login — Redirect to Atlassian consent screen
 * ?addAccount=true means adding another account to existing session
 */
app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const isAddAccount = req.query.addAccount === 'true';
  pendingStates.set(state, { createdAt: Date.now(), isAddAccount });

  // Clean up old states (>10 min)
  for (const [s, v] of pendingStates) {
    if (Date.now() - v.createdAt > 600000) pendingStates.delete(s);
  }

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    redirect_uri: CALLBACK_URL,
    state,
    response_type: 'code',
    prompt: 'consent',
  });

  res.redirect(`${ATLASSIAN_AUTH_URL}?${params}`);
});

/**
 * GET /auth/callback — Exchange code for tokens, discover sites
 */
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/#/login?error=oauth_denied');
  }

  if (!code || !state) {
    return res.redirect('/#/login?error=missing_params');
  }

  // Validate state
  const stateData = pendingStates.get(state);
  if (!stateData) {
    return res.redirect('/#/login?error=invalid_state');
  }
  pendingStates.delete(state);

  const isAddAccount = stateData.isAddAccount;

  try {
    // Exchange code for tokens
    const tokenResp = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: CALLBACK_URL,
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error('Token exchange failed:', err);
      return res.redirect('/#/login?error=token_exchange');
    }

    const tokens = await tokenResp.json();

    // Discover accessible Jira sites
    const sitesResp = await fetch(ATLASSIAN_RESOURCES_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let sites = [];
    if (sitesResp.ok) {
      const allResources = await sitesResp.json();
      sites = allResources.map(r => ({
        cloudId: r.id,
        name: r.name,
        url: r.url,
        avatarUrl: r.avatarUrl || '',
      }));
    }

    // Fetch user info from the first site
    let user = null;
    if (sites.length > 0) {
      try {
        const userResp = await fetch(
          `${ATLASSIAN_API_BASE}/ex/jira/${sites[0].cloudId}/rest/api/3/myself`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (userResp.ok) {
          user = await userResp.json();
        }
      } catch (e) {
        console.error('Failed to fetch user info:', e.message);
      }
    }

    // Build the new account entry
    const newAccount = {
      accountEmail: user?.emailAddress || '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      sites,
      user,
    };

    // Check if we're adding to an existing session
    const existingSession = getSession(req);
    let sessionId;

    if (isAddAccount && existingSession) {
      // Add new account to existing session
      sessionId = existingSession.sessionId;
      const session = sessions.get(sessionId);

      // Check if this account is already connected (by email)
      const existingIdx = session.accounts.findIndex(
        a => a.accountEmail && a.accountEmail === newAccount.accountEmail
      );
      if (existingIdx >= 0) {
        // Replace existing account (re-auth)
        session.accounts[existingIdx] = newAccount;
      } else {
        session.accounts.push(newAccount);
      }

      const totalSites = getAllSites({ accounts: session.accounts }).length;
      console.log(`✅ Account added — now ${session.accounts.length} account(s), ${totalSites} site(s)`);
      res.redirect('/#/settings');
    } else {
      // New session
      sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, {
        accounts: [newAccount],
      });

      // Set session cookie (httpOnly, signed)
      res.cookie('jiraffic-session', sessionId, {
        httpOnly: true,
        signed: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      console.log(`✅ OAuth complete — ${sites.length} site(s) discovered`);
      res.redirect('/#/dashboard');
    }

  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/#/login?error=server_error');
  }
});

/**
 * GET /auth/status — Check if user is logged in
 */
app.get('/auth/status', async (req, res) => {
  const session = getSession(req);
  if (!session || !session.accounts?.length) {
    return res.json({ loggedIn: false });
  }

  // Refresh token for the primary account
  const primaryAccount = session.accounts[0];
  const valid = await refreshAccountToken(primaryAccount);
  if (!valid) {
    sessions.delete(session.sessionId);
    res.clearCookie('jiraffic-session');
    return res.json({ loggedIn: false });
  }

  const allSites = getAllSites(session);

  res.json({
    loggedIn: true,
    user: primaryAccount.user,
    sitesCount: allSites.length,
    accountsCount: session.accounts.length,
  });
});

/**
 * GET /auth/sites — Return all accessible Jira sites across all accounts
 */
app.get('/auth/sites', async (req, res) => {
  const session = getSession(req);
  if (!session || !session.accounts?.length) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  // Refresh all accounts
  for (const acct of session.accounts) {
    await refreshAccountToken(acct);
  }

  const allSites = getAllSites(session);
  res.json({
    sites: allSites,
    accounts: session.accounts.map(a => ({
      email: a.accountEmail || a.user?.emailAddress || 'Unknown',
      displayName: a.user?.displayName || '',
      sitesCount: a.sites.length,
    })),
  });
});

/**
 * POST /auth/remove-account — Remove an account by email
 */
app.post('/auth/remove-account', (req, res) => {
  const session = getSession(req);
  if (!session || !session.accounts?.length) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const { email } = req.body;
  const sessionData = sessions.get(session.sessionId);

  if (sessionData.accounts.length <= 1) {
    return res.status(400).json({ message: 'Cannot remove the last account. Use logout instead.' });
  }

  sessionData.accounts = sessionData.accounts.filter(
    a => (a.accountEmail || a.user?.emailAddress) !== email
  );

  res.json({ success: true, accountsRemaining: sessionData.accounts.length });
});

/**
 * POST /auth/logout — Clear session
 */
app.post('/auth/logout', (req, res) => {
  const session = getSession(req);
  if (session) {
    sessions.delete(session.sessionId);
  }
  res.clearCookie('jiraffic-session');
  res.json({ success: true });
});

/* ── Jira API Proxy ─────────────────────────────────── */

/**
 * Proxy handler for Jira REST API requests
 * Uses Bearer token from the account that owns the requested cloudId.
 */
app.all('/api/jira/{*path}', async (req, res) => {
  const session = getSession(req);
  if (!session || !session.accounts?.length) {
    return res.status(401).json({ message: 'Not authenticated. Please log in.' });
  }

  const cloudId = req.headers['x-cloud-id'];
  if (!cloudId) {
    return res.status(400).json({ message: 'Missing X-Cloud-Id header.' });
  }

  // Find the account that owns this cloudId
  const account = findAccountForCloudId(session, cloudId);
  if (!account) {
    return res.status(400).json({ message: `No account found for cloud ID: ${cloudId}` });
  }

  const valid = await refreshAccountToken(account);
  if (!valid) {
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }

  // Extract the path after /api/jira/
  const rawPath = req.params.path;
  const jiraPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;

  // Determine if this is an agile API or standard REST API
  const isAgileApi = ['board', 'sprint'].some(p => jiraPath.startsWith(p));
  const apiVersion = isAgileApi ? 'agile/1.0' : 'api/3';
  const baseUrl = `${ATLASSIAN_API_BASE}/ex/jira/${cloudId}/rest/${apiVersion}/${jiraPath}`;

  // Append query string
  const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
  const fullUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${account.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    // Include body for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(fullUrl, fetchOptions);
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).send(text);
    }
  } catch (err) {
    console.error('Jira proxy error:', err.message);
    res.status(502).json({ message: `Failed to connect to Jira: ${err.message}` });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n  🚀 Jira-ffic Reports server running on http://localhost:${PORT}`);
  console.log(`  🔐 OAuth callback: ${CALLBACK_URL}\n`);
});
