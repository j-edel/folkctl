import { VERSION } from './version.js';
import { REMINDERS_DEPRECATION } from './endpoints.js';
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
  people       list, search, get, create, update, delete
  companies    list, search, get, create, update, delete
  deals        list, search, get, create, update, delete
  objects      list, search, get, create, update, delete
  groups       list, create, update, fields, members
  users        list, me, get
  notes        list, search, get, create, update, delete
  tasks        list, get, create, update, delete, done, todo
  reminders    list, get, create, update, delete (deprecated; use tasks)
  interactions create, past, upcoming, get, update, delete (history/editing in beta)
  webhooks     list, get, create, update, delete

Global flags:
  --json                 Machine-readable JSON output
  --pretty               Pretty-print JSON output
  --ndjson               Newline-delimited JSON for list items
  --plain                Print only the best identifier/name per item
  --csv                  CSV output for flat list fields
  --dry-run              Print the HTTP request without sending it
  --all                  Follow pagination.nextLink and merge all pages
  --limit <n>            Items per page where supported
  --filter f:op:v        Add folk filter[f][op]=v
  --param key=value      Add a raw query parameter
  --api-version <date>   Set X-API-Version for this call
  --base-url <url>       Override https://api.folk.app
  --config <path>        Override config path
  --no-input             Never prompt; fail instead
  --yes, --force         Skip destructive confirmations

Auth:
  export FOLK_API_KEY=fk_live_...
  printf '%s' "$FOLK_API_KEY" | folkctl auth login --token-stdin

Examples:
  folkctl people list --limit 20
  folkctl people search "Ada Lovelace" --json
  folkctl people create --first-name Ada --last-name Lovelace --email ada@example.com --group-id grp_...
  folkctl companies list --filter name:like:OpenAI --json
  folkctl groups fields grp_... person
  folkctl deals list --group-id grp_... --object-type Deals
  folkctl notes create --entity-id per_... --content "Met at SaaStr." --visibility private
  folkctl tasks list --only-assigned-to-me --empty completedAt
  folkctl interactions past --entity-id per_... --all --json
  folkctl mcp config codex
  folkctl api docs people.create
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
  --custom grp_...\.Status=Active

Search/filter:
  folkctl people search "Ada Lovelace"
  --filter fullName:like:Ada --filter groups:in:id:grp_... --combinator or
`,
    companies: `Company fields:
  --name "Acme Inc" --email hello@acme.com --url https://acme.com
  --group-id grp_... --custom grp_...\.Stage=Lead

Search/filter:
  folkctl companies search "Acme"
  --filter name:like:Acme --filter groups:in:id:grp_... --combinator or
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
  --filter dueAt:lt:2026-09-30 --filter assigneeUserId:in:usr_...
  --entity-id maps to filter[entity][in]; text search is not supported.

Completion:
  folkctl tasks done <taskId> --completed-at <ISO timestamp> [--dry-run]
  folkctl tasks todo <taskId> [--dry-run]
  done/todo also accept mark-as-done/mark-as-todo. Completion changes use separate POST endpoints.
`,
    reminders: `Reminder fields:
  --entity-id per_... --name "Follow up" --recurrence-rule "DTSTART...\nRRULE:FREQ=WEEKLY"
  --assigned-user-id usr_... --assigned-user-email jane@example.com

${REMINDERS_DEPRECATION}
Migration: https://developer.folk.app/migrations/reminders-to-tasks
`,
    webhooks: `Webhook fields:
  --name "My app" --target-url https://example.com/webhook
  --event person.created --event company.updated:grp_...
`,
  };
  return `${common}\n${extras[resource] || ''}`;
}

export function dealsHelp(resource = 'deals') {
  return `Usage:
  folkctl ${resource} list --group-id grp_... --object-type Deals [--limit n] [--all]
  folkctl ${resource} search "Project Alpha" --group-id grp_... --object-type Deals
  folkctl ${resource} get <id> --group-id grp_... --object-type Deals
  folkctl ${resource} create --group-id grp_... --object-type Deals --name "Project Alpha"
  folkctl ${resource} update <id> --group-id grp_... --object-type Deals --custom Status=Won
  folkctl ${resource} delete <id> --group-id grp_... --object-type Deals --yes

Deals and custom objects share /v1/groups/{groupId}/{objectType}. Use the exact custom object name, e.g. Deals or Projects, discovered from group custom fields.
Positional paths are also supported: ${resource} list <groupId> <objectType>, ${resource} search <groupId> <objectType> <terms>.
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
Removing members or custom field options requires confirmation. Removing options also removes associated contact data.
--visibility filters the retrieved groups locally as well as forwarding the API parameter. Use --all to inspect every page.
`;
}

export function interactionsHelp() {
  return `Usage:
  folkctl interactions past --entity-id <entityId> [--limit n] [--all]
  folkctl interactions upcoming --entity-id <entityId> [--all]
  folkctl interactions get <interactionId> --entity-id <entityId>
  folkctl interactions create --entity-id per_... --date-time <ISO timestamp> --title "Coffee" --content "Notes" --activity-type coffee [--dry-run]
  folkctl interactions update <interactionId> --entity-id per_... --title "Updated title" [--dry-run]
  folkctl interactions delete <interactionId> --entity-id per_... [--yes] [--dry-run]

History and editing endpoints are in open beta. list is an alias for past.
Reads require the linked person, company, or object ID. Only logged interactions can be updated or deleted; imported email/calendar/WhatsApp interactions follow Folk's privacy rules.
Use --activity-type for predefined activities, messaging apps, or emoji. The legacy --type flag maps to activityType.
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
  folkctl api docs people.create
  folkctl api request GET /v1/users/me --json
  folkctl api request POST /v1/people --data '{"firstName":"Ada","lastName":"Lovelace"}' --dry-run
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
