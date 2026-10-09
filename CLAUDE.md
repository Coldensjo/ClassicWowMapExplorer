# Git workflow

- Commit as soon as a feature is finished. Do not wait to be asked.
- Commit as soon as a bug fix or other fix is applied. Do not wait to be asked.
- Give each feature or fix its own commit, so unrelated changes are not bundled together.
- Before committing, make sure the project still builds and any relevant checks pass. If they fail, fix the problem first or tell the user rather than committing broken code.
- Match the style of existing commit messages: one sentence in the imperative mood that says what changed and why, e.g. "Attach no gear for an item slot with no model resource, instead of an unrelated M3 file".
- Commit to the current branch. Do not push unless the user asks.

# Testing in the browser

- Do not test every change with Claude in Chrome (the mcp__claude-in-chrome__* tools). Browser testing is slow and often tells little for this app.
- Use it only when it is worth it: when you are confident it will give valuable information, such as reading console errors for a crash, checking a value at runtime, or confirming a bug you cannot reason out from the code.
- Skip it for changes the build, type checks, or reading the code already verify, and for visual or feel changes that a screenshot or scripted input cannot judge well (camera movement, mouse capture, rendering subtleties).
- When a change needs to be seen or played with, it is fine to stop and ask the user to test it manually. Say exactly what to try and what to look for.
