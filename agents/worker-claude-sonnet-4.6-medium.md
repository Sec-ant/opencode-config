---
description: Worker subagent (Claude Sonnet 4.6 [medium])
mode: subagent
model: github-copilot/claude-sonnet-4.6
temperature: 0.2
steps: 200
variant: medium
permission:
  task:
    "*": deny
    "worker-claude-sonnet-4.6-*": allow
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
