/**
 * Covermark Link Landing Management System
 * Frontend Application Controller (SPA & Admin Panel)
 */

// ─── Cache Helpers (localStorage + 5-min TTL) ──────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
}
function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
    return data;
  } catch(e) { return null; }
}
function clearDataCaches() {
  ['cvm_lp', 'cvm_logs'].forEach(k => localStorage.removeItem(k));
  Object.keys(localStorage).filter(k => k.startsWith('cvm_analytics_')).forEach(k => localStorage.removeItem(k));
}
// ────────────────────────────────────────────────────────────────────────────

// Application State
let STATE = {
  landingPages: [],
  analyticsData: null,
  activityLogs: [],
  adminsList: [],
  currentAdmin: null,
  builderButtons: [], // holds button data for the form
  activeSection: 'dashboard',
  apiUrl: '',
  apiKey: '',
  lineChart: null // ChartJS instance
};

// DOM Elements
const sections = {
  dashboard: document.getElementById('sec-dashboard'),
  'landing-pages': document.getElementById('sec-landing-pages'),
  builder: document.getElementById('sec-builder'),
  analytics: document.getElementById('sec-analytics'),
  'activity-logs': document.getElementById('sec-activity-logs'),
  settings: document.getElementById('sec-settings')
};

// Initial Setup
document.addEventListener("DOMContentLoaded", function() {
  initSettings();
  setupEventListeners();
  checkSession();
  fetchIp(); // Pre-fetch IP in the background
});

// 1. Settings & API URL Configuration
function initSettings() {
  // Load from CONFIG first, fallback to localStorage
  let savedUrl = localStorage.getItem("covermark_api_url");
  let savedKey = localStorage.getItem("covermark_api_key");
  
  if (typeof CONFIG !== 'undefined') {
    STATE.apiUrl = CONFIG.API_URL || savedUrl || '';
    STATE.apiKey = CONFIG.API_KEY || savedKey || 'COVERMARK_SECRET_API_KEY';
  } else {
    STATE.apiUrl = savedUrl || '';
    STATE.apiKey = savedKey || 'COVERMARK_SECRET_API_KEY';
  }
  
  // Populate Settings form
  document.getElementById('settings-api-url').value = STATE.apiUrl;
  document.getElementById('settings-api-key').value = STATE.apiKey;
  
  updateApiBadge();
}

function updateApiBadge() {
  const badge = document.getElementById('api-status-badge');
  if (STATE.apiUrl) {
    badge.innerText = "API Configured";
    badge.className = "badge badge-published";
    badge.style.color = "#2E7D32";
  } else {
    badge.innerText = "No API URL Configured";
    badge.className = "badge badge-expired";
    badge.style.color = "#E53935";
  }
}

// 2. Authentication Logic
function checkSession() {
  // Use localStorage so session persists across tab closes & browser restarts
  const sessionStr = localStorage.getItem("covermark_admin_session");
  if (sessionStr) {
    try {
      STATE.currentAdmin = JSON.parse(sessionStr);
      document.getElementById('display-admin-name').innerText = STATE.currentAdmin.name;
      document.getElementById('display-admin-role').innerText = STATE.currentAdmin.role === 'super_admin' ? 'Super Admin' : 'Admin';
      
      document.getElementById('login-overlay').style.display = 'none';
      document.getElementById('app-container').style.display = 'flex';
      
      // Auto-load data for initial active section
      loadSectionData(STATE.activeSection);
    } catch (e) {
      localStorage.removeItem("covermark_admin_session");
      showLoginForm();
    }
  } else {
    showLoginForm();
  }
}

function showLoginForm() {
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  const txt = document.getElementById('login-error-text');
  if (el && txt) {
    txt.textContent = msg;
    el.style.display = 'flex';
  }
}

