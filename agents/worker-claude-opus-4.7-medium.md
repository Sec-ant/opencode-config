---
description: Worker subagent (Claude Opus 4.7 [medium])
mode: subagent
model: github-copilot/claude-opus-4.7
steps: 200
variant: medium
permission:
  task:
    "*": deny
    "worker-claude-opus-4.7*": allow
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
