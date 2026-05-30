#!/usr/bin/env python3
"""Fetch events from all family calendars and print merged JSON."""
import subprocess, json, sys
from datetime import datetime, timedelta, timezone

GAPI = "/root/.hermes/hermes-agent/venv/bin/python /root/.hermes/skills/productivity/google-workspace/scripts/google_api.py"
CALENDARS = [
    "panuzio@gmail.com",
    "chris.scott@gmail.com",
    "56qrs7r7otnosi7v1l0hsb7a2o@group.calendar.google.com",
]

days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
now = datetime.now(timezone.utc)
start = now.strftime("%Y-%m-%dT%H:%M:%SZ")
end = (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")

events, seen = [], set()
for cal in CALENDARS:
    r = subprocess.run(
        GAPI.split() + ["calendar", "list", "--calendar", cal, "--start", start, "--end", end],
        capture_output=True, text=True
    )
    for e in json.loads(r.stdout or "[]"):
        key = (e.get("summary", ""), e.get("start", ""))
        if key not in seen:
            seen.add(key)
            events.append(e)

events.sort(key=lambda e: e.get("start", ""))

# Strip to essential fields only to minimize LLM context usage
slim = [
    {k: e[k] for k in ("summary", "start", "end", "location") if k in e and e[k]}
    for e in events
]
print(json.dumps(slim, indent=2))
