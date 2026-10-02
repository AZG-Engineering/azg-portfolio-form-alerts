// Tests for Code.gs: the triggers, run against a fake spreadsheet and fake mail.

const test = require('node:test');
const assert = require('node:assert/strict');
const { OWNER, FORM_HEADERS, RESPONSES, loadScript, makeWorld, sampleResponses } = require('./helpers');

const ROUTING_HEADER = ['Request type', 'Assignee', 'Email (used only when DEMO_MODE is false)'];

/** A sheet with `count` sample responses, set up and ready for triggers. */
function readyWorld(count, options = {}) {
  const world = makeWorld({ responses: sampleResponses(count), routing: options.routing });
  const app = loadScript(world.globals, options);
  app.setup();
  return { world, app };
}

/** What Google passes to the form-submit trigger for the response in `row`. */
function submitEvent(world, row) {
  return { range: world.sheet(RESPONSES).getRange(row, 1, 1, FORM_HEADERS.length) };
}

function editEvent(world, sheetName, row, column, oldValue) {
  return { range: world.sheet(sheetName).getRange(row, column), oldValue };
}

function logLines(world) {
  return world.log().map((row) => row.slice(1).join(' | '));
}

// ---- setup ------------------------------------------------------------------

test('setup adds the three columns, the Routing and Run Log tabs, and three triggers', () => {
  const world = makeWorld({ responses: sampleResponses(3) });
  const app = loadScript(world.globals);
  app.setup();

  assert.deepEqual(world.sheet(RESPONSES).rows[0], [...FORM_HEADERS, 'Status', 'Assigned To', 'Last Updated']);
  assert.deepEqual(world.sheet('Routing').rows, [
    ROUTING_HEADER,
    ['IT', 'Jordan M.', ''],
    ['Facilities', 'Casey L.', ''],
    ['Supplies', 'Taylor R.', ''],
  ]);
  assert.deepEqual(world.sheet('Run Log').rows[0], ['Time', 'Function', 'Result', 'Details']);
  assert.deepEqual(
    world.triggers.map((t) => [t.handler, t.source, t.event || `every ${t.everyDays} day at ${t.hour}`]),
    [
      ['handleFormSubmit', 'spreadsheet', 'formSubmit'],
      ['handleEdit', 'spreadsheet', 'edit'],
      ['sendDailySummary', 'clock', 'every 1 day at 8'],
    ],
  );
  assert.deepEqual(logLines(world), ['setup | OK | Columns added: Status, Assigned To, Last Updated. Triggers created: 3']);
  assert.equal(world.sent.length, 0);
});

test('setup puts a dropdown of the four statuses on the Status column', () => {
  const { world } = readyWorld(3);
  const [validation] = world.sheet(RESPONSES).validations;
  assert.equal(validation.column, 7);
  assert.equal(validation.row, 2);
  assert.deepEqual(validation.rule.values, ['New', 'In progress', 'Waiting', 'Done']);
  assert.equal(validation.rule.allowInvalid, false);
});

test('running setup twice adds nothing twice', () => {
  const { world, app } = readyWorld(3);
  app.setup();
  assert.equal(world.sheet(RESPONSES).rows[0].length, 9);
  assert.equal(world.triggers.length, 3);
  assert.equal(world.sheet('Routing').rows.length, 4);
  assert.equal(logLines(world)[1], 'setup | OK | Columns added: none. Triggers created: 3');
});

test('setup keeps a Routing tab that is already filled in', () => {
  const routing = [ROUTING_HEADER, ['IT', 'Robin S.', '']];
  const { world } = readyWorld(3, { routing });
  assert.deepEqual(world.sheet('Routing').rows, routing);
});

test('setup without a linked form says what to do, and logs the error', () => {
  const world = makeWorld();
  const app = loadScript(world.globals);
  assert.throws(() => app.setup(), /No tab named "Form Responses 1"\. Link the form to this spreadsheet first/);
  assert.match(logLines(world)[0], /^setup \| ERROR \| No tab named "Form Responses 1"/);
  assert.equal(world.triggers.length, 0);
});

