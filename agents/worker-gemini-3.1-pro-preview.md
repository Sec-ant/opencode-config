---
description: Worker subagent (Gemini 3.1 Pro Preview)
mode: subagent
model: github-copilot/gemini-3.1-pro-preview
temperature: 0.2
steps: 200
permission:
  task:
    "*": deny
    "worker-gemini-3.1-pro-preview": allow
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
