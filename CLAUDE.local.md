# CLAUDE.local.md — fork-local overrides

Personal, git-excluded notes for **Dennis's fork** (`Plinsboorg/outline`), used to
develop the **document databases** feature. These layer on top of `AGENTS.md` /
`CLAUDE.md` (Outline's upstream contributor guide, which still fully applies) and
override it **only** where stated below.

> Not committed — excluded via `.git/info/exclude`, so it never diverges from
> upstream or lands in a PR.

## Overrides to the upstream guide

- **Markdown docs are allowed in this fork.** `AGENTS.md` says *"Do not create new
  markdown (.md) files"* — that is an upstream contributor convention aimed at
  keeping their codebase clean. In this fork, design / RFC / planning `.md` files
  (e.g. under `docs/`) are welcome. All other `AGENTS.md` rules stand.

## Fork context

- **Feature**: document databases (Notion/Obsidian-style). MVP-first: typed
  document properties → database (table) views over collections.
- **Spec**: `docs/document-databases-spec.md`. Tracking PR: `Plinsboorg/outline#1`.
- **Local run**: Postgres + Redis via Docker, config in `.env.local`, app at
  `http://localhost:3000`. Sign-in magic links print to the dev server console.
  (Fuller detail is in the assistant memory note `local-deploy-setup`.)
