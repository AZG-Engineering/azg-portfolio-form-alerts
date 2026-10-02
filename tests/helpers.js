// Test helpers: loads the Apps Script source into Node and stands in for the
// Google services it calls (SpreadsheetApp, MailApp, ScriptApp, Session, Utilities).
// No npm packages, no network, no Google account.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SOURCE_FILES = ['Logic.gs', 'Code.gs'];
const OWNER = 'owner@example.com'; // stands in for the account that owns the script
const FORM_HEADERS = ['Timestamp', 'Your name', 'Location', 'Request type', 'Priority', 'What do you need?'];
const RESPONSES = 'Form Responses 1';

/**
 * Runs the .gs files the way Apps Script does (one shared scope) and returns
 * every top-level function and constant. `globals` are the fake Google services.
 */
function loadScript(globals, options = {}) {
  let source = SOURCE_FILES.map((file) => fs.readFileSync(path.join(SRC, file), 'utf8')).join('\n');
  if (options.demoMode === false) {
    const live = source.replace('const DEMO_MODE = true;', 'const DEMO_MODE = false;');
    if (live === source) throw new Error('DEMO_MODE line not found in Code.gs');
    source = live;
  }
  const names = [...source.matchAll(/^(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const parameters = Object.keys(globals);
  const factory = new Function(...parameters, `${source}\nreturn { ${names.join(', ')} };`);
  return factory(...parameters.map((name) => globals[name]));
}

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    Object.assign(this, { sheet, row, column, numRows, numColumns });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numColumns; }
  getValues() {
    const values = [];
    for (let r = 0; r < this.numRows; r++) {
      const source = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numColumns; c++) {
        const value = source[this.column - 1 + c];
        line.push(value === undefined ? '' : value);
      }
      values.push(line);
    }
    return values;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    values.forEach((line, r) => line.forEach((value, c) => this.sheet.put(this.row + r, this.column + c, value)));
    return this;
  }
  setValue(value) {
    return this.setValues(Array.from({ length: this.numRows }, () => Array(this.numColumns).fill(value)));
  }
  setFontWeight() { return this; }
  setDataValidation(rule) {
    this.sheet.validations.push({ row: this.row, column: this.column, numRows: this.numRows, rule });
    return this;
  }
}

class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
    this.validations = [];
    this.frozenRows = 0;
  }
  put(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    const line = this.rows[row - 1];
    while (line.length < column) line.push('');
    line[column - 1] = value;
  }
  getName() { return this.name; }
  getMaxRows() { return 1000; }
  getLastRow() {
    for (let r = this.rows.length; r > 0; r--) {
      if (this.rows[r - 1].some((value) => value !== '' && value !== undefined)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this.rows.forEach((row) => row.forEach((value, c) => {
      if (value !== '' && value !== undefined) last = Math.max(last, c + 1);
    }));
    return last;
  }
  getRange(row, column, numRows = 1, numColumns = 1) { return new FakeRange(this, row, column, numRows, numColumns); }
  appendRow(values) { this.rows.push(values.slice()); return this; }
  deleteRows(start, count) { this.rows.splice(start - 1, count); }
  setFrozenRows(count) { this.frozenRows = count; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  add(name, rows) {
    const sheet = new FakeSheet(name, rows);
    this.sheets.push(sheet);
    return sheet;
  }
  getSheetByName(name) { return this.sheets.find((sheet) => sheet.name === name) || null; }
  insertSheet(name) { return this.add(name, []); }
  getUrl() { return 'https://sheet.example.com/demo'; }
}

function fakeScriptApp() {
  const triggers = [];
  return {
    triggers,
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (trigger) => { triggers.splice(triggers.indexOf(trigger), 1); },
    newTrigger: (handler) => {
      const spec = { handler };
      const builder = {
        forSpreadsheet() { spec.source = 'spreadsheet'; return builder; },
        onFormSubmit() { spec.event = 'formSubmit'; return builder; },
        onEdit() { spec.event = 'edit'; return builder; },
        timeBased() { spec.source = 'clock'; return builder; },
        everyDays(days) { spec.everyDays = days; return builder; },
        atHour(hour) { spec.hour = hour; return builder; },
        create() {
          const trigger = { ...spec, getHandlerFunction: () => handler };
          triggers.push(trigger);
          return trigger;
        },
      };
      return builder;
    },
  };
}

function fakeValidationBuilder() {
  const rule = {};
  const builder = {
    requireValueInList(values, showDropdown) { rule.values = values.slice(); rule.showDropdown = showDropdown; return builder; },
    setAllowInvalid(allow) { rule.allowInvalid = allow; return builder; },
    build() { return rule; },
  };
  return builder;
}

/**
 * A fake spreadsheet plus fake Google services wired to it.
 *   responses: rows for the "Form Responses 1" tab (header row first), or null for no tab
 *   routing:   rows for the "Routing" tab (header row first), or null for no tab
 */
function makeWorld({ responses = null, routing = null } = {}) {
  const spreadsheet = new FakeSpreadsheet();
  if (responses) spreadsheet.add(RESPONSES, responses);
  if (routing) spreadsheet.add('Routing', routing);
  const scriptApp = fakeScriptApp();
  const world = {
    spreadsheet,
    sent: [],
    mailError: null,
    consoleErrors: [],
    triggers: scriptApp.triggers,
    sheet: (name) => spreadsheet.getSheetByName(name),
    log: () => (spreadsheet.getSheetByName('Run Log') || { rows: [[]] }).rows.slice(1),
  };
  world.globals = {
    SpreadsheetApp: { getActive: () => spreadsheet, newDataValidation: fakeValidationBuilder },
    MailApp: {
      sendEmail: (to, subject, body) => {
        if (world.mailError) throw new Error(world.mailError);
        world.sent.push({ to, subject, body });
      },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => OWNER }), getScriptTimeZone: () => 'Etc/UTC' },
    ScriptApp: scriptApp,
    Utilities: {
      formatDate: (date, zone, format) => date.toISOString().replace('T', ' ').slice(0, format.includes('h') ? 16 : 10),
    },
    console: { error: (message) => world.consoleErrors.push(String(message)), log: () => {} },
  };
  return world;
}

/** Minimal CSV reader: commas, double-quoted fields, doubled quotes inside them. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') { quoted = false; } else { field += ch; }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** "9/21/2026 8:14:05" -> Date, the way a response sheet holds a timestamp. */
function parseTimestamp(text) {
  const [, month, day, year, hour, minute, second] = text.match(/^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)$/);
  return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
}

/** The sample responses as sheet rows: header row first, timestamps as Dates. */
function sampleResponses(count) {
  const rows = parseCsv(fs.readFileSync(path.join(ROOT, 'sample-data', 'responses.csv'), 'utf8'));
  const data = rows.slice(1, count === undefined ? undefined : count + 1)
    .map((row) => [parseTimestamp(row[0]), ...row.slice(1)]);
  return [rows[0], ...data];
}

module.exports = { ROOT, SRC, OWNER, FORM_HEADERS, RESPONSES, loadScript, makeWorld, parseCsv, sampleResponses };
