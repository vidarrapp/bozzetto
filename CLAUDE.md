# CLAUDE.md

Notes for Claude Code sessions working in this repository.

## Open questions for Vidar

When something needs Vidar's call (a product decision, a confirmation, a
choice between options), write it down in the repo as well as asking in
chat. A dashboard reads this list every hour.

- Put it under the heading `## Open questions for Vidar` in
  `docs/HANDOFF.md`. Create the file or the heading if they do not exist,
  and keep the heading text exactly as written.
- One line per question:
  `- [ ] YYYY-MM-DD: the question, with the options if there are any (blocks: what it gates)`.
  Leave out the blocks part when nothing waits on it.
- When Vidar answers, tick it and add the answer:
  `- [x] YYYY-MM-DD: the question. Decided YYYY-MM-DD: the answer`.
  Record the decision itself where this repo keeps decisions, as usual.
- Commit and push the change right away on the branch you are working on,
  so the question shows without waiting for a merge.
