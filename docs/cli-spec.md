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
├── groups       list | fields
├── users        list | me | get
├── notes        list | get | create | update | delete
├── reminders    list | get | create | update | delete
├── interactions create
└── webhooks     list | get | create | update | delete
```

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

## Request construction

The CLI always sends:

```http
Authorization: Bearer <token>
Accept: application/json
X-API-Version: <configured-version>
User-Agent: folkctl/<version>
```

Mutation commands send `Content-Type: application/json` and a JSON body.

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

## Destructive operations

Delete commands require an interactive confirmation unless one of these is present:

```bash
--dry-run
--yes
--force
```

For non-interactive automation, use `--no-input` to fail instead of prompting.
