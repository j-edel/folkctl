import { VERSION } from './version.js';
import { BATCH_MAX_RECORDS, ENRICHMENT_MAX_PEOPLE, REMINDERS_DEPRECATION } from './endpoints.js';
export { VERSION };

export function topHelp() {
  return `folkctl ${VERSION}

Zero-dependency CLI for the folk.app API, designed to be driven by humans or OpenClaw skills.

Usage:
  folkctl <resource> <action> [args] [flags]
  folkctl api <ls|docs|spec|request> [...]
  folkctl auth <login|logout|status> [flags]
  folkctl mcp <info|config> [client]

Resources:
  people       list, search, get, create, update, delete, batch, enrich
  companies    list, search, get, create, update, delete, batch
  deals        list, search, get, create, update, delete, batch
  objects      list, search, get, create, update, delete, batch
  groups       list, create, update, fields, members
  users        list, me, get
  notes        list, search, get, create, update, delete
  tasks        list, get, create, update, delete, done, todo
  reminders    list, get, create, update, delete (deprecated; use tasks)
  interactions list, past, upcoming, get, create, update, delete (history/editing in beta)
  enrichments  list, get, create (find emails and phones; uses credits)
  credits      get (workspace credits per metered feature)
  webhooks     list, get, create, update, delete

Global flags:
  --json                 Machine-readable JSON output
  --pretty               Pretty-print JSON output
  --ndjson               Newline-delimited JSON for list items and batch results
  --plain                Print only the best identifier/name per item
  --csv                  CSV output for flat list fields
  --dry-run              Print the HTTP request without sending it
  --all                  Follow pagination.nextLink and merge all pages
  --limit <n>            Items per page where supported
  --filter f:op:v        Add folk filter[f][op]=v
  --param key=value      Add a raw query parameter
  --idempotency-key <k>  Key for a write; default is a new UUID per command
  --no-idempotency-key   Send writes without an Idempotency-Key
  --retries <n>          Retries for retryable failures (default 3)
  --no-retry             Disable retries
  --api-version <date>   Set X-API-Version for this call
  --base-url <url>       Override https://api.folk.app
  --config <path>        Override config path
  --quiet                Suppress warnings and summaries on stderr
  --no-input             Never prompt; fail instead
  --yes, --force         Skip confirmations (deletes, group replacement, credit use)

Exit codes: 0 ok, 1 API or runtime error, 2 invalid input, 3 confirmation needed or cancelled,
4 authentication, 5 some batch records or a waited enrichment did not succeed.

Auth:
  export FOLK_API_KEY=fk_live_...
  printf '%s' "$FOLK_API_KEY" | folkctl auth login --token-stdin

Examples:
  folkctl people list --limit 20
  folkctl people search "Ada Lovelace" --json
  folkctl people create --first-name Ada --last-name Lovelace --email ada@example.com --group-id grp_...
  folkctl people batch create --data @people.ndjson --group-id grp_... --dry-run
  folkctl companies batch update com_1 com_2 --industry Fintech --dry-run
  folkctl companies list --filter name:like:OpenAI --json
  folkctl groups fields grp_... person
  folkctl deals list --group-id grp_... --object-type Deals
  folkctl notes create --entity-id per_... --content "Met at SaaStr." --visibility private
  folkctl tasks list --only-assigned-to-me --empty completedAt
  folkctl interactions past --entity-id per_... --all --json
  folkctl people enrich per_... --fields emails --wait
  folkctl credits
  folkctl mcp config codex
  folkctl api docs people.batch.update
  folkctl api request GET /v1/users/me --json
`;
}

