# Folk API implementation notes

Reviewed against Folk's public developer documentation on **October 22, 2026**, covering changelog entries through October 21. The published [OpenAPI document](https://developer.folk.app/schemas/2025-06-09.json) still identifies its API version as `2025-06-09`: the changes since the September 6 review are additive or deprecations, so the CLI keeps that version header.

## Protocol

- Base URL: `https://api.folk.app`
- Authentication: Bearer API key; separate OAuth authentication for [Folk MCP](mcp.md)
- JSON requests/responses, `X-API-Version`, and a package-version `User-Agent`
- List pagination: `limit`, `cursor`, and `data.pagination.nextLink`
- Idempotency: every `POST`, `PATCH`, `PUT`, and `DELETE` sends an `Idempotency-Key` (see below)
- Rate limits: a `default` policy of 600 requests per minute and a `burst` policy of 20 requests per 2 seconds, both per user
- Deprecation metadata: the server's `deprecations` array stays in the response payload and is printed to stderr; `Deprecation` and `Sunset` headers are in `response.deprecation` and `response.sunset`

## Endpoint coverage

The CLI maps all **71 public operations** in the October 22 OpenAPI snapshot, 14 more than on September 6. `deals` and `objects` wrap the same eight operations; the legacy `groups.fields` endpoint key aliases `groups.fields.list`. Internal search routes (`x-excluded` in the schema) are intentionally excluded. Public filtering endpoints power CLI searches.

| Resource | Routes and additions |
| --- | --- |
| `people`, `companies` | CRUD under `/v1/people` and `/v1/companies`; `POST /batch/create`, `/batch/update`, `/batch/delete` (new); person `gender` is editable and filterable |
| `deals`, `objects` | CRUD and `POST /batch/{create,update,delete}` (new) under `/v1/groups/{groupId}/{objectType}`; use the exact object type name |
| `groups` | List/create `/v1/groups`, update `/v1/groups/{groupId}` |
| `groups members` | List/add `/v1/groups/{groupId}/members`, update/remove `/{userId}` |
| `groups fields` | List/create `/v1/groups/{groupId}/custom-fields/{entityType}`, get/update `/{customFieldName}` |
| `users` | List/get/current user under `/v1/users` |
| `notes` | CRUD `/v1/notes`; content search through `query`, date bounds through `createdAfter`/`createdBefore` |
| `tasks` | CRUD `/v1/tasks`; completion through POST `/{taskId}/mark-as-done` and `/{taskId}/mark-as-todo` |
| `enrichments` (new) | List/create `/v1/person-enrichments`, get `/{enrichmentId}` |
| `credits` (new) | Get `/v1/credits` |
| `interactions` | List `/v1/interactions` (new), create `/v1/interactions`, get/update/delete `/{interactionId}`; `/past` and `/upcoming` are deprecated |
| `reminders` | Legacy CRUD `/v1/reminders`, deprecated in favor of Tasks |
| `webhooks` | CRUD `/v1/webhooks`; new event type `person_enrichment.finished` |

`test/fixtures/folk-api-contract.json` records the source URL, retrieval date, SHA-256 of the fetched OpenAPI document, and each public operation's method, path, required query parameters, and deprecated or beta status. Tests compare the CLI's wrappers and markers with this independent snapshot. Regenerate it with `node scripts/openapi-snapshot.mjs > test/fixtures/folk-api-contract.json` and review the diff; do not generate it from `src/endpoints.js`.

The schema also marks many operations `x-stability-level: alpha`, including long-standing ones such as Tasks and group custom fields. The public reference does not present them as alpha, so the CLI does not surface that marker. It does surface the public "Beta" tag of the interaction history endpoints.

## Idempotency and retries

