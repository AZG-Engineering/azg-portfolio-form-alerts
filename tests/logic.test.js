// Tests for Logic.gs: the decisions, with no Google services involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const { OWNER, FORM_HEADERS, loadScript, makeWorld, sampleResponses } = require('./helpers');

const app = loadScript(makeWorld().globals);
const HEADERS = [...FORM_HEADERS, 'Status', 'Assigned To', 'Last Updated'];
const ROUTING = [['IT', 'Jordan M.', 'jordan@example.com'], ['Facilities', 'Casey L.', ''], ['Supplies', 'Taylor R.', '']];
const SHEET_URL = 'https://sheet.example.com/demo';
const NOW = new Date(Date.UTC(2026, 9, 1, 8, 0, 0)); // 1 Oct 2026, 08:00

function record(overrides = {}) {
  return {
    row: 7,
    timestamp: new Date(Date.UTC(2026, 8, 22, 15, 47, 51)),
    name: 'Jamie W.',
    location: 'Shop floor',
    type: 'IT',
    priority: 'Urgent',
    details: 'Label printer at station 3 prints blank labels',
    status: '',
    assignedTo: '',
    ...overrides,
  };
}

/** The 15 sample responses as records, with a Status and assignee on each. */
function sampleRecords(statuses) {
  const [headers, ...rows] = sampleResponses();
  return rows.map((values, i) => {
    const rec = app.rowToRecord(headers, values, i + 2, app.COLUMNS);
    const assignee = app.findAssignee(ROUTING, rec.type);
    return { ...rec, status: statuses[i] || 'New', assignedTo: assignee ? assignee.name : '' };
  });
}

test('columnIndexes finds each column whatever the order, case or spacing', () => {
  const shuffled = ['Priority', ' your name ', 'Timestamp', 'STATUS', 'Request type'];
  const indexes = app.columnIndexes(shuffled, app.COLUMNS);
  assert.equal(indexes.priority, 0);
  assert.equal(indexes.name, 1);
  assert.equal(indexes.timestamp, 2);
  assert.equal(indexes.status, 3);
  assert.equal(indexes.type, 4);
  assert.equal(indexes.details, -1);
});

test('missingColumns names the script columns the sheet does not have yet', () => {
  assert.deepEqual(app.missingColumns(FORM_HEADERS, app.COLUMNS, app.MANAGED_COLUMNS), ['Status', 'Assigned To', 'Last Updated']);
  assert.deepEqual(app.missingColumns(HEADERS, app.COLUMNS, app.MANAGED_COLUMNS), []);
});

test('rowToRecord reads a sheet row into named fields and trims them', () => {
  const values = [NOW, ' Riley P. ', 'Front office', 'IT', 'Normal', 'Printer is offline', 'New', 'Jordan M.', NOW];
  assert.deepEqual(app.rowToRecord(HEADERS, values, 2, app.COLUMNS), {
    row: 2,
    timestamp: NOW,
    name: 'Riley P.',
    location: 'Front office',
    type: 'IT',
    priority: 'Normal',
    details: 'Printer is offline',
    status: 'New',
    assignedTo: 'Jordan M.',
  });
});

test('findAssignee matches the request type without caring about case or spaces', () => {
  assert.deepEqual(app.findAssignee(ROUTING, ' facilities '), { name: 'Casey L.', email: '' });
  assert.deepEqual(app.findAssignee(ROUTING, 'IT'), { name: 'Jordan M.', email: 'jordan@example.com' });
});

test('findAssignee returns nothing for an unknown or blank request type', () => {
  assert.equal(app.findAssignee(ROUTING, 'Payroll'), null);
  assert.equal(app.findAssignee(ROUTING, ''), null);
  assert.equal(app.findAssignee([['', 'Nobody', '']], ''), null);
  assert.equal(app.findAssignee([], 'IT'), null);
});

test('in demo mode every alert goes to the sheet owner, even when an address is on file', () => {
  assert.deepEqual(app.resolveRecipient(true, OWNER, { name: 'Jordan M.', email: 'jordan@example.com' }), {
    to: OWNER,
    sentTo: 'the sheet owner (demo mode)',
    note: 'Demo mode: the alert for Jordan M. was sent to the sheet owner instead.',
  });
});

test('outside demo mode an alert goes to the assignee when there is an address', () => {
  assert.deepEqual(app.resolveRecipient(false, OWNER, { name: 'Jordan M.', email: 'jordan@example.com' }),
    { to: 'jordan@example.com', sentTo: 'the assignee', note: '' });
});

