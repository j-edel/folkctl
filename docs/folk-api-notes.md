# folk API notes used by this implementation

These notes are intentionally short and source-oriented so maintainers can update endpoint wrappers quickly.

## Core protocol

- Base URL: `https://api.folk.app`
- Authentication: `Authorization: Bearer <api-key>`
- Version header: `X-API-Version: <date>`
- Request/response format: JSON over HTTPS
- Pagination: list endpoints use `limit`, `cursor`, and `data.pagination.nextLink`
- Rate limits: honor `Retry-After` on `429`, and retry temporary `500`/`503` responses with backoff

## Endpoint map

| Key | Method/path | Notes |
| --- | --- | --- |
| `people.list` | `GET /v1/people` | Supports pagination and filtering |
| `people.create` | `POST /v1/people` | Names, emails, phones, URLs, groups, companies, grouped custom fields |
| `people.get` | `GET /v1/people/{personId}` | Person details |
| `people.update` | `PATCH /v1/people/{personId}` | Partial update |
| `people.delete` | `DELETE /v1/people/{personId}` | Destructive |
| `companies.*` | `/v1/companies` | Same list/get/create/update/delete shape as people |
| `groups.list` | `GET /v1/groups` | Workspace groups |
| `groups.fields` | `GET /v1/groups/{groupId}/custom-fields/{entityType}` | `entityType` is `person`, `company`, or custom object name |
| `deals.*` | `/v1/groups/{groupId}/{objectType}` | `objectType` is a deal custom-field/object name such as `Deals` |
| `users.list` | `GET /v1/users` | Workspace users |
| `users.me` | `GET /v1/users/me` | Current user |
| `notes.*` | `/v1/notes` | Markdown notes linked to people/companies |
| `reminders.*` | `/v1/reminders` | Uses `name`, `entity`, `recurrenceRule`, `assignedUsers` |
| `interactions.create` | `POST /v1/interactions` | Uses `entity`, `dateTime`, `title`, `content`, `type` |
| `webhooks.*` | `/v1/webhooks` | Uses `name`, `targetUrl`, `subscribedEvents` |

## Source URLs

- https://developer.folk.app/api-reference/overview
- https://developer.folk.app/api-reference/authentication
- https://developer.folk.app/api-reference/versioning
- https://developer.folk.app/api-reference/pagination
- https://developer.folk.app/api-reference/filtering
- https://developer.folk.app/api-reference/rate-limits
- https://developer.folk.app/api-reference/people/list-people
- https://developer.folk.app/api-reference/people/create-a-person
- https://developer.folk.app/api-reference/deals/list-deals
- https://developer.folk.app/api-reference/groups/list-group-custom-fields
- https://developer.folk.app/api-reference/reminders/create-a-reminder
- https://developer.folk.app/api-reference/interactions/create-an-interaction
- https://developer.folk.app/api-reference/webhooks/create-a-webhook
