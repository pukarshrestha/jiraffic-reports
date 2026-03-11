# Jira-ffic Reports

A web application that connects to your Jira Cloud account to generate custom reports and analytics, styled with the Atlassian Design System (ADS).

## Features

- 🔐 **Secure Jira Connection** — Connect using your Jira Cloud URL, email, and API token
- 📊 **Sprint Velocity** — Track story points committed vs. completed across sprints
- 📈 **Issue Distribution** — Breakdown by status, type, and priority (doughnut charts)
- 👥 **Team Workload** — Visualize issue distribution across team members
- 📉 **Created vs Resolved** — Trend analysis over the last 12 weeks
- 🔍 **JQL Query Builder** — Run custom JQL queries with tabular results
- 🌗 **Light & Dark Mode** — Full theme support matching Atlassian's design tokens
- 📱 **Responsive** — Works on desktop, tablet, and mobile

## Tech Stack

- **Frontend:** Vite + Vanilla JS + CSS (ADS Design Tokens)
- **Backend:** Node.js + Express (API proxy)
- **Charts:** Chart.js
- **Design:** Atlassian Design System (ADS) foundations

## Getting Started

### Prerequisites

- Node.js 18+
- A [Jira Cloud](https://www.atlassian.com/software/jira) account
- A [Jira API Token](https://id.atlassian.com/manage-profile/security/api-tokens)

### Installation

```bash
# Install dependencies
npm install

# Start the proxy server (in one terminal)
node server/index.js

# Start the dev server (in another terminal)
npm run dev
```

Then open `http://localhost:5173` in your browser.

### Connecting to Jira

1. Enter your Jira Cloud URL (e.g., `https://yourcompany.atlassian.net`)
2. Enter your email address associated with Jira
3. Generate and paste your [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
4. Click **Connect to Jira**

## Project Structure

```
├── index.html              # Main HTML entry point
├── vite.config.js           # Vite configuration with API proxy
├── server/
│   └── index.js             # Express proxy server for Jira API
├── src/
│   ├── main.js              # App entry, routing, theme init
│   ├── styles/
│   │   ├── tokens.css       # ADS design tokens (light + dark)
│   │   ├── reset.css        # Modern CSS reset
│   │   ├── components.css   # Reusable UI components
│   │   └── layout.css       # Page layout (sidebar, topbar, grid)
│   ├── components/
│   │   └── shell.js         # App shell (sidebar + topbar)
│   ├── views/
│   │   ├── login.js         # Login page
│   │   ├── dashboard.js     # Dashboard with project overview
│   │   └── report.js        # Report views (velocity, distribution, etc.)
│   ├── services/
│   │   ├── auth.js          # Auth & session management
│   │   ├── jira.js          # Jira API client
│   │   └── reports.js       # Report data transformations
│   └── utils/
│       ├── theme.js         # Light/dark mode toggle
│       ├── router.js        # Hash-based SPA router
│       └── toast.js         # Toast notifications
└── public/
    └── favicon.svg          # App favicon
```

## License

MIT