test('outside demo mode an alert falls back to the owner when there is no address or no assignee', () => {
  assert.deepEqual(app.resolveRecipient(false, OWNER, { name: 'Casey L.', email: '' }), {
    to: OWNER,
    sentTo: 'the sheet owner (no address on the Routing tab)',
    note: 'No email address on the Routing tab for Casey L., so this came to the sheet owner.',
  });
  const nobody = app.resolveRecipient(false, OWNER, null);
  assert.equal(nobody.to, OWNER);
  assert.match(nobody.note, /for nobody \(no routing rule\), so this came to the sheet owner\./);
});

test('the alert email carries the request and says where to update it', () => {
  const assignee = { name: 'Jordan M.', email: '' };
  const email = app.buildAlertEmail(record(), assignee, { to: OWNER, note: '' }, SHEET_URL, 'Tue 22 Sep 2026, 3:47 PM');
  assert.equal(email.to, OWNER);
  assert.equal(email.subject, 'URGENT: New IT request from Jamie W.');
  assert.equal(email.body, [
    'A new request came in.',
    '',
    'Assigned to: Jordan M.',
    'Type:        IT',
    'Priority:    Urgent',
    'From:        Jamie W.',
    'Location:    Shop floor',
    'Submitted:   Tue 22 Sep 2026, 3:47 PM',
    '',
    'What they need:',
    '  Label printer at station 3 prints blank labels',
    '',
    'Its Status is now "New". Change the Status cell in row 7 as the work moves along.',
    '',
    'Open the sheet: https://sheet.example.com/demo',
  ].join('\n'));
});

test('a non-urgent alert has a plain subject, and the demo note leads the body', () => {
  const recipient = app.resolveRecipient(true, OWNER, null);
  const email = app.buildAlertEmail(record({ priority: 'Low', type: 'Payroll' }), null, recipient, SHEET_URL, 'x');
  assert.equal(email.subject, 'New Payroll request from Jamie W.');
  assert.ok(email.body.startsWith('Demo mode: the alert for nobody (no routing rule) was sent to the sheet owner instead.\n\nA new request came in.'));
  assert.match(email.body, /^Assigned to: nobody yet \(no routing rule for this request type\)$/m);
});

test('no message doubles the full stop after a name that ends in one', () => {
  const assignee = { name: 'Jordan M.', email: '' };
  const texts = [
    app.resolveRecipient(true, OWNER, assignee).note,
    app.resolveRecipient(false, OWNER, assignee).note,
    app.buildAlertEmail(record(), assignee, app.resolveRecipient(true, OWNER, assignee), SHEET_URL, 'x').body,
    app.buildSummaryEmail([record({ assignedTo: 'Jordan M.' })], NOW, 'today', OWNER, SHEET_URL).body,
    app.statusChangeMessage(record(), 'New', 'Done'),
  ];
  for (const text of texts) assert.doesNotMatch(text, /\.\./);
});

test('a request is open until its Status is Done; a blank Status is open', () => {
  assert.equal(app.isOpen(record({ status: '' })), true);
  assert.equal(app.isOpen(record({ status: 'New' })), true);
  assert.equal(app.isOpen(record({ status: 'Waiting' })), true);
  assert.equal(app.isOpen(record({ status: ' done ' })), false);
});

test('openItems leaves out finished requests and empty rows', () => {
  const empty = { row: 9, timestamp: '', name: '', location: '', type: '', priority: '', details: '', status: '', assignedTo: '' };
  const open = app.openItems([record({ row: 2 }), record({ row: 3, status: 'Done' }), empty]);
  assert.deepEqual(open.map((r) => r.row), [2]);
});

test('ageInDays counts whole days and copes with a missing timestamp', () => {
  assert.equal(app.ageInDays(new Date(Date.UTC(2026, 8, 22, 15, 47, 51)), NOW), 8);
  assert.equal(app.ageInDays(new Date(Date.UTC(2026, 9, 1, 7, 0, 0)), NOW), 0);
  assert.equal(app.ageInDays(new Date(Date.UTC(2026, 9, 2, 7, 0, 0)), NOW), 0);
  assert.equal(app.ageInDays('', NOW), null);
});

