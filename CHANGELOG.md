# Changelog

## 0.3.0

Reviewed against Folk's API changes from September 6 to October 22, 2026: 14 new public operations (71 in total) and a deprecated pair of interaction routes.

- Add `batch create`, `batch update`, and `batch delete` for people, companies, deals, and custom objects, up to 100 records per request. `--data` takes a JSON array, `{"records": [...]}`, or NDJSON such as `--ndjson` output. Resource flags apply to every record, and `batch update <id>...` applies one change to each ID. Results keep request order, print a summary on stderr, and exit with code 5 when any record fails. A response without one result per record is reported as an error, with the idempotency key.
- Require confirmation for batch deletes, and for batch updates that set `groups` on people or companies. On update, `groups` replaces a record's groups and deletes its custom field values in each group left out. Single updates that set `groups` now print a warning.
- Add `enrichments list|get|create` and `people enrich` to find missing emails and phones. Creating an enrichment asks for confirmation because it spends workspace credits. `--wait` polls until it completes or fails, retrying rate-limited or failed status checks at the next poll and aborting a check that has not answered by `--wait-timeout`, so the wait ends within about 2 seconds of it. A waited enrichment that does not end completed exits with code 5.
- Add `credits` to show workspace credits for each metered feature.
- Route `interactions past`, `upcoming`, and `list` to `GET /v1/interactions`, which replaces the `/past` and `/upcoming` routes that Folk removes on March 29, 2027. Add `--timeframe`, `--imported-type`, `--logged-only`, and `--user-id`.
- Send an `Idempotency-Key` with every write: a new UUID per command, or the value of `--idempotency-key`. Writes now retry network errors and 409, 502, 503, and 504 responses with the same key, so a retry cannot run a write twice. They never retry a 500, which Folk stores for the key. Every request retries 429 after `Retry-After`, up to 60 seconds. With `--no-idempotency-key`, writes retry only 429, unless `--retries` opts into the 0.2.x retries, which can run a write twice.
- Handle the new burst limit of 20 requests per 2 seconds. `response.rateLimit` now includes the burst headers and the parsed IETF `RateLimit-Policy` and `RateLimit` headers, and `--all` and `--wait` pause when a policy has no requests left.
- Show the path of each validation issue, the exhausted rate limit policy, and recovery hints for idempotency and credit errors. Print the deprecation notices Folk sends for any endpoint; for reminders, Folk's notice replaces the bundled one, which still covers dry-runs, failed requests, and responses without a notice.
- Apply the wrapper confirmations to `api request`: deletes, batch deletes, enrichment creation, batch updates that set `groups`, and custom field option removal. The path is normalized first, also relative to a `--base-url` path such as a proxy prefix, so spellings such as `v1/...`, `/v1/./...`, `%2e` segments, and other letter cases are caught.
- If a status check fails while `--wait` waits on a new enrichment, report the enrichment ID, the command that resumes waiting, and the create request's idempotency key, so a re-run does not start and pay for a second enrichment. A `--wait-timeout` shorter than the interval now polls once instead of failing at once.
- Warn when a batch update sets list fields such as `emails`, which replace each record's existing values. Accept comma-separated record IDs and `--id` values.
- Fix boolean flags followed by a `true`/`false` word: `--yes false` and `-y false` no longer confirm a deletion. `--no-retry=true`, `--no-<flag>=false`, and `--no-retries` now work as written.
- Fix confirmation prompts that never returned when input ended (Ctrl-D) or when `--data -` had already read stdin; they now cancel with exit code 3.
- Reject `__proto__`, `constructor`, and `prototype` as `--field` path segments and `--custom` names.
- Fix `--foundation-date`, which mapped to a field the API never had. It now fails with a pointer to `--foundation-year`.
- Point Deals documentation links to the Custom objects reference, which replaced the Deals pages on October 15, 2026.
- Fix the `--custom` and reminder recurrence examples in help output, and trim trailing spaces from table rows.
- Update the bundled skill, documentation, examples, and the OpenAPI contract snapshot. Add `scripts/openapi-snapshot.mjs` to regenerate the snapshot from the published schema, and `scripts/check-skill-pin.mjs` to confirm before tagging that the skill installs the released CLI source.

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
