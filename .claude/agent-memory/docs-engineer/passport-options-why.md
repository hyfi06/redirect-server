---
name: passport-options-why
description: passport.authenticate() options that always need WHY comments
metadata:
  type: reference
---

Two passport.authenticate() options that surprise readers and always need a one-line comment:

1. `passReqToCallback: true` — shifts the verify callback signature so the first arg is `req`, not `accessToken`. Comment: "passReqToCallback: true shifts the callback signature — first arg is req, not accessToken"

2. `session: false` + `failureRedirect: false` on the callback route — stateless JWT means no session; failureRedirect: false means passport won't redirect on failure, so a custom handler can return JSON 401 instead (required by D4 — auth routes under /api/v1/ serve JSON, not redirects).