function clearLoginError() {
  const el = document.getElementById('login-error');
  if (el) el.style.display = 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  clearLoginError();
  
  // Disable submit button & show loading state to improve UX (prevent double click)
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #ffffff; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; box-sizing: border-box;"></span>
    กำลังตรวจสอบข้อมูล...
  `;

  const empId = document.getElementById('login-emp-id').value;
  const password = document.getElementById('login-password').value;
  
  if (!STATE.apiUrl) {
    showLoginError("ไม่พบการตั้งค่า API URL กรุณาติดต่อผู้ดูแลระบบ");
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
    return;
  }
  
  try {
    const ip = await fetchIp();
    const response = await fetch(STATE.apiUrl, {
      method: "POST",
      body: JSON.stringify({
        action: "login",
        apiKey: STATE.apiKey,
        employeeId: empId,
        password: password,
        ip: ip
      })
    });
    
    const result = await response.json();
    if (result.success) {
      // Save to localStorage — persists across tab close/reopen
      localStorage.setItem("covermark_admin_session", JSON.stringify(result.data));
      checkSession();
    } else {
      showLoginError(result.message || "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง");
      // Shake effect on inputs
      const form = document.getElementById('login-form');
      form.style.animation = 'none';
      form.offsetHeight; // reflow
      form.style.animation = 'loginShake 0.4s ease';
      // Reset button on failure
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  } catch (err) {
    console.error(err);
    showLoginError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองอีกครั้ง");
    // Reset button on error
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
  }
}

async function handleLogout() {
  const ip = await fetchIp();
  // Call logout action in background (optional logging)
  if (STATE.apiUrl && STATE.currentAdmin) {
    fetch(STATE.apiUrl, {
      method: "POST",
      body: JSON.stringify({
        action: "trackClick", // simple call or use custom logout log if desired
        apiKey: STATE.apiKey,
        admin: STATE.currentAdmin.name,
        ip: ip
      })
    }).catch(e => console.error(e));
  }
  
  localStorage.removeItem("covermark_admin_session");
  STATE.currentAdmin = null;
  showToast("ออกจากระบบแล้ว", "success");
  showLoginForm();
}

let clientIpCached = null;
async function fetchIp() {
  if (clientIpCached) return clientIpCached;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    clientIpCached = data.ip;
    return clientIpCached;
  } catch (e) {
    return "127.0.0.1";
  }
}

// 3. Navigation & Routing
function navigateToSection(target) {
  // Update sidebar active link
  document.querySelectorAll('.sidebar-item').forEach(item => {
    if (item.getAttribute('data-target') === target) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Toggle content sections
  for (const key in sections) {
    if (key === target) {
      sections[key].classList.add('active');
    } else {
      sections[key].classList.remove('active');
    }
  }
  
  STATE.activeSection = target;
  
  // Set header page title
  let title = "แดชบอร์ด";
  switch (target) {
    case "dashboard": title = "แดชบอร์ด"; break;
    case "landing-pages": title = "รายการ Landing Pages"; break;
    case "builder": title = "สร้าง/แก้ไข Landing Page"; break;
    case "analytics": title = "สถิติและการวิเคราะห์"; break;
    case "activity-logs": title = "ประวัติกิจกรรมของระบบ"; break;
    case "settings": title = "ตั้งค่าการเชื่อมต่อ API"; break;
  }
  document.getElementById('page-title').innerText = title;
  
  // Load data for the section
  loadSectionData(target);
  
  // Auto-close sidebar on mobile
  document.getElementById('sidebar').classList.remove('active');
}

function loadSectionData(section) {
  if (!STATE.apiUrl) return;
  
  switch (section) {
    case "dashboard":
      loadDashboardData();
      break;
    case "landing-pages":
      loadLandingPagesList();
      break;
    case "analytics":
      loadAnalyticsData();
      break;
    case "activity-logs":
      loadActivityLogs();
      break;
  }
}

// 4. Data Loading - Dashboard View
async function loadDashboardData(forceRefresh = false) {
  const bgRefresh = () => {
    fetch(`${STATE.apiUrl}?action=getLandingPages&apiKey=${STATE.apiKey}`)
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          STATE.landingPages = result.data;
          saveCache('cvm_lp', result.data);
          updateDashboardStatsView();
          loadRecentActivities();
        }
      })
      .catch(err => console.error("Silent dashboard refresh error", err));
  };

  // 1. In-memory hit
  if (STATE.landingPages && STATE.landingPages.length > 0 && !forceRefresh) {
    updateDashboardStatsView();
    loadRecentActivities();
    bgRefresh();
    return;
  }

  // 2. localStorage cache hit (survives page refresh)
  const cached = loadCache('cvm_lp');
  if (cached && !forceRefresh) {
    STATE.landingPages = cached;
    updateDashboardStatsView();
    loadRecentActivities();
    bgRefresh();
    return;
  }

  showToast("กำลังดึงข้อมูลแดชบอร์ด...", "info");
  try {
    const response = await fetch(`${STATE.apiUrl}?action=getLandingPages&apiKey=${STATE.apiKey}`);
    const result = await response.json();
    if (result.success) {
      STATE.landingPages = result.data;
      saveCache('cvm_lp', result.data);
      updateDashboardStatsView();
      loadRecentActivities(true);
    }
  } catch (err) {
    console.error(err);
    showToast("ไม่สามารถดึงข้อมูลแคมเปญได้: " + err.message, "danger");
  }
}

function updateDashboardStatsView() {
  const total = STATE.landingPages.length;
  let published = 0;
  let draft = 0;
  let expired = 0;
  
  const now = new Date();
  STATE.landingPages.forEach(lp => {
    if (lp.expire_at && now > new Date(lp.expire_at)) {
      expired++;
    } else if (lp.status === "published") {
      published++;
    } else {
      draft++;
    }
  });
  
  document.getElementById('stat-total-pages').innerText = total;
  document.getElementById('stat-published-pages').innerText = published;
  document.getElementById('stat-draft-pages').innerText = draft;
  document.getElementById('stat-expired-pages').innerText = expired;
}

async function loadRecentActivities(forceRefresh = false) {
  const renderList = () => {
    const tbody = document.getElementById('dashboard-activity-table-body');
    tbody.innerHTML = "";
    
    const recent = STATE.activityLogs.slice(0, 5);
    if (recent.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">ไม่มีประวัติกิจกรรมล่าสุด</div></td></tr>`;
      return;
    }
    
    recent.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatThaiDateTime(log.created_at)}</td>
        <td><strong>${log.admin}</strong></td>
        <td><span class="badge ${getLogActionClass(log.action)}">${translateAction(log.action)}</span></td>
        <td>${log.table}</td>
        <td><span style="font-family:monospace; font-size:12px;">${log.record_id || '-'}</span></td>
      `;
      tbody.appendChild(tr);
    });
  };

  // 1. In-memory hit
  if (STATE.activityLogs && STATE.activityLogs.length > 0 && !forceRefresh) {
    renderList();
    fetch(`${STATE.apiUrl}?action=getActivityLogs&apiKey=${STATE.apiKey}`)
      .then(res => res.json())
      .then(result => { if (result.success) { STATE.activityLogs = result.data; saveCache('cvm_logs', result.data); renderList(); } })
      .catch(e => console.error("Silent recent activity logs reload error", e));
    return;
  }

  // 2. localStorage cache hit
  const cachedLogs = loadCache('cvm_logs');
  if (cachedLogs && !forceRefresh) {
    STATE.activityLogs = cachedLogs;
    renderList();
    fetch(`${STATE.apiUrl}?action=getActivityLogs&apiKey=${STATE.apiKey}`)
      .then(res => res.json())
      .then(result => { if (result.success) { STATE.activityLogs = result.data; saveCache('cvm_logs', result.data); renderList(); } })
      .catch(e => console.error("Silent recent activity logs reload error", e));
    return;
  }
  
  try {
    const response = await fetch(`${STATE.apiUrl}?action=getActivityLogs&apiKey=${STATE.apiKey}`);
    const result = await response.json();
    if (result.success) {
      STATE.activityLogs = result.data;
      saveCache('cvm_logs', result.data);
      renderList();
    }
  } catch (err) {
    console.error(err);
  }
}

// 5. Data Loading - Landing Pages View
async function loadLandingPagesList(forceRefresh = false) {
  const tbody = document.getElementById('landing-pages-table-body');
  const bgRefresh = () => {
    fetch(`${STATE.apiUrl}?action=getLandingPages&apiKey=${STATE.apiKey}`)
      .then(res => res.json())
      .then(result => { if (result.success) { STATE.landingPages = result.data; saveCache('cvm_lp', result.data); renderLandingPagesTable(); } })
      .catch(err => console.error("Silent list refresh error", err));
  };

  // 1. In-memory hit
  if (STATE.landingPages && STATE.landingPages.length > 0 && !forceRefresh) {
    renderLandingPagesTable();
    bgRefresh();
    return;
  }

  // 2. localStorage cache hit
  const cached = loadCache('cvm_lp');
  if (cached && !forceRefresh) {
    STATE.landingPages = cached;
    renderLandingPagesTable();
    bgRefresh();
    return;
  }

  tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">กำลังดึงข้อมูลแคมเปญทั้งหมด...</div></td></tr>`;
  try {
    const response = await fetch(`${STATE.apiUrl}?action=getLandingPages&apiKey=${STATE.apiKey}`);
    const result = await response.json();
    if (result.success) {
      STATE.landingPages = result.data;
      saveCache('cvm_lp', result.data);
      renderLandingPagesTable();
    } else {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state text-danger">${result.message}</div></td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state text-danger">ไม่สามารถโหลดข้อมูลได้ (${err.message})</div></td></tr>`;
  }
}

function renderLandingPagesTable() {
  const tbody = document.getElementById('landing-pages-table-body');
  tbody.innerHTML = "";
  
  // Get filter settings
  const searchQuery = document.getElementById('lp-search-input').value.toLowerCase().trim();
  const statusFilter = document.getElementById('lp-status-filter').value;
  const sortBy = document.getElementById('lp-sort-select').value;
  
  let filtered = [...STATE.landingPages];
  const now = new Date();
  
  // Filter search
  if (searchQuery) {
    filtered = filtered.filter(lp => 
      (lp.title && lp.title.toLowerCase().includes(searchQuery)) ||
      (lp.headline && lp.headline.toLowerCase().includes(searchQuery)) ||
      (lp.slug && lp.slug.toLowerCase().includes(searchQuery))
    );
  }
  
  // Filter status
  if (statusFilter !== "all") {
    filtered = filtered.filter(lp => {
      const isExpired = lp.expire_at && now > new Date(lp.expire_at);
      if (statusFilter === "expired") return isExpired;
      if (statusFilter === "published") return lp.status === "published" && !isExpired;
      if (statusFilter === "draft") return lp.status === "draft" && !isExpired;
    });
  }
  
  // Sort
  filtered.sort((a, b) => {
    if (sortBy === "newest") return new Date(b.created_at) - new Date(a.created_at);
    if (sortBy === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (sortBy === "headline-asc") return (a.title || a.headline || "").localeCompare(b.title || b.headline || "");
    if (sortBy === "headline-desc") return (b.title || b.headline || "").localeCompare(a.title || a.headline || "");
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">ไม่พบข้อมูลแคมเปญตามเงื่อนไขที่ค้นหา</div></td></tr>`;
    return;
  }
  
  filtered.forEach(lp => {
    const isExpired = lp.expire_at && now > new Date(lp.expire_at);
    let statusBadge = `<span class="badge badge-published">เผยแพร่</span>`;
    if (isExpired) {
      statusBadge = `<span class="badge badge-expired">หมดอายุ</span>`;
    } else if (lp.status === "draft") {
      statusBadge = `<span class="badge badge-draft">ร่าง</span>`;
    }
    
    const bannerImg = lp.image_url 
      ? `<img class="thumbnail-preview" src="${lp.image_url}" alt="Banner">`
      : `<div class="thumbnail-preview" style="display:flex; align-items:center; justify-content:center; font-size:18px;">🖼️</div>`;
      
    const buttonsCount = lp.buttons ? lp.buttons.length : 0;
    
    // Construct local / production base path URL
    const publicUrl = `${window.location.origin}/l/${lp.slug}`;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${bannerImg}</td>
      <td><strong>${lp.title || lp.headline || '-'}</strong></td>
      <td><span style="font-family:monospace; color:var(--color-primary); font-weight:600;">/l/${lp.slug}</span></td>
      <td>${buttonsCount} ปุ่ม</td>
      <td>${lp.expire_at ? formatThaiDateTime(lp.expire_at) : 'ไม่มีวันหมดอายุ'}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="action-menu">
          <button class="btn-icon" onclick="copyToClipboard('${publicUrl}')" title="คัดลอกลิงก์">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
            </svg>
          </button>
          <button class="btn-icon" onclick="showQrCodeModal('${lp.slug}')" title="ดาวน์โหลด QR Code">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
            </svg>
          </button>
          <button class="btn-icon" onclick="openEditLandingPageBuilder('${lp.id}')" title="แก้ไข">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
          </button>
          <button class="btn-icon" onclick="duplicateCampaign('${lp.id}')" title="คัดลอกแคมเปญ">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path>
            </svg>
          </button>
          <button class="btn-icon" onclick="openPreviewTab('${lp.slug}')" title="ดูหน้าจริง">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
            </svg>
          </button>
          <button class="btn-icon btn-icon-danger" onclick="confirmDeleteCampaign('${lp.id}', '${(lp.title || lp.headline || '').replace(/'/g, "\\'")}')" title="ลบ">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 6. Campaign CRUD & Action Logic
function openPreviewTab(slug) {
  // Opens landing page with preview parameter which skips analytics view logging and draft filter
  window.open(`landing.html?slug=${slug}&preview=true`, '_blank');
}

function openCreateLandingPageBuilder() {
  // Clear form fields
  document.getElementById('builder-lp-id').value = "";
  document.getElementById('builder-title').value = "";
  document.getElementById('builder-headline').value = "";
  document.getElementById('builder-message').value = "";
  document.getElementById('builder-image-url').value = "";
  document.getElementById('builder-slug').value = "";
  document.getElementById('builder-status').value = "draft";
  document.getElementById('builder-button-layout').value = "vertical";
  document.getElementById('builder-publish-at').value = "";
  document.getElementById('builder-expire-at').value = "";
  document.getElementById('builder-redirect-url').value = "";
  document.getElementById('builder-seo-title').value = "";
  document.getElementById('builder-meta-description').value = "";
  
  document.getElementById('builder-image-preview').style.display = 'none';
  document.getElementById('builder-image-preview').src = '';
  
  document.getElementById('builder-mode-title').innerText = "สร้าง Landing Page ใหม่";
  
  STATE.builderButtons = [];
  renderBuilderButtons();
  
  // Switch to builder view
  navigateToSection('builder');
  
  // Initial live preview update
  updateLivePreview();
}

function openEditLandingPageBuilder(id) {
  const lp = STATE.landingPages.find(item => item.id === id);
  if (!lp) return;
  
  document.getElementById('builder-lp-id').value = lp.id;
  document.getElementById('builder-title').value = lp.title || lp.headline || '';
  document.getElementById('builder-headline').value = lp.headline || '';
  document.getElementById('builder-message').value = lp.message || '';
  document.getElementById('builder-image-url').value = lp.image_url || '';
  document.getElementById('builder-slug').value = lp.slug || '';
  document.getElementById('builder-status').value = lp.status || 'draft';
  document.getElementById('builder-button-layout').value = lp.button_layout || 'vertical';
  
  // Format dates for input-datetime-local format: YYYY-MM-DDTHH:MM
  document.getElementById('builder-publish-at').value = lp.publish_at ? formatIsoToInputDateTime(lp.publish_at) : '';
  document.getElementById('builder-expire-at').value = lp.expire_at ? formatIsoToInputDateTime(lp.expire_at) : '';
  document.getElementById('builder-redirect-url').value = lp.redirect_url || '';
  document.getElementById('builder-seo-title').value = lp.seo_title || '';
  document.getElementById('builder-meta-description').value = lp.meta_description || '';
  
  const previewImg = document.getElementById('builder-image-preview');
  if (lp.image_url) {
    previewImg.src = lp.image_url;
    previewImg.style.display = 'block';
  } else {
    previewImg.style.display = 'none';
    previewImg.src = '';
  }
  
  document.getElementById('builder-mode-title').innerText = "แก้ไข Landing Page";
  
  // Clone buttons list to prevent accidental edits before saving
  STATE.builderButtons = lp.buttons ? lp.buttons.map(btn => ({ ...btn })) : [];
  renderBuilderButtons();
  
  navigateToSection('builder');
  updateLivePreview();
}

async function duplicateCampaign(id) {
  const lp = STATE.landingPages.find(item => item.id === id);
  if (!lp) return;
  
  showToast("กำลังคัดลอกแคมเปญ...", "info");
  
  try {
    const ip = await fetchIp();
    const response = await fetch(STATE.apiUrl, {
      method: "POST",
      body: JSON.stringify({
        action: "duplicateLandingPage",
        apiKey: STATE.apiKey,
        id: id,
        admin: STATE.currentAdmin.name,
        ip: ip
      })
    });
    const result = await response.json();
    if (result.success) {
      showToast("คัดลอกแคมเปญสำเร็จ (บันทึกเป็นแบบร่าง)", "success");
      clearLocalDataCache();
      loadLandingPagesList();
    } else {
      showToast(result.message || "ล้มเหลว", "danger");
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการคัดลอก: " + err.message, "danger");
  }
}

let lpIdToDelete = null;
function confirmDeleteCampaign(id, headline) {
  lpIdToDelete = id;
  document.getElementById('delete-lp-title-preview').innerText = headline;
  openModal('confirm-delete-modal');
}

// 7. Builder Buttons Rendering & Drag-Drop Sorting
function renderBuilderButtons() {
  const container = document.getElementById('builder-buttons-list-container');
  container.innerHTML = "";
  
  if (STATE.builderButtons.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:20px; border:1px dashed var(--color-border); border-radius:12px; font-size:13px; color:var(--color-text-muted);">ยังไม่มีปุ่มลิงก์ในหน้าเพจนี้ กรุณากดปุ่มเพิ่มปุ่มด้านบน</div>`;
    return;
  }
  
  // Sort in builder using sort_order parameter
  STATE.builderButtons.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  
  STATE.builderButtons.forEach((btn, index) => {
    const item = document.createElement('div');
    item.className = 'button-item';
    item.setAttribute('draggable', 'true');
    item.setAttribute('data-index', index);
    
    // Setup Drag Event Listeners
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);
    
    item.innerHTML = `
      <div class="drag-handle">☰</div>
      <div class="button-fields">
        <!-- Title -->
        <div class="input-group">
          <input type="text" class="input-control btn-title-input" placeholder="ข้อความบนปุ่ม" value="${btn.title || ''}" oninput="updateButtonData(${index}, 'title', this.value)">
        </div>
        <!-- Style -->
        <div class="input-group">
          <select class="input-control btn-style-input" onchange="updateButtonData(${index}, 'style', this.value)">
            <option value="primary" ${btn.style === 'primary' ? 'selected' : ''}>ปุ่มสีเขียวหลัก (Primary)</option>
            <option value="secondary" ${btn.style === 'secondary' ? 'selected' : ''}>ปุ่มสีเขียวรอง (Secondary)</option>
            <option value="outline" ${btn.style === 'outline' ? 'selected' : ''}>ปุ่มกรอบเส้นโครง (Outline)</option>
          </select>
        </div>
        <!-- URL -->
        <div class="input-group full-width">
          <input type="url" class="input-control btn-url-input" placeholder="ลิงก์ปลายทาง (https://...)" value="${btn.url || ''}" oninput="updateButtonData(${index}, 'url', this.value)">
          
          <!-- Simple UTM helper shortcut -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 6px;">
            <span style="font-size:10px; color:var(--color-text-muted);">UTM Builder:</span>
            <button type="button" class="btn btn-outline btn-sm" style="padding: 2px 6px; font-size:10px; border-radius:4px;" onclick="appendUtmTags(${index})">ใส่ UTM LINE อัตโนมัติ</button>
          </div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        <button type="button" class="btn-icon btn-icon-danger" onclick="deleteBuilderButton(${index})" title="ลบปุ่ม">&times;</button>
        <!-- Reorder buttons up/down for mobile/keyboard users -->
        <button type="button" class="btn-icon" style="font-size:10px;" onclick="moveButtonOrder(${index}, -1)" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn-icon" style="font-size:10px;" onclick="moveButtonOrder(${index}, 1)" ${index === STATE.builderButtons.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    `;
    container.appendChild(item);
  });
  
  updateLivePreview();
}

function updateButtonData(index, field, value) {
  STATE.builderButtons[index][field] = value;
  updateLivePreview();
}

function deleteBuilderButton(index) {
  STATE.builderButtons.splice(index, 1);
  renderBuilderButtons();
}

function moveButtonOrder(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= STATE.builderButtons.length) return;
  
  // Swap elements
  const temp = STATE.builderButtons[index];
  STATE.builderButtons[index] = STATE.builderButtons[targetIndex];
  STATE.builderButtons[targetIndex] = temp;
  
  // Re-assign sort_orders
  STATE.builderButtons.forEach((btn, idx) => {
    btn.sort_order = idx;
  });
  
  renderBuilderButtons();
}

// HTML5 Drag and Drop Handlers
let dragSrcEl = null;

function handleDragStart(e) {
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.getAttribute('data-index'));
  this.style.opacity = '0.4';
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
  const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
  const toIndex = parseInt(this.getAttribute('data-index'), 10);
  
  if (fromIndex !== toIndex) {
    const movedItem = STATE.builderButtons.splice(fromIndex, 1)[0];
    STATE.builderButtons.splice(toIndex, 0, movedItem);
    
    // Re-assign sort_orders
    STATE.builderButtons.forEach((btn, idx) => {
      btn.sort_order = idx;
    });
    
    renderBuilderButtons();
  }
  return false;
}

