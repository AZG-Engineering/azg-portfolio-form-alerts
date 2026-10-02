/**
 * Logic.gs: the decisions, with no Google services in them.
 *
 * Everything here takes plain values and returns plain values: which person a
 * request goes to, who an email is addressed to, what the emails and log lines
 * say. Code.gs does the reading, writing and sending. Keeping the two apart is
 * what lets this file be tested on any computer (see tests/).
 */

const STATUS = { NEW: 'New', IN_PROGRESS: 'In progress', WAITING: 'Waiting', DONE: 'Done' };
const STATUS_LIST = [STATUS.NEW, STATUS.IN_PROGRESS, STATUS.WAITING, STATUS.DONE];
const UNASSIGNED = 'Unassigned';

function clean_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function sameText_(a, b) {
  return clean_(a).toLowerCase() === clean_(b).toLowerCase();
}

function isDate_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

/** Where each named column sits in the header row: {key: zero-based index, or -1}. */
function columnIndexes(headers, columns) {
  const indexes = {};
  Object.keys(columns).forEach(function (key) {
    indexes[key] = -1;
    for (let i = 0; i < headers.length; i++) {
      if (sameText_(headers[i], columns[key])) {
        indexes[key] = i;
        break;
      }
    }
  });
  return indexes;
}

/** The header names, out of the given keys, that the sheet doesn't have yet. */
function missingColumns(headers, columns, keys) {
  const indexes = columnIndexes(headers, columns);
  return keys.filter(function (key) { return indexes[key] < 0; })
    .map(function (key) { return columns[key]; });
}

/** One sheet row as a named record. rowNumber is the row as shown in the sheet. */
function rowToRecord(headers, values, rowNumber, columns) {
  const indexes = columnIndexes(headers, columns);
  const read = function (key) { return indexes[key] >= 0 ? values[indexes[key]] : ''; };
  return {
    row: rowNumber,
    timestamp: read('timestamp'),
    name: clean_(read('name')),
    location: clean_(read('location')),
    type: clean_(read('type')),
    priority: clean_(read('priority')),
    details: clean_(read('details')),
    status: clean_(read('status')),
    assignedTo: clean_(read('assignedTo')),
  };
}

/**
 * Who handles this request type. routingRows are the Routing tab's rows without
 * the header: [request type, assignee name, assignee email]. Returns null when
 * no row matches.
 */
function findAssignee(routingRows, requestType) {
  for (let i = 0; i < routingRows.length; i++) {
    const row = routingRows[i];
    if (clean_(row[0]) && sameText_(row[0], requestType) && clean_(row[1])) {
      return { name: clean_(row[1]), email: clean_(row[2]) };
    }
  }
  return null;
}

/**
 * Where an alert is actually sent. In demo mode every alert goes to the sheet
 * owner, whatever the Routing tab says, so no made-up person is ever emailed.
 */
function resolveRecipient(demoMode, ownerEmail, assignee) {
  const who = assignee ? assignee.name : 'nobody (no routing rule)';
  if (demoMode) {
    return {
      to: ownerEmail,
      sentTo: 'the sheet owner (demo mode)',
      note: 'Demo mode: the alert for ' + who + ' was sent to the sheet owner instead.',
    };
  }
  if (assignee && assignee.email) {
    return { to: assignee.email, sentTo: 'the assignee', note: '' };
  }
  return {
    to: ownerEmail,
    sentTo: 'the sheet owner (no address on the Routing tab)',
    note: 'No email address on the Routing tab for ' + who + ', so this came to the sheet owner.',
  };
}

function isUrgent_(record) {
  return sameText_(record.priority, 'Urgent');
}

/** The alert email for one new request. submittedLabel is the timestamp as text. */
function buildAlertEmail(record, assignee, recipient, sheetUrl, submittedLabel) {
  const subject = (isUrgent_(record) ? 'URGENT: ' : '') + 'New ' + (record.type || 'work') + ' request from ' + (record.name || 'unknown');
  const lines = [];
  if (recipient.note) {
    lines.push(recipient.note, '');
  }
  lines.push(
    'A new request came in.',
    '',
    'Assigned to: ' + (assignee ? assignee.name : 'nobody yet (no routing rule for this request type)'),
    'Type:        ' + record.type,
    'Priority:    ' + record.priority,
    'From:        ' + record.name,
    'Location:    ' + record.location,
    'Submitted:   ' + submittedLabel,
    '',
    'What they need:',
    '  ' + record.details,
    '',
    'Its Status is now "' + STATUS.NEW + '". Change the Status cell in row ' + record.row + ' as the work moves along.',
    '',
    'Open the sheet: ' + sheetUrl
  );
  return { to: recipient.to, subject: subject, body: lines.join('\n') };
}

