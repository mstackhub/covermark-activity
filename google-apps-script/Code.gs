/**
 * Covermark Link Landing Management System Backend
 * Google Apps Script Web App API
 */

// Configuration - Replace with actual Folder ID if desired, or let it auto-create
var DRIVE_FOLDER_NAME = "LandingPageImages";
var API_KEY = "COVERMARK_SECRET_API_KEY"; // simple security token for API requests

// Main Entry Points
function doGet(e) {
  return handleResponse(function() {
    initDatabase();
    var action = e.parameter.action;
    
    if (!action) {
      return { success: false, message: "Missing action parameter" };
    }
    
    // Public endpoint - get landing page by slug (no auth needed)
    if (action === "getLandingPageBySlug") {
      var slug = e.parameter.slug;
      if (!slug) return { success: false, message: "Missing slug" };
      return getLandingPageBySlug(slug);
    }
    
    // Authenticate API key for admin operations
    var apiKey = e.parameter.apiKey;
    if (apiKey !== API_KEY) {
      return { success: false, message: "Unauthorized API Key" };
    }
    
    switch (action) {
      case "getLandingPages":
        return getLandingPages();
      case "getAnalytics":
        return getAnalytics(e.parameter.landingId, e.parameter.range);
      case "getActivityLogs":
        return getActivityLogs();
      case "getAdmins":
        return getAdmins();
      default:
        return { success: false, message: "Unknown GET action: " + action };
    }
  });
}

function doPost(e) {
  return handleResponse(function() {
    initDatabase();
    
    var requestData;
    try {
      requestData = JSON.parse(e.postData.contents);
    } catch (err) {
      return { success: false, message: "Invalid JSON body" };
    }
    
    var action = requestData.action;
    if (!action) {
      return { success: false, message: "Missing action in request body" };
    }
    
    // Public endpoints (no admin auth, but might have client-side tracking key)
    if (action === "trackView") {
      return trackView(requestData.landingId, requestData.isUnique);
    }
    if (action === "trackClick") {
      return trackClick(requestData.landingId, requestData.buttonId);
    }
    
    // Authenticate API Key for Admin actions
    if (requestData.apiKey !== API_KEY) {
      return { success: false, message: "Unauthorized API Key" };
    }
    
    switch (action) {
      case "login":
        return loginAdmin(requestData.employeeId, requestData.password, requestData.ip);
      case "createLandingPage":
        return createLandingPage(requestData.data, requestData.admin, requestData.ip);
      case "updateLandingPage":
        return updateLandingPage(requestData.data, requestData.admin, requestData.ip);
      case "deleteLandingPage":
        return deleteLandingPage(requestData.id, requestData.admin, requestData.ip);
      case "duplicateLandingPage":
        return duplicateLandingPage(requestData.id, requestData.admin, requestData.ip);
      case "restoreVersion":
        return restoreVersion(requestData.logId, requestData.admin, requestData.ip);
      case "uploadImage":
        return uploadImageToDrive(requestData.fileName, requestData.mimeType, requestData.base64Data, requestData.admin, requestData.ip);
      case "importCSV":
        return importLandingPagesFromCSV(requestData.csvData, requestData.admin, requestData.ip);
      default:
        return { success: false, message: "Unknown POST action: " + action };
    }
  });
}

// Wrapper for JSON responses and CORS support
function handleResponse(callback) {
  var result;
  try {
    result = callback();
  } catch (err) {
    result = { success: false, message: err.toString(), stack: err.stack };
  }
  
  var jsonString = JSON.stringify(result);
  return ContentService.createTextOutput(jsonString)
    .setMimeType(ContentService.MimeType.JSON);
}

