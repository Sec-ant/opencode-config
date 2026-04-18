---
description: Worker subagent (GPT-5-mini [low])
mode: subagent
model: github-copilot/gpt-5-mini
steps: 200
variant: low
permission:
  task:
    "*": deny
    "worker-gpt-5-mini-*": allow
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
