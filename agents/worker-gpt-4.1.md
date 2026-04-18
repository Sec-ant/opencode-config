---
description: Worker subagent (GPT-4.1)
mode: subagent
model: github-copilot/gpt-4.1
steps: 200
permission:
  task:
    "*": deny
    "worker-gpt-4.1*": allow
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