// ---- new form response ------------------------------------------------------

test('a new response gets Status New, an assignee, a date, and one alert email', () => {
  const { world, app } = readyWorld(3);
  app.handleFormSubmit(submitEvent(world, 3)); // Morgan T., Facilities, Urgent

  const row = world.sheet(RESPONSES).rows[2];
  assert.equal(row[6], 'New');
  assert.equal(row[7], 'Casey L.');
  assert.ok(row[8] instanceof Date);

  assert.equal(world.sent.length, 1);
  const [email] = world.sent;
  assert.equal(email.subject, 'URGENT: New Facilities request from Morgan T.');
  assert.match(email.body, /^Assigned to: Casey L\.$/m);
  assert.match(email.body, /Dock door 2 will not close all the way/);
  assert.match(email.body, /Change the Status cell in row 3/);
  assert.equal(logLines(world)[1], 'handleFormSubmit | OK | Row 3: Status set to New; alert for Casey L. sent to the sheet owner (demo mode)');
});

test('demo mode: the alert goes to the sheet owner even when the Routing tab has an address', () => {
  const routing = [ROUTING_HEADER, ['IT', 'Jordan M.', 'jordan@example.com']];
  const { world, app } = readyWorld(3, { routing });
  app.handleFormSubmit(submitEvent(world, 2)); // Riley P., IT
  assert.equal(world.sent.length, 1);
  assert.equal(world.sent[0].to, OWNER);
  assert.ok(world.sent[0].body.startsWith('Demo mode: the alert for Jordan M. was sent to the sheet owner instead.'));
  for (const email of world.sent) assert.notEqual(email.to, 'jordan@example.com');
});

test('demo mode off: the alert goes to the address on the Routing tab', () => {
  const routing = [ROUTING_HEADER, ['IT', 'Jordan M.', 'jordan@example.com'], ['Facilities', 'Casey L.', '']];
  const { world, app } = readyWorld(3, { routing, demoMode: false });
  app.handleFormSubmit(submitEvent(world, 2)); // IT: has an address
  app.handleFormSubmit(submitEvent(world, 3)); // Facilities: no address on file
  assert.equal(world.sent[0].to, 'jordan@example.com');
  assert.ok(world.sent[0].body.startsWith('A new request came in.\n\nAssigned to: Jordan M.\n'));
  assert.equal(world.sent[1].to, OWNER);
  assert.ok(world.sent[1].body.startsWith('No email address on the Routing tab for Casey L., so this came to the sheet owner.'));
  assert.deepEqual(logLines(world).slice(1), [
    'handleFormSubmit | OK | Row 2: Status set to New; alert for Jordan M. sent to the assignee',
    'handleFormSubmit | OK | Row 3: Status set to New; alert for Casey L. sent to the sheet owner (no address on the Routing tab)',
  ]);
});

test('a request type with no routing rule is left unassigned and the owner is told', () => {
  const routing = [ROUTING_HEADER, ['IT', 'Jordan M.', '']];
  const { world, app } = readyWorld(3, { routing });
  app.handleFormSubmit(submitEvent(world, 4)); // Supplies: no rule
  const row = world.sheet(RESPONSES).rows[3];
  assert.equal(row[6], 'New');
  assert.equal(row[7], '');
  assert.equal(world.sent[0].to, OWNER);
  assert.match(world.sent[0].body, /^Assigned to: nobody yet/m);
  assert.equal(logLines(world)[1], 'handleFormSubmit | OK | Row 4: Status set to New; alert for nobody (no routing rule for "Supplies") sent to the sheet owner (demo mode)');
});

test('if the trigger fires twice for one response, only one alert is sent', () => {
  const { world, app } = readyWorld(3);
  app.handleFormSubmit(submitEvent(world, 2));
  app.handleFormSubmit(submitEvent(world, 2));
  assert.equal(world.sent.length, 1);
  assert.equal(logLines(world)[2], 'handleFormSubmit | OK | Row 2 skipped: it already has the status "New".');
});

