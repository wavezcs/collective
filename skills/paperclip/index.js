/**
 * Paperclip Skill — Locutus's interface to Mission Control
 *
 * Allows drones to create, read, update Paperclip issues and add comments.
 * Reads credentials from environment: PAPERCLIP_API_KEY, PAPERCLIP_API_URL,
 * PAPERCLIP_COMPANY_ID (all injected via openclaw-gateway drop-in).
 */

const http = require('http');
const https = require('https');

function getEnv() {
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const apiUrl = process.env.PAPERCLIP_API_URL || 'http://localhost:3100';
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiKey) throw new Error('PAPERCLIP_API_KEY not set in environment');
  if (!companyId) throw new Error('PAPERCLIP_COMPANY_ID not set in environment');

  return { apiKey, apiUrl, companyId };
}

function request(method, urlStr, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      },
      ...(isHttps ? { rejectUnauthorized: false } : {})
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  name: 'paperclip',
  description: 'Manage Paperclip (Mission Control) issues. Create tasks, list open issues, update status, retrieve details, or add comments. Use to track work items for the Collective.',

  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create_issue', 'list_issues', 'get_issue', 'update_issue', 'add_comment'],
        description: 'Operation to perform on Paperclip'
      },
      // create_issue / update_issue
      title: {
        type: 'string',
        description: 'Issue title (create_issue)'
      },
      description: {
        type: 'string',
        description: 'Issue body/description (create_issue, update_issue)'
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent'],
        description: 'Issue priority (create_issue, update_issue)'
      },
      status: {
        type: 'string',
        enum: ['open', 'in_progress', 'done', 'cancelled'],
        description: 'Issue status (update_issue)'
      },
      assignee_id: {
        type: 'string',
        description: 'Agent ID to assign the issue to (create_issue, update_issue)'
      },
      // issue identity
      issue_id: {
        type: 'string',
        description: 'Issue ID for get_issue, update_issue, add_comment'
      },
      // list_issues filters
      filter_status: {
        type: 'string',
        description: 'Filter list_issues by status (open, in_progress, done, cancelled)'
      },
      filter_assignee: {
        type: 'string',
        description: 'Filter list_issues by assignee agent ID'
      },
      limit: {
        type: 'number',
        description: 'Max issues to return for list_issues (default 20)'
      },
      // add_comment
      comment: {
        type: 'string',
        description: 'Comment body for add_comment'
      }
    },
    required: ['operation']
  },

  async run({ operation, title, description, priority, status, assignee_id,
              issue_id, filter_status, filter_assignee, limit = 20, comment }) {
    const { apiKey, apiUrl, companyId } = getEnv();
    const base = `${apiUrl}/api/v1/companies/${companyId}`;

    switch (operation) {

      case 'create_issue': {
        if (!title) return 'Error: title required for create_issue';
        const body = { title };
        if (description) body.description = description;
        if (priority) body.priority = priority;
        if (assignee_id) body.assignee_id = assignee_id;

        const issue = await request('POST', `${base}/issues`, apiKey, body);
        return `Paperclip: created issue #${issue.number || issue.id} — "${issue.title}" (${issue.id})`;
      }

      case 'list_issues': {
        const params = new URLSearchParams({ limit: String(limit) });
        if (filter_status) params.set('status', filter_status);
        if (filter_assignee) params.set('assignee_id', filter_assignee);

        const result = await request('GET', `${base}/issues?${params}`, apiKey);
        const issues = Array.isArray(result) ? result : (result.issues || result.data || []);
        if (issues.length === 0) return 'Paperclip: no issues found';

        const lines = issues.map(i =>
          `  #${i.number || i.id} [${i.status}] ${i.title}${i.priority ? ` (${i.priority})` : ''}`
        );
        return `Paperclip issues (${issues.length}):\n${lines.join('\n')}`;
      }

      case 'get_issue': {
        if (!issue_id) return 'Error: issue_id required for get_issue';
        const issue = await request('GET', `${base}/issues/${issue_id}`, apiKey);
        return `Paperclip issue ${issue.id}:\n${JSON.stringify(issue, null, 2)}`;
      }

      case 'update_issue': {
        if (!issue_id) return 'Error: issue_id required for update_issue';
        const body = {};
        if (title) body.title = title;
        if (description) body.description = description;
        if (priority) body.priority = priority;
        if (status) body.status = status;
        if (assignee_id) body.assignee_id = assignee_id;
        if (Object.keys(body).length === 0) return 'Error: no fields to update';

        const issue = await request('PATCH', `${base}/issues/${issue_id}`, apiKey, body);
        return `Paperclip: updated issue ${issue_id} — status: ${issue.status || status}, title: ${issue.title || title}`;
      }

      case 'add_comment': {
        if (!issue_id) return 'Error: issue_id required for add_comment';
        if (!comment) return 'Error: comment required for add_comment';

        const result = await request('POST', `${base}/issues/${issue_id}/comments`, apiKey, { body: comment });
        return `Paperclip: comment added to issue ${issue_id} (comment id: ${result.id || 'ok'})`;
      }

      default:
        return `Error: unknown operation "${operation}"`;
    }
  }
};
