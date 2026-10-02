/**
 * @OnlyCurrentDoc
 *
 * Form -> Sheet -> alerts.
 *
 * A Google Form feeds a response sheet. This script, bound to that sheet:
 *   - on each new response, sets Status to "New", fills in who it is assigned to,
 *     and sends that person an alert email;
 *   - records every Status change in the Run Log;
 *   - emails a summary of everything still open once a day;
 *   - writes every run, and every error, to the "Run Log" tab.
 *
 * Run setup() once after pasting the code. It adds the columns and tabs the
 * script needs and creates the three triggers.
 *
 * The decisions (who gets what, what the emails say) are in Logic.gs.
 * This file only reads the sheet, writes to it, and sends mail.
 */

// ---- Settings ---------------------------------------------------------------

/**
 * true:  every email goes to the person who owns this script, whoever the
 *        request is assigned to. Safe for demos: nobody else is ever emailed.
 * false: alerts go to the address on the Routing tab for that assignee.
 */
const DEMO_MODE = true;

const RESPONSES_SHEET = 'Form Responses 1';
const ROUTING_SHEET = 'Routing';
const LOG_SHEET = 'Run Log';
const SUMMARY_HOUR = 8; // daily summary goes out between 8 and 9 am, script time zone
const MAX_LOG_ROWS = 500;

/** Column headers. The first six must match the form's question titles exactly. */
const COLUMNS = {
  timestamp: 'Timestamp',
  name: 'Your name',
  location: 'Location',
  type: 'Request type',
  priority: 'Priority',
  details: 'What do you need?',
  status: 'Status',
  assignedTo: 'Assigned To',
  updated: 'Last Updated',
};

/** Columns this script adds to the right of the form's own columns. */
const MANAGED_COLUMNS = ['status', 'assignedTo', 'updated'];

/** Starting contents of the Routing tab: request type, assignee, email. */
const DEFAULT_ROUTING = [
  ['IT', 'Jordan M.', ''],
  ['Facilities', 'Casey L.', ''],
  ['Supplies', 'Taylor R.', ''],
];

const HANDLERS = ['handleFormSubmit', 'handleEdit', 'sendDailySummary'];

// ---- Run once ---------------------------------------------------------------

/** Adds the columns and tabs the script needs and (re)creates its triggers. */
function setup() {
  return runLogged_('setup', function () {
    const ss = SpreadsheetApp.getActive();
    const responses = responsesSheet_(ss);
    const added = ensureManagedColumns_(responses);
    ensureRoutingSheet_(ss);
    logSheet_(ss);
    const created = resetTriggers_(ss);
    return 'Columns added: ' + (added.length ? added.join(', ') : 'none') + '. Triggers created: ' + created;
  });
}

// ---- Triggers ---------------------------------------------------------------

/** Form-submit trigger: mark the new row, assign it, send the alert. */
function handleFormSubmit(e) {
  return runLogged_('handleFormSubmit', function () {
    if (!e || !e.range) {
      throw new Error('No form response in this run. handleFormSubmit is started by the form-submit trigger; run setup() to create it.');
    }
    const sheet = e.range.getSheet();
    const rowNumber = e.range.getRow();
    const headers = headers_(sheet);
    const missing = missingColumns(headers, COLUMNS, MANAGED_COLUMNS);
    if (missing.length) {
      throw new Error('Missing column(s): ' + missing.join(', ') + '. Run setup() first.');
    }
    const indexes = columnIndexes(headers, COLUMNS);
    const record = rowToRecord(headers, rowValues_(sheet, rowNumber, headers.length), rowNumber, COLUMNS);
    if (record.status) {
      // The trigger fired twice for one response. Don't alert twice.
      return 'Row ' + rowNumber + ' skipped: it already has the status "' + record.status + '".';
    }

    const ss = SpreadsheetApp.getActive();
    const assignee = findAssignee(routingRows_(ss), record.type);
    sheet.getRange(rowNumber, indexes.status + 1).setValue(STATUS.NEW);
    sheet.getRange(rowNumber, indexes.assignedTo + 1).setValue(assignee ? assignee.name : '');
    sheet.getRange(rowNumber, indexes.updated + 1).setValue(new Date());

    const recipient = resolveRecipient(DEMO_MODE, ownerEmail_(), assignee);
    const email = buildAlertEmail(record, assignee, recipient, ss.getUrl(), formatWhen_(record.timestamp));
    MailApp.sendEmail(email.to, email.subject, email.body);

    const who = assignee ? assignee.name : 'nobody (no routing rule for "' + record.type + '")';
    return 'Row ' + rowNumber + ': Status set to New; alert for ' + who + ' sent to ' + recipient.sentTo;
  });
}

