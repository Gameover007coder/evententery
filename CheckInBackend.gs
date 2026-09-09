/**
 * =====================================================================
 * EVENT CHECK-IN & ATTENDEE MANAGER — Google Apps Script Backend (v2.0)
 * =====================================================================
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Delete any default code and paste this ENTIRE file into Code.gs
 * 4. (Optional) Adjust CONFIG below (SHEET_NAME, OPTIONAL_PASSCODE)
 * 5. Click Deploy > New deployment:
 *      - Select type: "Web app"
 *      - Description: "Event Check-In API v2"
 *      - Execute as: "Me"
 *      - Who has access: "Anyone" (allows phone scanner/laptop to hit the endpoint)
 * 6. Click "Deploy" and authorize permissions when prompted by Google.
 * 7. Copy the "Web app URL" (ends in /exec) and paste it into the WebApp Settings!
 * 
 * NOTE ON UPDATES:
 * Whenever you modify this script, click "Deploy" > "Manage deployments",
 * edit the active deployment, choose "New version", and click "Deploy".
 * =====================================================================
 */

// ================= CONFIGURATION =================
const SHEET_NAME = 'CheckIns'; // Sheet tab name (will be created if missing)
const OPTIONAL_PASSCODE = '';   // Set a secret passcode (e.g. '1234') if desired, or leave empty '' for no passcode

// Standard columns for the Check-In system
const COL_HEADERS = ['ID', 'Name', 'Team', 'CheckedIn', 'Timestamp', 'ScannedBy'];

// ================= ENTRY POINTS =================

/**
 * Handle HTTP POST requests
 * Handles: checkin, toggle, batchAdd, add, stats, list, ping
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    // Verify passcode if configured
    if (OPTIONAL_PASSCODE && payload.passcode !== OPTIONAL_PASSCODE) {
      return jsonResponse({ status: 'error', message: 'Unauthorized: Invalid passcode' });
    }

    const action = (payload.action || 'checkin').toLowerCase();

    switch (action) {
      case 'checkin':
        return handleCheckIn(payload);
      case 'toggle':
        return handleToggle(payload);
      case 'batchadd':
      case 'batch_add':
        return handleBatchAdd(payload);
      case 'add':
        return handleSingleAdd(payload);
      case 'stats':
        return handleGetStats();
      case 'list':
        return handleGetList();
      case 'ping':
        return jsonResponse({ status: 'success', message: 'Pong! Backend is online.', timestamp: new Date().toISOString() });
      default:
        return jsonResponse({ status: 'error', message: `Unknown action: "${action}"` });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: 'Server error: ' + err.toString() });
  }
}

/**
 * Handle HTTP GET requests
 * Handles: stats, list, ping, checkin (fallback)
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    
    // Verify passcode if configured
    if (OPTIONAL_PASSCODE && params.passcode !== OPTIONAL_PASSCODE) {
      return jsonResponse({ status: 'error', message: 'Unauthorized: Invalid passcode' });
    }

    const action = (params.action || 'stats').toLowerCase();

    switch (action) {
      case 'stats':
        return handleGetStats();
      case 'list':
        return handleGetList();
      case 'ping':
        return jsonResponse({ status: 'success', message: 'Pong! Backend is online.', timestamp: new Date().toISOString() });
      case 'checkin':
        return handleCheckIn(params);
      case 'toggle':
        return handleToggle(params);
      default:
        return jsonResponse({ status: 'error', message: 'Unknown GET action. Use ?action=stats, ?action=list, or ?action=ping' });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: 'Server error: ' + err.toString() });
  }
}

// ================= CORE OPERATIONS =================

/**
 * Check-in an attendee by ID
 */