export function resourceHelp(resource) {
  const common = `Usage:
  folkctl ${resource} list [--limit n] [--all] [--json]
  folkctl ${resource} get <id> [--json]
  folkctl ${resource} create [fields|--data JSON|--data @file|-] [--dry-run]
  folkctl ${resource} update <id> [fields|--data JSON|--data @file|-] [--dry-run]
  folkctl ${resource} delete <id> [--yes|--force] [--dry-run]

`;
  const extras = {
    people: `People fields:
  --first-name Ada --last-name Lovelace --full-name "Ada Lovelace"
  --email ada@example.com --phone +15551234567 --url https://example.com
  --group-id grp_... --company-id com_...
  --gender Male|Female|Unknown|Other --birthday <date>
  Use --field gender=null or --field birthday=null to clear.
  --custom grp_123.Status=Active   (groupId.Field Name=value)
  On update, --group-id and groups replace the person's groups: each group left out is
  removed, with the person's custom field values in it. On create, groups only add.

Search/filter:
  folkctl people search "Ada Lovelace"
  --filter fullName:like:Ada --filter groups:in:id:grp_... --combinator or

${batchHelp('people', 'per', '--job-title "Partner"')}
Enrichment (finds missing emails and phones; uses workspace credits):
  folkctl people enrich per_1 per_2 --fields emails,phones [--wait] [--yes]
  Same as folkctl enrichments create. See folkctl enrichments --help.
`,
    companies: `Company fields:
  --name "Acme Inc" --email hello@acme.com --url https://acme.com
  --industry Fintech --employee-range 11-50 --foundation-year 2015
  --funding-raised 2000000 --last-funding-date 2026-03-01
  --group-id grp_... --custom grp_123.Stage=Lead
  On update, --group-id and groups replace the company's groups and delete the custom
  field values of each group left out.

Search/filter:
  folkctl companies search "Acme"
  --filter name:like:Acme --filter groups:in:id:grp_... --combinator or

${batchHelp('companies', 'com', '--industry Fintech')}
batch create matches records to existing companies by name: a matching record updates that
company, and its result has operation "updated" instead of "created".
`,
    notes: `Note fields:
  --entity-id per_... --content "Markdown content" --visibility public|private

Note search:
  folkctl notes search "contract renewal" [--entity-id per_...] [--all]
  folkctl notes list --query "renewal" --created-after <ISO timestamp> --created-before <ISO timestamp>
`,
    tasks: `Task fields:
  --entity-id per_... --title "Follow up" --due-at YYYY-MM-DD
  --due-time HH:mm --description "Markdown content"
  --recurrence-frequency weekday|weekly|biweekly|monthly|quarterly|yearly|null
  --is-public=true|false (API default: true), or --visibility public|private
  --assigned-user-id usr_... --assigned-user-email jane@example.com
  Use --field description=null, --due-time null, or --recurrence-frequency null to clear fields.

Task filters:
  --entity-id per_... --only-assigned-to-me --empty completedAt
  --filter dueAt:lt:2026-09-30 --filter assigneeUserId:in:usr_... --filter createdAt:gt:2026-01-01
  --entity-id maps to filter[entity][in]; text search is not supported.

Completion:
  folkctl tasks done <taskId> --completed-at <ISO timestamp> [--dry-run]
  folkctl tasks todo <taskId> [--dry-run]
  done/todo also accept mark-as-done/mark-as-todo. Completion changes use separate POST endpoints.
`,
    reminders: `Reminder fields:
  --entity-id per_... --name "Follow up" --recurrence-rule "DTSTART...\\nRRULE:FREQ=WEEKLY"
  --assigned-user-id usr_... --assigned-user-email jane@example.com

${REMINDERS_DEPRECATION}
Migration: https://developer.folk.app/migrations/reminders-to-tasks
`,
    webhooks: `Webhook fields:
  --name "My app" --target-url https://example.com/webhook
  --event person.created --event company.updated:grp_...
  --event person_enrichment.finished (no group filter)
`,
  };
  return `${common}\n${extras[resource] || ''}`;
}

function batchHelp(resource, prefix, exampleFlag) {
  return `Batch (up to ${BATCH_MAX_RECORDS} records per request; each record succeeds or fails on its own):
  folkctl ${resource} batch create --data @records.json|@records.ndjson|- [fields applied to each record]
  folkctl ${resource} batch update --data @changes.ndjson    (each record needs its id)
  folkctl ${resource} batch update ${prefix}_1 ${prefix}_2 ${exampleFlag}    (same change for each ID)
  folkctl ${resource} batch delete ${prefix}_1 ${prefix}_2 [--data @ids.json] [--yes]
  --data takes a JSON array, {"records": [...]}, or NDJSON such as --ndjson output.
  batch update with groups replaces groups and needs confirmation (--yes).
  Results keep request order. Exit code 5 means at least one record failed.
`;
}

