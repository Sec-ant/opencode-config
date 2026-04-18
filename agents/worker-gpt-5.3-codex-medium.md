---
description: Worker subagent (GPT-5.3-Codex [medium])
mode: subagent
model: github-copilot/gpt-5.3-codex
steps: 200
variant: medium
permission:
  task:
    "*": deny
    "worker-gpt-5.3-codex-*": allow
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