- Folk accepts an `Idempotency-Key` of 1 to 255 printable ASCII characters without spaces on any write. The first request with a key runs; a later request with the same key and body replays the stored response, with `Idempotent-Replayed: true` (exposed as `response.idempotentReplayed`). Keys are scoped to the user and workspace and kept for 24 hours.
- The CLI generates a UUID per command and reuses it for that command's retries. `--idempotency-key` sets the key, which lets a person or agent re-run a command whose outcome is unknown, for example after a network error, without running the write twice. `--no-idempotency-key` omits it.
- Following Folk's retry guidance, keyed writes retry network errors and 409 (`IDEMPOTENCY_REQUEST_IN_PROGRESS`), 502, 503 (including `IDEMPOTENCY_UNAVAILABLE`), and 504. They do not retry a 500: Folk stores it for the key, so a retry would return it again. Reads also retry 500. Every request retries 429, which Folk rejects before running.
- Reusing a key for a different request fails with `IDEMPOTENCY_KEY_REUSED`. A response larger than 1 MiB is not stored, and a retry fails with `IDEMPOTENCY_RESPONSE_NOT_STORED`: the write already ran. The CLI prints a recovery hint for each idempotency error.

## Rate limits

- Responses carry the IETF `RateLimit-Policy` and `RateLimit` headers, for example `"default";q=600;w=60, "burst";q=20;w=2`, plus legacy `X-RateLimit-*` headers and `X-RateLimit-*-Burst` variants. The CLI parses both into `response.rateLimit`.
- Windows are fixed and aligned to the clock. `--all` pagination and `--wait` polling pause until the window resets when a policy reports `r=0`.
- A 429 includes `Retry-After`, and its `error.details` names the exceeded `policy`, with `windowSeconds`, `retryAfter`, and a `policies` list. The CLI waits for `Retry-After`, capped at the 60-second default window, and reports the exhausted policy if retries run out.

## Batch requests

- A batch is `POST .../batch/{create|update|delete}` with `{"records": [...]}`, up to 100 records. Each record succeeds or fails on its own; the response is `200` with one entry in `data.results` per record, in request order, with `status` `succeeded` or `failed`. Results can carry `warnings`, `removedGroups` (people and company updates), and `operation` (`created` or `updated`, company creates).
- The whole request fails for authentication, rate limiting, invalid JSON, more than 100 records, or a malformed record (`422` with `error.details.issues` paths such as `["records", 3, "id"]`). The CLI checks the record count, record shape, and IDs before sending.
- On people and companies, batch create adds `groups`, but batch update and single update replace them: a group left out is removed, with the record's custom field values in that group. The CLI asks for confirmation before a batch update that sets `groups`, and warns on single updates.
- List fields also replace on update: `emails`, `phones`, `urls`, `addresses`, and person `companies`, and object `people` and `companies`. The CLI warns when a batch update sets one.
- The shared `customFieldValues` description says each group ID in it "must also be provided in the `groups` field". On update that would force sending `groups`, which replaces them. Folk's own batch update examples set `customFieldValues` without `groups`, and its MCP docs state the rule for create only, so the CLI treats it as a create rule: on update, set the custom fields of groups a record is already in without sending `groups`.
- Company batch create matches existing companies by name, like single create. Object batch create never matches existing objects, so a retried batch creates duplicates unless it reuses the idempotency key. People and companies on objects are given by ID and must already be in the group; on object updates, `people` and `companies` replace the lists.
- An object type that does not exist in the group fails a batch with `404`, listing the group's object types. If the API key cannot access the group, the batch succeeds and every record fails with `FORBIDDEN`.
- The CLI exits with code 5 when any record fails, prints `<resource> batch <action>: N records, N succeeded, N failed` on stderr, and adds a `batch` summary to JSON output.

## Person enrichments and credits