// Spreadsheet database initialization
function initDatabase() {
  var cache = CacheService.getScriptCache();
  if (cache.get("db_initialized") === "true") {
    return; // Skip spreadsheet setup check if already run recently
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var sheets = {
    "Admins": ["id", "name", "employee_id", "password", "role", "created_at"],
    "LandingPages": ["id", "headline", "message", "slug", "image_url", "status", "publish_at", "expire_at", "seo_title", "meta_description", "redirect_url", "created_at", "updated_at", "button_layout", "title"],
    "Buttons": ["id", "landing_id", "title", "url", "style", "sort_order", "created_at"],
    "Analytics": ["landing_id", "date", "views", "unique_visitors", "button_clicks"],
    "ButtonClicks": ["landing_id", "button_id", "date", "clicks"],
    "ActivityLogs": ["id", "admin", "action", "table", "record_id", "old_value", "new_value", "ip", "created_at"],
    "ClickLogs": ["id", "landing_id", "campaign_title", "button_id", "button_title", "clicked_at"]
  };
  
  for (var sheetName in sheets) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(sheets[sheetName]);
      
      // Seed default admin if Admins sheet is new
      if (sheetName === "Admins") {
        sheet.appendRow(["ADM001", "ผู้ดูแลระบบ", "admin", "CvM#Pass2026", "super_admin", new Date().toISOString()]);
      }
    } else {
      // Upgrade existing sheets dynamically if new columns are added
      var dataRange = sheet.getDataRange();
      var values = dataRange.getValues();
      var existingHeaders = values[0] || [];
      var expectedHeaders = sheets[sheetName];
      
      var missingHeaders = [];
      for (var i = 0; i < expectedHeaders.length; i++) {
        if (existingHeaders.indexOf(expectedHeaders[i]) === -1) {
          missingHeaders.push(expectedHeaders[i]);
        }
      }
      
      if (missingHeaders.length > 0) {
        var startCol = existingHeaders.length + 1;
        var headerRange = sheet.getRange(1, startCol, 1, missingHeaders.length);
        headerRange.setValues([missingHeaders]);
      }
    }
  }
  
  // Set cache for 6 hours to avoid repeated executions
  cache.put("db_initialized", "true", 21600);
}

// Helper: Get sheet data as array of objects
function getSheetData(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  
  var headers = values[0];
  var data = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    data.push(obj);
  }
  return data;
}

// Helper: Append a row
function appendRowToSheet(sheetName, headers, dataObj) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i];
    row.push(dataObj[key] !== undefined ? dataObj[key] : "");
  }
  sheet.appendRow(row);
}

// Log admin activities
function logActivity(admin, action, table, recordId, oldValue, newValue, ip) {
  var headers = ["id", "admin", "action", "table", "record_id", "old_value", "new_value", "ip", "created_at"];
  var id = "LOG" + new Date().getTime() + Math.floor(Math.random() * 1000);
  var logObj = {
    id: id,
    admin: admin || "System",
    action: action,
    table: table,
    record_id: recordId || "",
    old_value: oldValue ? JSON.stringify(oldValue) : "",
    new_value: newValue ? JSON.stringify(newValue) : "",
    ip: ip || "",
    created_at: new Date().toISOString()
  };
  appendRowToSheet("ActivityLogs", headers, logObj);
}

