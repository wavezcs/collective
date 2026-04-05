---
name: paperclip
description: Manage Paperclip (Mission Control) issues — create, list, update, comment. Use to track work items for the Collective.
metadata: {"openclaw":{"always":true,"emoji":"📋"}}
---

# Paperclip — Mission Control

To manage issues, call the **`collective__paperclip`** tool with an `operation` parameter.

## When to Use

- Creating a task or issue for the Collective to track
- Listing open or in-progress work items
- Updating issue status (open → in_progress → done)
- Adding progress comments to issues
- Retrieving issue details

## Operations

- `create_issue` — title (required), description, priority (low/medium/high/urgent), assignee_id
- `list_issues` — filter_status, filter_assignee, limit (default 20)
- `get_issue` — issue_id (required)
- `update_issue` — issue_id (required), any of: title, description, priority, status, assignee_id
- `add_comment` — issue_id (required), comment (required)

## Agent IDs

Locutus agent ID: `9b6cfca2-edab-429c-a629-b8fd6e945004`

## Notes

- Company ID and API key are injected from environment automatically
- Status values: open, in_progress, done, cancelled
- Always create an issue when the Collective receives a complex multi-step task from the user