/** A request is open until its Status says Done. A blank Status counts as open. */
function isOpen(record) {
  return !sameText_(record.status, STATUS.DONE);
}

function isBlankRecord_(record) {
  return !record.name && !record.type && !record.details && !isDate_(record.timestamp);
}

function openItems(records) {
  return records.filter(function (record) { return !isBlankRecord_(record) && isOpen(record); });
}

/** Whole days between a timestamp and now. null when the timestamp isn't a date. */
function ageInDays(timestamp, now) {
  if (!isDate_(timestamp)) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 86400000));
}

function ageLabel_(timestamp, now) {
  const days = ageInDays(timestamp, now);
  if (days === null) {
    return 'age unknown';
  }
  return days === 0 ? 'today' : days + (days === 1 ? ' day old' : ' days old');
}

/**
 * The daily summary of open requests, grouped by assignee. Urgent ones come
 * first, then the oldest. todayLabel is today's date as text.
 */
function buildSummaryEmail(records, now, todayLabel, ownerEmail, sheetUrl) {
  const open = openItems(records).sort(function (a, b) {
    if (isUrgent_(a) !== isUrgent_(b)) {
      return isUrgent_(a) ? -1 : 1;
    }
    const at = isDate_(a.timestamp) ? a.timestamp.getTime() : Infinity;
    const bt = isDate_(b.timestamp) ? b.timestamp.getTime() : Infinity;
    return at !== bt ? at - bt : a.row - b.row;
  });
  const urgent = open.filter(isUrgent_).length;

  if (open.length === 0) {
    return {
      to: ownerEmail,
      subject: 'Open requests: none',
      body: ['Open requests as of ' + todayLabel + ': none.', '', 'Nothing is waiting today.', '', 'Open the sheet: ' + sheetUrl].join('\n'),
    };
  }

  const groups = {};
  open.forEach(function (record) {
    const key = record.assignedTo || UNASSIGNED;
    (groups[key] = groups[key] || []).push(record);
  });
  const names = Object.keys(groups).sort(function (a, b) {
    if ((a === UNASSIGNED) !== (b === UNASSIGNED)) {
      return a === UNASSIGNED ? 1 : -1;
    }
    return a.localeCompare(b);
  });

  const count = open.length + (urgent ? ' (' + urgent + ' urgent)' : '');
  const lines = ['Open requests as of ' + todayLabel + ': ' + count, ''];
  names.forEach(function (name) {
    lines.push(name + ' (' + groups[name].length + ')');
    groups[name].forEach(function (record) {
      lines.push('  - ' + [
        'Row ' + record.row,
        isUrgent_(record) ? 'URGENT' : (record.priority || 'No priority'),
        record.type,
        record.location,
        'from ' + record.name,
        ageLabel_(record.timestamp, now),
        'Status: ' + (record.status || 'none'),
      ].join(' | '));
      lines.push('      ' + record.details);
    });
    lines.push('');
  });
  lines.push('Open the sheet: ' + sheetUrl);
  return { to: ownerEmail, subject: 'Open requests: ' + count, body: lines.join('\n') };
}

/** The Run Log line for a Status cell that someone changed. */
function statusChangeMessage(record, oldValue, newValue) {
  const before = clean_(oldValue) || '(blank)';
  const after = clean_(newValue) || '(blank)';
  return 'Row ' + record.row + ' (' + record.type + ', from ' + record.name + '): ' + before + ' -> ' + after;
}

/** One Run Log row: when, which function, OK or ERROR, and what happened. */
function logRow(now, functionName, result, details) {
  return [now, functionName, result, clean_(details)];
}

/** How many of the oldest log rows to delete so at most maxRows entries remain. */
function logRowsToTrim(lastRow, maxRows) {
  return Math.max(0, lastRow - 1 - maxRows);
}