// Authentication Logic
function loginAdmin(employeeId, password, ip) {
  var admins = getSheetData("Admins");
  var foundAdmin = null;
  for (var i = 0; i < admins.length; i++) {
    if (admins[i].employee_id.toString().trim() === employeeId.toString().trim() && 
        admins[i].password.toString().trim() === password.toString().trim()) {
      foundAdmin = admins[i];
      break;
    }
  }
  
  if (foundAdmin) {
    logActivity(foundAdmin.name, "login", "Admins", foundAdmin.id, null, { employee_id: employeeId }, ip);
    return {
      success: true,
      data: {
        id: foundAdmin.id,
        name: foundAdmin.name,
        employeeId: foundAdmin.employee_id,
        role: foundAdmin.role
      }
    };
  } else {
    logActivity("Guest", "login_failed", "Admins", null, null, { employee_id: employeeId }, ip);
    return { success: false, message: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง" };
  }
}

// Get all landing pages with their buttons
function getLandingPages() {
  var lps = getSheetData("LandingPages");
  var buttons = getSheetData("Buttons");
  
  // Group buttons by landing page id
  var buttonsByLandingId = {};
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    if (!buttonsByLandingId[btn.landing_id]) {
      buttonsByLandingId[btn.landing_id] = [];
    }
    buttonsByLandingId[btn.landing_id].push(btn);
  }
  
  // Sort buttons in each landing page by sort_order
  for (var lpId in buttonsByLandingId) {
    buttonsByLandingId[lpId].sort(function(a, b) {
      return Number(a.sort_order) - Number(b.sort_order);
    });
  }
  
  // Attach buttons to landing pages
  for (var j = 0; j < lps.length; j++) {
    var lp = lps[j];
    lp.buttons = buttonsByLandingId[lp.id] || [];
  }
  
  // Sort landing pages by created_at desc
  lps.sort(function(a, b) {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  
  return { success: true, data: lps };
}

// Get public landing page by slug
function getLandingPageBySlug(slug) {
  var lps = getSheetData("LandingPages");
  var targetLp = null;
  for (var i = 0; i < lps.length; i++) {
    if (lps[i].slug.toString().trim() === slug.toString().trim()) {
      targetLp = lps[i];
      break;
    }
  }
  
  if (!targetLp) {
    return { success: false, message: "ไม่พบหน้า Landing Page ที่ท่านเรียกหา" };
  }
  
  var buttons = getSheetData("Buttons");
  var lpButtons = [];
  for (var j = 0; j < buttons.length; j++) {
    if (buttons[j].landing_id === targetLp.id) {
      lpButtons.push(buttons[j]);
    }
  }
  
  lpButtons.sort(function(a, b) {
    return Number(a.sort_order) - Number(b.sort_order);
  });
  
  targetLp.buttons = lpButtons;
  return { success: true, data: targetLp };
}

// Create new landing page
function createLandingPage(data, admin, ip) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Validate duplicate slug
  var lps = getSheetData("LandingPages");
  for (var i = 0; i < lps.length; i++) {
    if (lps[i].slug.toString().trim() === data.slug.toString().trim()) {
      return { success: false, message: "Slug นี้ถูกใช้งานไปแล้ว กรุณาใช้ Slug อื่น" };
    }
  }
  
  var lpId = "LP" + new Date().getTime() + Math.floor(Math.random() * 100);
  var now = new Date().toISOString();
  
  var lpHeaders = ["id", "headline", "message", "slug", "image_url", "status", "publish_at", "expire_at", "seo_title", "meta_description", "redirect_url", "created_at", "updated_at", "button_layout", "title"];
  var lpObj = {
    id: lpId,
    headline: data.headline,
    message: data.message,
    slug: data.slug,
    image_url: data.image_url || "",
    status: data.status || "draft",
    publish_at: data.publish_at || "",
    expire_at: data.expire_at || "",
    seo_title: data.seo_title || "",
    meta_description: data.meta_description || "",
    redirect_url: data.redirect_url || "",
    button_layout: data.button_layout || "vertical",
    title: data.title || "",
    created_at: now,
    updated_at: now
  };
  
  appendRowToSheet("LandingPages", lpHeaders, lpObj);
  
  // Add Buttons
  var btnHeaders = ["id", "landing_id", "title", "url", "style", "sort_order", "created_at"];
  if (data.buttons && data.buttons.length > 0) {
    for (var j = 0; j < data.buttons.length; j++) {
      var btn = data.buttons[j];
      var btnId = "BTN" + new Date().getTime() + Math.floor(Math.random() * 1000) + j;
      var btnObj = {
        id: btnId,
        landing_id: lpId,
        title: btn.title,
        url: btn.url,
        style: btn.style || "primary",
        sort_order: btn.sort_order || j,
        created_at: now
      };
      appendRowToSheet("Buttons", btnHeaders, btnObj);
    }
  }
  
  lpObj.buttons = data.buttons || [];
  logActivity(admin, "create", "LandingPages", lpId, null, lpObj, ip);
  
  return { success: true, data: lpObj };
}

// Update existing landing page
function updateLandingPage(data, admin, ip) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lpSheet = ss.getSheetByName("LandingPages");
  var lpValues = lpSheet.getDataRange().getValues();
  
  var lpIndex = -1;
  var oldLpObj = null;
  var headers = lpValues[0];
  
  for (var i = 1; i < lpValues.length; i++) {
    if (lpValues[i][0] === data.id) {
      lpIndex = i + 1; // 1-based index and header row
      oldLpObj = {};
      for (var j = 0; j < headers.length; j++) {
        oldLpObj[headers[j]] = lpValues[i][j];
      }
      break;
    }
  }
  
  if (lpIndex === -1) {
    return { success: false, message: "ไม่พบหน้า Landing Page ที่ต้องการแก้ไข" };
  }
  
  // Check slug duplication
  var lps = getSheetData("LandingPages");
  for (var k = 0; k < lps.length; k++) {
    if (lps[k].slug.toString().trim() === data.slug.toString().trim() && lps[k].id !== data.id) {
      return { success: false, message: "Slug นี้ถูกใช้งานในแคมเปญอื่นแล้ว กรุณาใช้ Slug อื่น" };
    }
  }
  
  // Retrieve old buttons
  var btnSheet = ss.getSheetByName("Buttons");
  var btnValues = btnSheet.getDataRange().getValues();
  var oldButtons = [];
  var btnHeaders = btnValues[0];
  for (var m = 1; m < btnValues.length; m++) {
    if (btnValues[m][1] === data.id) {
      var bObj = {};
      for (var n = 0; n < btnHeaders.length; n++) {
        bObj[btnHeaders[n]] = btnValues[m][n];
      }
      oldButtons.push(bObj);
    }
  }
  oldLpObj.buttons = oldButtons;
  
  // Update Landing Page Row
  var now = new Date().toISOString();
  var lpObj = {
    id: data.id,
    headline: data.headline,
    message: data.message,
    slug: data.slug,
    image_url: data.image_url !== undefined ? data.image_url : oldLpObj.image_url,
    status: data.status,
    publish_at: data.publish_at || "",
    expire_at: data.expire_at || "",
    seo_title: data.seo_title || "",
    meta_description: data.meta_description || "",
    redirect_url: data.redirect_url || "",
    button_layout: data.button_layout !== undefined ? data.button_layout : (oldLpObj.button_layout || "vertical"),
    title: data.title !== undefined ? data.title : (oldLpObj.title || ""),
    created_at: oldLpObj.created_at,
    updated_at: now
  };
  
  for (var c = 0; c < headers.length; c++) {
    var val = lpObj[headers[c]] !== undefined ? lpObj[headers[c]] : "";
    lpSheet.getRange(lpIndex, c + 1).setValue(val);
  }
  
  // Update Buttons (Delete existing buttons for this landing page and write new ones)
  // First, find and delete rows in Buttons sheet
  var btnRowsToDelete = [];
  for (var r = btnValues.length - 1; r >= 1; r--) {
    if (btnValues[r][1] === data.id) {
      btnSheet.deleteRow(r + 1);
    }
  }
  
  // Write new buttons
  var writeBtnHeaders = ["id", "landing_id", "title", "url", "style", "sort_order", "created_at"];
  if (data.buttons && data.buttons.length > 0) {
    for (var bIdx = 0; bIdx < data.buttons.length; bIdx++) {
      var btn = data.buttons[bIdx];
      var btnId = btn.id && btn.id.startsWith("BTN") ? btn.id : "BTN" + new Date().getTime() + Math.floor(Math.random() * 1000) + bIdx;
      var btnObj = {
        id: btnId,
        landing_id: data.id,
        title: btn.title,
        url: btn.url,
        style: btn.style || "primary",
        sort_order: btn.sort_order || bIdx,
        created_at: btn.created_at || now
      };
      appendRowToSheet("Buttons", writeBtnHeaders, btnObj);
    }
  }
  
  lpObj.buttons = data.buttons || [];
  logActivity(admin, "update", "LandingPages", data.id, oldLpObj, lpObj, ip);
  
  return { success: true, data: lpObj };
}