export function dealsHelp(resource = 'deals') {
  return `Usage:
  folkctl ${resource} list --group-id grp_... --object-type Deals [--limit n] [--all]
  folkctl ${resource} search "Project Alpha" --group-id grp_... --object-type Deals
  folkctl ${resource} get <id> --group-id grp_... --object-type Deals
  folkctl ${resource} create --group-id grp_... --object-type Deals --name "Project Alpha"
  folkctl ${resource} update <id> --group-id grp_... --object-type Deals --custom Status=Won
  folkctl ${resource} delete <id> --group-id grp_... --object-type Deals --yes

Batch (up to ${BATCH_MAX_RECORDS} objects of one type per request):
  folkctl ${resource} batch create --group-id grp_... --object-type Deals --data @deals.ndjson
  folkctl ${resource} batch update --group-id grp_... --object-type Deals --data @changes.ndjson
  folkctl ${resource} batch update obj_1 obj_2 --group-id grp_... --object-type Deals --custom Status=Won
  folkctl ${resource} batch delete obj_1 obj_2 --group-id grp_... --object-type Deals [--yes]
  batch create never matches existing objects: re-running it creates duplicates unless you
  reuse --idempotency-key. people and companies are given by ID and must be in the group.
  On update, people and companies replace the object's lists.

Deals are custom objects whose object type is Deals, so ${resource} commands share /v1/groups/{groupId}/{objectType}.
Use the exact, case-sensitive object type name (e.g. Deals or Projects) from group custom fields of type objectField.
Positional paths are also supported: ${resource} list <groupId> <objectType>, ${resource} batch delete <groupId> <objectType> <ids...>.
`;
}

export function groupsHelp() {
  return `Usage:
  folkctl groups list [--visibility public|private] [--limit n] [--all]
  folkctl groups create --name "Sales" --visibility private [--dry-run]
  folkctl groups update <groupId> --name "Pipeline" [--dry-run]
  folkctl groups fields <groupId> <entityType> [--all]
  folkctl groups fields list <groupId> <entityType> [--all]
  folkctl groups fields get <groupId> <entityType> <customFieldName>
  folkctl groups fields create <groupId> <entityType> --name "Stage" --type singleSelect --data @field.json [--dry-run]
  folkctl groups fields update <groupId> <entityType> <customFieldName> --data @changes.json [--dry-run]
  folkctl groups members list <groupId> [--all]
  folkctl groups members add <groupId> <userId> --role admin|contributor|reader [--dry-run]
  folkctl groups members update <groupId> <userId> --role reader [--dry-run]
  folkctl groups members remove <groupId> <userId> [--yes] [--dry-run]

Path flags: --group-id, --entity-type, --custom-field-name, --user-id.
entityType is person, company, or a custom object name such as Deals.
Use --data for custom field options/config, including addOptions, updateOptions, and removeOptions.
Select option labels are case-sensitive; writing an unknown label creates a new option.
An objectField on person or company creates an object type, along with its Status field.
Object types cannot have contactField or objectField custom fields.
Removing members or custom field options requires confirmation. Removing options also removes associated contact data.
--visibility filters the retrieved groups locally as well as forwarding the API parameter. Use --all to inspect every page.
`;
}

export function interactionsHelp() {
  return `Usage:
  folkctl interactions list --entity-id <entityId> [--timeframe past|upcoming] [--all]
  folkctl interactions past --entity-id <entityId> [--imported-type email,calendar] [--all]
  folkctl interactions upcoming --entity-id <entityId> [--user-id usr_...] [--all]
  folkctl interactions get <interactionId> --entity-id <entityId>
  folkctl interactions create --entity-id per_... --date-time <ISO timestamp> --title "Coffee" --content "Notes" --activity-type coffee [--dry-run]
  folkctl interactions update <interactionId> --entity-id per_... --title "Updated title" [--dry-run]
  folkctl interactions delete <interactionId> --entity-id per_... [--yes] [--dry-run]

History filters:
  --imported-type email|calendar|whatsapp|call   Repeat or comma-separate. Default: every imported type.
  --logged-only                                  Only manually logged interactions.
  --user-id usr_...                              Only these workspace members. Repeat or comma-separate.
  --imported-type never removes logged interactions; --user-id also filters logged ones by author.

list, past, and upcoming use GET /v1/interactions (list defaults to past). The older /past and
/upcoming routes are deprecated and scheduled for removal on March 29, 2027.
History and editing endpoints are in open beta. Reads require the linked person, company, or object ID.
Only logged interactions can be updated or deleted; imported email, calendar, WhatsApp, and call
interactions follow Folk's privacy rules. Calls carry content.status: ongoing, processing, completed,
missed, or failed. Expect new interaction types over time.
Use --activity-type for predefined activities, messaging apps, or emoji. The legacy --type flag maps to activityType.
`;
}

