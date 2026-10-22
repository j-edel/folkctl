# folkctl

`folkctl` is a zero-dependency Node.js CLI plus an OpenClaw/ClawHub-ready skill for the [folk.app](https://www.folk.app/) CRM API. It is designed for direct terminal use and for agent-driven workflows where predictable output, dry-runs, and self-documenting commands matter.

## What this repo contains

- A CLI executable: `folkctl`
- A ClawHub/OpenClaw skill: `skills/folk-cli/SKILL.md`
- Unit tests using Node's built-in test runner
- API endpoint metadata for people, companies, groups, group members, custom fields, deals, custom objects, users, notes, tasks, interactions, person enrichments, credits, webhooks, and legacy reminders, including batch endpoints
- Offline setup snippets for Folk's official hosted MCP server
- Publishing notes for GitHub and ClawHub

## Requirements

- Node.js 20+
- A folk API key

No npm runtime dependencies are required.

## Install

```bash
npm install -g github:j-edel/folkctl
folkctl --version
```

The npm registry package was not available when this update was prepared; GitHub is the current distribution source. For a pinned version, choose a reviewed tag from [GitHub Releases](https://github.com/j-edel/folkctl/releases), or install a release tarball.

Or clone for development:

```bash
git clone https://github.com/j-edel/folkctl.git
cd folkctl
npm install
npm link
folkctl --version
```

For local development without linking:

```bash
node bin/folkctl.js --help
node bin/folkctl.js people list --dry-run
```

## Authentication

For automation and OpenClaw skills, prefer an environment variable:

```bash
export FOLK_API_KEY="fk_live_..."
```

For local project usage, `folkctl` also reads `FOLK_API_KEY` and `FOLK_API_VERSION` from `.env` and `.env.local` in the current working directory:

```bash
cp .env.example .env.local
$EDITOR .env.local
folkctl auth status
```

Real environment variables take precedence over `.env.local`, and `.env.local` is ignored by git. Base URL overrides are intentionally not read from cwd `.env` files; use a real environment variable, config file, or `--base-url` for proxy/testing targets.

For local interactive use, store the key in the CLI config file:

```bash
printf '%s' "$FOLK_API_KEY" | folkctl auth login --token-stdin
folkctl auth status
```

The config file defaults to `$XDG_CONFIG_HOME/folkctl/config.json` or `~/.config/folkctl/config.json` and is written with `0600` permissions where supported.

## Command examples

```bash
# Introspect the API map shipped with the CLI
folkctl api ls
folkctl api docs people.create
folkctl people --help

# List/search contacts
folkctl people list --limit 20
folkctl people search "Ada Lovelace" --json --pretty
folkctl companies list --filter name:like:OpenAI --json

# Create records with ergonomic flags
folkctl people create \
  --first-name Ada \
  --last-name Lovelace \
  --email ada@example.com \
  --group-id grp_123

folkctl companies create \
  --name "Acme Inc" \
  --url https://acme.example \
  --group-id grp_123

# Use raw JSON whenever folk adds fields before the CLI has a shortcut
folkctl people create --data @examples/person-create.json --dry-run
cat examples/company-create.json | folkctl companies create --data - --dry-run

# Groups and custom fields
folkctl groups list --json
folkctl groups fields grp_123 person --json
folkctl groups fields grp_123 company --json
folkctl groups fields grp_123 Deals --json
folkctl groups create --name "Partners" --visibility private --dry-run
folkctl groups members list grp_123 --json
folkctl groups members add grp_123 usr_123 --role reader --dry-run
folkctl groups fields get grp_123 person "Status" --json
folkctl groups fields create grp_123 person --name "Region" --type textField --dry-run

# Deals live under /v1/groups/{groupId}/{objectType}; objectType is usually a deal object-field name such as Deals
folkctl deals list --group-id grp_123 --object-type Deals
folkctl deals create --group-id grp_123 --object-type Deals \
  --name "Project Alpha" \
  --company-id com_123 \
  --person-id per_123 \
  --custom Status=Active

# Any custom object type uses the same API as deals
folkctl objects list --group-id grp_123 --object-type Projects --json
folkctl objects create --group-id grp_123 --object-type Projects --name "Website launch" --dry-run

# Search notes by content and creation date
folkctl notes search "contract renewal" --created-after 2026-08-01T00:00:00Z --all --json

# Notes, tasks, interactions, and webhooks
folkctl notes create --entity-id per_123 --content "Met at SaaStr. Follow up next week." --visibility private
folkctl tasks create --entity-id per_123 --title "Follow up" --due-at 2026-09-08 --due-time 09:00 --is-public=false --dry-run
folkctl tasks list --only-assigned-to-me --empty completedAt --all --json
folkctl tasks done tsk_123 --completed-at 2026-09-08T14:00:00Z --dry-run
folkctl tasks todo tsk_123 --dry-run
folkctl interactions past --entity-id per_123 --all --json
folkctl interactions upcoming --entity-id per_123 --json
folkctl interactions list --entity-id per_123 --imported-type email,call --user-id usr_123 --json
folkctl interactions list --entity-id per_123 --logged-only --json
folkctl interactions get lit_123 --entity-id per_123 --json
folkctl interactions create --entity-id per_123 --date-time 2026-09-06T09:00:00.000Z --title "Coffee" --content "Discussed new project." --activity-type coffee --dry-run
folkctl interactions update lit_123 --entity-id per_123 --content "Updated notes." --dry-run
folkctl webhooks create --name "My app" --target-url https://example.com/webhook --event person.created

# Batch create, update, or delete up to 100 records per request
folkctl people batch create --data @examples/people-batch-create.ndjson --group-id grp_123 --dry-run
folkctl people batch update --data @examples/people-batch-update.json --dry-run
folkctl companies batch update com_123 com_456 --industry Fintech --dry-run
folkctl people batch delete per_123 per_456 --dry-run
folkctl deals batch create --group-id grp_123 --object-type Deals --data @deals.ndjson --dry-run

# Pipe --ndjson output through jq into a batch (100 records per request at most)
folkctl people list --filter jobTitle:empty --limit 100 --ndjson \
  | jq -c '{id, jobTitle: "Unknown"}' \
  | folkctl people batch update --data - --dry-run

# Find missing emails and phones (uses workspace credits)
folkctl credits
folkctl people enrich per_123 per_456 --fields emails,phones --wait --dry-run
folkctl enrichments list --status pending,in_progress
folkctl enrichments get enr_123 --wait

# Low-level escape hatch for endpoints not yet wrapped
folkctl api request GET /v1/users/me --json
folkctl api request POST /v1/people --data '{"firstName":"Ada","lastName":"Lovelace"}' --dry-run
```

## Output and safety contract

- Data output goes to stdout.
- Human errors and prompts go to stderr.
- `--json` emits machine-readable JSON.
- `--ndjson` emits one JSON object per line for list items.
- `--plain` emits the best identifier/name per item.
- `--csv` emits a flat CSV projection for list items.
- `--dry-run` prints the HTTP request and never sends it.
- `--all` follows `data.pagination.nextLink` and merges `data.items`, pausing when a rate limit window is exhausted.
- Authorized requests are restricted to the configured folk API origin.
- Every write sends an `Idempotency-Key`, a new UUID unless you pass `--idempotency-key`. Retries reuse it, so a retried write runs once. To retry a command whose outcome is unknown, re-run it with the `idempotencyKey` from its error within 24 hours.
- Reads retry 429, 500, 502, 503, 504, and network errors. Writes retry 429, 409, 502, 503, 504, and network errors, but not a 500, which Folk stores for the key. `--retries n` sets the count (default 3) and `--no-retry` disables retries.
- Batch commands write each record on its own. Exit code 5 means Folk accepted the batch but at least one record failed; check each result's `status`.
- Deletes (including batch deletes), group member removal, custom field option removal, batch updates that replace groups, and enrichments (which spend credits) require an interactive confirmation unless `--yes`, `--force`, or `--dry-run` is passed.
- Removing custom field options also removes their associated contact data; preview `removeOptions` changes carefully.
- On people and company updates, `groups` replaces the record's groups and deletes its custom field values in each group left out. Leave `groups` out to keep them; custom fields of groups the record is already in can be set without it. List fields such as `emails` and `phones` also replace the existing values on update.
- Boolean flags read a following `true`/`false` word as their value, so `--yes false` does not confirm. Use `--flag=value` when in doubt.
- Secrets are read from `FOLK_API_KEY` or local config; do not pass API keys as command flags.

## Filtering

folk filters use query params like `filter[field][operator]=value`. `folkctl` maps concise flags to that shape:

```bash
folkctl people list --filter fullName:like:Ada
folkctl people list --filter groups:in:id:grp_123
folkctl people list --filter emails:like:ada@example.com --combinator or
folkctl companies list --filter urls:not_eq:https://example.com
folkctl people list --empty description
folkctl people list --not-empty jobTitle
```

Raw query params are also supported:

```bash
folkctl people list --param 'filter[fullName][like]=Ada' --param combinator=or
```

Tasks have their own filters. `--entity-id` maps to `filter[entity][in]` for tasks and to `entity.id` for notes, reminders, and interactions:

```bash
folkctl tasks list --entity-id per_123 --filter dueAt:lt:2026-09-30 --empty completedAt
folkctl tasks list --filter assigneeUserId:in:usr_123 --only-assigned-to-me=false
```

Task title search is not exposed by the REST API. Use `tasks list` with supported filters. `notes search` uses Folk's full-text `query` parameter.

Enrichment lists filter on `status`, `createdAt`, and `finishedAt`; `--status` is a shortcut for `filter[status][in]`:

```bash
folkctl enrichments list --status pending,in_progress
folkctl enrichments list --filter finishedAt:gt:2026-10-01
```

Select option labels are case-sensitive in filters and writes. Filtering on an unknown label matches nothing, and writing one creates a new option.

`groups list --visibility private --all` filters groups across every retrieved page. The CLI applies the visibility filter locally as well as forwarding it, because the current API can ignore that parameter. Without `--all`, only the current page is filtered and `nextLink` may still point to more results.

## Updating from 0.2.x

- Writes now send an `Idempotency-Key` and retry transient failures with it. Scripts that relied on writes never retrying can pass `--no-retry`.
- `interactions past`, `upcoming`, and `list` now call `GET /v1/interactions`. Folk removes the old `/past` and `/upcoming` routes on March 29, 2027; output shape is unchanged.
- Batch deletes, batch updates that set `groups`, and enrichments need `--yes` in non-interactive use.
- `--foundation-date` now fails: the API has no such field. Use `--foundation-year`.
- Error output for validation failures now lists each issue's field path.

## Updating from 0.1.x

Use `tasks` for new follow-ups. Tasks use `title`, `dueAt` (a `YYYY-MM-DD` date), optional `dueTime` (`HH:mm`), and `recurrenceFrequency` instead of reminder iCalendar strings. Visibility is `isPublic`; the API defaults to public, so pass `--is-public=false` for private tasks. Completion requires `tasks done --completed-at <timestamp>` or `tasks todo`.

Existing `reminders` commands remain available and print a deprecation notice to stderr (`--quiet` suppresses it). They do not convert records or change IDs. Folk's changelog and endpoint reference list a February 13, 2027 sunset; its migration guide currently says February 11. See [API source notes](docs/folk-api-notes.md) and plan migration before the earlier date.

Interaction history and editing are in open beta. Reads require `--entity-id`, and only manually logged interactions can be updated or deleted. Imported email, calendar, and WhatsApp content follows workspace privacy rules. The legacy interaction `--type` flag now writes `activityType`.

`deals` and `groups fields <groupId> <entityType>` retain their existing syntax. Use `objects` for any custom object type, and `groups fields list|get|create|update` for managing field definitions.

## Official Folk MCP

Folk hosts an OAuth-authenticated MCP server at `https://mcp.folk.app/mcp`. These offline commands print its connection details and client setup snippets:

```bash
folkctl mcp info --json
folkctl mcp config codex
folkctl mcp config cursor
folkctl mcp config vscode
```

Merge the printed configuration into your MCP client and complete its OAuth flow. For Codex, run `codex mcp login folk` after adding the configuration. `folkctl` continues to call the REST API with `FOLK_API_KEY`; it does not execute MCP tools or manage MCP OAuth credentials. See [MCP setup and capabilities](docs/mcp.md).

## Tests

```bash
npm run ci
```

## OpenClaw skill

The skill lives at `skills/folk-cli/SKILL.md` and is included in the CLI package. Add that folder to your OpenClaw skills configuration, with `folkctl` installed and `FOLK_API_KEY` available in the agent environment.

For ClawHub publication, use the existing `folk-cli` slug and the release procedure in [publishing notes](docs/publishing.md). The bundled skill is available from this repository regardless of registry publication.

## Repository status

`folkctl` 0.3.0 targets the public API documented on October 22, 2026. The offline suite checks all 71 public OpenAPI operations, and their deprecation and beta markers, against an independent endpoint snapshot, plus CLI request construction, payloads, pagination, batch results, enrichment polling, retries, idempotency keys, rate limits, confirmations, configuration, and MCP snippets. These tests do not mutate a live workspace. See [API source notes](docs/folk-api-notes.md) for contract details and documentation discrepancies.

To check for API changes, regenerate the snapshot and run the tests:

```bash
node scripts/openapi-snapshot.mjs > test/fixtures/folk-api-contract.json
git diff test/fixtures/folk-api-contract.json
npm test
```