function handleDragEnd(e) {
  this.style.opacity = '1.0';
  document.querySelectorAll('.button-item').forEach(item => {
    item.style.opacity = '1.0';
  });
}

function appendUtmTags(index) {
  const btn = STATE.builderButtons[index];
  if (!btn.url) {
    showToast("กรุณากรอกลิงก์ปลายทางก่อนเพื่อทำ UTM", "danger");
    return;
  }
  
  const slug = document.getElementById('builder-slug').value || 'campaign';
  
  try {
    const urlObj = new URL(btn.url);
    urlObj.searchParams.set("utm_source", "line");
    urlObj.searchParams.set("utm_medium", "oa");
    urlObj.searchParams.set("utm_campaign", slug);
    
    // Also include button title in content if possible
    if (btn.title) {
      urlObj.searchParams.set("utm_content", encodeURIComponent(btn.title));
    }
    
    STATE.builderButtons[index].url = urlObj.toString();
    renderBuilderButtons();
    showToast("เพิ่ม UTM Tags เรียบร้อย", "success");
  } catch (err) {
    showToast("ลิงก์รูปแบบไม่ถูกต้อง กรุณากรอกลิงก์ขึ้นต้นด้วย http:// หรือ https://", "danger");
  }
}

// 8. Real-Time Live Preview Update
function updateLivePreview() {
  const headline = document.getElementById('builder-headline').value.trim();
  const message = document.getElementById('builder-message').value.trim();
  const imageUrl = document.getElementById('builder-image-url').value;
  const slug = document.getElementById('builder-slug').value || "covermark-slug";
  
  const prevHeadline = document.getElementById('prev-headline');
  if (headline) {
    prevHeadline.innerText = headline;
    prevHeadline.style.display = 'block';
  } else {
    prevHeadline.style.display = 'none';
  }
  
  const prevMsg = document.getElementById('prev-message');
  if (message) {
    prevMsg.innerText = message;
    prevMsg.style.display = 'block';
  } else {
    prevMsg.style.display = 'none';
  }

  // Hide the .phone-content container if there is no text to display
  const prevContent = document.querySelector('.phone-content');
  if (prevContent) {
    if (headline || message) {
      prevContent.style.display = 'block';
    } else {
      prevContent.style.display = 'none';
    }
  }
  
  document.getElementById('builder-slug-preview-text').innerText = slug;
  
  const prevBanner = document.getElementById('prev-banner');
  if (imageUrl) {
    prevBanner.src = imageUrl;
    prevBanner.style.display = 'block';
  } else {
    prevBanner.style.display = 'none';
  }
  
  // Preview Buttons
  const btnContainer = document.getElementById('prev-buttons-container');
  btnContainer.innerHTML = "";
  
  const buttonLayout = document.getElementById('builder-button-layout').value;
  if (buttonLayout === 'horizontal') {
    btnContainer.className = 'phone-buttons layout-horizontal';
  } else {
    btnContainer.className = 'phone-buttons';
  }
  
  STATE.builderButtons.forEach(btn => {
    const previewBtn = document.createElement('div');
    previewBtn.className = `phone-btn phone-btn-${btn.style || 'primary'}`;
    previewBtn.innerText = btn.title || 'ข้อความปุ่ม';
    btnContainer.appendChild(previewBtn);
  });
}

