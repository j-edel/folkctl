# CLI spec

## Goals

`folkctl` should be safe enough for agentic use and pleasant enough for humans:

1. Every command is discoverable with `--help`.
2. Every HTTP wrapper is inspectable with `api docs` and `api spec`.
3. Every mutation can be previewed with `--dry-run`.
4. Machine output is stable with `--json`, `--ndjson`, `--plain`, and `--csv`.
5. Secrets come from environment or config, never from positional args.
6. The low-level `api request` escape hatch keeps the CLI useful when the folk API changes.
7. A write retried with its idempotency key runs at most once.

## Command tree

```text
folkctl
├── auth
│   ├── status [--check]
│   ├── login --token-stdin
│   └── logout
├── api
│   ├── ls [resource]
│   ├── docs <endpoint-key>
│   ├── spec <endpoint-key>
│   └── request <METHOD> <PATH-OR-URL>
├── people       list | search | get | create | update | delete | enrich
│   └── batch    create | update | delete
├── companies    list | search | get | create | update | delete
│   └── batch    create | update | delete
├── deals        list | search | get | create | update | delete
│   └── batch    create | update | delete
├── objects      list | search | get | create | update | delete
│   └── batch    create | update | delete
├── groups       list | create | update
│   ├── fields   list | get | create | update
│   └── members  list | add | update | remove
├── users        list | me | get
├── notes        list | search | get | create | update | delete
├── tasks        list | get | create | update | delete | done | todo
├── reminders    list | get | create | update | delete (deprecated)
├── interactions list | past | upcoming | get | create | update | delete
├── enrichments  list | get | create
├── credits      get
├── webhooks     list | get | create | update | delete
└── mcp          info | config
```

`groups fields <groupId> <entityType>` remains shorthand for `groups fields list`. Nested endpoint keys (for example `groups.members.add` or `people.batch.update`) are available through `api docs` and `api spec`. `interactions list` defaults to `--timeframe past`; `past` and `upcoming` set it. Task completion also accepts `mark-done`/`mark-as-done` and `mark-todo`/`mark-as-todo`. `people enrich` is `enrichments create`, and `person-enrichments` is an alias of `enrichments`.

## Flag syntax

Value flags take `--flag value` or `--flag=value`. Boolean flags take `--flag`, `--flag=false`, `--no-flag`, `--no-flag=false`, or a separated `true`/`false` word (also `1`/`0`, `yes`/`no`, `on`/`off`), so `--yes false` does not confirm anything. Other words after a boolean flag stay positional arguments: `people delete --yes per_123` deletes `per_123`. `-y false` works for single short flags. Repeated flags keep every value; single-value flags use the last one. `--` ends flag parsing.

## Config precedence

1. CLI flags for non-secret settings: `--base-url`, `--api-version`, `--config`
2. Environment variables: `FOLK_API_KEY`, `FOLK_API_BASE_URL`, `FOLK_API_VERSION`, `FOLKCTL_CONFIG`
3. Config file: `$XDG_CONFIG_HOME/folkctl/config.json` or `~/.config/folkctl/config.json`
4. Defaults: `https://api.folk.app`, API version `2025-06-09`

Project-local `.env` and `.env.local` files are also read for `FOLK_API_KEY` and `FOLK_API_VERSION` only. They are intentionally ignored for `FOLK_API_BASE_URL` and `FOLKCTL_CONFIG` so a working directory cannot redirect a stored token to another origin.

## Exit codes

- `0`: success
- `1`: runtime or API failure
- `2`: invalid command/flags/input
- `3`: user cancelled or confirmation required
- `4`: missing/invalid authentication
- `5`: Folk accepted the request, but at least one batch record failed, or an enrichment waited on with `--wait` failed. Output is still written to stdout.

## Pagination

List endpoints return a payload with `data.items` and `data.pagination.nextLink`. Passing `--all` follows `nextLink` and merges all `items` into the final response. When a rate limit policy reports no requests left, `--all` waits for its window to reset before the next page.

`groups list --visibility` additionally filters retrieved items locally to handle servers that ignore the announced query parameter. It preserves remaining pagination links, updates merged `itemCount`, and includes `clientFilter` metadata. Use `--all` for complete coverage.