export function enrichmentsHelp() {
  return `Usage:
  folkctl enrichments create <personId>... --fields emails|phones|emails,phones [--wait] [--yes] [--dry-run]
  folkctl enrichments get <enrichmentId> [--wait]
  folkctl enrichments list [--status pending,in_progress] [--filter createdAt:gt:2026-10-01] [--all]
  folkctl people enrich <personId>... --fields emails      (same as enrichments create)

Enrichment finds the missing emails and phones of up to ${ENRICHMENT_MAX_PEOPLE} people, like 1-click enrichment
in the folk app. It runs asynchronously and uses workspace enrichment credits for each field found.
create asks for confirmation unless --yes or --dry-run is passed. Check credits first with folkctl credits.
Folk rejects a request with 402 when the workspace lacks credits for its maximum cost; nothing is charged.

IDs come from arguments, repeated --id, or --data '{"ids":[...],"fields":[...]}'. Duplicates are sent once.
--wait polls until the enrichment is completed or failed (--wait-interval 5, --wait-timeout 600 seconds).
A waited enrichment that does not end completed exits with code 5. Rate-limited or failed status checks are
retried at the next poll, never past --wait-timeout. Without --wait, poll with enrichments get, or subscribe a
webhook to person_enrichment.finished.

Per-person status: enriched, partially_enriched, not_enriched, skipped (unknown, deleted, or not editable),
or error (try again later). missingInputs lists data that may improve a new attempt, such as a LinkedIn URL.
enrichments list returns at most 10 enrichments per page; filters: status, createdAt, finishedAt.
`;
}

export function creditsHelp() {
  return `Usage:
  folkctl credits [get] [--json]

Shows the credits used and available in the current period for each metered feature, such as
person_enrichment. limit is null when unlimited and 0 when the feature is unavailable. Credits with
scope user belong to the user of the API key. Requires the contributor role or above.
`;
}

export function usersHelp() {
  return `Usage:
  folkctl users list [--limit n] [--all]
  folkctl users me [--json]
  folkctl users get <userId> [--json]
`;
}

export function mcpHelp() {
  return `Usage:
  folkctl mcp info [--json]
  folkctl mcp config [generic|codex|claude|cursor|vscode|windsurf] [--json]

Print connection details or a configuration snippet for Folk's hosted MCP server:
  https://mcp.folk.app/mcp (Streamable HTTP, OAuth)

These commands work offline, print to stdout, and do not change client configuration.
Merge the snippet into your MCP client, then complete its OAuth flow.
For Codex, run codex mcp login folk after adding the config.
REST commands keep using FOLK_API_KEY; MCP authorization is separate.
This CLI does not run an MCP server or execute MCP tools.
Docs: https://developer.folk.app/mcp/connect
`;
}

export function apiHelp() {
  return `Usage:
  folkctl api ls [resource]
  folkctl api docs <endpoint-key>
  folkctl api spec <endpoint-key>
  folkctl api request <METHOD> <PATH-OR-URL> [--param k=v] [--data JSON] [--json]

Examples:
  folkctl api ls people
  folkctl api docs people.batch.create
  folkctl api request GET /v1/users/me --json
  folkctl api request POST /v1/people --data '{"firstName":"Ada","lastName":"Lovelace"}' --dry-run

Writes (POST, PUT, PATCH, DELETE) send an Idempotency-Key. DELETE, batch delete, and enrichment requests
need confirmation (--yes).
`;
}

export function authHelp() {
  return `Usage:
  folkctl auth status [--check]
  folkctl auth login --token-stdin
  folkctl auth logout

Prefer FOLK_API_KEY for automation. auth login stores a local config file with 0600 permissions where supported.
`;
}