function setImageUploadLoading(isLoading) {
  const zone = document.getElementById('builder-image-zone');
  const spinner = document.getElementById('image-upload-spinner');
  if (!zone || !spinner) return;
  
  if (isLoading) {
    zone.style.opacity = "0.5";
    zone.style.pointerEvents = "none";
    spinner.style.display = 'flex';
  } else {
    zone.style.opacity = "1";
    zone.style.pointerEvents = "auto";
    spinner.style.display = 'none';
  }
}

// Client-side image resize & compression using canvas (max size 1200px width, 0.8 quality Jpeg)
async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  setImageUploadLoading(true);
  
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = function(event) {
    const img = new Image();
    img.src = event.target.result;
    img.onerror = function() {
      setImageUploadLoading(false);
      showToast("ไฟล์รูปภาพไม่ถูกต้องหรือไม่สามารถประมวลผลได้", "danger");
    };
    img.onload = function() {
      try {
        // Create Canvas
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        // Target Dimensions (max width 1200px)
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 1200;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        // Compress to JPEG with 0.8 quality
        const base64Data = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
        
        // Upload to GAS
        uploadBase64Image(file.name, "image/jpeg", base64Data);
      } catch (err) {
        setImageUploadLoading(false);
        showToast("เกิดข้อผิดพลาดในการปรับขนาดภาพ", "danger");
      }
    };
  };
  reader.onerror = function() {
    setImageUploadLoading(false);
    showToast("ไม่สามารถอ่านไฟล์รูปภาพได้", "danger");
  };
}

