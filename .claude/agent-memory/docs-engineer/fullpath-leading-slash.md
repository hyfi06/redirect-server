---
name: fullpath-leading-slash
description: Stored redirect paths always carry a leading slash; spec code blocks for POST fullPath construction must include it or they diverge from the implementation
metadata:
  type: project
---

D5 in the spec originally showed `fullPath = group ? \`${group}/${path}\` : path` — missing the leading `/`.

The actual implementation (confirmed by tests) is:
- `group ? \`/${group}/${path}\` : \`/${path}\``

The invariant: paths stored in Firestore always start with `/` because the catch-all redirect handler compares against `req.path`, which Express always delivers with a leading slash.

Whenever spec code blocks show fullPath construction, verify they include the leading slash.