test('the daily summary of the sample data lists only open requests, grouped by assignee', () => {
  // Rows 2-16. Mark four as Done; the other eleven stay open.
  const statuses = ['Done', 'In progress', 'Done', 'New', 'Waiting', 'New', 'Done', 'New', 'New', 'In progress', 'New', 'Done', 'New', 'New', 'New'];
  const email = app.buildSummaryEmail(sampleRecords(statuses), NOW, 'Thu 1 Oct 2026', OWNER, SHEET_URL);
  assert.equal(email.to, OWNER);
  assert.equal(email.subject, 'Open requests: 11 (3 urgent)');
  assert.equal(email.body, [
    'Open requests as of Thu 1 Oct 2026: 11 (3 urgent)',
    '',
    'Casey L. (5)',
    '  - Row 3 | URGENT | Facilities | Warehouse | from Morgan T. | 9 days old | Status: In progress',
    '      Dock door 2 will not close all the way',
    '  - Row 11 | URGENT | Facilities | Shop floor | from Avery K. | 6 days old | Status: In progress',
    '      Water on the floor near the compressor',
    '  - Row 6 | Low | Facilities | Front office | from Riley P. | 8 days old | Status: Waiting',
    '      Light over the reception desk flickers',
    '  - Row 9 | Normal | Facilities | Warehouse | from Morgan T. | 7 days old | Status: New',
    '      Pallet jack 4 leaks oil',
    '  - Row 14 | Normal | Facilities | Front office | from Drew H. | 2 days old | Status: New',
    '      Conference room thermostat stuck at 80',
    '',
    'Jordan M. (3)',
    '  - Row 7 | URGENT | IT | Shop floor | from Jamie W. | 8 days old | Status: New',
    '      Label printer at station 3 prints blank labels',
    '  - Row 12 | Low | IT | Warehouse | from Sam D. | 5 days old | Status: New',
    '      Barcode scanner battery does not last a shift',
    '  - Row 15 | Normal | IT | Shop floor | from Quinn B. | 1 day old | Status: New',
    '      Shared tablet will not charge',
    '',
    'Taylor R. (3)',
    '  - Row 5 | Normal | Supplies | Warehouse | from Sam D. | 9 days old | Status: New',
    '      Packing tape is down to the last case',
    '  - Row 10 | Normal | Supplies | Shop floor | from Quinn B. | 6 days old | Status: New',
    '      Safety glasses, 12 pairs',
    '  - Row 16 | Normal | Supplies | Front office | from Riley P. | today | Status: New',
    '      Printer paper, two cases',
    '',
    'Open the sheet: https://sheet.example.com/demo',
  ].join('\n'));
});

test('requests with no assignee are listed last, under Unassigned', () => {
  const records = [
    record({ row: 2, assignedTo: '', priority: 'Normal' }),
    record({ row: 3, assignedTo: 'Jordan M.', priority: 'Normal' }),
  ];
  const body = app.buildSummaryEmail(records, NOW, 'today', OWNER, SHEET_URL).body;
  assert.ok(body.indexOf('Jordan M. (1)') < body.indexOf('Unassigned (1)'));
});

test('the daily summary says so when nothing is open', () => {
  const email = app.buildSummaryEmail([record({ status: 'Done' })], NOW, 'Thu 1 Oct 2026', OWNER, SHEET_URL);
  assert.equal(email.subject, 'Open requests: none');
  assert.match(email.body, /Open requests as of Thu 1 Oct 2026: none\./);
  assert.match(email.body, /Nothing is waiting today\./);
});

test('a status change is written as before -> after, with blanks spelled out', () => {
  assert.equal(app.statusChangeMessage(record(), 'New', 'In progress'), 'Row 7 (IT, from Jamie W.): New -> In progress');
  assert.equal(app.statusChangeMessage(record(), undefined, 'Done'), 'Row 7 (IT, from Jamie W.): (blank) -> Done');
  assert.equal(app.statusChangeMessage(record(), 'Done', ''), 'Row 7 (IT, from Jamie W.): Done -> (blank)');
});

test('logRow and logRowsToTrim', () => {
  assert.deepEqual(app.logRow(NOW, 'setup', 'OK', ' done '), [NOW, 'setup', 'OK', 'done']);
  assert.equal(app.logRowsToTrim(1, 500), 0); // header only
  assert.equal(app.logRowsToTrim(501, 500), 0); // header + 500 entries
  assert.equal(app.logRowsToTrim(504, 500), 3);
});