// Delete landing page and its buttons
function deleteLandingPage(id, admin, ip) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get Landing Page info for logging
  var lps = getSheetData("LandingPages");
  var targetLp = null;
  for (var i = 0; i < lps.length; i++) {
    if (lps[i].id === id) {
      targetLp = lps[i];
      break;
    }
  }
  
  if (!targetLp) {
    return { success: false, message: "ไม่พบหน้า Landing Page ที่ต้องการลบ" };
  }
  
  var buttons = getSheetData("Buttons");
  var lpButtons = [];
  for (var j = 0; j < buttons.length; j++) {
    if (buttons[j].landing_id === id) {
      lpButtons.push(buttons[j]);
    }
  }
  targetLp.buttons = lpButtons;
  
  // Delete from LandingPages sheet
  var lpSheet = ss.getSheetByName("LandingPages");
  var lpValues = lpSheet.getDataRange().getValues();
  for (var r = lpValues.length - 1; r >= 1; r--) {
    if (lpValues[r][0] === id) {
      lpSheet.deleteRow(r + 1);
      break;
    }
  }
  
  // Delete associated buttons
  var btnSheet = ss.getSheetByName("Buttons");
  var btnValues = btnSheet.getDataRange().getValues();
  for (var b = btnValues.length - 1; b >= 1; b--) {
    if (btnValues[b][1] === id) {
      btnSheet.deleteRow(b + 1);
    }
  }
  
  logActivity(admin, "delete", "LandingPages", id, targetLp, null, ip);
  return { success: true, data: { id: id } };
}

