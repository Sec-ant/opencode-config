---
description: Worker subagent (Grok Code Fast 1)
mode: subagent
model: github-copilot/grok-code-fast-1
temperature: 0.2
steps: 200
variant: high
permission:
  task:
    "*": deny
    "worker-grok-code-fast-1": allow
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