async function uploadBase64Image(fileName, mimeType, base64Data) {
  try {
    const ip = await fetchIp();
    const response = await fetch(STATE.apiUrl, {
      method: "POST",
      body: JSON.stringify({
        action: "uploadImage",
        apiKey: STATE.apiKey,
        fileName: fileName,
        mimeType: mimeType,
        base64Data: base64Data,
        admin: STATE.currentAdmin.name,
        ip: ip
      })
    });
    
    const result = await response.json();
    setImageUploadLoading(false);
    
    if (result.success) {
      showToast("อัปโหลดแบนเนอร์สำเร็จ", "success");
      
      const imageUrl = result.data.url;
      document.getElementById('builder-image-url').value = imageUrl;
      
      const previewImg = document.getElementById('builder-image-preview');
      previewImg.src = imageUrl;
      previewImg.style.display = 'block';
      
      updateLivePreview();
    } else {
      showToast(result.message || "การอัปโหลดรูปภาพล้มเหลว", "danger");
    }
  } catch (err) {
    setImageUploadLoading(false);
    showToast("เกิดข้อผิดพลาดในการอัปโหลด: " + err.message, "danger");
  }
}

// Save builder Landing Page
async function saveBuilderLandingPage() {
  const id = document.getElementById('builder-lp-id').value;
  const title = document.getElementById('builder-title').value.trim();
  const headline = document.getElementById('builder-headline').value.trim();
  const message = document.getElementById('builder-message').value.trim();
  const imageUrl = document.getElementById('builder-image-url').value;
  const slug = document.getElementById('builder-slug').value.trim();
  const status = document.getElementById('builder-status').value;
  const buttonLayout = document.getElementById('builder-button-layout').value;
  const publishAt = document.getElementById('builder-publish-at').value;
  const expireAt = document.getElementById('builder-expire-at').value;
  const redirectUrl = document.getElementById('builder-redirect-url').value.trim();
  const seoTitle = document.getElementById('builder-seo-title').value.trim();
  const metaDescription = document.getElementById('builder-meta-description').value.trim();
  
  if (!title || !slug) {
    showToast("กรุณากรอกข้อมูลที่จำเป็น (ชื่อแคมเปญ, Slug) ให้ครบถ้วน", "danger");
    return;
  }
  
  // Format slug cleanly (lowercase, alphanumeric + hyphen)
  const formattedSlug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  
  // Verify buttons are filled
  for (let i = 0; i < STATE.builderButtons.length; i++) {
    const btn = STATE.builderButtons[i];
    if (!btn.title || !btn.url) {
      showToast(`กรุณากรอกข้อมูลปุ่มลำดับที่ ${i+1} ให้สมบูรณ์`, "danger");
      return;
    }
  }
  
  const payload = {
    id: id || undefined,
    title: title,
    headline: headline,
    message: message,
    slug: formattedSlug,
    image_url: imageUrl,
    status: status,
    button_layout: buttonLayout,
    publish_at: publishAt ? new Date(publishAt).toISOString() : '',
    expire_at: expireAt ? new Date(expireAt).toISOString() : '',
    redirect_url: redirectUrl,
    seo_title: seoTitle,
    meta_description: metaDescription,
    buttons: STATE.builderButtons
  };
  
  const action = id ? "updateLandingPage" : "createLandingPage";
  const isEdit = !!id;

  // ── UX: Loading state on save button ──
  const saveBtn = document.getElementById('builder-save-btn');
  const originalBtnHTML = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `
    <span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-radius:50%;border-top-color:#fff;animation:spin 0.8s linear infinite;margin-right:8px;vertical-align:middle;box-sizing:border-box;"></span>
    กำลังบันทึก...
  `;

  showToast("กำลังบันทึกข้อมูล...", "info");
  
  try {
    const ip = await fetchIp();
    const response = await fetch(STATE.apiUrl, {
      method: "POST",
      body: JSON.stringify({
        action: action,
        apiKey: STATE.apiKey,
        data: payload,
        admin: STATE.currentAdmin.name,
        ip: ip
      })
    });
    
    const result = await response.json();
    if (result.success) {
      // ── UX: Show success state on button ──
      saveBtn.innerHTML = `
        <svg fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="width:16px;height:16px;margin-right:6px;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>
        บันทึกสำเร็จ!
      `;
      saveBtn.style.backgroundColor = 'var(--color-success)';

      showToast(isEdit ? "✅ อัปเดตแคมเปญสำเร็จแล้ว" : "✅ สร้างแคมเปญใหม่สำเร็จแล้ว", "success");
      clearLocalDataCache();

      // Navigate after short delay so user sees success state
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnHTML;
        saveBtn.style.backgroundColor = '';
        navigateToSection('landing-pages');
      }, 1500);

    } else {
      showToast(result.message || "บันทึกข้อมูลไม่สำเร็จ", "danger");
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalBtnHTML;
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการบันทึก: " + err.message, "danger");
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalBtnHTML;
  }
}

// 9. Analytics Reporting
async function loadAnalyticsData(forceRefresh = false) {
  const landingId = document.getElementById('analytics-lp-selector').value;
  const range = document.getElementById('analytics-range-selector').value;
  
  try {
    // Populate landing page selector first if empty
    if (document.getElementById('analytics-lp-selector').options.length <= 1) {
      const responseLps = await fetch(`${STATE.apiUrl}?action=getLandingPages&apiKey=${STATE.apiKey}`);
      const resLps = await responseLps.json();
      if (resLps.success) {
        const selector = document.getElementById('analytics-lp-selector');
        selector.innerHTML = `<option value="">ดูรวมทุกแคมเปญ</option>`;
        resLps.data.forEach(lp => {
          const opt = document.createElement('option');
          opt.value = lp.id;
          opt.innerText = lp.title || lp.headline || 'ไม่มีชื่อแคมเปญ';
          selector.appendChild(opt);
        });
        selector.value = landingId;
      }
    }
    
    const cacheKey = `analytics_cache_${landingId || 'all'}_${range}`;
    const renderAnalytics = (data) => {
      STATE.analyticsData = data;
      renderAnalyticsSummary();
      renderAnalyticsChart(range);
      renderAnalyticsButtonsTable();
    };
    
    if (STATE[cacheKey] && !forceRefresh) {
      renderAnalytics(STATE[cacheKey]);
      
      // Background fetch silently
      fetch(`${STATE.apiUrl}?action=getAnalytics&apiKey=${STATE.apiKey}&landingId=${landingId}&range=${range}`)
        .then(res => res.json())
        .then(result => {
          if (result.success) {
            STATE[cacheKey] = result.data;
            renderAnalytics(result.data);
          }
        })
        .catch(err => console.error("Silent analytics refresh error", err));
      return;
    }
    
    showToast("กำลังคำนวณข้อมูลสถิติ...", "info");
    
    const url = `${STATE.apiUrl}?action=getAnalytics&apiKey=${STATE.apiKey}&landingId=${landingId}&range=${range}`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.success) {
      STATE[cacheKey] = result.data;
      renderAnalytics(result.data);
    }
  } catch (err) {
    showToast("ไม่สามารถโหลดสถิติวิเคราะห์ได้: " + err.message, "danger");
  }
}

