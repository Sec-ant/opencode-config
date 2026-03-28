---
description: Worker subagent (GPT-5.1-Codex-mini)
mode: subagent
model: github-copilot/gpt-5.1-codex-mini
steps: 100
permission:
  task:
    "*": deny
    "worker-gpt-5.1-codex-mini": allow
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
