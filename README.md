# folkctl

`folkctl` is a zero-dependency Node.js CLI plus an OpenClaw/ClawHub-ready skill for the [folk.app](https://www.folk.app/) CRM API. It is designed for direct terminal use and for agent-driven workflows where predictable output, dry-runs, and self-documenting commands matter.

## What this repo contains

- A CLI executable: `folkctl`
- A ClawHub/OpenClaw skill: `skills/folk-cli/SKILL.md`
- Unit tests using Node's built-in test runner
- API endpoint metadata for people, companies, groups, deals, users, notes, reminders, interactions, and webhooks
- Publishing notes for GitHub and ClawHub

## Requirements

- Node.js 20+
- A folk API key

No npm runtime dependencies are required.

## Install

```bash
npm install -g folkctl
folkctl --version
```

Or from source:

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

# Deals live under /v1/groups/{groupId}/{objectType}; objectType is usually a deal object-field name such as Deals
folkctl deals list --group-id grp_123 --object-type Deals
folkctl deals create --group-id grp_123 --object-type Deals \
  --name "Project Alpha" \
  --company-id com_123 \
  --person-id per_123 \
  --custom Status=Active

# Notes, reminders, interactions, and webhooks
folkctl notes create --entity-id per_123 --content "Met at SaaStr. Follow up next week." --visibility private
folkctl reminders create --entity-id per_123 --name "Follow up" --visibility private --recurrence-rule "DTSTART;TZID=Europe/Paris:20250717T090000\nRRULE:FREQ=WEEKLY;INTERVAL=1"
folkctl interactions create --entity-id per_123 --date-time 2025-07-17T09:00:00.000Z --title "Coffee" --content "Discussed new project." --type ☕️
folkctl webhooks create --name "My app" --target-url https://example.com/webhook --event person.created

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
- `--all` follows `data.pagination.nextLink` and merges `data.items`.
- Authorized requests are restricted to the configured folk API origin.
- Retries are enabled by default only for idempotent read methods; pass `--retries n` to opt into mutation retries.
- Delete operations require an interactive confirmation unless `--yes`, `--force`, or `--dry-run` is passed.
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

## Tests

```bash
npm run ci
```

## OpenClaw skill

The skill lives at `skills/folk-cli/SKILL.md`. After publishing this repo and installing `folkctl` on machines that run OpenClaw:

```bash
openclaw skills install folk-cli
```

During local iteration, point OpenClaw at the local skill folder or publish it to ClawHub using the flow in `docs/publishing.md`.

## Repository status

`folkctl` is an early `0.1.0` release. The offline test suite covers CLI parsing, request construction, dry-run output, payload helpers, and local `.env` loading. Endpoint coverage follows the public folk API documentation; see `docs/folk-api-notes.md` for sources.
