#!/usr/bin/env bash
# inbox-processor — watches /opt/vault/Inbox/ for new .md files and posts them to Aria
# Requires: inotify-tools

VAULT_INBOX="/opt/vault/Inbox"
HERMES_API="http://localhost:8642"
LOG_PREFIX="[inbox-processor]"

mkdir -p "$VAULT_INBOX"

echo "$LOG_PREFIX started, watching $VAULT_INBOX"

inotifywait -m -e close_write -e moved_to --format '%f' "$VAULT_INBOX" | while read -r FILENAME; do
  # Only process markdown files
  [[ "$FILENAME" == *.md ]] || continue

  FILEPATH="$VAULT_INBOX/$FILENAME"
  echo "$LOG_PREFIX new file: $FILENAME"

  # Read the note content
  CONTENT=$(cat "$FILEPATH" 2>/dev/null)
  [[ -z "$CONTENT" ]] && continue

  # Build the task for Aria
  TASK="A new note was dropped in the Inbox. Please process it: file, tag, extract any entities to Brain, and move it to the appropriate PARA folder in the vault (/opt/vault/). If it contains tasks, add them to /opt/vault/Tasks/tasks.md. If it's a recipe, file it under /opt/vault/Resources/Recipes/. Respond with a brief summary of what you did.

Filename: $FILENAME

Content:
$CONTENT"

  # POST to Hermes API
  RESPONSE=$(curl -s -X POST "$HERMES_API/v1/messages" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg task "$TASK" '{role:"user", content:$task}')" \
    --max-time 120 2>&1)

  if [[ $? -eq 0 ]]; then
    echo "$LOG_PREFIX processed: $FILENAME"
    # Archive the original from Inbox (Aria will have filed the processed version)
    mv "$FILEPATH" "$VAULT_INBOX/.processed/$(date +%Y%m%d-%H%M%S)-$FILENAME" 2>/dev/null || true
  else
    echo "$LOG_PREFIX error processing $FILENAME: $RESPONSE"
  fi
done
