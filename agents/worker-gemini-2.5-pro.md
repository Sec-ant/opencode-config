---
description: Worker subagent (Gemini 2.5 Pro)
mode: subagent
model: github-copilot/gemini-2.5-pro
steps: 200
permission:
  task:
    "*": deny
    "worker-gemini-2.5-pro*": allow
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
