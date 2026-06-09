import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { parseFlagArgs } from '../src/args.js';
import { buildPersonBody, buildDealBody, buildWebhookBody, buildInteractionBody, buildReminderBody, buildGenericBody } from '../src/body.js';

test('builds a person body from ergonomic flags', async () => {
  const { flags } = parseFlagArgs(['--first-name', 'Ada', '--last-name', 'Lovelace', '--email', 'ada@example.com', '--group-id', 'grp_123', '--custom', 'grp_123.Status=Active']);
  assert.deepEqual(await buildPersonBody(flags), {
    firstName: 'Ada',
    lastName: 'Lovelace',
    emails: ['ada@example.com'],
    groups: [{ id: 'grp_123' }],
    customFieldValues: { grp_123: { Status: 'Active' } },
  });
});

test('builds deal, reminder, interaction, and webhook bodies from documented shapes', async () => {
  const deal = await buildDealBody(parseFlagArgs(['--name', 'Project Alpha', '--company-id', 'com_123', '--person-id', 'per_123', '--custom', 'Status=Active']).flags);
  assert.equal(deal.customFieldValues.Status, 'Active');
  assert.deepEqual(deal.companies, [{ id: 'com_123' }]);

  const reminder = await buildReminderBody(parseFlagArgs(['--entity-id', 'per_123', '--name', 'Follow up', '--recurrence-rule', 'RRULE:FREQ=WEEKLY', '--assigned-user-email', 'jane@example.com']).flags);
  assert.deepEqual(reminder.assignedUsers, [{ email: 'jane@example.com' }]);

  const interaction = await buildInteractionBody(parseFlagArgs(['--entity-id', 'per_123', '--date-time', '2025-07-17T09:00:00.000Z', '--title', 'Coffee', '--content', 'Discussed project', '--type', '☕️']).flags);
  assert.equal(interaction.dateTime, '2025-07-17T09:00:00.000Z');

  const webhook = await buildWebhookBody(parseFlagArgs(['--name', 'My app', '--target-url', 'https://example.com/hook', '--event', 'person.created:grp_123']).flags);
  assert.deepEqual(webhook.subscribedEvents, [{ eventType: 'person.created', filter: { groupId: 'grp_123' } }]);
});

test('converts escaped newlines in reminder recurrence rules', async () => {
  const reminder = await buildReminderBody(parseFlagArgs(['--name', 'Follow up', '--recurrence-rule', 'DTSTART;TZID=Europe/Paris:20250717T090000\\nRRULE:FREQ=WEEKLY']).flags);
  assert.equal(reminder.recurrenceRule, 'DTSTART;TZID=Europe/Paris:20250717T090000\nRRULE:FREQ=WEEKLY');
});

test('preserves ergonomic string flags as strings', async () => {
  const person = await buildPersonBody(parseFlagArgs(['--first-name', 'true', '--last-name', '123', '--description', 'null']).flags);
  assert.deepEqual({
    firstName: person.firstName,
    lastName: person.lastName,
    description: person.description,
  }, {
    firstName: 'true',
    lastName: '123',
    description: 'null',
  });
});

test('reads --data - from stdin', async () => {
  const { flags } = parseFlagArgs(['--data', '-']);
  const stdin = Readable.from(['{"name":"Acme"}']);
  assert.deepEqual(await buildGenericBody(flags, stdin), { name: 'Acme' });
});
