---
description: Worker subagent (Gemini 3.1 Pro Preview [medium])
mode: subagent
model: github-copilot/gemini-3.1-pro-preview
steps: 200
variant: medium
permission:
  task:
    "*": deny
    "worker-gemini-3.1-pro-preview*": allow
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
