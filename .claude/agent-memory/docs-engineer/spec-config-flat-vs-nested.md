---
name: spec-config-flat-vs-nested
description: Spec showed flat config.jwtSecret but implementation uses nested config.jwt.jwtSecret — plan recorded the decision but spec was never updated
metadata:
  type: project
---

In §1.1 of spec 2026-06-05_01_v3, the code block used `config.jwtSecret` (flat).
The plan noted the decision to keep the existing nested structure (`config.jwt.jwtSecret`),
but the spec code block was not updated at that time.

Lesson: when a plan deviation note records a confirmed design decision, the spec code blocks
must also be updated in the same [docs] commit — the plan note alone is not sufficient.

Also: CLAUDE.md env vars table was missing JWT_SECRET and JWT_TTL despite the spec
explicitly listing them. Check the env table after every §1.x docs cycle.