## Request construction

The CLI always sends:

```http
Authorization: Bearer <token>
Accept: application/json
X-API-Version: <configured-version>
User-Agent: folkctl/<version>
```

Commands with a body send `Content-Type: application/json`. Every `POST`, `PATCH`, `PUT`, and `DELETE` also sends `Idempotency-Key`: a new UUID per command, or the value of `--idempotency-key` (1 to 255 printable ASCII characters, no spaces). `--no-idempotency-key` omits it. The key appears in `--dry-run` output and in `request.headers` of JSON output. `tasks todo` posts to `/v1/tasks/{taskId}/mark-as-todo` without a body; `tasks done` posts an explicit `completedAt` timestamp to `/v1/tasks/{taskId}/mark-as-done`.

The resolved request origin must match the configured folk API origin. Absolute
URLs and pagination links pointing at any other origin are rejected before the
Authorization header is sent.

## Retries

`--retries n` sets the number of retries (default 3) and `--no-retry` disables them. Each retry of a command reuses its idempotency key.

| Request | Retried on |
| --- | --- |
| Read (`GET`) | 429, 500, 502, 503, 504, network errors |
| Write with an idempotency key | 429, 409, 502, 503, 504, network errors |
| Write with `--no-idempotency-key` | 429; with explicit `--retries`, also 500, 502, 503, 504, and network errors |

A write is not retried on 500, because Folk stores that response for the key. A 429 is always safe to retry: Folk rejects rate-limited requests before running them. Delays follow `Retry-After`, capped at 60 seconds, and otherwise use exponential backoff with jitter. When a write fails without a definite answer, the error includes `idempotencyKey=<key>` so the same command can be re-run with `--idempotency-key` within 24 hours.

## Body construction

Every create/update command accepts raw JSON:

```bash
folkctl people create --data '{"firstName":"Ada"}'
folkctl people create --data @person.json
folkctl people create --data - < person.json
```

`--field path.to.key=value` applies generic deep assignment on top of `--data`. Resource-specific flags then map to the documented folk request bodies.

Tasks use `title`, `dueAt`, `dueTime`, `description`, `recurrenceFrequency`, `assignedUsers`, `entity`, and `isPublic`. Use the completion commands instead of sending `completedAt` to `tasks update`. `--is-public=false` and `--visibility private` both request a private task; an explicit `--is-public` value takes precedence over `--visibility`.

Interaction `--type` is retained as a flag alias for `activityType`; `--activity-type` takes precedence when both flags are passed. Raw JSON is passed through. Interaction get/delete and the history lists require the `entity.id` query parameter; update requires `entity.id` in the body. History lists map `--timeframe`, repeated or comma-separated `--imported-type` and `--user-id`, and `--logged-only` (an empty `importedTypes`).

`--entity-id` maps to `filter[entity][in]` on Tasks. Notes use `query`, `createdAfter`, and `createdBefore`, exposed through `--query`, `--created-after`, and `--created-before`. Task text search is not supported. Enrichment lists map `--status a,b` to repeated `filter[status][in]`.

Enrichment bodies are `{"fields": [...], "ids": [...]}`. `--fields` takes `emails`, `phones`, or both (singular forms are accepted). IDs come from `ids` in `--data`, repeated `--id`, and positional arguments, in that order, and are sent once each, up to 500.

## Batch commands

`<resource> batch <create|update|delete>` sends `POST .../batch/<action>` with `{"records": [...]}` for people, companies, deals, and objects. Records come from:

- `--data` (inline, `@file`, or `-` for stdin) holding a JSON array of records, an object with a `records` array, one record object, or NDJSON with one record per line. Delete also accepts an array of ID strings, and sends only each record's `id`, so full records from `--ndjson` output work as input.
- For update and delete, record IDs as positional arguments or repeated `--id`. `batch update <id>...` applies the same change to each ID, taken from resource flags, `--field`, and an optional `--data` object. Passing IDs together with `--data` records is an error.