function handleCheckIn(data) {
  const id = (data.id || '').toString().trim().toUpperCase();
  const scannedBy = (data.scannedBy || 'Gate Scanner').toString().trim();

  if (!id) {
    return jsonResponse({ status: 'error', message: 'No attendee ID provided.' });
  }

  const sheet = getOrCreateSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(12000); // Wait up to 12s to prevent race condition between concurrent scans

  try {
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) {
      return jsonResponse({ status: 'not_found', message: 'No attendee records in sheet.' });
    }

    const colMap = getColumnIndices(values[0]);
    if (!colMap) {
      return jsonResponse({ status: 'error', message: 'Sheet is missing required headers.' });
    }

    for (let i = 1; i < values.length; i++) {
      const rowId = (values[i][colMap.id] || '').toString().trim().toUpperCase();
      if (rowId === id) {
        const checkedVal = values[i][colMap.checked];
        const isAlreadyChecked = checkedVal === true || checkedVal === 'TRUE';
        const name = values[i][colMap.name] || 'Attendee';
        const team = colMap.team !== -1 ? (values[i][colMap.team] || '') : '';
        const existingTime = values[i][colMap.time];

        if (isAlreadyChecked) {
          return jsonResponse({
            status: 'duplicate',
            id: id,
            name: name,
            team: team,
            timestamp: formatTimestamp(existingTime),
            scannedBy: colMap.scannedBy !== -1 ? values[i][colMap.scannedBy] : ''
          });
        }

        // Mark as checked in
        const now = new Date();
        const formattedNow = formatTimestamp(now);
        sheet.getRange(i + 1, colMap.checked + 1).setValue(true);
        sheet.getRange(i + 1, colMap.time + 1).setValue(formattedNow);
        if (colMap.scannedBy !== -1) {
          sheet.getRange(i + 1, colMap.scannedBy + 1).setValue(scannedBy);
        }

        return jsonResponse({
          status: 'success',
          id: id,
          name: name,
          team: team,
          timestamp: formattedNow,
          scannedBy: scannedBy
        });
      }
    }

    return jsonResponse({ status: 'not_found', id: id, message: `Attendee ID "${id}" was not found.` });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Toggle check-in status (or set manually)
 */
function handleToggle(data) {
  const id = (data.id || '').toString().trim().toUpperCase();
  const targetState = data.checkedIn !== undefined ? (data.checkedIn === true || data.checkedIn === 'true') : null;
  const operator = (data.scannedBy || 'Admin').toString().trim();

  if (!id) {
    return jsonResponse({ status: 'error', message: 'No ID provided for toggle.' });
  }

  const sheet = getOrCreateSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(12000);

  try {
    const values = sheet.getDataRange().getValues();
    const colMap = getColumnIndices(values[0]);
    if (!colMap) {
      return jsonResponse({ status: 'error', message: 'Sheet is missing required headers.' });
    }

    for (let i = 1; i < values.length; i++) {
      const rowId = (values[i][colMap.id] || '').toString().trim().toUpperCase();
      if (rowId === id) {
        const currentChecked = values[i][colMap.checked] === true || values[i][colMap.checked] === 'TRUE';
        const newChecked = targetState !== null ? targetState : !currentChecked;
        const now = newChecked ? formatTimestamp(new Date()) : '';
        const by = newChecked ? operator : '';

        sheet.getRange(i + 1, colMap.checked + 1).setValue(newChecked);
        sheet.getRange(i + 1, colMap.time + 1).setValue(now);
        if (colMap.scannedBy !== -1) {
          sheet.getRange(i + 1, colMap.scannedBy + 1).setValue(by);
        }

        return jsonResponse({
          status: 'success',
          id: id,
          checkedIn: newChecked,
          timestamp: now,
          scannedBy: by
        });
      }
    }

    return jsonResponse({ status: 'not_found', id: id });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Add a single new attendee
 */
function handleSingleAdd(data) {
  const id = (data.id || '').toString().trim().toUpperCase();
  const name = (data.name || '').toString().trim();
  const team = (data.team || '').toString().trim();

  if (!id || !name) {
    return jsonResponse({ status: 'error', message: 'ID and Name are required.' });
  }

  return handleBatchAdd({ attendees: [{ id: id, name: name, team: team }] });
}

/**
 * Bulk add attendees from Badge Studio / CSV generator directly to the sheet
 */
function handleBatchAdd(data) {
  const attendees = data.attendees || [];
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return jsonResponse({ status: 'error', message: 'No attendees list provided.' });
  }

  const sheet = getOrCreateSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const values = sheet.getDataRange().getValues();
    const colMap = getColumnIndices(values[0]);
    if (!colMap) {
      return jsonResponse({ status: 'error', message: 'Sheet is missing required headers.' });
    }

    // Collect existing IDs to avoid duplicates
    const existingIds = new Set();
    for (let i = 1; i < values.length; i++) {
      const existingId = (values[i][colMap.id] || '').toString().trim().toUpperCase();
      if (existingId) existingIds.add(existingId);
    }

    const rowsToAdd = [];
    let addedCount = 0;
    let skippedCount = 0;

    for (let j = 0; j < attendees.length; j++) {
      const att = attendees[j];
      const attId = (att.id || '').toString().trim().toUpperCase();
      const attName = (att.name || '').toString().trim();
      const attTeam = (att.team || '').toString().trim();

      if (!attId || !attName) continue;

      if (existingIds.has(attId)) {
        skippedCount++;
        continue;
      }

      existingIds.add(attId);
      addedCount++;

      // Build row matching standard COL_HEADERS order: ID | Name | Team | CheckedIn | Timestamp | ScannedBy
      const row = new Array(COL_HEADERS.length).fill('');
      row[colMap.id] = attId;
      row[colMap.name] = attName;
      if (colMap.team !== -1) row[colMap.team] = attTeam;
      row[colMap.checked] = false;
      row[colMap.time] = '';
      if (colMap.scannedBy !== -1) row[colMap.scannedBy] = '';

      rowsToAdd.push(row);
    }

    if (rowsToAdd.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, COL_HEADERS.length).setValues(rowsToAdd);
    }

    return jsonResponse({
      status: 'success',
      added: addedCount,
      skipped: skippedCount,
      totalProcessed: attendees.length
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Get live stats for Dashboard
 */
function handleGetStats() {
  const sheet = getOrCreateSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return jsonResponse({ status: 'success', total: 0, checkedIn: 0, pending: 0, byTeam: {}, recentScans: [] });
  }

  const colMap = getColumnIndices(values[0]);
  if (!colMap) {
    return jsonResponse({ status: 'error', message: 'Sheet is missing required headers.' });
  }

  let total = 0;
  let checkedIn = 0;
  const byTeam = {};
  const checkedRecords = [];

  for (let i = 1; i < values.length; i++) {
    const id = values[i][colMap.id];
    if (!id) continue;
    total++;

    const isChecked = values[i][colMap.checked] === true || values[i][colMap.checked] === 'TRUE';
    if (isChecked) {
      checkedIn++;
      checkedRecords.push({
        id: id,
        name: values[i][colMap.name] || 'Attendee',
        team: colMap.team !== -1 ? (values[i][colMap.team] || '') : '',
        timestamp: formatTimestamp(values[i][colMap.time]),
        scannedBy: colMap.scannedBy !== -1 ? (values[i][colMap.scannedBy] || '') : ''
      });
    }

    if (colMap.team !== -1) {
      const team = (values[i][colMap.team] || 'Individual').toString().trim() || 'Individual';
      if (!byTeam[team]) byTeam[team] = { total: 0, checkedIn: 0 };
      byTeam[team].total++;
      if (isChecked) byTeam[team].checkedIn++;
    }
  }

  // Get most recent 10 check-ins
  const recentScans = checkedRecords.slice(-10).reverse();

  return jsonResponse({
    status: 'success',
    total: total,
    checkedIn: checkedIn,
    pending: total - checkedIn,
    rate: total > 0 ? Math.round((checkedIn / total) * 100) : 0,
    byTeam: byTeam,
    recentScans: recentScans
  });
}

/**
 * Get full attendee list for Admin Table
 */
function handleGetList() {
  const sheet = getOrCreateSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return jsonResponse({ status: 'success', records: [] });
  }

  const colMap = getColumnIndices(values[0]);
  if (!colMap) {
    return jsonResponse({ status: 'error', message: 'Sheet is missing required headers.' });
  }

  const records = [];
  for (let i = 1; i < values.length; i++) {
    const id = values[i][colMap.id];
    if (!id) continue;

    const isChecked = values[i][colMap.checked] === true || values[i][colMap.checked] === 'TRUE';
    records.push({
      id: id.toString().trim(),
      name: (values[i][colMap.name] || '').toString().trim(),
      team: colMap.team !== -1 ? (values[i][colMap.team] || '').toString().trim() : '',
      checkedIn: isChecked,
      timestamp: formatTimestamp(values[i][colMap.time]),
      scannedBy: colMap.scannedBy !== -1 ? (values[i][colMap.scannedBy] || '').toString().trim() : ''
    });
  }

  return jsonResponse({ status: 'success', records: records, count: records.length });
}

// ================= HELPERS =================

/**
 * Locate or automatically create sheet with header row
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COL_HEADERS);
    sheet.getRange(1, 1, 1, COL_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Maps header names to column index
 */
function getColumnIndices(headerRow) {
  const cleanHeaders = headerRow.map(h => (h || '').toString().trim().toLowerCase());
  const id = cleanHeaders.indexOf('id');
  const name = cleanHeaders.indexOf('name');
  const team = cleanHeaders.indexOf('team');
  const checked = cleanHeaders.indexOf('checkedin');
  const time = cleanHeaders.indexOf('timestamp');
  const scannedBy = cleanHeaders.indexOf('scannedby');

  if (id === -1 || name === -1 || checked === -1 || time === -1) {
    return null;
  }
  return { id, name, team, checked, time, scannedBy };
}

/**
 * Formats a Date object or string to HH:mm:ss or readable date
 */
function formatTimestamp(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd HH:mm:ss');
  }
  return val.toString();
}

/**
 * Generates clean JSON response with CORS headers
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