function renderAnalyticsSummary() {
  const chartData = STATE.analyticsData.chartData;
  let totalViews = 0;
  let totalUniques = 0;
  let totalClicks = 0;
  
  chartData.forEach(row => {
    totalViews += row.views;
    totalUniques += row.unique_visitors;
    totalClicks += row.clicks;
  });
  
  document.getElementById('anal-total-views').innerText = totalViews.toLocaleString();
  document.getElementById('anal-total-uniques').innerText = totalUniques.toLocaleString();
  document.getElementById('anal-total-clicks').innerText = totalClicks.toLocaleString();
  
  // CTR Calculation (clicks / views)
  const ctr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : 0;
  document.getElementById('anal-avg-ctr').innerText = ctr + "%";
}

function renderAnalyticsChart(range) {
  const chartData = STATE.analyticsData.chartData;
  const ctx = document.getElementById('analytics-line-chart').getContext('2d');
  
  // Format Labels
  const labels = chartData.map(row => row.date);
  const viewsData = chartData.map(row => row.views);
  const uniquesData = chartData.map(row => row.unique_visitors);
  const clicksData = chartData.map(row => row.clicks);
  
  if (STATE.lineChart) {
    STATE.lineChart.destroy();
  }
  
  STATE.lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Views (ยอดชม)',
          data: viewsData,
          borderColor: '#015C46',
          backgroundColor: 'rgba(1, 92, 70, 0.05)',
          tension: 0.25,
          fill: true
        },
        {
          label: 'Unique Visitors (คนเข้าชม)',
          data: uniquesData,
          borderColor: '#0E7A5F',
          backgroundColor: 'rgba(14, 122, 95, 0.05)',
          tension: 0.25,
          fill: false
        },
        {
          label: 'Button Clicks (ยอดกดปุ่ม)',
          data: clicksData,
          borderColor: '#E53935',
          backgroundColor: 'rgba(229, 57, 53, 0.05)',
          tension: 0.25,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: '#eff2f1'
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: {
              family: 'Noto Sans Thai'
            }
          }
        }
      }
    }
  });
}

function renderAnalyticsButtonsTable() {
  const tbody = document.getElementById('analytics-buttons-table-body');
  tbody.innerHTML = "";
  
  const list = STATE.analyticsData.topButtons;
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">ไม่มีข้อมูลการคลิกสำหรับช่วงเวลานี้</div></td></tr>`;
    return;
  }
  
  list.forEach(btn => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${btn.title}</strong></td>
      <td>${btn.clicks.toLocaleString()} ครั้ง</td>
    `;
    tbody.appendChild(tr);
  });
}

// 10. Activity Logs & Version History Diff Viewer
async function loadActivityLogs(forceRefresh = false) {
  const tbody = document.getElementById('activity-logs-table-body');
  const bgRefresh = () => {
    fetch(`${STATE.apiUrl}?action=getActivityLogs&apiKey=${STATE.apiKey}`)
      .then(res => res.json())
      .then(result => { if (result.success) { STATE.activityLogs = result.data; saveCache('cvm_logs', result.data); renderActivityLogsTable(); populateActivityFilters(); } })
      .catch(err => console.error("Silent logs refresh error", err));
  };

  // 1. In-memory hit
  if (STATE.activityLogs && STATE.activityLogs.length > 0 && !forceRefresh) {
    renderActivityLogsTable();
    populateActivityFilters();
    bgRefresh();
    return;
  }

  // 2. localStorage cache hit (survives page refresh)
  const cached = loadCache('cvm_logs');
  if (cached && !forceRefresh) {
    STATE.activityLogs = cached;
    renderActivityLogsTable();
    populateActivityFilters();
    bgRefresh();
    return;
  }

  tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">กำลังดึงล็อกกิจกรรมของระบบ...</div></td></tr>`;
  try {
    const response = await fetch(`${STATE.apiUrl}?action=getActivityLogs&apiKey=${STATE.apiKey}`);
    const result = await response.json();
    if (result.success) {
      STATE.activityLogs = result.data;
      saveCache('cvm_logs', result.data);
      renderActivityLogsTable();
      populateActivityFilters();
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state text-danger">ไม่สามารถโหลดข้อมูลล็อกได้ (${err.message})</div></td></tr>`;
  }
}

function populateActivityFilters() {
  const adminFilter = document.getElementById('log-admin-filter');
  if (adminFilter.options.length <= 1) {
    // Collect unique admin names
    const admins = [...new Set(STATE.activityLogs.map(log => log.admin))];
    admins.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.innerText = name;
      adminFilter.appendChild(opt);
    });
  }
}

