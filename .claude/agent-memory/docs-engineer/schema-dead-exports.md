---
name: schema-dead-exports
description: Exported but unused schema symbols need a NOTE comment explaining the obstacle to wire-in
metadata:
  type: project
---

In §2.2 (`redirect.schema.js`), `getByPathRedirectSchema` is exported but no route imports it.
The obstacle: `slugPath` pattern rejects leading slashes, but Express `req.path` always has one (e.g. `/fc/seminar`).
Wire-in requires either adjusting the pattern or stripping the slash before validation.

Lesson: when a schema symbol is exported but unused, add a NOTE comment in the source file
explaining (1) that it is not wired in and (2) what must be resolved before it can be.
The test file already documented this (good practice by test-engineer); the source file
should carry the same information so readers don't need to open the tests to understand the gap.
