---
description: Worker subagent (GPT-5.2-Codex)
mode: subagent
model: github-copilot/gpt-5.2-codex
steps: 200
permission:
  task:
    "*": deny
    "worker-gpt-5.2-codex*": allow
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