test('a response that arrives before setup is an error, not a silent miss', () => {
  const world = makeWorld({ responses: sampleResponses(3) });
  const app = loadScript(world.globals);
  assert.throws(() => app.handleFormSubmit(submitEvent(world, 2)), /Run setup\(\) first/);
  assert.equal(world.sent.length, 0);
  assert.equal(logLines(world)[0], 'handleFormSubmit | ERROR | Missing column(s): Status, Assigned To, Last Updated. Run setup() first.');
});

test('running handleFormSubmit by hand explains itself', () => {
  const { world, app } = readyWorld(3);
  assert.throws(() => app.handleFormSubmit(), /started by the form-submit trigger/);
  assert.match(logLines(world)[1], /^handleFormSubmit \| ERROR \|/);
});

test('when the email cannot be sent, the error is logged and passed on', () => {
  const { world, app } = readyWorld(3);
  world.mailError = 'Service invoked too many times for one day: email.';
  assert.throws(() => app.handleFormSubmit(submitEvent(world, 2)), /too many times/);
  assert.equal(logLines(world)[1], 'handleFormSubmit | ERROR | Service invoked too many times for one day: email.');
});

// ---- status changes ---------------------------------------------------------

test('changing a Status cell is logged with before and after, and no email is sent', () => {
  const { world, app } = readyWorld(3);
  app.handleFormSubmit(submitEvent(world, 2));
  world.sent.length = 0;
  const sheet = world.sheet(RESPONSES);
  const stamped = sheet.rows[1][8];

  sheet.getRange(2, 7).setValue('In progress'); // what the person typed
  app.handleEdit(editEvent(world, RESPONSES, 2, 7, 'New'));

  assert.equal(logLines(world)[2], 'handleEdit | OK | Row 2 (IT, from Riley P.): New -> In progress');
  assert.ok(sheet.rows[1][8] instanceof Date);
  assert.ok(sheet.rows[1][8] >= stamped);
  assert.equal(world.sent.length, 0);
});

test('edits anywhere else are ignored and leave no log row', () => {
  const { world, app } = readyWorld(3);
  const before = world.log().length;
  app.handleEdit(editEvent(world, RESPONSES, 2, 2, 'Riley P.')); // the name column
  app.handleEdit(editEvent(world, RESPONSES, 1, 7, 'Status')); // the header row
  app.handleEdit(editEvent(world, 'Routing', 2, 2, 'Jordan M.')); // another tab
  app.handleEdit({ range: world.sheet(RESPONSES).getRange(2, 7, 2, 1) }); // two cells at once
  app.handleEdit(undefined);
  assert.equal(world.log().length, before);
});

// ---- daily summary ----------------------------------------------------------

test('the daily summary goes to the sheet owner and lists only what is open', () => {
  const { world, app } = readyWorld(5);
  [2, 3, 4, 5, 6].forEach((row) => app.handleFormSubmit(submitEvent(world, row)));
  world.sent.length = 0;
  world.sheet(RESPONSES).getRange(4, 7).setValue('Done'); // Avery K., Supplies

  app.sendDailySummary();

  assert.equal(world.sent.length, 1);
  const [email] = world.sent;
  assert.equal(email.to, OWNER);
  assert.equal(email.subject, 'Open requests: 4 (1 urgent)');
  assert.match(email.body, /Casey L\. \(2\)/);
  assert.match(email.body, /Jordan M\. \(1\)/);
  assert.match(email.body, /Taylor R\. \(1\)/);
  assert.doesNotMatch(email.body, /nitrile gloves/);
  assert.equal(logLines(world).at(-1), 'sendDailySummary | OK | Summary sent to the sheet owner. Open requests: 4 (1 urgent)');
});

test('the daily summary works on a sheet with no responses yet', () => {
  const world = makeWorld({ responses: [FORM_HEADERS] });
  const app = loadScript(world.globals);
  app.setup();
  app.sendDailySummary();
  assert.equal(world.sent[0].subject, 'Open requests: none');
});