// Duplicate landing page
function duplicateLandingPage(id, admin, ip) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lps = getSheetData("LandingPages");
  var targetLp = null;
  for (var i = 0; i < lps.length; i++) {
    if (lps[i].id === id) {
      targetLp = lps[i];
      break;
    }
  }
  
  if (!targetLp) {
    return { success: false, message: "ไม่พบแคมเปญต้นฉบับที่จะทำการคัดลอก" };
  }
  
  var buttons = getSheetData("Buttons");
  var lpButtons = [];
  for (var j = 0; j < buttons.length; j++) {
    if (buttons[j].landing_id === id) {
      lpButtons.push(buttons[j]);
    }
  }
  lpButtons.sort(function(a, b) { return Number(a.sort_order) - Number(b.sort_order); });
  
  // Generate new unique slug and ID
  var newSlug = targetLp.slug + "-copy-" + Math.floor(Math.random() * 1000);
  var newLpId = "LP" + new Date().getTime() + Math.floor(Math.random() * 100);
  var now = new Date().toISOString();
  
  var lpHeaders = ["id", "headline", "message", "slug", "image_url", "status", "publish_at", "expire_at", "seo_title", "meta_description", "redirect_url", "created_at", "updated_at", "button_layout", "title"];
  var newLpObj = {
    id: newLpId,
    headline: targetLp.headline,
    message: targetLp.message,
    slug: newSlug,
    image_url: targetLp.image_url,
    status: "draft", // default to draft when duplicating
    publish_at: targetLp.publish_at || "",
    expire_at: targetLp.expire_at || "",
    seo_title: targetLp.seo_title || "",
    meta_description: targetLp.meta_description || "",
    redirect_url: targetLp.redirect_url || "",
    button_layout: targetLp.button_layout || "vertical",
    title: targetLp.title ? (targetLp.title + " (คัดลอก)") : "คัดลอกแคมเปญ",
    created_at: now,
    updated_at: now
  };
  
  appendRowToSheet("LandingPages", lpHeaders, newLpObj);
  
  // Copy Buttons
  var btnHeaders = ["id", "landing_id", "title", "url", "style", "sort_order", "created_at"];
  var copiedButtons = [];
  for (var k = 0; k < lpButtons.length; k++) {
    var btn = lpButtons[k];
    var btnId = "BTN" + new Date().getTime() + Math.floor(Math.random() * 1000) + k;
    var btnObj = {
      id: btnId,
      landing_id: newLpId,
      title: btn.title,
      url: btn.url,
      style: btn.style,
      sort_order: btn.sort_order,
      created_at: now
    };
    appendRowToSheet("Buttons", btnHeaders, btnObj);
    copiedButtons.push(btnObj);
  }
  
  newLpObj.buttons = copiedButtons;
  logActivity(admin, "duplicate", "LandingPages", newLpId, null, newLpObj, ip);
  return { success: true, data: newLpObj };
}

// Restore a historical version of Landing Page from Activity Logs
function restoreVersion(logId, admin, ip) {
  var logs = getSheetData("ActivityLogs");
  var targetLog = null;
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].id === logId) {
      targetLog = logs[i];
      break;
    }
  }
  
  if (!targetLog) {
    return { success: false, message: "ไม่พบข้อมูลประวัติเวอร์ชันดังกล่าว" };
  }
  
  var lpData = null;
  try {
    // If the action was delete, the old value contains the data to restore
    // If the action was update, the new_value is what they had, or old_value holds the preceding state. 
    // We'll restore to whatever is in new_value if available, else old_value.
    var rawVal = targetLog.new_value || targetLog.old_value;
    lpData = JSON.parse(rawVal);
  } catch (err) {
    return { success: false, message: "ข้อมูลเวอร์ชันเดิมไม่สมบูรณ์" };
  }
  
  if (!lpData || !lpData.id) {
    return { success: false, message: "โครงสร้างข้อมูลเวอร์ชันเดิมไม่ถูกต้อง" };
  }
  
  // We will restore the Landing Page row and Buttons
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lpSheet = ss.getSheetByName("LandingPages");
  var lpValues = lpSheet.getDataRange().getValues();
  var lpHeaders = lpValues[0];
  
  // See if landing page already exists
  var lpIndex = -1;
  for (var j = 1; j < lpValues.length; j++) {
    if (lpValues[j][0] === lpData.id) {
      lpIndex = j + 1;
      break;
    }
  }
  
  var now = new Date().toISOString();
  var lpObj = {
    id: lpData.id,
    headline: lpData.headline,
    message: lpData.message,
    slug: lpData.slug,
    image_url: lpData.image_url || "",
    status: lpData.status || "draft",
    publish_at: lpData.publish_at || "",
    expire_at: lpData.expire_at || "",
    seo_title: lpData.seo_title || "",
    meta_description: lpData.meta_description || "",
    redirect_url: lpData.redirect_url || "",
    button_layout: lpData.button_layout || "vertical",
    title: lpData.title || "",
    created_at: lpData.created_at || now,
    updated_at: now
  };
  
  if (lpIndex !== -1) {
    // Overwrite existing
    for (var c = 0; c < lpHeaders.length; c++) {
      var val = lpObj[lpHeaders[c]] !== undefined ? lpObj[lpHeaders[c]] : "";
      lpSheet.getRange(lpIndex, c + 1).setValue(val);
    }
  } else {
    // Re-create deleted landing page
    appendRowToSheet("LandingPages", lpHeaders, lpObj);
  }
  
  // Restore Buttons
  var btnSheet = ss.getSheetByName("Buttons");
  var btnValues = btnSheet.getDataRange().getValues();
  
  // Delete existing buttons for this page if any
  for (var r = btnValues.length - 1; r >= 1; r--) {
    if (btnValues[r][1] === lpData.id) {
      btnSheet.deleteRow(r + 1);
    }
  }
  
  // Append restored buttons
  var btnHeaders = ["id", "landing_id", "title", "url", "style", "sort_order", "created_at"];
  if (lpData.buttons && lpData.buttons.length > 0) {
    for (var bIdx = 0; bIdx < lpData.buttons.length; bIdx++) {
      var btn = lpData.buttons[bIdx];
      var btnId = btn.id || "BTN" + new Date().getTime() + Math.floor(Math.random() * 1000) + bIdx;
      var btnObj = {
        id: btnId,
        landing_id: lpData.id,
        title: btn.title,
        url: btn.url,
        style: btn.style || "primary",
        sort_order: btn.sort_order || bIdx,
        created_at: btn.created_at || now
      };
      appendRowToSheet("Buttons", btnHeaders, btnObj);
    }
  }
  
  lpObj.buttons = lpData.buttons || [];
  logActivity(admin, "restore", "LandingPages", lpData.id, null, lpObj, ip);
  return { success: true, data: lpObj };
}