/** Edit trigger: when someone changes a Status cell, log it. Other edits are ignored. */
function handleEdit(e) {
  return runLogged_('handleEdit', function () {
    if (!e || !e.range) {
      return null;
    }
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getName() !== RESPONSES_SHEET || range.getRow() < 2 || range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
      return null;
    }
    const headers = headers_(sheet);
    const indexes = columnIndexes(headers, COLUMNS);
    if (indexes.status < 0 || range.getColumn() !== indexes.status + 1) {
      return null;
    }
    const rowNumber = range.getRow();
    const record = rowToRecord(headers, rowValues_(sheet, rowNumber, headers.length), rowNumber, COLUMNS);
    if (indexes.updated >= 0) {
      sheet.getRange(rowNumber, indexes.updated + 1).setValue(new Date());
    }
    return statusChangeMessage(record, e.oldValue, record.status);
  });
}

/** Daily time trigger: email the list of open requests to the sheet owner. */
function sendDailySummary() {
  return runLogged_('sendDailySummary', function () {
    const ss = SpreadsheetApp.getActive();
    const sheet = responsesSheet_(ss);
    const headers = headers_(sheet);
    const lastRow = sheet.getLastRow();
    const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
    const records = rows.map(function (values, i) {
      return rowToRecord(headers, values, i + 2, COLUMNS);
    });
    const now = new Date();
    const email = buildSummaryEmail(records, now, formatDay_(now), ownerEmail_(), ss.getUrl());
    MailApp.sendEmail(email.to, email.subject, email.body);
    return 'Summary sent to the sheet owner. ' + email.subject;
  });
}

// ---- Run log ----------------------------------------------------------------

/**
 * Runs the work, then writes one Run Log row: OK with what happened, or ERROR
 * with the message. Errors are passed on so Google reports the failed run too.
 * Work that returns null did nothing worth a log row.
 */
function runLogged_(functionName, work) {
  let details;
  try {
    details = work();
  } catch (error) {
    writeLog_(functionName, 'ERROR', error && error.message ? error.message : String(error));
    throw error;
  }
  if (details !== null) {
    writeLog_(functionName, 'OK', details);
  }
  return details;
}

function writeLog_(functionName, result, details) {
  try {
    const sheet = logSheet_(SpreadsheetApp.getActive());
    sheet.appendRow(logRow(new Date(), functionName, result, details));
    const extra = logRowsToTrim(sheet.getLastRow(), MAX_LOG_ROWS);
    if (extra > 0) {
      sheet.deleteRows(2, extra);
    }
  } catch (error) {
    console.error('Could not write to the Run Log: ' + error);
  }
}

function logSheet_(ss) {
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['Time', 'Function', 'Result', 'Details']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---- Sheet helpers ----------------------------------------------------------

function responsesSheet_(ss) {
  const sheet = ss.getSheetByName(RESPONSES_SHEET);
  if (!sheet) {
    throw new Error('No tab named "' + RESPONSES_SHEET + '". Link the form to this spreadsheet first, or change RESPONSES_SHEET in Code.gs to the tab\'s name.');
  }
  return sheet;
}

function headers_(sheet) {
  const lastColumn = sheet.getLastColumn();
  return lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
}

function rowValues_(sheet, rowNumber, width) {
  return sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
}

/** Adds any missing Status / Assigned To / Last Updated header. Returns the ones added. */
function ensureManagedColumns_(sheet) {
  const added = missingColumns(headers_(sheet), COLUMNS, MANAGED_COLUMNS);
  added.forEach(function (header) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header).setFontWeight('bold');
  });
  const statusColumn = columnIndexes(headers_(sheet), COLUMNS).status + 1;
  if (sheet.getMaxRows() > 1) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build();
    sheet.getRange(2, statusColumn, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  }
  return added;
}

function ensureRoutingSheet_(ss) {
  let sheet = ss.getSheetByName(ROUTING_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ROUTING_SHEET);
    const rows = [['Request type', 'Assignee', 'Email (used only when DEMO_MODE is false)']].concat(DEFAULT_ROUTING);
    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function routingRows_(ss) {
  const sheet = ss.getSheetByName(ROUTING_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
}

/** Removes this script's old triggers and creates the three it needs. */
function resetTriggers_(ss) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (HANDLERS.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('handleFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('sendDailySummary').timeBased().everyDays(1).atHour(SUMMARY_HOUR).create();
  return 3;
}

// ---- Small helpers ----------------------------------------------------------

/** The address of whoever owns this script. It is read at run time, never stored. */
function ownerEmail_() {
  const address = Session.getEffectiveUser().getEmail();
  if (!address) {
    throw new Error('Could not read the sheet owner\'s email address.');
  }
  return address;
}

function formatWhen_(value) {
  if (Object.prototype.toString.call(value) !== '[object Date]') {
    return String(value);
  }
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'EEE d MMM yyyy, h:mm a');
}

function formatDay_(value) {
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'EEE d MMM yyyy');
}
