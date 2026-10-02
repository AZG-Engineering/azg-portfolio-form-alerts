// Checks on the files themselves: demo mode is on, and nothing that will be
// pasted into Google or shown to anyone holds an email address.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, SRC, loadScript, makeWorld, parseCsv } = require('./helpers');

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('DEMO_MODE is on in the source as shipped', () => {
  assert.equal(loadScript(makeWorld().globals).DEMO_MODE, true);
  assert.match(read('src', 'Code.gs'), /^const DEMO_MODE = true;$/m);
});

test('the script is limited to the spreadsheet it is attached to', () => {
  assert.match(read('src', 'Code.gs'), /@OnlyCurrentDoc/);
});

test('no email address is written in the script, the manifest or the sample data', () => {
  const files = [
    ...fs.readdirSync(SRC).map((name) => ['src', name]),
    ...fs.readdirSync(path.join(ROOT, 'sample-data')).map((name) => ['sample-data', name]),
  ];
  assert.ok(files.length >= 5);
  for (const parts of files) {
    assert.doesNotMatch(read(...parts), EMAIL, parts.join('/'));
  }
});

test('the manifest is valid JSON on the V8 runtime', () => {
  const manifest = JSON.parse(read('src', 'appsscript.json'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.ok(manifest.timeZone);
});

test('the sample data has 15 responses in the form\'s column order', () => {
  const rows = parseCsv(read('sample-data', 'responses.csv'));
  const app = loadScript(makeWorld().globals);
  assert.deepEqual(rows[0], ['timestamp', 'name', 'location', 'type', 'priority', 'details'].map((key) => app.COLUMNS[key]));
  assert.equal(rows.length, 1 + 15);
  for (const row of rows.slice(1)) {
    assert.equal(row.length, 6);
    assert.match(row[0], /^\d{1,2}\/\d{1,2}\/2026 \d{1,2}:\d{2}:\d{2}$/);
    assert.ok(['Front office', 'Warehouse', 'Shop floor'].includes(row[2]), row[2]);
    assert.ok(['IT', 'Facilities', 'Supplies'].includes(row[3]), row[3]);
    assert.ok(['Low', 'Normal', 'Urgent'].includes(row[4]), row[4]);
  }
});

test('every request type in the sample data has a default routing rule', () => {
  const app = loadScript(makeWorld().globals);
  const types = new Set(parseCsv(read('sample-data', 'responses.csv')).slice(1).map((row) => row[3]));
  for (const type of types) {
    assert.ok(app.findAssignee(app.DEFAULT_ROUTING, type), type);
  }
});
