# Gym Log

A minimalist, self-hosted gym log for a family. Working title; planning stage.

Each workout record is one independent set. Version 1 requires a connection to the Ubuntu server through Tailscale.

- [Product requirements](docs/PRD.md)
- [Build checklist](docs/CHECKLIST.md)
- [Questions and decisions](docs/QUESTIONS.md)

## Proposed stack

TypeScript, React + Vite, custom components with SCSS, Node + Express, PostgreSQL, and REST. Use npm workspaces for one repository. Database access and credentials stay in the API.

Proposed layout when implementation begins:

```text
apps/
  api/                 Express API; serves the built frontend in production
  web/                 React + Vite + SCSS
packages/
  contracts/           Request/response types and runtime validation
db/
  migrations/          Versioned SQL migrations
docs/                  PRD, checklist, decisions
infra/                 Deployment configuration and backup instructions
```

There is no runnable application or installed dependency set yet. This repository records the scope before implementation. Package versions and database access tooling will be selected during scaffolding.

## Local development and Git

This project was initialized on Windows with a local Git repository. WSL is installed, but distribution enumeration returned `Wsl/EnumerateDistros/E_ACCESSDENIED` in the current environment, so WSL development has not been verified. The repository uses LF line endings to ease moving between Windows and Linux.

Preferred follow-up: clone this local repository into a folder under the WSL Linux home directory once WSL access is available, then use that as the development checkout. Commit changes before moving between checkouts. Keep secrets, database data, and backups outside Git.

This folder can be added as a project in the Codex app. Creating the directory and Git repository does not register it in the sidebar automatically.
