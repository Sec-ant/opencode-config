---
description: Worker subagent (GPT-4o)
mode: subagent
model: github-copilot/gpt-4o
temperature: 0.2
steps: 200
permission:
  task:
    "*": deny
    "worker-gpt-4o": allow
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
