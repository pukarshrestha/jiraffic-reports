/**
 * Jira-ffic Reports — Express Proxy Server
 * 
 * Proxies API requests to Jira Cloud, adding authentication headers.
 * Runs on port 3001 during development.
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/**
 * Proxy handler for Jira REST API requests
 * Reads Jira credentials from custom headers and forwards to Jira Cloud.
 */
app.all('/api/jira/{*path}', async (req, res) => {
  const jiraUrl = req.headers['x-jira-url'];
  const email = req.headers['x-jira-email'];
  const token = req.headers['x-jira-token'];

  if (!jiraUrl || !email || !token) {
    return res.status(400).json({ message: 'Missing Jira credentials. Provide X-Jira-Url, X-Jira-Email, and X-Jira-Token headers.' });
  }

  // Extract the path after /api/jira/
  // Express 5 returns wildcard params as an array
  const rawPath = req.params.path;
  const jiraPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;

  // Determine if this is an agile API or standard REST API
  const isAgileApi = ['board', 'sprint'].some(p => jiraPath.startsWith(p));
  const baseUrl = isAgileApi
    ? `${jiraUrl}/rest/agile/1.0/${jiraPath}`
    : `${jiraUrl}/rest/api/3/${jiraPath}`;

  // Append query string
  const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
  const fullUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  // Create Basic Auth header
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Basic ${auth}`,
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
  console.log(`\n  🚀 Jira-ffic Reports proxy server running on http://localhost:${PORT}\n`);
});
