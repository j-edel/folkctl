# CLI spec

## Goals

`folkctl` should be safe enough for agentic use and pleasant enough for humans:

1. Every command is discoverable with `--help`.
2. Every HTTP wrapper is inspectable with `api docs` and `api spec`.
3. Every mutation can be previewed with `--dry-run`.
4. Machine output is stable with `--json`, `--ndjson`, `--plain`, and `--csv`.
5. Secrets come from environment or config, never from positional args.
6. The low-level `api request` escape hatch keeps the CLI useful when the folk API changes.

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
├── people       list | search | get | create | update | delete
├── companies    list | search | get | create | update | delete
├── deals        list | search | get | create | update | delete
├── objects      list | search | get | create | update | delete
├── groups       list | create | update
│   ├── fields   list | get | create | update
│   └── members  list | add | update | remove
├── users        list | me | get
├── notes        list | search | get | create | update | delete
├── tasks        list | get | create | update | delete | done | todo
├── reminders    list | get | create | update | delete (deprecated)
├── interactions create | past | upcoming | get | update | delete
├── webhooks     list | get | create | update | delete
└── mcp          info | config
```

`groups fields <groupId> <entityType>` remains shorthand for `groups fields list`. Nested endpoint keys (for example `groups.members.add`) are available through `api docs` and `api spec`. `interactions list` aliases `past`; task completion also accepts `mark-done`/`mark-as-done` and `mark-todo`/`mark-as-todo`.

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

## Pagination

List endpoints return a payload with `data.items` and `data.pagination.nextLink`. Passing `--all` follows `nextLink` and merges all `items` into the final response.

`groups list --visibility` additionally filters retrieved items locally to handle servers that ignore the announced query parameter. It preserves remaining pagination links, updates merged `itemCount`, and includes `clientFilter` metadata. Use `--all` for complete coverage.

## Request construction

The CLI always sends:

```http
Authorization: Bearer <token>
Accept: application/json
X-API-Version: <configured-version>
User-Agent: folkctl/<version>
```

Commands with a body send `Content-Type: application/json`. `tasks todo` posts to `/v1/tasks/{taskId}/mark-as-todo` without a body; `tasks done` posts an explicit `completedAt` timestamp to `/v1/tasks/{taskId}/mark-as-done`.

The resolved request origin must match the configured folk API origin. Absolute
URLs and pagination links pointing at any other origin are rejected before the
Authorization header is sent.

Retries default to idempotent read methods only. Mutation retries require an
explicit `--retries n`.

## Body construction

Every create/update command accepts raw JSON:

```bash
folkctl people create --data '{"firstName":"Ada"}'
folkctl people create --data @person.json
folkctl people create --data - < person.json
```

`--field path.to.key=value` applies generic deep assignment on top of `--data`. Resource-specific flags then map to the documented folk request bodies.

Tasks use `title`, `dueAt`, `dueTime`, `description`, `recurrenceFrequency`, `assignedUsers`, `entity`, and `isPublic`. Use the completion commands instead of sending `completedAt` to `tasks update`. `--is-public=false` and `--visibility private` both request a private task; an explicit `--is-public` value takes precedence over `--visibility`.

Interaction `--type` is retained as a flag alias for `activityType`; `--activity-type` takes precedence when both flags are passed. Raw JSON is passed through. Interaction get/delete and both history lists require the `entity.id` query parameter; update requires `entity.id` in the body.

`--entity-id` maps to `filter[entity][in]` on Tasks. Notes use `query`, `createdAfter`, and `createdBefore`, exposed through `--query`, `--created-after`, and `--created-before`. Task text search is not supported.

## Destructive operations

Delete commands require an interactive confirmation unless one of these is present:

```bash
--dry-run
--yes
--force
```

For non-interactive automation, use `--no-input` to fail instead of prompting.

The same confirmation applies to group member removal and nonempty `removeOptions` in group custom field updates, because removing an option deletes its associated contact data.

## Deprecation and MCP

Reminder wrappers remain on the reminder routes and emit a notice to stderr unless `--quiet` is set. JSON responses preserve the server's `deprecations` array and expose `Deprecation`/`Sunset` headers in `response.deprecation`/`response.sunset`.

MCP helpers run offline without loading REST configuration. `mcp config` writes only a snippet to stdout; `--json` wraps the snippet with format and authentication instructions. The user merges it into their MCP client and authenticates using OAuth. The CLI does not run an MCP server or call MCP tools. See [MCP setup](mcp.md).
