---
"@horseness/cli": minor
"@horseness/daemon": minor
"@horseness/domain": minor
"@horseness/protocol": minor
"@horseness/orchestrator": minor
---

# Editable immutable task plan previews

Add private JSON plan export and authenticated `task revise` before adoption. Allow task additions/removals and edits to titles, instructions, acceptance criteria and dependencies while retaining closed bounded graph validation. Persist revisions as new digest-addressed previews with immutable base and authenticated author lineage; preserve original planner outcomes and explicit adoption/execution boundaries.

Reject stale, already-adopted and actively authorized graphs. Retain the exact edited JSON and original request identity across interrupted CLI operations. Existing workspace owners explicitly enable the new capability; old event/receipt bytes, canonical revision and SQLite schema remain unchanged.
