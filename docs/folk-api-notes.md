# Folk API implementation notes

Reviewed against Folk's public developer documentation on **September 6, 2026**. The current published [OpenAPI document](https://developer.folk.app/schemas/2025-06-09.json) still identifies its API version as `2025-06-09`. The CLI retains that version header; a product update date is not a new API version.

## Protocol

- Base URL: `https://api.folk.app`
- Authentication: Bearer API key; separate OAuth authentication for [Folk MCP](mcp.md)
- JSON requests/responses, `X-API-Version`, and a package-version `User-Agent`
- List pagination: `limit`, `cursor`, and `data.pagination.nextLink`
- Read retries honor `Retry-After` for 429, 500, and 503 responses; mutations require an explicit retry opt-in
- Deprecation metadata: server `deprecations` stays in the response payload; `Deprecation` and `Sunset` headers are available in JSON response metadata

## Endpoint coverage

The CLI maps all **57 public operations** in that OpenAPI snapshot. `deals` and `objects` wrap the same five operations; the legacy `groups.fields` endpoint key aliases `groups.fields.list`. Internal search routes in the schema are intentionally excluded. Public filtering endpoints power CLI searches.

| Resource | Routes and additions |
| --- | --- |
| `people`, `companies` | CRUD under `/v1/people` and `/v1/companies`; person `gender` is editable and filterable |
| `deals`, `objects` | CRUD under `/v1/groups/{groupId}/{objectType}`; use the exact object type name |
| `groups` | List/create `/v1/groups`, update `/v1/groups/{groupId}` |
| `groups members` | List/add `/v1/groups/{groupId}/members`, update/remove `/{userId}` |
| `groups fields` | List/create `/v1/groups/{groupId}/custom-fields/{entityType}`, get/update `/{customFieldName}` |
| `users` | List/get/current user under `/v1/users` |
| `notes` | CRUD `/v1/notes`; content search through `query`, date bounds through `createdAfter`/`createdBefore` |
| `tasks` | CRUD `/v1/tasks`; completion through POST `/{taskId}/mark-as-done` and `/{taskId}/mark-as-todo` |
| `interactions` | Create `/v1/interactions`, history `/past` and `/upcoming`, get/update/delete `/{interactionId}` |
| `reminders` | Legacy CRUD `/v1/reminders`, deprecated in favor of Tasks |
| `webhooks` | CRUD `/v1/webhooks` |

`test/fixtures/folk-api-contract.json` records the source URL, retrieval date, SHA-256 of the fetched OpenAPI document, and its public operation paths/methods/required query parameters. Tests compare wrappers with this independent snapshot. Update the fixture from the authoritative schema when revising API coverage; do not regenerate it from `src/endpoints.js`.

## Contract details

- Tasks use `title`, `dueAt` (`YYYY-MM-DD`), optional `dueTime` (`HH:mm`), markdown `description`, `recurrenceFrequency`, `assignedUsers`, `entity`, and boolean `isPublic`. Public visibility is the API default. Optional time/recurrence fields can be cleared with null.
- `tasks done` requires an explicit `completedAt` ISO timestamp. `tasks todo` sends a POST without a body. `completedAt` is not a task PATCH field.
- Task entity filters use `filter[entity][in]`, while note/reminder/interaction scoping uses `entity.id`. Task title text search is not documented.
- Interaction past/upcoming/get/delete require the entity query parameter. Interaction update requires `entity.id` in the body. History/editing endpoints are in open beta; only logged interactions can be updated/deleted. Imported content is subject to privacy rules.
- Logged interactions use `activityType`. Creation still accepts deprecated raw `type`; the CLI's `--type` flag now produces `activityType`, including on updates.
- Group custom fields use the field's **name** in the URL. Options/config pass through `--data`; option changes use `addOptions`, `updateOptions`, and `removeOptions`. Removing options also removes associated contact data and therefore requires confirmation in the wrapper.
- Groups/members/custom fields have only the operations listed above. There is no public group GET/delete or custom field delete route.

## Documentation discrepancies

The published [changelog](https://developer.folk.app/changelog) and [reminder endpoint reference](https://developer.folk.app/api-reference/reminders/list-reminders) give a **February 13, 2027** sunset. The [migration guide](https://developer.folk.app/migrations/reminders-to-tasks) currently says **February 11, 2027**, and one completion example uses `/mark-done` rather than `/mark-as-done`. The CLI follows the OpenAPI document and dedicated completion endpoint pages. Plan reminder migration before the earlier date, and inspect the live `Sunset` header for the server's announcement.

The August 7 changelog announces group-list `visibility`, but the current OpenAPI parameter list omits it. A read-only check on September 6 returned public groups for `visibility=private`. `groups list --visibility` therefore filters returned groups locally as well as forwarding the announced parameter. The filter applies only to retrieved pages; use `--all` for the complete set. JSON output includes `clientFilter`, and pagination links remain available when more pages exist.

Read-only checks on September 6 also confirmed successful current-user, Tasks list, note search, reminder list, group membership/custom-field list, past/upcoming interaction list, and interaction detail responses using version `2025-06-09`. The live reminder `Sunset` header was `Sat, 13 Feb 2027 00:00:00 GMT`. Mutations were checked offline with dry-runs and mocked responses; no live records were created, updated, or deleted during validation. MCP configuration output was checked offline; no OAuth session or live MCP tool invocation was tested.

## Primary references

- [Documentation index](https://developer.folk.app/llms.txt), [OpenAPI](https://developer.folk.app/schemas/2025-06-09.json), [changelog](https://developer.folk.app/changelog)
- [Versioning and deprecation](https://developer.folk.app/api-reference/versioning), [filtering](https://developer.folk.app/api-reference/filtering), [pagination](https://developer.folk.app/api-reference/pagination)
- [Create a task](https://developer.folk.app/api-reference/tasks/create-a-task), [mark done](https://developer.folk.app/api-reference/tasks/mark-a-task-as-done), [mark to do](https://developer.folk.app/api-reference/tasks/mark-a-task-as-to-do)
- [Past interactions](https://developer.folk.app/api-reference/interactions/list-past-interactions), [update interaction](https://developer.folk.app/api-reference/interactions/update-an-interaction)
- [Custom objects](https://developer.folk.app/api-reference/custom-objects/overview), [group custom fields](https://developer.folk.app/api-reference/group-custom-fields/update-a-group-custom-field), [group members](https://developer.folk.app/api-reference/group-members/list-group-members)
- [MCP connection](https://developer.folk.app/mcp/connect), [supported MCP tools](https://developer.folk.app/mcp/tools)
