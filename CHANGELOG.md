# Changelog

## Companion skill 0.2.2 (CLI 0.2.1)

- Pin the ClawHub metadata installer and manual installation command to the patched CLI 0.2.1 source, including task boolean validation.
- Verify CLI 0.2.1 after installation; keep lifecycle scripts disabled for manual installation.

## 0.2.1

- Reject invalid separated values for task `--is-public` and `--only-assigned-to-me` flags instead of silently treating them as enabled. For example, `--is-public maybe` now fails validation before any request is sent.
- Preserve bare flags, negated flags, and explicit `true`/`false` values in both separated and equals forms.
- Include companion skill 0.2.2 with installation pinned to the patched CLI source.

## Companion skill 0.2.1 (CLI 0.2.0)

- Pin the ClawHub metadata installer and manual installation command to the reviewed v0.2.0 source commit instead of the moving default branch.
- Install manually with lifecycle scripts disabled, verify the expected CLI version, and document the separate skill patch version.

## 0.2.0

- Add Tasks CRUD, entity and assignment filters, recurrence and due-time flags, and explicit done/todo commands using the documented completion endpoints.
- Add past/upcoming interaction history, get/update/delete, and `--activity-type`. Keep `--type` as a flag alias for `activityType`.
- Add group create/update, member management, and custom field create/get/update. Require confirmation before removing members or custom field options and their associated data.
- Add `objects` commands for any custom object type, preserving existing `deals` commands and legacy `groups fields` syntax.
- Add full-text note search and creation-date filters, plus the person `--gender` flag.
- Add offline `mcp info` and `mcp config` helpers for Folk's official OAuth server. REST API keys remain separate from MCP authentication.
- Retain deprecated reminder commands with stderr notices, expose deprecation/sunset response headers, and document the Tasks migration.
- Fix multiword deal/object search with path flags and keep CLI version/User-Agent tied to package metadata.
- Apply group visibility filtering to retrieved pages even when the API ignores the announced query parameter; use `--all` for complete pagination.
- Update documentation, examples, the bundled OpenClaw skill, and regression coverage against a September 6, 2026 snapshot of the public OpenAPI contract.

## 0.1.0

- Initial `folkctl` CLI.
- Added OpenClaw/ClawHub skill in `skills/folk-cli/SKILL.md`.
- Added endpoint metadata and wrappers for people, companies, groups, deals, users, notes, reminders, interactions, and webhooks.
- Added JSON/NDJSON/plain/CSV output modes, dry-run mode, pagination following, query filters, and destructive confirmation safeguards.
- Added tests for argument parsing, filter construction, body builders, API docs, and dry-run request generation.