// Upload Image to Google Drive
function uploadImageToDrive(fileName, mimeType, base64Data, admin, ip) {
  var folder = null;
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  }
  
  var decodedBytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decodedBytes, mimeType, fileName);
  
  // Note: Auto-compression and resizing in pure GAS can be done by parsing raw image bytes if using specific libraries,
  // but standard GAS Drive API saves the blob as is. 
  // To avoid huge files, we restrict to 5MB max (checked on client-side).
  var file = folder.createFile(blob);
  
  // Make the file publicly accessible so anyone on the web can view it
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  // Construct direct download link
  var fileId = file.getId();
  var publicUrl = "https://lh3.googleusercontent.com/d/" + fileId; // alternative direct link format
  // or: "https://drive.google.com/uc?export=download&id=" + fileId;
  
  logActivity(admin, "upload_image", "GoogleDrive", fileId, null, { file_id: fileId, url: publicUrl }, ip);
  
  return {
    success: true,
    data: {
      fileId: fileId,
      url: publicUrl
    }
  };
}

// Track page view and unique visitor
function trackView(landingId, isUnique) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Analytics");
  var values = sheet.getDataRange().getValues();
  
  var todayStr = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
  var foundIndex = -1;
  
  for (var i = 1; i < values.length; i++) {
    var rowDate = "";
    if (values[i][1] instanceof Date) {
      rowDate = values[i][1].toISOString().substring(0, 10);
    } else {
      rowDate = values[i][1].toString().substring(0, 10);
    }
    
    if (values[i][0] === landingId && rowDate === todayStr) {
      foundIndex = i + 1;
      break;
    }
  }
  
  if (foundIndex !== -1) {
    var currentViews = Number(values[foundIndex - 1][2] || 0);
    var currentUniques = Number(values[foundIndex - 1][3] || 0);
    
    sheet.getRange(foundIndex, 3).setValue(currentViews + 1);
    if (isUnique) {
      sheet.getRange(foundIndex, 4).setValue(currentUniques + 1);
    }
  } else {
    // Create new analytics row
    var headers = ["landing_id", "date", "views", "unique_visitors", "button_clicks"];
    var newAnalytics = {
      landing_id: landingId,
      date: todayStr,
      views: 1,
      unique_visitors: isUnique ? 1 : 0,
      button_clicks: 0
    };
    appendRowToSheet("Analytics", headers, newAnalytics);
  }
  
  return { success: true };
}

