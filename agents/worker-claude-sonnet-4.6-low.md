---
description: Worker subagent (Claude Sonnet 4.6 [low])
mode: subagent
model: github-copilot/claude-sonnet-4.6
steps: 200
variant: low
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
