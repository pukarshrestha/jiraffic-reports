/**
 * Report Generation — Transform Jira data into report datasets
 */

/**
 * Issue Distribution by Status
 */
export function issuesByStatus(issues) {
  const counts = {};
  issues.forEach(issue => {
    const status = issue.fields?.status?.name || 'Unknown';
    counts[status] = (counts[status] || 0) + 1;
  });
  return {
    labels: Object.keys(counts),
    values: Object.values(counts),
    total: issues.length,
  };
}

/**
 * Issue Distribution by Type
 */
export function issuesByType(issues) {
  const counts = {};
  issues.forEach(issue => {
    const type = issue.fields?.issuetype?.name || 'Unknown';
    counts[type] = (counts[type] || 0) + 1;
  });
  return {
    labels: Object.keys(counts),
    values: Object.values(counts),
    total: issues.length,
  };
}

/**
 * Issue Distribution by Priority
 */
export function issuesByPriority(issues) {
  const counts = {};
  issues.forEach(issue => {
    const priority = issue.fields?.priority?.name || 'None';
    counts[priority] = (counts[priority] || 0) + 1;
  });
  return {
    labels: Object.keys(counts),
    values: Object.values(counts),
    total: issues.length,
  };
}

/**
 * Assignee Workload — Issues per person
 */
export function assigneeWorkload(issues) {
  const counts = {};
  issues.forEach(issue => {
    const name = issue.fields?.assignee?.displayName || 'Unassigned';
    counts[name] = (counts[name] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    labels: sorted.map(([name]) => name),
    values: sorted.map(([, count]) => count),
    total: issues.length,
  };
}

/**
 * Sprint Velocity — Story points per sprint
 */
export function sprintVelocity(sprints, sprintIssuesMap) {
  const data = sprints
    .filter(s => s.state === 'closed' || s.state === 'active')
    .map(sprint => {
      const issues = sprintIssuesMap[sprint.id] || [];
      let committed = 0;
      let completed = 0;

      issues.forEach(issue => {
        // customfield_10016 is commonly used for story points
        const points = issue.fields?.story_points || issue.fields?.customfield_10016 || 0;
        committed += points;

        const statusCategory = issue.fields?.status?.statusCategory?.key;
        if (statusCategory === 'done') {
          completed += points;
        }
      });

      return {
        name: sprint.name,
        committed,
        completed,
        state: sprint.state,
      };
    });

  return {
    sprints: data,
    labels: data.map(d => d.name),
    committed: data.map(d => d.committed),
    completed: data.map(d => d.completed),
  };
}

/**
 * Created vs Resolved over time (by week)
 */
export function createdVsResolved(issues, weekCount = 12) {
  const now = new Date();
  const weeks = [];

  for (let i = weekCount - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const created = issues.filter(issue => {
      const d = new Date(issue.fields?.created);
      return d >= weekStart && d < weekEnd;
    }).length;

    const resolved = issues.filter(issue => {
      const d = issue.fields?.resolutiondate ? new Date(issue.fields.resolutiondate) : null;
      return d && d >= weekStart && d < weekEnd;
    }).length;

    weeks.push({
      label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      created,
      resolved,
    });
  }

  return {
    labels: weeks.map(w => w.label),
    created: weeks.map(w => w.created),
    resolved: weeks.map(w => w.resolved),
  };
}

/**
 * Status transition summary
 */
export function statusSummary(issues) {
  let toDo = 0, inProgress = 0, done = 0;
  issues.forEach(issue => {
    const cat = issue.fields?.status?.statusCategory?.key;
    if (cat === 'done') done++;
    else if (cat === 'indeterminate') inProgress++;
    else toDo++;
  });
  return { toDo, inProgress, done, total: issues.length };
}