function renderActivityLogsTable() {
  const tbody = document.getElementById('activity-logs-table-body');
  tbody.innerHTML = "";
  
  const adminFilter = document.getElementById('log-admin-filter').value;
  const actionFilter = document.getElementById('log-action-filter').value;
  const dateFilter = document.getElementById('log-date-filter').value;
  
  let filtered = [...STATE.activityLogs];
  
  if (adminFilter !== "all") {
    filtered = filtered.filter(log => log.admin === adminFilter);
  }
  if (actionFilter !== "all") {
    filtered = filtered.filter(log => log.action === actionFilter);
  }
  if (dateFilter) {
    filtered = filtered.filter(log => log.created_at.substring(0, 10) === dateFilter);
  }
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">ไม่พบข้อมูลประวัติตามเงื่อนไข</div></td></tr>`;
    return;
  }
  
  filtered.forEach(log => {
    // Show compare button only for CRUD update/delete/create actions on landing pages
    let actionBtn = "";
    if (log.table === "LandingPages" && (log.action === "update" || log.action === "delete" || log.action === "create" || log.action === "restore")) {
      actionBtn = `<button class="btn btn-outline btn-sm" onclick="viewLogDiff('${log.id}')" style="padding:4px 8px; font-size:11px;">ดูความต่าง/กู้คืน</button>`;
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatThaiDateTime(log.created_at)}</td>
      <td><strong>${log.admin}</strong></td>
      <td><span class="badge ${getLogActionClass(log.action)}">${translateAction(log.action)}</span></td>
      <td>${log.table}</td>
      <td><span style="font-family:monospace; font-size:12px;">${log.record_id || '-'}</span></td>
      <td>${log.ip || '-'}</td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

function viewLogDiff(logId) {
  const log = STATE.activityLogs.find(item => item.id === logId);
  if (!log) return;
  
  document.getElementById('diff-admin-name').innerText = log.admin;
  document.getElementById('diff-time').innerText = formatThaiDateTime(log.created_at);
  
  const oldBox = document.getElementById('diff-old-box');
  const newBox = document.getElementById('diff-new-box');
  
  let oldJson = null;
  let newJson = null;
  
  try { oldJson = log.old_value ? JSON.parse(log.old_value) : null; } catch(e) {}
  try { newJson = log.new_value ? JSON.parse(log.new_value) : null; } catch(e) {}
  
  oldBox.innerText = oldJson ? JSON.stringify(oldJson, null, 2) : "ไม่มีข้อมูลก่อนหน้านี้";
  newBox.innerText = newJson ? JSON.stringify(newJson, null, 2) : "ไม่มีข้อมูลใหม่";
  
  // Set Restore callback
  const restoreBtn = document.getElementById('diff-restore-btn');
  restoreBtn.onclick = function() {
    restoreHistoricalVersion(logId);
  };
  
  openModal('diff-modal');
}

async function restoreHistoricalVersion(logId) {
  closeModal('diff-modal');
  showToast("กำลังย้อนกู้คืนประวัติแคมเปญ...", "info");
  
  try {
    const ip = await fetchIp();
    const response = await fetch(STATE.apiUrl, {
      method: "POST",
      body: JSON.stringify({
        action: "restoreVersion",
        apiKey: STATE.apiKey,
        logId: logId,
        admin: STATE.currentAdmin.name,
        ip: ip
      })
    });
    
    const result = await response.json();
    if (result.success) {
      showToast("กู้คืนแคมเปญและปุ่มลิงก์ย้อนหลังเสร็จสิ้น", "success");
      clearLocalDataCache();
      loadLandingPagesList();
      navigateToSection('landing-pages');
    } else {
      showToast(result.message || "ล้มเหลว", "danger");
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการกู้คืน: " + err.message, "danger");
  }
}

// 11. QR Code Generator & Modal Setup
function showQrCodeModal(slug) {
  // Construct clean URL
  const publicUrl = `${window.location.origin}/l/${slug}`;
  
  // Clear old canvas
  const container = document.getElementById('qrcode-canvas');
  container.innerHTML = "";
  
  // Populate link field
  const input = document.getElementById('qrcode-link-input');
  input.value = publicUrl;
  
  // Copy URL action
  document.getElementById('qrcode-copy-btn').onclick = function() {
    copyToClipboard(publicUrl);
  };
  
  // Initialize QRCode JS
  const qrcode = new QRCode(container, {
    text: publicUrl,
    width: 200,
    height: 200,
    colorDark : "#015C46",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
  
  // Setup Download
  document.getElementById('qrcode-download-btn').onclick = function() {
    const img = container.querySelector('img');
    if (img) {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = `covermark-qr-${slug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast("ดาวน์โหลดภาพคิวอาร์โค้ดสำเร็จ", "success");
    } else {
      // Try fetching from canvas if image didn't render instantly
      const canvas = container.querySelector('canvas');
      if (canvas) {
        const a = document.createElement('a');
        a.href = canvas.toDataURL("image/png");
        a.download = `covermark-qr-${slug}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast("ดาวน์โหลดภาพคิวอาร์โค้ดสำเร็จ", "success");
      } else {
        showToast("คิวอาร์โค้ดกำลังประมวลผล กรุณาลองใหม่อีกครั้ง", "danger");
      }
    }
  };
  
  openModal('qrcode-modal');
}

// 12. Import / Export CSV Logics
function exportLandingPagesToCSV() {
  if (STATE.landingPages.length === 0) {
    showToast("ไม่มีข้อมูลที่จะส่งออก", "danger");
    return;
  }
  
  // Headers
  let csv = "id,headline,message,slug,image_url,status,publish_at,expire_at,seo_title,meta_description,redirect_url,buttons,title\n";
  
  STATE.landingPages.forEach(lp => {
    // Format buttons: Title1|Url1|Style1, Title2|Url2|Style2
    let btnsFormatted = "";
    if (lp.buttons && lp.buttons.length > 0) {
      btnsFormatted = lp.buttons.map(btn => `${escapeCsv(btn.title)}|${btn.url}|${btn.style}`).join(",");
    }
    
    csv += `"${escapeCsv(lp.id)}","${escapeCsv(lp.headline)}","${escapeCsv(lp.message)}","${escapeCsv(lp.slug)}","${escapeCsv(lp.image_url)}","${escapeCsv(lp.status)}","${escapeCsv(lp.publish_at)}","${escapeCsv(lp.expire_at)}","${escapeCsv(lp.seo_title)}","${escapeCsv(lp.meta_description)}","${escapeCsv(lp.redirect_url)}","${escapeCsv(btnsFormatted)}","${escapeCsv(lp.title || lp.headline || '')}"\n`;
  });
  
  downloadCsvFile(csv, "covermark-campaigns.csv");
}

function exportAnalyticsToCSV() {
  if (!STATE.analyticsData || !STATE.analyticsData.chartData) {
    showToast("ไม่มีข้อมูลสถิติสำหรับการส่งออก", "danger");
    return;
  }
  
  let csv = "date,views,unique_visitors,clicks\n";
  STATE.analyticsData.chartData.forEach(row => {
    csv += `"${row.date}",${row.views},${row.unique_visitors},${row.clicks}\n`;
  });
  
  downloadCsvFile(csv, "covermark-analytics.csv");
}

function openImportCSVModal() {
  document.getElementById('import-csv-file-input').value = "";
  openModal('import-csv-modal');
}

function handleCsvImport() {
  const fileInput = document.getElementById('import-csv-file-input');
  const file = fileInput.files[0];
  
  if (!file) {
    showToast("กรุณาเลือกไฟล์ CSV ก่อน", "danger");
    return;
  }
  
  closeModal('import-csv-modal');
  showToast("กำลังประมวลผลไฟล์ CSV...", "info");
  
  const reader = new FileReader();
  reader.readAsText(file, "UTF-8");
  reader.onload = async function(evt) {
    const text = evt.target.result;
    const parsedRows = parseCsvText(text);
    
    if (parsedRows.length <= 1) {
      showToast("โครงสร้างไฟล์ CSV ไม่ถูกต้อง หรือไม่มีแถวข้อมูล", "danger");
      return;
    }
    
    showToast("กำลังอิมพอร์ตข้อมูลเข้า Spreadsheet โปรดรอสักครู่...", "info");
    
    try {
      const ip = await fetchIp();
      const response = await fetch(STATE.apiUrl, {
        method: "POST",
        body: JSON.stringify({
          action: "importCSV",
          apiKey: STATE.apiKey,
          csvData: parsedRows,
          admin: STATE.currentAdmin.name,
          ip: ip
        })
      });
      const result = await response.json();
      if (result.success) {
        showToast(result.message || "นำเข้าข้อมูล CSV สำเร็จแล้ว", "success");
        clearLocalDataCache();
        loadLandingPagesList();
      } else {
        showToast(result.message || "ล้มเหลว", "danger");
      }
    } catch (err) {
      showToast("เกิดข้อผิดพลาดในการอิมพอร์ต: " + err.message, "danger");
    }
  };
}

// Simple Helper: Escape double quotes inside CSV fields
function escapeCsv(field) {
  if (!field) return "";
  return field.toString().replace(/"/g, '""');
}

function downloadCsvFile(csvContent, fileName) {
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("ส่งออกข้อมูลเป็น CSV สำเร็จแล้ว", "success");
}

// CSV Parser handling quotes and commas
function parseCsvText(text) {
  const lines = [];
  let row = [""];
  let insideQuote = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        // Escaped quote: "" -> "
        row[row.length - 1] += '"';
        i++;
      } else {
        // Toggle quotes flag
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      // New cell
      row.push("");
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      // New line (skip double characters e.g. \r\n)
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

// 13. UI Helper Utilities (Toast, Modal, Date formatter)
function showToast(message, type = "success") {
  const container = document.getElementById('toast-container');
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  
  container.appendChild(toast);
  
  // Fade out and remove after 3s
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3500);
}

function openModal(modalId) {
  document.getElementById(modalId).style.display = "flex";
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = "none";
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("คัดลอกลิงก์ไปยังคลิปบอร์ดแล้วค่ะ", "success");
  }).catch(err => {
    showToast("ไม่สามารถคัดลอกได้อัตโนมัติ กรุณาคัดลอกแมนนวล", "danger");
  });
}

function formatThaiDateTime(isoString) {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "-";
  
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}  ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatIsoToInputDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  
  return `${y}-${m}-${date}T${h}:${min}`;
}

function getLogActionClass(action) {
  switch (action) {
    case "create": return "badge-published";
    case "update": return "badge-draft";
    case "delete": return "badge-expired";
    case "duplicate": return "badge-published";
    case "restore": return "badge-published";
    default: return "badge-draft";
  }
}

function translateAction(action) {
  switch (action) {
    case "create": return "สร้าง";
    case "update": return "แก้ไข";
    case "delete": return "ลบ";
    case "duplicate": return "ทำซ้ำ";
    case "restore": return "กู้คืน";
    case "login": return "ล็อกอิน";
    case "login_failed": return "ล็อกอินล้มเหลว";
    case "upload_image": return "อัปโหลดภาพ";
    default: return action;
  }
}

function clearLocalDataCache() {
  STATE.landingPages = [];
  STATE.activityLogs = [];
  for (const key in STATE) {
    if (key.startsWith("analytics_cache_")) {
      delete STATE[key];
    }
  }
  // Also clear localStorage caches so next load fetches fresh data
  clearDataCaches();
}

// 14. Event Listeners Registration
function setupEventListeners() {
  // Sidebar navigation click
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const target = this.getAttribute('data-target');
      navigateToSection(target);
    });
  });
  
  // Mobile sidebar menu toggle
  const menuToggleBtn = document.getElementById('menu-toggle');
  const sidebarEl = document.getElementById('sidebar');
  const backdropEl = document.getElementById('sidebar-backdrop');

  function openSidebar() {
    sidebarEl.classList.add('active');
    if (backdropEl) backdropEl.classList.add('active');
  }
  function closeSidebar() {
    sidebarEl.classList.remove('active');
    if (backdropEl) backdropEl.classList.remove('active');
  }

  menuToggleBtn.addEventListener('click', () => {
    sidebarEl.classList.contains('active') ? closeSidebar() : openSidebar();
  });

  if (backdropEl) {
    backdropEl.addEventListener('click', closeSidebar);
  }

  // Close sidebar when navigating (mobile UX)
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
  
  // Login Form submit
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  
  // Logout Button click
  document.getElementById('logout-button').addEventListener('click', handleLogout);
  
  // Settings Form submit
  document.getElementById('settings-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const url = document.getElementById('settings-api-url').value.trim();
    const key = document.getElementById('settings-api-key').value.trim();
    
    localStorage.setItem("covermark_api_url", url);
    localStorage.setItem("covermark_api_key", key);
    
    STATE.apiUrl = url;
    STATE.apiKey = key;
    
    updateApiBadge();
    showToast("บันทึกการตั้งค่า API แล้ว", "success");
    checkSession();
  });
  
  // Builder Live Preview listeners
  document.getElementById('builder-headline').addEventListener('input', updateLivePreview);
  document.getElementById('builder-message').addEventListener('input', updateLivePreview);
  document.getElementById('builder-button-layout').addEventListener('change', updateLivePreview);
  document.getElementById('builder-slug').addEventListener('input', updateLivePreview);
  
  // Builder Image Drag/Upload zone
  const dropZone = document.getElementById('builder-image-zone');
  dropZone.addEventListener('click', () => {
    const input = document.getElementById('builder-image-input');
    input.value = ""; // Reset value to allow uploading same image
    input.click();
  });
  
  document.getElementById('builder-image-input').addEventListener('change', handleImageUpload);
  
  // Drag over files
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--color-primary)";
    dropZone.style.backgroundColor = "var(--color-primary-light)";
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = "var(--color-border)";
    dropZone.style.backgroundColor = "#fafbfa";
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--color-border)";
    dropZone.style.backgroundColor = "#fafbfa";
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const input = document.getElementById('builder-image-input');
      input.value = ""; // Reset value to allow uploading same image
      
      // Create a mock DataTransfer file container
      const container = new DataTransfer();
      container.items.add(file);
      input.files = container.files;
      
      // trigger event
      const event = new Event('change');
      input.dispatchEvent(event);
    }
  });
  
  // Add new Button Form in Builder
  document.getElementById('builder-add-button-btn').addEventListener('click', () => {
    const newBtn = {
      id: "BTN" + new Date().getTime() + Math.floor(Math.random() * 1000),
      title: "",
      url: "",
      style: "primary",
      sort_order: STATE.builderButtons.length
    };
    STATE.builderButtons.push(newBtn);
    renderBuilderButtons();
  });
  
  // Builder Save Form
  document.getElementById('builder-save-btn').addEventListener('click', saveBuilderLandingPage);
  
  // Delete Campaign confirmation submit
  document.getElementById('confirm-delete-submit-btn').addEventListener('click', async function() {
    if (!lpIdToDelete) return;
    
    closeModal('confirm-delete-modal');
    showToast("กำลังลบแคมเปญ...", "info");
    
    try {
      const ip = await fetchIp();
      const response = await fetch(STATE.apiUrl, {
        method: "POST",
        body: JSON.stringify({
          action: "deleteLandingPage",
          apiKey: STATE.apiKey,
          id: lpIdToDelete,
          admin: STATE.currentAdmin.name,
          ip: ip
        })
      });
      const result = await response.json();
      if (result.success) {
        showToast("ลบแคมเปญเรียบร้อยแล้ว", "success");
        clearLocalDataCache();
        loadLandingPagesList();
      } else {
        showToast(result.message || "ลบข้อมูลล้มเหลว", "danger");
      }
    } catch (err) {
      showToast("เกิดข้อผิดพลาดในการลบ: " + err.message, "danger");
    } finally {
      lpIdToDelete = null;
    }
  });
  
  // Analytics Filter/Sort changes
  document.getElementById('analytics-lp-selector').addEventListener('change', loadAnalyticsData);
  document.getElementById('analytics-range-selector').addEventListener('change', loadAnalyticsData);
  
  // Landing Pages Search & Filter changes
  document.getElementById('lp-search-input').addEventListener('input', renderLandingPagesTable);
  document.getElementById('lp-status-filter').addEventListener('change', renderLandingPagesTable);
  document.getElementById('lp-sort-select').addEventListener('change', renderLandingPagesTable);
  
  // Activity Log Filter changes
  document.getElementById('log-admin-filter').addEventListener('change', renderActivityLogsTable);
  document.getElementById('log-action-filter').addEventListener('change', renderActivityLogsTable);
  document.getElementById('log-date-filter').addEventListener('change', renderActivityLogsTable);
  
  // CSV Import submit
  document.getElementById('import-csv-submit-btn').addEventListener('click', handleCsvImport);
}