Resource flags and `--field` apply to every create or update record, the same way they apply on top of `--data` for one record. Record IDs and `--id` values can also be comma-separated. The CLI checks that there are 1 to 100 records, that each is an object, and that update and delete records have a string `id`, before sending anything. On update, list fields (`emails`, `phones`, `urls`, `addresses`, and person `companies`; object `people` and `companies`) replace each record's existing values, so a batch update that sets one prints a warning.

Output keeps request order. Tables, CSV, and `--plain` flatten each result to `index`, `status`, `id`, `name`, `operation`, `error`, `warnings`, and `removedGroups`; `--plain` prints only the IDs that succeeded; `--ndjson` prints each raw result. JSON output adds `batch: {records, succeeded, failed, withWarnings}`. If the response does not have exactly one result per record, each record's outcome is unknown: the command exits with code 1 and prints the idempotency key for a safe re-run. A summary goes to stderr unless `--quiet`, and the exit code is 5 when any record fails.

## Asynchronous enrichments

`enrichments create` answers `202` with a pending enrichment. `--wait` polls `GET /v1/person-enrichments/{id}` every `--wait-interval` seconds (default 5, minimum 1) until the status is no longer `pending` or `in_progress`, for up to `--wait-timeout` seconds (default 600). Polls also wait for an exhausted rate limit window or `Retry-After`, but never past the timeout, so there is always at least one poll. Status checks send no retries of their own: a check that is rate limited (429), fails with 500, 502, 503, or 504, or hits a network error is retried at the next poll. If the timeout passes, or a check fails in another way (such as 404), the command exits with code 1 and prints the enrichment ID, the last check's error, and the command that resumes waiting; after a create, it also prints the create request's idempotency key. An enrichment that ends in any status other than `completed`, or a response without a status, does not count as success: exit code 5, or 1 for a response without a status. A summary of the result goes to stderr unless `--quiet`.

## Confirmations

These commands require an interactive confirmation unless `--dry-run`, `--yes`, or `--force` is present:

- Deletes, including batch deletes, `api request DELETE`, and `api request POST .../batch/delete`
- Group member removal, and nonempty `removeOptions` in group custom field updates, because removing an option deletes its associated contact data
- Batch updates of people or companies in which any record sets `groups`, because `groups` replaces the record's groups and deletes its custom field values in each group left out
- Enrichment creation, including `api request POST /v1/person-enrichments`, because it spends workspace credits

The prompt asks for the record ID, or for the number of records or people affected. For non-interactive automation, `--no-input` fails instead of prompting. Without a terminal, or when `--data -` has already read stdin, the command fails with exit code 3; ending the input at the prompt (Ctrl-D) cancels with exit code 3. Single updates that set `groups` on people or companies print a warning instead.

`api request` applies the same confirmations. It resolves the request URL first (`.` and `..` segments, percent-encoding, case, duplicate and trailing slashes) and matches the path against the endpoint catalog, so any spelling of a guarded route is caught. Any `DELETE`, and any `POST` to a path ending in `/batch/delete`, needs confirmation even when the route is not in the catalog.

## Deprecation and MCP

Reminder wrappers remain on the reminder routes and emit a notice to stderr unless `--quiet` is set. Interaction history commands use `GET /v1/interactions`; the deprecated `/past` and `/upcoming` keys stay available to `api docs` and `api spec` with their sunset date.

For every endpoint, including `api request`, the CLI prints the notices Folk sends in `deprecations` to stderr, once each, because they can be newer than this release. Endpoints the CLI already knows are deprecated print their bundled notice instead when Folk sends none, in dry-runs, and when the request fails; if Folk's `Sunset` header gives another date, the notice says so. For other endpoints, a `Deprecation` header without a message prints a generic notice. JSON responses preserve the server's `deprecations` array and expose `Deprecation`/`Sunset` headers in `response.deprecation`/`response.sunset`.

MCP helpers run offline without loading REST configuration. `mcp config` writes only a snippet to stdout; `--json` wraps the snippet with format and authentication instructions. The user merges it into their MCP client and authenticates using OAuth. The CLI does not run an MCP server or call MCP tools. See [MCP setup](mcp.md).
