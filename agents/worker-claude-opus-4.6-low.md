---
description: Worker subagent (Claude Opus 4.6 [low])
mode: subagent
model: github-copilot/claude-opus-4.6
temperature: 0.2
steps: 200
variant: low
permission:
  task:
    "*": deny
    "worker-claude-opus-4.6-*": allow
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