- `POST /v1/person-enrichments` takes `fields` (`emails`, `phones`, or both) and up to 500 person `ids`, and answers `202` with a `pending` enrichment, or a `completed` one when every ID is skipped. Statuses are `pending`, `in_progress`, `completed`, and `failed` (`errorReason` `insufficient_credits` or `internal_error`). New values may appear; the CLI treats any status other than pending or in progress as final.
- A completed enrichment has a `summary` and per-person `items` with `enriched`, `partially_enriched`, `not_enriched`, `skipped`, or `error`, plus `enrichedFields` and `missingInputs`. Found data is saved on the person.
- Enrichment uses workspace credits per person and field found. Folk rejects a request with `402 INSUFFICIENT_CREDITS` when the workspace cannot cover the maximum cost; nothing is performed or charged. `GET /v1/credits` lists `used` and `limit` per metered feature for the current period (`limit` is null when unlimited) and needs the contributor role.
- `GET /v1/person-enrichments` returns at most 10 enrichments per page (`limit` above 10 is a `422`). Filters: `status` (`eq`, `not_eq`, `in`, `not_in`), `createdAt` (`gt`, `lt`), `finishedAt` (`empty`, `not_empty`, `gt`, `lt`).
- The `person_enrichment.finished` webhook event fires when an enrichment completes or fails, with no filters. Its payload has the status, not the per-person results.
- The CLI deduplicates IDs, asks for confirmation before spending credits, and validates `--wait` options before the request.

## Interactions

- `GET /v1/interactions` requires `entity.id` and `timeframe` (`past` or `upcoming`). `importedTypes` (`email`, `calendar`, `whatsapp`, `call`) and `user.id` repeat for several values. Without `importedTypes`, every imported type is returned; an empty `importedTypes=` returns logged interactions only. `importedTypes` never removes logged interactions, but `user.id` does: a live check on October 22 returned no interactions for a user who had not logged the entity's only (logged) interaction.
- `GET /v1/interactions/past` and `/upcoming` are deprecated since September 29, 2026 and return `Deprecation: Tue, 29 Sep 2026` and `Sunset: Mon, 29 Mar 2027` headers. `interactions past|upcoming|list` use the new route; the `interactions.past` and `interactions.upcoming` keys remain in `api docs` for reference.
- Calls from the folk mobile app appear as `call` interactions with a duration, a summary when processed, and `content.status` (`ongoing`, `processing`, `completed`, `missed`, `failed`). Participants carry `name`, `picture`, and `userId` when they match a workspace member. New interaction types are additive changes; the CLI passes them through.
- Interaction get/delete require the entity query parameter, and update requires `entity.id` in the body. History and editing are in open beta; only logged interactions can be updated or deleted, and imported content follows workspace privacy rules. Logged interactions use `activityType`; creation still accepts the deprecated raw `type`, and the CLI's `--type` flag produces `activityType`.

## Custom fields and objects

- Group custom fields use the field's **name** in the URL. Options/config pass through `--data`; option changes use `addOptions`, `updateOptions`, and `removeOptions`. Removing options also removes associated contact data and therefore requires confirmation in the wrapper.
- Since October 21, creating a `contactField` or `objectField` on an object type is rejected with `422`, and so is writing a value to a `contactField` created on an object type earlier. Creating an object type (an `objectField` on `person` or `company`) also creates a `Status` single-select field with `Lead`, `Qualified`, `Proposal sent`, `Closed-won`, and `Closed-lost`.
- Select option labels are case-sensitive: writing an unknown label creates a new option, and filtering on one matches nothing.
- Errors on object custom field values use the input path (`customFieldValues.<name>`), and errors on an unknown custom field or filter attribute list the valid names. The CLI prints these issue paths without `--verbose`.
- Object get, update, and delete answer `404` for an object of another type in the same group (delete since October 5, update since October 7). Since October 6, an object is created together with its people and companies, and creation fails as a whole if linking fails.
- Deals are custom objects whose object type is `Deals`. On October 15, Folk merged the Deals reference into Custom objects without an API change; operation IDs such as `listDeals` are unchanged.
- Groups/members/custom fields have only the operations listed above. There is no public group GET/delete or custom field delete route.

## Tasks

- Tasks use `title`, `dueAt` (`YYYY-MM-DD`), optional `dueTime` (`HH:mm`), markdown `description`, `recurrenceFrequency`, `assignedUsers`, `entity`, and boolean `isPublic`. Public visibility is the API default. Optional time/recurrence fields can be cleared with null.
- `tasks done` requires an explicit `completedAt` ISO timestamp. `tasks todo` sends a POST without a body. `completedAt` is not a task PATCH field.
- Task entity filters use `filter[entity][in]`, while note/reminder/interaction scoping uses `entity.id`. Task filters also accept `createdAt` (`gt`, `lt`). Task title text search is not documented.

