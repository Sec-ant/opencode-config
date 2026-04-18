---
description: Worker subagent (Claude Sonnet 4)
mode: subagent
model: github-copilot/claude-sonnet-4
steps: 200
permission:
  task:
    "*": deny
    "worker-claude-sonnet-4": allow
    explore: allow
  question: allow
  read: allow
  edit: allow
  bash:
    "*": allow
  glob: allow
  grep: allow
  list: allow
  webfetch: allow
  websearch: allow
  codesearch: allow
---