// Track button click
function trackClick(landingId, buttonId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Update overall button clicks in Analytics sheet
  var analyticsSheet = ss.getSheetByName("Analytics");
  var aValues = analyticsSheet.getDataRange().getValues();
  var todayStr = new Date().toISOString().substring(0, 10);
  var foundAIndex = -1;
  
  for (var i = 1; i < aValues.length; i++) {
    var rowDate = "";
    if (aValues[i][1] instanceof Date) {
      rowDate = aValues[i][1].toISOString().substring(0, 10);
    } else {
      rowDate = aValues[i][1].toString().substring(0, 10);
    }
    
    if (aValues[i][0] === landingId && rowDate === todayStr) {
      foundAIndex = i + 1;
      break;
    }
  }
  
  if (foundAIndex !== -1) {
    var currentClicks = Number(aValues[foundAIndex - 1][4] || 0);
    analyticsSheet.getRange(foundAIndex, 5).setValue(currentClicks + 1);
  } else {
    var headersA = ["landing_id", "date", "views", "unique_visitors", "button_clicks"];
    var newAnalytics = {
      landing_id: landingId,
      date: todayStr,
      views: 0,
      unique_visitors: 0,
      button_clicks: 1
    };
    appendRowToSheet("Analytics", headersA, newAnalytics);
  }
  
  // 2. Update specific button click in ButtonClicks sheet
  var clickSheet = ss.getSheetByName("ButtonClicks");
  var clickValues = clickSheet.getDataRange().getValues();
  var foundCIndex = -1;
  
  for (var j = 1; j < clickValues.length; j++) {
    var cRowDate = "";
    if (clickValues[j][2] instanceof Date) {
      cRowDate = clickValues[j][2].toISOString().substring(0, 10);
    } else {
      cRowDate = clickValues[j][2].toString().substring(0, 10);
    }
    
    if (clickValues[j][0] === landingId && clickValues[j][1] === buttonId && cRowDate === todayStr) {
      foundCIndex = j + 1;
      break;
    }
  }
  
  if (foundCIndex !== -1) {
    var currentBtnClicks = Number(clickValues[foundCIndex - 1][3] || 0);
    clickSheet.getRange(foundCIndex, 4).setValue(currentBtnClicks + 1);
  } else {
    var headersC = ["landing_id", "button_id", "date", "clicks"];
    var newClick = {
      landing_id: landingId,
      button_id: buttonId,
      date: todayStr,
      clicks: 1
    };
    appendRowToSheet("ButtonClicks", headersC, newClick);
  }
  
  // 3. Log detailed individual click with timestamp to ClickLogs sheet
  try {
    // Get landing page info for campaign title
    var lpSheet = ss.getSheetByName("LandingPages");
    var lpValues = lpSheet.getDataRange().getValues();
    var lpHeaders = lpValues[0];
    var titleCol = lpHeaders.indexOf("title");
    var headlineCol = lpHeaders.indexOf("headline");
    var idCol = lpHeaders.indexOf("id");
    
    var campaignTitle = "Unknown Campaign";
    for (var k = 1; k < lpValues.length; k++) {
      if (lpValues[k][idCol] === landingId) {
        campaignTitle = lpValues[k][titleCol] || lpValues[k][headlineCol] || "Campaign " + landingId;
        break;
      }
    }
    
    // Get button title
    var btnSheet = ss.getSheetByName("Buttons");
    var btnValues = btnSheet.getDataRange().getValues();
    var btnHeaders = btnValues[0];
    var btnTitleCol = btnHeaders.indexOf("title");
    var btnIdCol = btnHeaders.indexOf("id");
    
    var buttonTitle = "Unknown Button";
    for (var m = 1; m < btnValues.length; m++) {
      if (btnValues[m][btnIdCol] === buttonId) {
        buttonTitle = btnValues[m][btnTitleCol] || "Button " + buttonId;
        break;
      }
    }
    
    var logHeaders = ["id", "landing_id", "campaign_title", "button_id", "button_title", "clicked_at"];
    var logEntry = {
      id: "CLK" + new Date().getTime() + Math.floor(Math.random() * 100),
      landing_id: landingId,
      campaign_title: campaignTitle,
      button_id: buttonId,
      button_title: buttonTitle,
      clicked_at: new Date().toISOString()
    };
    
    appendRowToSheet("ClickLogs", logHeaders, logEntry);
  } catch (e) {
    Logger.log("Error logging click: " + e.toString());
  }
  
  return { success: true };
}

