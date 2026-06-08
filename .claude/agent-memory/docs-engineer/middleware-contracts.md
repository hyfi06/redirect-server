---
name: middleware-contracts
description: Middleware functions that set req properties require JSDoc even when the body is short — the side effect is the non-obvious WHY.
metadata:
  type: project
---

`authenticate` sets `req.user` to the decoded JWT payload. Any middleware that reads `req.user`
(like `authorize`) must come after it. This ordering contract is not visible from the code alone
and must be documented in the JSDoc of both middlewares.

Pattern to follow:
- `authenticate` JSDoc: state that it sets req.user and must run before authorize.
- `authorize` JSDoc: state that it requires authenticate to have run first.

CLAUDE.md Auth section goes stale quickly as auth is incrementally implemented.
Update it after every §1.x feat cycle, not just at the end of the block.