## Documentation discrepancies

The published [changelog](https://developer.folk.app/changelog) and [reminder endpoint reference](https://developer.folk.app/api-reference/reminders/list-reminders) give a **February 13, 2027** sunset. The [migration guide](https://developer.folk.app/migrations/reminders-to-tasks) still says **February 11, 2027** on October 22, and one completion example still uses `/mark-done` rather than `/mark-as-done`. The CLI follows the OpenAPI document and dedicated completion endpoint pages. Plan reminder migration before the earlier date, and inspect the live `Sunset` header for the server's announcement.

The August 7 changelog announces group-list `visibility`, but the OpenAPI parameter list still omits it. Read-only checks on September 6 and October 22 returned public groups for `visibility=private`. `groups list --visibility` therefore filters returned groups locally as well as forwarding the announced parameter. The filter applies only to retrieved pages; use `--all` for the complete set. JSON output includes `clientFilter`, and pagination links remain available when more pages exist.

The interaction list routes accept a `limit` parameter without error, but the schema does not document one. The CLI does not advertise `--limit` for interactions.

## Live checks

Read-only checks on October 22 with version `2025-06-09` confirmed: current user with both rate limit header formats, `credits` (five metered features), `enrichments list` and its `limit` validation error, `interactions past`, `upcoming`, and `list` on `GET /v1/interactions` with `--logged-only`, `--imported-type`, and `--user-id`, the `422` for an invalid `timeframe`, deprecation headers on `/v1/interactions/past` (`Sunset: Mon, 29 Mar 2027 00:00:00 GMT`), multi-page `--all`, and a task `createdAt` filter.

Writes were checked offline with dry-runs and mocked responses, including batch results, enrichment polling, retries, and idempotency keys. No live records were created, updated, or deleted, and no enrichment credits were spent. MCP configuration output was checked offline; no OAuth session or live MCP tool invocation was tested.

## Primary references

- [Documentation index](https://developer.folk.app/llms.txt), [OpenAPI](https://developer.folk.app/schemas/2025-06-09.json), [changelog](https://developer.folk.app/changelog)
- [Idempotency](https://developer.folk.app/api-reference/idempotency), [batch requests](https://developer.folk.app/api-reference/batch-requests), [rate limits](https://developer.folk.app/api-reference/rate-limits), [errors](https://developer.folk.app/api-reference/errors), [success responses](https://developer.folk.app/api-reference/success-responses)
- [Versioning and deprecation](https://developer.folk.app/api-reference/versioning), [filtering](https://developer.folk.app/api-reference/filtering), [pagination](https://developer.folk.app/api-reference/pagination)
- [Person enrichments](https://developer.folk.app/core-concepts/person-enrichments), [enrich people](https://developer.folk.app/api-reference/person-enrichments/enrich-people), [get credits](https://developer.folk.app/api-reference/credits/get-credits)
- [List interactions](https://developer.folk.app/api-reference/interactions/list-interactions), [update interaction](https://developer.folk.app/api-reference/interactions/update-an-interaction)
- [Create people in batch](https://developer.folk.app/api-reference/people/create-people-in-batch), [update people in batch](https://developer.folk.app/api-reference/people/update-people-in-batch), [create objects in batch](https://developer.folk.app/api-reference/custom-objects/create-objects-in-batch)
- [Create a task](https://developer.folk.app/api-reference/tasks/create-a-task), [mark done](https://developer.folk.app/api-reference/tasks/mark-a-task-as-done), [mark to do](https://developer.folk.app/api-reference/tasks/mark-a-task-as-to-do)
- [Custom objects](https://developer.folk.app/core-concepts/custom-objects), [custom fields](https://developer.folk.app/core-concepts/custom-fields), [group members](https://developer.folk.app/api-reference/group-members/list-group-members)
- [Webhook events](https://developer.folk.app/webhooks/events-and-payloads), [MCP connection](https://developer.folk.app/mcp/connect), [supported MCP tools](https://developer.folk.app/mcp/tools)
