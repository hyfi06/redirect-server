# Agent Memory Index — Docs Engineer

<!-- Add entries as: - [Title](file.md) — one-line hook -->
- [middleware-contracts](middleware-contracts.md) — Middleware that sets req properties needs JSDoc for the side effect; CLAUDE.md Auth section goes stale per §1.x cycle
- [passport-options-why](passport-options-why.md) — passReqToCallback and session:false/failureRedirect:false always need WHY comments
- [spec-config-flat-vs-nested](spec-config-flat-vs-nested.md) — plan deviation notes must also update spec code blocks; CLAUDE.md env table needs checking each §1.x docs cycle
- [schema-dead-exports](schema-dead-exports.md) — Exported but unused schema symbols (e.g. getByPathRedirectSchema) need a NOTE comment explaining why they are not wired in and what obstacle blocks wire-in
- [fullpath-leading-slash](fullpath-leading-slash.md) — Stored redirect paths always carry a leading slash; spec code blocks for POST fullPath construction must include it or they diverge from the implementation
- [claude-md-permission-filter](claude-md-permission-filter.md) — CLAUDE.md Permission model section shows a single-group array-contains filter; after §2.3 it uses array-contains-any — check this section each cycle that touches redirect GET
