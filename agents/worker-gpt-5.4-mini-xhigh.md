---
description: Worker subagent (GPT-5.4 Mini [xhigh])
mode: subagent
model: github-copilot/gpt-5.4-mini
steps: 200
variant: xhigh
permission:
  task:
    "*": deny
    "worker-gpt-5.4-mini*": allow
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
