---
description: Worker subagent (GPT-5.4)
mode: subagent
model: github-copilot/gpt-5.4
steps: 200
reasoningEffort: high
permission:
  task:
    "*": deny
    "worker-gpt-5.4": allow
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