// Get Analytics data (views, unique, and button clicks)
function getAnalytics(landingId, range) {
  var analytics = getSheetData("Analytics");
  var buttonClicks = getSheetData("ButtonClicks");
  var buttons = getSheetData("Buttons");
  
  // Filter by landingId if specified
  if (landingId) {
    analytics = analytics.filter(function(row) { return row.landing_id === landingId; });
    buttonClicks = buttonClicks.filter(function(row) { return row.landing_id === landingId; });
  }
  
  // Create a map of button IDs to titles
  var buttonTitles = {};
  for (var i = 0; i < buttons.length; i++) {
    buttonTitles[buttons[i].id] = buttons[i].title;
  }
  
  // Group button clicks by button_id to show which buttons are clicked most
  var topButtons = {};
  for (var j = 0; j < buttonClicks.length; j++) {
    var click = buttonClicks[j];
    var title = buttonTitles[click.button_id] || "ปุ่มที่ถูกลบไปแล้ว (" + click.button_id + ")";
    if (!topButtons[click.button_id]) {
      topButtons[click.button_id] = {
        button_id: click.button_id,
        title: title,
        clicks: 0
      };
    }
    topButtons[click.button_id].clicks += Number(click.clicks || 0);
  }
  
  var topButtonsList = [];
  for (var bId in topButtons) {
    topButtonsList.push(topButtons[bId]);
  }
  topButtonsList.sort(function(a, b) { return b.clicks - a.clicks; });
  
  // Sort analytics by date ascending
  analytics.sort(function(a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
  
  // Format dates cleanly for chart
  var chartData = analytics.map(function(row) {
    var dateStr = "";
    if (row.date instanceof Date) {
      dateStr = row.date.toISOString().substring(0, 10);
    } else {
      dateStr = row.date.toString().substring(0, 10);
    }
    return {
      date: dateStr,
      views: Number(row.views || 0),
      unique_visitors: Number(row.unique_visitors || 0),
      clicks: Number(row.button_clicks || 0)
    };
  });
  
  return {
    success: true,
    data: {
      chartData: chartData,
      topButtons: topButtonsList
    }
  };
}

// Get Activity Logs (limited to 300 entries for performance)
function getActivityLogs() {
  var logs = getSheetData("ActivityLogs");
  logs.sort(function(a, b) {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  
  if (logs.length > 300) {
    logs = logs.slice(0, 300);
  }
  
  return { success: true, data: logs };
}

// Get Admins list
function getAdmins() {
  var admins = getSheetData("Admins");
  var cleanAdmins = admins.map(function(admin) {
    return {
      id: admin.id,
      name: admin.name,
      employeeId: admin.employee_id,
      role: admin.role,
      created_at: admin.created_at
    };
  });
  return { success: true, data: cleanAdmins };
}

// Import Landing Pages from CSV (Bulk Upload)
function importLandingPagesFromCSV(csvData, admin, ip) {
  // csvData is expected to be an array of arrays representing the CSV rows
  if (!csvData || csvData.length <= 1) {
    return { success: false, message: "ไม่มีข้อมูล CSV สำหรับการนำเข้า" };
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = new Date().toISOString();
  
  var lpHeaders = ["id", "headline", "message", "slug", "image_url", "status", "publish_at", "expire_at", "seo_title", "meta_description", "redirect_url", "created_at", "updated_at"];
  var btnHeaders = ["id", "landing_id", "title", "url", "style", "sort_order", "created_at"];
  
  var successCount = 0;
  
  // Skip header row
  for (var i = 1; i < csvData.length; i++) {
    var row = csvData[i];
    if (row.length < 4) continue; // Skip invalid rows
    
    var headline = row[0];
    var message = row[1];
    var slug = row[2];
    var imageUrl = row[3] || "";
    var status = row[4] || "draft";
    var publishAt = row[5] || "";
    var expireAt = row[6] || "";
    var seoTitle = row[7] || "";
    var metaDesc = row[8] || "";
    var redirectUrl = row[9] || "";
    
    // Parse buttons format: "Title1|Url1|Style1, Title2|Url2|Style2"
    var buttonsRaw = row[10] || "";
    
    // Check slug duplication
    var existingLps = getSheetData("LandingPages");
    var isDuplicate = false;
    for (var k = 0; k < existingLps.length; k++) {
      if (existingLps[k].slug.toString().trim() === slug.toString().trim()) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue; // Skip duplicates for safety in bulk import
    
    var lpId = "LP" + new Date().getTime() + Math.floor(Math.random() * 100) + "_" + i;
    var lpObj = {
      id: lpId,
      headline: headline,
      message: message,
      slug: slug,
      image_url: imageUrl,
      status: status,
      publish_at: publishAt,
      expire_at: expireAt,
      seo_title: seoTitle,
      meta_description: metaDesc,
      redirect_url: redirectUrl,
      button_layout: "vertical",
      title: headline,
      created_at: now,
      updated_at: now
    };
    
    appendRowToSheet("LandingPages", lpHeaders, lpObj);
    
    // Add buttons
    if (buttonsRaw.trim() !== "") {
      var btnList = buttonsRaw.split(",");
      for (var j = 0; j < btnList.length; j++) {
        var btnParts = btnList[j].split("|");
        if (btnParts.length >= 2) {
          var title = btnParts[0].trim();
          var url = btnParts[1].trim();
          var style = (btnParts[2] || "primary").trim();
          
          var btnId = "BTN" + new Date().getTime() + Math.floor(Math.random() * 1000) + "_" + i + "_" + j;
          var btnObj = {
            id: btnId,
            landing_id: lpId,
            title: title,
            url: url,
            style: style,
            sort_order: j,
            created_at: now
          };
          appendRowToSheet("Buttons", btnHeaders, btnObj);
        }
      }
    }
    
    successCount++;
  }
  
  logActivity(admin, "import", "LandingPages", "bulk", null, { count: successCount }, ip);
  return { success: true, message: "นำเข้า Landing Page สำเร็จทั้งหมด " + successCount + " รายการ" };
}
