---
name: claude-md-permission-filter
description: CLAUDE.md Permission model section shows a single-group array-contains filter; after §2.3 it uses array-contains-any — check this section each cycle that touches redirect GET
metadata:
  type: feedback
---

After §2.3, the redirect GET route uses `array-contains-any` (not `array-contains`) to support multi-group users.
CLAUDE.md had the old single-group filter pattern hardcoded in the Permission model section — updated in §2.1+2.3 docs cycle.

Future check: whenever redirect GET filtering logic changes, verify CLAUDE.md Permission model section stays in sync.