// ---- the owner's walkthrough ------------------------------------------------

test('the walkthrough in DEPLOY.md Part 5 gives the results the guide promises', () => {
  const all = sampleResponses();
  const world = makeWorld({ responses: [all[0]] }); // a freshly linked sheet: headers only
  const app = loadScript(world.globals);
  app.setup();
  const sheet = world.sheet(RESPONSES);

  // Step 19: Riley P., Morgan T., Avery K. and Jamie W. submit the form.
  [all[1], all[2], all[3], all[6]].forEach((entry, i) => {
    sheet.getRange(i + 2, 1, 1, entry.length).setValues([entry]); // Google writes the response
    app.handleFormSubmit(submitEvent(world, i + 2));
  });
  // Steps 20-21: each row is marked and assigned, and four alerts arrive.
  assert.deepEqual(sheet.rows.slice(1).map((row) => [row[1], row[6], row[7]]), [
    ['Riley P.', 'New', 'Jordan M.'],
    ['Morgan T.', 'New', 'Casey L.'],
    ['Avery K.', 'New', 'Taylor R.'],
    ['Jamie W.', 'New', 'Jordan M.'],
  ]);
  assert.equal(world.sent.length, 4);
  assert.equal(world.sent[1].subject, 'URGENT: New Facilities request from Morgan T.');
  for (const email of world.sent) {
    assert.equal(email.to, OWNER);
    assert.ok(email.body.startsWith('Demo mode:'));
  }

  // Step 22: two Status cells are changed by hand.
  sheet.getRange(2, 7).setValue('In progress');
  app.handleEdit(editEvent(world, RESPONSES, 2, 7, 'New'));
  sheet.getRange(4, 7).setValue('Done');
  app.handleEdit(editEvent(world, RESPONSES, 4, 7, 'New'));

  // Step 23: the summary is run by hand.
  app.sendDailySummary();
  assert.equal(world.sent.at(-1).subject, 'Open requests: 3 (2 urgent)');
  assert.ok(world.sent.at(-1).body.startsWith('Open requests as of'));

  // Step 24: eight rows in the Run Log, all OK.
  assert.deepEqual(world.log().map((row) => `${row[1]} ${row[2]}`), [
    'setup OK',
    'handleFormSubmit OK', 'handleFormSubmit OK', 'handleFormSubmit OK', 'handleFormSubmit OK',
    'handleEdit OK', 'handleEdit OK',
    'sendDailySummary OK',
  ]);
});

// ---- run log ----------------------------------------------------------------

test('every log row has a time, the function, OK or ERROR, and details', () => {
  const { world, app } = readyWorld(3);
  app.handleFormSubmit(submitEvent(world, 2));
  for (const row of world.log()) {
    assert.equal(row.length, 4);
    assert.ok(row[0] instanceof Date);
    assert.ok(['setup', 'handleFormSubmit', 'handleEdit', 'sendDailySummary'].includes(row[1]));
    assert.ok(['OK', 'ERROR'].includes(row[2]));
    assert.ok(row[3].length > 0);
  }
});

test('the Run Log keeps the newest 500 entries', () => {
  const { world, app } = readyWorld(3);
  const log = world.sheet('Run Log');
  for (let i = 0; i < 505; i++) log.appendRow([new Date(), 'handleEdit', 'OK', `filler ${i}`]);
  app.sendDailySummary();
  assert.equal(log.rows.length, 1 + 500);
  assert.deepEqual(log.rows[0], ['Time', 'Function', 'Result', 'Details']);
  assert.match(log.rows.at(-1)[3], /^Summary sent/);
});

test('the Run Log never contains an email address', () => {
  const routing = [ROUTING_HEADER, ['IT', 'Jordan M.', 'jordan@example.com']];
  const { world, app } = readyWorld(3, { routing, demoMode: false });
  app.handleFormSubmit(submitEvent(world, 2));
  app.sendDailySummary();
  for (const line of logLines(world)) assert.doesNotMatch(line, /@/);
});
