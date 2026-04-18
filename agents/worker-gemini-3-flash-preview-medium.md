---
description: Worker subagent (Gemini 3 Flash [medium])
mode: subagent
model: github-copilot/gemini-3-flash-preview
steps: 200
variant: medium
permission:
  task:
    "*": deny
    "worker-gemini-3-flash-preview-*": allow
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
