---
description: Worker subagent (Claude Haiku 4.5)
mode: subagent
model: github-copilot/claude-haiku-4.5
temperature: 0.2
steps: 100
variant: high
permission:
  task:
    "*": deny
    "worker-claude-haiku-4.5": allow
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
