// =============================================================================
// QuoteLeadsHQ — Dashboard Client (UPDATED WITH AI SETTINGS FIXES)
// =============================================================================
// This file contains fixes for:
// 1. AI Settings form with all required fields
// 2. User type checking for prompt editing (internal vs external)
// 3. Quote follow-up automation settings
// 4. On-site appointment settings
// 5. Call-back settings
// =============================================================================

const SUPABASE_URL = "https://wjadekgptkstfdootuol.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqYWRla2dwdGtzdGZkb290dW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTc3NzQsImV4cCI6MjA5MDU3Mzc3NH0.g45wqe_F9KHh3TVzkq8LimxxT4UiuTZpJZcWkzzD7IM";

// ─── SVG Icon Map ─────────────────────────────────────────────────────────────
const ICONS = {
  dashboard:       `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`,
  briefcase:       `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>`,
  kanban:          `<rect x="2" y="3" width="5" height="18" rx="1"/><rect x="9" y="3" width="5" height="12" rx="1"/><rect x="16" y="3" width="5" height="8" rx="1"/>`,
  users:           `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  file:            `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
  calendar:        `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  chart:           `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  message:         `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  settings:        `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  spark:           `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  team:            `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  plus:            `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  search:          `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  "panel-left":    `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>`,
  "chevron-right": `<polyline points="9 18 15 12 9 6"/>`,
  logout:          `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
  menu:            `<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`,
  sun:             `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
  moon:            `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  trash:           `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`,
  edit:            `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  mail:            `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>`,
  phone:           `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  play:            `<polygon points="5 3 19 12 5 21 5 3"/>`,
  pause:           `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`,
  mic:             `<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>`,
  eye:             `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  "external-link": `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
  clock:           `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  map:             `<polygon points="1 6 1 22 8 18 16 22 21 18 21 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>`,
  "map-pin":       `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  gift:            `<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>`,
  "message-circle": `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>`,
  refresh:           `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
};

function renderIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    const p = ICONS[el.dataset.icon];
    if (p) el.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${p}</svg>`;
  });
}

function updateThemeIcon() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const dark = document.documentElement.dataset.theme === "dark";
  const iconEl = document.getElementById("themeToggleIcon");
  if (iconEl) {
    iconEl.dataset.icon = dark ? "sun" : "moon";
    const p = ICONS[dark ? "sun" : "moon"];
    if (p) iconEl.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${p}</svg>`;
  }
}

// ─── Pipeline stage labels ────────────────────────────────────────────────────
const STAGE_LABELS = {
  new_lead:          "New Lead",
  follow_up:         "Qualifying",
  quote_in_progress: "Quote in Progress",
  quoted:            "Quoted",
  closed_won:        "Closed Won",
  closed_lost:       "Closed Lost",
};

const STAGE_FROM_LABEL = Object.fromEntries(
  Object.entries(STAGE_LABELS).map(([k, v]) => [v, k])
);

function stageLabel(dbVal) { return STAGE_LABELS[dbVal] || dbVal || "—"; }
function stageKey(label)   { return STAGE_FROM_LABEL[label] || label; }

// ─── State ────────────────────────────────────────────────────────────────────
let sb;
let currentUser      = null;
let currentCompanyId = null;
let currentConvId    = null;
let currentLeadId    = null;
let customFields     = [];
let allLeads         = [];
let dragLeadId       = null;
let authInitialized  = false;
let currentUserType  = null;  // 'internal' or 'external' — NEW

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  renderIcons();

  try {
    await waitFor(() => window.supabase, 10000);
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    toast("Failed to connect to authentication service. Please refresh.", true);
    console.error("Supabase init failed:", err);
    return;
  }

  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
  updateThemeIcon();

  // Set up auth state listener FIRST (before checking session)
  sb.auth.onAuthStateChange((_event, session) => {
    if (authInitialized) return;
    authInitialized = true;
    
    if (session?.user) { 
      currentUser = session.user; 
      showApp(); 
    } else { 
      currentUser = null; 
      showAuth(); 
    }
  });

  // Then check existing session
  setTimeout(async () => {
    if (authInitialized) return;
    
    try {
      const { data: { session }, error } = await sb.auth.getSession();
      authInitialized = true;
      
      if (error) {
        console.error("Session check error:", error);
        showAuth();
        return;
      }
      
      if (session?.user) { 
        currentUser = session.user; 
        showApp(); 
      } else { 
        showAuth(); 
      }
    } catch (err) {
      console.error("Session check failed:", err);
      authInitialized = true;
      showAuth();
    }
  }, 100);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const loginForm = document.getElementById("loginForm");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.textContent;
      submitBtn.textContent = "Signing in...";
    }
    emailInput && (emailInput.disabled = true);
    passwordInput && (passwordInput.disabled = true);
    
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email:    emailInput?.value || "",
        password: passwordInput?.value || "",
      });
      
      if (error) {
        toast(error.message, true);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || "Sign In";
        }
        emailInput && (emailInput.disabled = false);
        passwordInput && (passwordInput.disabled = false);
      }
    } catch (err) {
      toast("Login failed. Please try again.", true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText || "Sign In";
      }
      emailInput && (emailInput.disabled = false);
      passwordInput && (passwordInput.disabled = false);
    }
  });

  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    const btn = document.getElementById("logoutButton");
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `<span>Logging out...</span>`;
    }
    
    try {
      await sb.auth.signOut();
      authInitialized = false;
    } catch (err) {
      toast("Logout failed. Please try again.", true);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalText || `<span class="icon" data-icon="logout"></span><span>Log Out</span>`;
        renderIcons();
      }
    }
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  document.querySelectorAll("[data-page]").forEach((btn) =>
    btn.addEventListener("click", () => navigateTo(btn.dataset.page))
  );
  document.querySelectorAll("[data-page-link]").forEach((btn) =>
    btn.addEventListener("click", () => navigateTo(btn.dataset.pageLink))
  );

  // ── Sidebar ───────────────────────────────────────────────────────────────
  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("appView")?.classList.toggle("collapsed");
  });

  document.getElementById("crmToggle")?.addEventListener("click", () => {
    document.getElementById("crmSubmenu")?.classList.toggle("closed");
  });

  // ── Theme ─────────────────────────────────────────────────────────────────
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = dark ? "" : "dark";
    localStorage.setItem("theme", dark ? "light" : "dark");
    updateThemeIcon();
  });

  // ── Lead Modal ────────────────────────────────────────────────────────────
  const doOpenLeadModal = () => { resetLeadForm(); openModal("leadModal"); };
  ["openLeadModalDashboard","openLeadModal","openLeadModalEmpty","openLeadModalPipeline"].forEach((id) =>
    document.getElementById(id)?.addEventListener("click", doOpenLeadModal)
  );
  document.getElementById("cancelLeadModal")?.addEventListener("click", () => closeModal("leadModal"));
  document.getElementById("leadForm")?.addEventListener("submit", handleLeadSave);

  // ── Custom Field Modal ────────────────────────────────────────────────────
  const doOpenCFModal = () => openModal("customFieldModal");
  ["openCustomFieldModalFromLeads","openCustomFieldModalSettings"].forEach((id) =>
    document.getElementById(id)?.addEventListener("click", doOpenCFModal)
  );
  document.getElementById("closeCustomFieldModal")?.addEventListener("click", () => closeModal("customFieldModal"));
  document.getElementById("customFieldForm")?.addEventListener("submit", handleCustomFieldSave);

  // ── New Conversation Modal ────────────────────────────────────────────────
  document.getElementById("openNewConvModal")?.addEventListener("click", openNewConvModal);
  document.getElementById("cancelNewConvModal")?.addEventListener("click", () => closeModal("newConvModal"));
  document.getElementById("newConvForm")?.addEventListener("submit", handleNewConversation);

  // Close modals on backdrop click
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); })
  );

  // ── Settings ──────────────────────────────────────────────────────────────
  document.getElementById("companyProfileForm")?.addEventListener("submit", handleCompanyProfileSave);
  document.getElementById("passwordForm")?.addEventListener("submit", handlePasswordChange);

  // ── AI Settings ───────────────────────────────────────────────────────────
  document.getElementById("aiSettingsForm")?.addEventListener("submit", handleAiSettingsSave);
  document.getElementById("twilioNumberForm")?.addEventListener("submit", handleTwilioNumberSave);

  // ── Voice AI ──────────────────────────────────────────────────────────────
  document.getElementById("voiceAgentForm")?.addEventListener("submit", handleVoiceAgentSave);
  document.getElementById("voiceProviderForm")?.addEventListener("submit", handleVoiceProviderSave);
  document.getElementById("testVoiceAgent")?.addEventListener("click", testVoiceAgent);
  document.getElementById("closeCallDetailModal")?.addEventListener("click", () => closeModal("callDetailModal"));
  document.getElementById("voiceLogsRefresh")?.addEventListener("click", () => { voiceLogsPage = 0; loadVoiceLogs(); });
  document.getElementById("voiceLogsStatus")?.addEventListener("change", () => { voiceLogsPage = 0; loadVoiceLogs(); });
  document.getElementById("voiceLogsDirection")?.addEventListener("change", () => { voiceLogsPage = 0; loadVoiceLogs(); });

  // ── Opportunity Modal ─────────────────────────────────────────────────────
  document.getElementById("closeOpportunityModal")?.addEventListener("click", () => closeModal("opportunityModal"));
  document.getElementById("oppEditLeadBtn")?.addEventListener("click", () => {
    const leadId = document.getElementById("oppModalLeadId")?.value;
    if (leadId) {
      closeModal("opportunityModal");
      openEditLead(leadId);
    }
  });
  document.getElementById("oppCallLeadBtn")?.addEventListener("click", openCallLeadModal);

  // Opportunity tabs
  document.querySelectorAll(".opp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".opp-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".opp-tab-content").forEach((c) => c.classList.add("hidden"));
      tab.classList.add("active");
      const tabName = tab.dataset.tab;
      document.getElementById(`oppTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.remove("hidden");

      // Load tab content
      const leadId = document.getElementById("oppModalLeadId")?.value;
      if (leadId) {
        if (tabName === "conversations") loadOppConversations(leadId);
        if (tabName === "quotes") loadOppQuotes(leadId);
        if (tabName === "appointments") loadOppAppointments(leadId);
        if (tabName === "calls") loadOppCalls(leadId);
      }
    });
  });

  // ── Call Lead Modal ───────────────────────────────────────────────────────
  document.getElementById("cancelCallLeadModal")?.addEventListener("click", () => closeModal("callLeadModal"));
  document.getElementById("confirmCallLead")?.addEventListener("click", handleCallLead);

  // ── Team Members ──────────────────────────────────────────────────────────
  document.getElementById("teamInviteForm")?.addEventListener("submit", handleTeamInvite);

  // ── Conversations ─────────────────────────────────────────────────────────
  document.getElementById("convSendForm")?.addEventListener("submit", handleSendMessage);
  document.getElementById("convAiToggle")?.addEventListener("change", handleAiToggle);

  // ── Search ────────────────────────────────────────────────────────────────
  document.getElementById("globalSearchInput")?.addEventListener("input", handleSearch);

  // ── Quote Modal ──────────────────────────────────────────────────────────
  document.getElementById("openQuoteModal")?.addEventListener("click", openQuoteModalHandler);
  document.getElementById("cancelQuoteModal")?.addEventListener("click", () => closeModal("quoteModal"));
  document.getElementById("quoteForm")?.addEventListener("submit", handleQuoteSave);

  // ── Appointment Modal ────────────────────────────────────────────────────
  document.getElementById("openAppointmentModal")?.addEventListener("click", openAppointmentModalHandler);
  document.getElementById("cancelAppointmentModal")?.addEventListener("click", () => closeModal("appointmentModal"));
  document.getElementById("appointmentForm")?.addEventListener("submit", handleAppointmentSave);

  // ── Sale Modal ───────────────────────────────────────────────────────────
  document.getElementById("openSaleModal")?.addEventListener("click", openSaleModalHandler);
  document.getElementById("cancelSaleModal")?.addEventListener("click", () => closeModal("saleModal"));
  document.getElementById("saleForm")?.addEventListener("submit", handleSaleSave);

  // ── Phone number auto-format (Twilio E.164) ──────────────────────────────
  document.getElementById("leadPhone")?.addEventListener("blur", function () {
    this.value = formatPhoneE164(this.value);
  });
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function waitFor(fn, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (fn()) return resolve();
    const start = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); resolve(); }
      if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error("Timeout")); }
    }, 50);
  });
}

function openModal(id)  { document.getElementById(id)?.classList.add("open"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }

function toast(msg, isError = false) {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = `toast${isError ? " err" : ""}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function fmt(val) {
  if (!val && val !== 0) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD", maximumFractionDigits: 0,
  }).format(val);
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function showAuth() {
  const authView = document.getElementById("authView");
  const appView = document.getElementById("appView");
  
  if (authView) authView.classList.remove("hidden");
  if (appView) appView.classList.add("hidden");
  
  // Reset login form state
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.reset();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
    if (emailInput) emailInput.disabled = false;
    if (passwordInput) passwordInput.disabled = false;
  }
}

async function showApp() {
  const authView = document.getElementById("authView");
  const appView = document.getElementById("appView");
  
  if (authView) authView.classList.add("hidden");
  if (appView) appView.classList.remove("hidden");

  if (!currentUser) {
    toast("Authentication error. Please log in again.", true);
    showAuth();
    return;
  }

  try {
    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("company_id, full_name, phone, role, user_type")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile fetch error:", profileError);
    }

    // Store user type for prompt editing permissions
    if (profile?.user_type) {
      currentUserType = profile.user_type;
    }

    if (profile) {
      currentCompanyId = profile.company_id;
      const sidebarName = document.getElementById("sidebarAccountName");
      const sidebarMeta = document.getElementById("sidebarAccountMeta");
      const sidebarAvatar = document.getElementById("sidebarAvatar");
      
      if (sidebarName) sidebarName.textContent = profile.full_name || currentUser.email || "User";
      if (sidebarMeta) sidebarMeta.textContent = currentUser.email || "";
      
      const initials = (profile.full_name || currentUser.email || "??")
        .split(/[\s@]+/).map((s) => s[0]?.toUpperCase() || "").join("").slice(0, 2);
      if (sidebarAvatar) sidebarAvatar.textContent = initials;
    }

    if (currentCompanyId) {
      const { data: company, error: companyError } = await sb
        .from("companies")
        .select("name")
        .eq("id", currentCompanyId)
        .maybeSingle();
        
      if (companyError) {
        console.error("Company fetch error:", companyError);
      }
      
      if (company?.name) {
        const brandName = document.getElementById("brandCompanyName");
        if (brandName) brandName.textContent = company.name;
      }
    }

    navigateTo("dashboard");
  } catch (err) {
    console.error("Error loading app:", err);
    toast("Error loading dashboard. Please refresh.", true);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const CRM_PAGES = ["opportunities","leads","quotes","appointments","sales"];

const PAGE_META = {
  dashboard:          ["Dashboard",         "A live view of your lead and pipeline workspace."],
  leads:              ["Leads",             "Manage and capture your lead records."],
  opportunities:      ["Opportunities",     "Track deals through your pipeline stages."],
  quotes:             ["Quotes",            "Leads that have been quoted."],
  appointments:       ["Appointments",      "Scheduled appointments and bookings."],
  sales:              ["Sales",             "Closed won and lost performance summary."],
  conversations:      ["Conversations",     "SMS threads with leads."],
  "general-settings": ["Account & Company", "Manage your company and personal profile."],
  "ai-settings":      ["AI Settings",       "Configure your SMS agent and Twilio numbers."],
  "voice-ai":         ["Voice AI",          "Configure VAPI voice agent for calls."],
  "team-members":     ["Team Members",      "Invite and manage your team."],
};

function navigateTo(page) {
  document.querySelectorAll("[data-page]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.page === page)
  );
  const crmToggle = document.getElementById("crmToggle");
  if (crmToggle) crmToggle.classList.toggle("active", CRM_PAGES.includes(page));

  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.remove("hidden");

  const [title, sub] = PAGE_META[page] || [page, ""];
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");
  if (pageTitle) pageTitle.textContent = title;
  if (pageSubtitle) pageSubtitle.textContent = sub;

  const loaders = {
    dashboard:          loadDashboard,
    leads:              loadLeads,
    opportunities:      loadOpportunities,
    quotes:             loadQuotes,
    appointments:       loadAppointments,
    sales:              loadSales,
    conversations:      loadConversations,
    "general-settings": loadSettings,
    "ai-settings":      loadAiSettings,
    "voice-ai":         loadVoiceAi,
    "team-members":     loadTeamMembers,
  };
  loaders[page]?.();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentCompanyId) return;

  try {
    const [{ data: leads }, { data: cf }, { count: quoteCount }] = await Promise.all([
      sb.from("leads").select("id, name, email, pipeline_stage, value, created_at").eq("company_id", currentCompanyId),
      sb.from("custom_fields").select("id").eq("company_id", currentCompanyId),
      sb.from("quotes").select("id", { count: "exact", head: true }).eq("company_id", currentCompanyId),
    ]);

    const all    = leads || [];
    const cfLen  = cf?.length || 0;
    const open   = all.filter((l) => !["closed_won","closed_lost"].includes(l.pipeline_stage)).length;
    const totalQuotes = quoteCount || 0;

    const statLeadCount = document.getElementById("statLeadCount");
    const statOpenPipeline = document.getElementById("statOpenPipeline");
    const statQuotes = document.getElementById("statQuotes");
    const statCustomFields = document.getElementById("statCustomFields");
    
    if (statLeadCount) statLeadCount.textContent = all.length;
    if (statOpenPipeline) statOpenPipeline.textContent = open;
    if (statQuotes) statQuotes.textContent = totalQuotes;
    if (statCustomFields) statCustomFields.textContent = cfLen;

    const weekAgo     = new Date(Date.now() - 7 * 864e5);
    const newThisWeek = all.filter((l) => new Date(l.created_at) > weekAgo).length;
    
    const leadGrowthChip = document.getElementById("leadGrowthChip");
    const qualifyingChip = document.getElementById("qualifyingChip");
    const quoteChip = document.getElementById("quoteChip");
    const customFieldChip = document.getElementById("customFieldChip");
    
    if (leadGrowthChip) leadGrowthChip.textContent = newThisWeek ? `+${newThisWeek} this week` : "No new";
    if (qualifyingChip) qualifyingChip.textContent = `${all.filter((l) => l.pipeline_stage === "follow_up").length} qualifying`;
    if (quoteChip) quoteChip.textContent = `${totalQuotes} quote${totalQuotes === 1 ? "" : "s"}`;
    if (customFieldChip) customFieldChip.textContent = `${cfLen} field${cfLen === 1 ? "" : "s"}`;

    buildLeadVolumeChart(all);
    renderRecentLeads(all.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5));
    renderPipelineSnapshot(all);
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

function buildLeadVolumeChart(leads) {
  const chart = document.getElementById("leadVolumeChart");
  if (!chart) return;
  const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const counts = days.map((d) => {
    const ds = d.toISOString().slice(0, 10);
    return leads.filter((l) => l.created_at?.slice(0, 10) === ds).length;
  });
  const max = Math.max(...counts, 1);
  chart.innerHTML = days.map((d, i) => `
    <div class="bar-col">
      <div class="bar" style="height:${Math.max((counts[i] / max) * 160, 10)}px" title="${counts[i]} leads"></div>
      <span style="font-size:10px;color:var(--muted)">${DAY_LABELS[d.getDay()]}</span>
    </div>`).join("");
}

function renderRecentLeads(leads) {
  const el = document.getElementById("recentLeadsPanel");
  if (!el) return;
  if (!leads.length) {
    el.innerHTML = `<div class="empty"><h3>No leads yet</h3><p>Add your first lead to see it here.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="list">${leads.map((l) => `
    <div class="item" style="grid-template-columns:1.6fr 1fr 1fr">
      <div><h3>${l.name || "—"}</h3><p>${l.email || "—"}</p></div>
      <div><span class="chip">${stageLabel(l.pipeline_stage)}</span></div>
      <div><p style="font-size:11px;color:var(--muted)">${fmtDate(l.created_at)}</p></div>
    </div>`).join("")}</div>`;
}

function renderPipelineSnapshot(leads) {
  const el = document.getElementById("pipelineSnapshotPanel");
  if (!el) return;
  const STAGES = ["new_lead","follow_up","quote_in_progress","quoted","closed_won","closed_lost"];
  if (!leads.length) {
    el.innerHTML = `<div class="empty"><p>No pipeline data yet.</p></div>`;
    return;
  }
  el.innerHTML = STAGES.map((s) => {
    const items = leads.filter((l) => l.pipeline_stage === s);
    const val   = items.reduce((a, l) => a + (Number(l.value) || 0), 0);
    return `<div class="item" style="grid-template-columns:1.4fr 80px 110px">
      <div><h3>${stageLabel(s)}</h3></div>
      <div><p>${items.length} lead${items.length === 1 ? "" : "s"}</p></div>
      <div><p>${val ? fmt(val) : "—"}</p></div>
    </div>`;
  }).join("");
}

// ─── Custom Fields ────────────────────────────────────────────────────────────
async function loadCustomFields() {
  if (!currentCompanyId) return [];
  try {
    const { data } = await sb
      .from("custom_fields")
      .select("*")
      .eq("company_id", currentCompanyId)
      .order("created_at");
    customFields = data || [];
    return customFields;
  } catch (err) {
    console.error("Load custom fields error:", err);
    return [];
  }
}

async function renderCustomFieldInputs(values = {}) {
  await loadCustomFields();
  const el = document.getElementById("customFieldInputs");
  if (!el) return;
  el.innerHTML = customFields.map((f) => `
    <div class="custom-row" style="grid-template-columns:1fr 1fr">
      <div class="field">
        <label>${f.label}</label>
        ${f.type === "textarea"
          ? `<textarea name="cf_${f.key}">${values[f.key] || ""}</textarea>`
          : `<input type="${f.type || "text"}" name="cf_${f.key}" value="${values[f.key] || ""}">`}
      </div>
    </div>`).join("");
}

function renderSettingsCustomFields() {
  const el = document.getElementById("settingsCustomFields");
  if (!el) return;
  if (!customFields.length) {
    el.innerHTML = `<div class="notice">No custom fields yet. Create one below.</div>`;
    return;
  }
  el.innerHTML = `<div class="table-lite">${customFields.map((f) => `
    <div class="row">
      <div><strong style="font-size:13px">${f.label}</strong><span class="muted" style="margin-left:6px">${f.type}</span></div>
      <div><code style="font-size:11px;color:var(--muted)">${f.key}</code></div>
      <button class="iconbtn btn-danger" onclick="deleteCustomField('${f.id}')" type="button">
        <span class="icon" data-icon="trash"></span>
      </button>
    </div>`).join("")}</div>`;
  renderIcons();
}

async function handleCustomFieldSave(e) {
  e.preventDefault();
  const label = document.getElementById("customFieldLabel")?.value.trim();
  const type  = document.getElementById("customFieldType")?.value;
  if (!label) return;
  const key = slugify(label);
  
  try {
    const { error } = await sb.from("custom_fields").insert({
      company_id: currentCompanyId, label, type, key,
    });
    if (error) { toast(error.message, true); return; }
    toast("Custom field added.");
    document.getElementById("customFieldForm")?.reset();
    await loadCustomFields();
    renderSettingsCustomFields();
    await renderCustomFieldInputs();
    
    const statCustomFields = document.getElementById("statCustomFields");
    const customFieldChip = document.getElementById("customFieldChip");
    if (statCustomFields) statCustomFields.textContent = customFields.length;
    if (customFieldChip) customFieldChip.textContent = `${customFields.length} field${customFields.length === 1 ? "" : "s"}`;
  } catch (err) {
    toast("Failed to save custom field.", true);
  }
}

async function deleteCustomField(id) {
  if (!confirm("Delete this custom field? Values stored in leads will be lost.")) return;
  try {
    const { error } = await sb.from("custom_fields").delete().eq("id", id);
    if (error) { toast(error.message, true); return; }
    toast("Custom field deleted.");
    await loadCustomFields();
    renderSettingsCustomFields();
  } catch (err) {
    toast("Failed to delete custom field.", true);
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────
async function loadLeads() {
  if (!currentCompanyId) return;
  await loadCustomFields();
  try {
    const { data, error } = await sb
      .from("leads")
      .select("*")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false });
    if (error) { toast(error.message, true); return; }
    allLeads = data || [];
    renderLeadsTable(allLeads);
  } catch (err) {
    toast("Failed to load leads.", true);
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById("leadsTableBody");
  const empty  = document.getElementById("leadsEmptyState");
  if (!tbody) return;
  if (!leads.length) {
    tbody.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  tbody.innerHTML = leads.map((l) => `
    <tr>
      <td><strong>${l.name || "—"}</strong><span class="muted">${fmtDate(l.created_at)}</span></td>
      <td><strong>${l.email || "—"}</strong>${l.phone ? `<span class="muted">${l.phone}</span>` : ""}</td>
      <td><strong>${l.address || "—"}</strong>${l.postcode ? `<span class="muted">${l.postcode}</span>` : ""}</td>
      <td>${l.source ? `<span class="chip">${l.source}</span>` : "—"}</td>
      <td><span class="chip">${stageLabel(l.pipeline_stage)}</span></td>
      <td style="font-size:12px;color:var(--muted)">${renderCustomDataSummary(l.custom_data)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="iconbtn" onclick="openOpportunityModal('${l.id}')" type="button" title="View Details"><span class="icon" data-icon="eye"></span></button>
          <button class="iconbtn" onclick="callLeadDirect('${l.id}')" type="button" title="Call with AI"><span class="icon" data-icon="phone"></span></button>
          <button class="iconbtn" onclick="openEditLead('${l.id}')" type="button" title="Edit"><span class="icon" data-icon="edit"></span></button>
          <button class="iconbtn btn-danger" onclick="deleteLead('${l.id}')" type="button" title="Delete"><span class="icon" data-icon="trash"></span></button>
        </div>
      </td>
    </tr>`).join("");
  renderIcons();
}

// Quick call function from leads table
async function callLeadDirect(leadId) {
  const lead = allLeads.find((l) => l.id === leadId);
  if (!lead) {
    toast("Lead not found.", true);
    return;
  }

  if (!lead.phone) {
    toast("Lead has no phone number.", true);
    return;
  }

  document.getElementById("callLeadId").value = leadId;
  document.getElementById("callLeadPhone").value = lead.phone;

  await loadVapiAssistants();
  openModal("callLeadModal");
}

function renderCustomDataSummary(data) {
  if (!data || !Object.keys(data).length) return "—";
  return Object.entries(data).slice(0, 2).map(([k, v]) => `<div>${k}: ${v || "—"}</div>`).join("");
}

function resetLeadForm() {
  document.getElementById("leadForm")?.reset();
  const leadId = document.getElementById("leadId");
  const leadModalTitle = document.getElementById("leadModalTitle");
  if (leadId) leadId.value = "";
  if (leadModalTitle) leadModalTitle.textContent = "New Lead";
  renderCustomFieldInputs();
}

async function openEditLead(id) {
  const l = allLeads.find((x) => x.id === id);
  if (!l) return;
  
  const leadModalTitle = document.getElementById("leadModalTitle");
  const leadId = document.getElementById("leadId");
  const leadName = document.getElementById("leadName");
  const leadEmail = document.getElementById("leadEmail");
  const leadPhone = document.getElementById("leadPhone");
  const leadPostcode = document.getElementById("leadPostcode");
  const leadAddress = document.getElementById("leadAddress");
  const leadSource = document.getElementById("leadSource");
  const leadStatus = document.getElementById("leadStatus");
  const leadValue = document.getElementById("leadValue");
  const leadNotes = document.getElementById("leadNotes");
  
  if (leadModalTitle) leadModalTitle.textContent = "Edit Lead";
  if (leadId) leadId.value = l.id;
  if (leadName) leadName.value = l.name || "";
  if (leadEmail) leadEmail.value = l.email || "";
  if (leadPhone) leadPhone.value = l.phone || "";
  if (leadPostcode) leadPostcode.value = l.postcode || "";
  if (leadAddress) leadAddress.value = l.address || "";
  if (leadSource) leadSource.value = l.source || "";
  if (leadStatus) leadStatus.value = stageLabel(l.pipeline_stage) || "New Lead";
  if (leadValue) leadValue.value = l.value || "";
  if (leadNotes) leadNotes.value = l.notes || "";
  
  await renderCustomFieldInputs(l.custom_data || {});
  openModal("leadModal");
}

async function handleLeadSave(e) {
  e.preventDefault();
  const id = document.getElementById("leadId")?.value;

  const custom_data = {};
  customFields.forEach((f) => {
    const el = document.querySelector(`[name="cf_${f.key}"]`);
    if (el) custom_data[f.key] = el.value;
  });

  const payload = {
    company_id: currentCompanyId,
    name:           document.getElementById("leadName")?.value || null,
    email:          document.getElementById("leadEmail")?.value || null,
    phone:          formatPhoneE164(document.getElementById("leadPhone")?.value) || null,
    postcode:       document.getElementById("leadPostcode")?.value || null,
    address:        document.getElementById("leadAddress")?.value || null,
    source:         document.getElementById("leadSource")?.value || null,
    pipeline_stage: stageKey(document.getElementById("leadStatus")?.value || "New Lead"),
    value:          Number(document.getElementById("leadValue")?.value) || null,
    notes:          document.getElementById("leadNotes")?.value || null,
    custom_data,
  };

  try {
    const { error } = id
      ? await sb.from("leads").update(payload).eq("id", id)
      : await sb.from("leads").insert(payload);

    if (error) { toast(error.message, true); return; }
    toast(id ? "Lead updated." : "Lead created.");
    closeModal("leadModal");
    loadLeads();
    loadDashboard();
  } catch (err) {
    toast("Failed to save lead.", true);
  }
}

async function deleteLead(id) {
  if (!confirm("Delete this lead? This cannot be undone.")) return;
  try {
    const { error } = await sb.from("leads").delete().eq("id", id);
    if (error) { toast(error.message, true); return; }
    toast("Lead deleted.");
    loadLeads();
    loadDashboard();
  } catch (err) {
    toast("Failed to delete lead.", true);
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────
function handleSearch(e) {
  const q = e.target?.value?.toLowerCase()?.trim();
  if (!q) { renderLeadsTable(allLeads); return; }
  const filtered = allLeads.filter((l) =>
    [l.name, l.email, l.phone, l.postcode, l.address]
      .some((v) => v?.toLowerCase().includes(q))
  );
  renderLeadsTable(filtered);
}

// ─── Phone Number Auto-Format (E.164 / Twilio) ───────────────────────────────
function formatPhoneE164(raw) {
  if (!raw) return raw;
  let phone = raw.replace(/[\s\-().]/g, "");
  if (phone.startsWith("+")) return phone;
  if (phone.startsWith("0")) {
    phone = "+61" + phone.slice(1);
  } else if (/^\d{9}$/.test(phone)) {
    phone = "+61" + phone;
  }
  return phone;
}

// ─── Populate Lead Selector ──────────────────────────────────────────────────
async function populateLeadSelector(selectId) {
  try {
    const { data: leads } = await sb
      .from("leads")
      .select("id, name, phone, email")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false });
    const sel = document.getElementById(selectId);
    if (sel && leads) {
      sel.innerHTML = `<option value="">— Select a lead —</option>` +
        leads.map((l) => {
          const label = l.name || l.email || l.id;
          const sub = l.phone ? ` · ${l.phone}` : "";
          return `<option value="${l.id}">${label}${sub}</option>`;
        }).join("");
    }
  } catch (err) {
    toast("Failed to load leads.", true);
  }
}

// ─── Quote Modal Handlers ────────────────────────────────────────────────────
async function openQuoteModalHandler() {
  await populateLeadSelector("quoteLeadSelect");
  document.getElementById("quoteForm")?.reset();
  openModal("quoteModal");
}

async function handleQuoteSave(e) {
  e.preventDefault();
  const leadId = document.getElementById("quoteLeadSelect")?.value;
  if (!leadId) { toast("Please select a lead.", true); return; }

  const payload = {
    company_id:   currentCompanyId,
    lead_id:      leadId,
    quote_number: document.getElementById("quoteNumber")?.value || null,
    total:        Number(document.getElementById("quoteTotal")?.value) || null,
    status:       document.getElementById("quoteStatus")?.value || "draft",
    notes:        document.getElementById("quoteNotes")?.value || null,
  };

  try {
    const { error } = await sb.from("quotes").insert(payload);
    if (error) { toast(error.message, true); return; }
    toast("Quote created.");
    closeModal("quoteModal");
    loadQuotes();
  } catch (err) {
    toast("Failed to create quote.", true);
  }
}

// ─── Appointment Modal Handlers ──────────────────────────────────────────────
async function openAppointmentModalHandler() {
  await populateLeadSelector("apptLeadSelect");
  document.getElementById("appointmentForm")?.reset();
  openModal("appointmentModal");
}

async function handleAppointmentSave(e) {
  e.preventDefault();
  const leadId = document.getElementById("apptLeadSelect")?.value;
  if (!leadId) { toast("Please select a lead.", true); return; }

  const payload = {
    company_id:       currentCompanyId,
    lead_id:          leadId,
    title:            document.getElementById("apptTitle")?.value || "Appointment",
    appointment_type: document.getElementById("apptType")?.value || "callback",
    status:           document.getElementById("apptStatus")?.value || "scheduled",
    start_time:       document.getElementById("apptStart")?.value || null,
    end_time:         document.getElementById("apptEnd")?.value || null,
    location:         document.getElementById("apptLocation")?.value || null,
    notes:            document.getElementById("apptNotes")?.value || null,
  };

  try {
    const { error } = await sb.from("appointments").insert(payload);
    if (error) { toast(error.message, true); return; }
    toast("Appointment created.");
    closeModal("appointmentModal");
    loadAppointments();
  } catch (err) {
    toast("Failed to create appointment.", true);
  }
}

// ─── Sale Modal Handlers ─────────────────────────────────────────────────────
async function openSaleModalHandler() {
  await populateLeadSelector("saleLeadSelect");
  document.getElementById("saleForm")?.reset();
  openModal("saleModal");
}

async function handleSaleSave(e) {
  e.preventDefault();
  const leadId = document.getElementById("saleLeadSelect")?.value;
  if (!leadId) { toast("Please select a lead.", true); return; }

  const outcome = document.getElementById("saleOutcome")?.value || "closed_won";
  const value = Number(document.getElementById("saleValue")?.value) || null;
  const notes = document.getElementById("saleNotes")?.value || null;

  try {
    const updatePayload = { pipeline_stage: outcome };
    if (value !== null) updatePayload.value = value;
    if (notes) updatePayload.notes = notes;

    const { error } = await sb.from("leads").update(updatePayload).eq("id", leadId);
    if (error) { toast(error.message, true); return; }
    toast("Sale recorded.");
    closeModal("saleModal");
    loadSales();
  } catch (err) {
    toast("Failed to record sale.", true);
  }
}

// ─── Opportunities / Kanban ───────────────────────────────────────────────────
const KANBAN_STAGES = ["new_lead","follow_up","quote_in_progress","quoted","closed_won","closed_lost"];

async function loadOpportunities() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("leads")
      .select("id, name, email, phone, pipeline_stage, value, created_at")
      .eq("company_id", currentCompanyId);
    allLeads = data || [];
    buildKanban(allLeads);
  } catch (err) {
    toast("Failed to load opportunities.", true);
  }
}

function buildKanban(leads) {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;

  board.innerHTML = KANBAN_STAGES.map((stage) => {
    const cards = leads.filter((l) => l.pipeline_stage === stage);
    return `
      <div class="col"
           data-stage="${stage}"
           ondragover="kanbanDragOver(event)"
           ondrop="kanbanDrop(event,'${stage}')"
           ondragleave="kanbanDragLeave(event)">
        <div class="colhead">
          <b>${stageLabel(stage)}</b><span class="chip">${cards.length}</span>
        </div>
        <div class="cards">
          ${cards.length
            ? cards.map((l) => `
              <div class="kcard"
                   draggable="true"
                   data-lead-id="${l.id}"
                   ondragstart="kanbanDragStart(event,'${l.id}')"
                   ondragend="kanbanDragEnd(event)"
                   onclick="if(!event.target.closest('.kcard-actions')) openOpportunityModal('${l.id}')"
                   style="position:relative;cursor:pointer">
                <h3>${l.name || "—"}</h3>
                <p>${l.email || l.phone || "—"}</p>
                <span class="money">${l.value ? fmt(l.value) : "No value set"}</span>
                <div class="kcard-actions" style="position:absolute;top:8px;right:8px;display:flex;gap:4px;opacity:0;transition:opacity .15s">
                  <button class="iconbtn" style="width:28px;height:28px;min-height:28px" onclick="event.stopPropagation();callLeadDirect('${l.id}')" type="button" title="Call with AI"><span class="icon" data-icon="phone" style="width:12px;height:12px"></span></button>
                </div>
              </div>`).join("")
            : `<div class="kanban-drop-hint">Drop leads here</div>`}
        </div>
      </div>`;
  }).join("");

  // Add hover effect for card actions
  const style = document.createElement('style');
  style.textContent = '.kcard:hover .kcard-actions{opacity:1!important}';
  if (!document.getElementById('kanban-card-styles')) {
    style.id = 'kanban-card-styles';
    document.head.appendChild(style);
  }
}

function kanbanDragStart(event, leadId) {
  dragLeadId = leadId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", leadId);
  setTimeout(() => event.target.classList.add("dragging"), 0);
}

function kanbanDragEnd(event) {
  event.target.classList.remove("dragging");
  document.querySelectorAll(".col.drag-over").forEach((el) => el.classList.remove("drag-over"));
}

function kanbanDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drag-over");
}

function kanbanDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("drag-over");
  }
}

async function kanbanDrop(event, newStage) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");

  const leadId = event.dataTransfer.getData("text/plain") || dragLeadId;
  if (!leadId) return;

  // Optimistic update
  const lead = allLeads.find((l) => l.id === leadId);
  if (lead) lead.pipeline_stage = newStage;
  buildKanban(allLeads);

  try {
    const { error } = await sb.from("leads").update({ pipeline_stage: newStage }).eq("id", leadId);
    if (error) {
      toast(error.message, true);
      loadOpportunities();
    } else {
      toast(`Moved to "${stageLabel(newStage)}"`);
    }
  } catch (err) {
    toast("Failed to update status.", true);
    loadOpportunities();
  }
  dragLeadId = null;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
function buildQuoteLink(token) {
  if (!token) return "";
  return `${window.location.origin}/quote-public.html?token=${encodeURIComponent(token)}`;
}

async function loadQuotes() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("quotes")
      .select("id, quote_number, status, total, notes, created_at, sent_at, viewed_at, accepted_at, quote_token, lead_id, leads(name, email, phone)")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false });
    const quotes = data || [];
    const el = document.getElementById("quotesPanel");
    if (!el) return;
    if (!quotes.length) {
      el.innerHTML = `<div class="empty"><h3>No quotes yet</h3><p>Create a quote from the button above or via AI SMS workflow.</p></div>`;
      return;
    }
    el.innerHTML = `<div class="table-lite">${quotes.map((q) => {
      const lead = q.leads || {};
      const quoteLink = buildQuoteLink(q.quote_token);
      return `
      <div class="row" style="grid-template-columns:1.4fr .7fr .6fr auto">
        <div><strong style="font-size:13px">Quote #${q.quote_number || q.id.slice(0,8)}</strong><span class="muted">${lead.name || lead.email || lead.phone || "—"}</span></div>
        <div><span class="chip">${q.status || "draft"}</span></div>
        <div><strong style="font-size:13px">${fmt(q.total)}</strong><span class="muted">${fmtDate(q.created_at)}</span></div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="downloadQuotePDF('${q.id}')" title="Download PDF"><span class="icon" data-icon="file"></span> PDF</button>
          ${quoteLink ? `<button class="btn" style="padding:4px 10px;font-size:11px" onclick="copyQuoteLink('${quoteLink}')" title="Copy shareable link"><span class="icon" data-icon="external-link"></span> Link</button>` : ""}
        </div>
      </div>`;
    }).join("")}</div>`;
    renderIcons();
  } catch (err) {
    toast("Failed to load quotes.", true);
  }
}

// ─── Copy Quote Link ──────────────────────────────────────────────────────────
function copyQuoteLink(link) {
  navigator.clipboard.writeText(link).then(() => {
    toast("Quote link copied to clipboard!");
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("Quote link copied to clipboard!");
  });
}

// ─── Download Quote PDF ───────────────────────────────────────────────────────
async function downloadQuotePDF(quoteId) {
  if (!currentCompanyId) return;
  try {
    const { data: q } = await sb
      .from("quotes")
      .select("id, quote_number, status, subtotal, tax, total, valid_until, notes, line_items, created_at, sent_at, lead_id, leads(name, email, phone, address)")
      .eq("id", quoteId)
      .single();
    if (!q) { toast("Quote not found.", true); return; }

    const { data: company } = await sb
      .from("companies")
      .select("name, email, phone")
      .eq("id", currentCompanyId)
      .single();

    const lead = q.leads || {};
    const co = company || {};

    // Load jsPDF from CDN if not already loaded
    if (typeof window.jspdf === "undefined") {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        s.integrity = "sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk";
        s.crossOrigin = "anonymous";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont(undefined, "bold");
    doc.text(co.name || "QuoteLeadsHQ", 14, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    if (co.email) { doc.text(co.email + (co.phone ? "  ·  " + co.phone : ""), 14, y); y += 6; }

    // Quote title
    y += 6;
    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text("Quote #" + (q.quote_number || q.id.slice(0,8)), 14, y);
    y += 8;

    // Status + date
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.text("Status: " + (q.status || "Draft").toUpperCase(), 14, y);
    doc.text("Date: " + (q.created_at ? new Date(q.created_at).toLocaleDateString("en-AU") : "—"), pw - 14, y, { align: "right" });
    y += 6;
    if (q.valid_until) {
      doc.text("Valid Until: " + new Date(q.valid_until).toLocaleDateString("en-AU"), 14, y);
      y += 6;
    }

    // Prepared for
    y += 4;
    doc.setFont(undefined, "bold");
    doc.text("Prepared For:", 14, y);
    y += 5;
    doc.setFont(undefined, "normal");
    doc.text(lead.name || "—", 14, y); y += 5;
    if (lead.email) { doc.text(lead.email, 14, y); y += 5; }
    if (lead.phone) { doc.text(lead.phone, 14, y); y += 5; }
    if (lead.address) { doc.text(lead.address, 14, y); y += 5; }

    // Line items
    const items = q.line_items || [];
    if (items.length) {
      y += 8;
      doc.setFont(undefined, "bold");
      doc.text("Line Items", 14, y); y += 6;
      doc.setFont(undefined, "normal");
      doc.setDrawColor(200);
      doc.line(14, y, pw - 14, y); y += 4;
      items.forEach((li) => {
        const desc = li.description || li.name || "Item";
        const qty = li.quantity ? " × " + li.quantity : "";
        const price = "$" + Number(li.total || li.price || 0).toFixed(2);
        doc.text(desc + qty, 14, y);
        doc.text(price, pw - 14, y, { align: "right" });
        y += 6;
      });
      doc.line(14, y, pw - 14, y); y += 4;
    }

    // Totals
    y += 4;
    if (q.subtotal) {
      doc.text("Subtotal:", pw - 60, y);
      doc.text("$" + Number(q.subtotal).toFixed(2), pw - 14, y, { align: "right" }); y += 6;
    }
    if (q.tax) {
      doc.text("Tax:", pw - 60, y);
      doc.text("$" + Number(q.tax).toFixed(2), pw - 14, y, { align: "right" }); y += 6;
    }
    doc.setFont(undefined, "bold");
    doc.setFontSize(14);
    doc.text("Total:", pw - 60, y);
    doc.text("$" + Number(q.total || 0).toFixed(2), pw - 14, y, { align: "right" });
    y += 10;

    // Notes
    if (q.notes) {
      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.text("Notes:", 14, y); y += 5;
      doc.setFont(undefined, "normal");
      const lines = doc.splitTextToSize(q.notes, pw - 28);
      doc.text(lines, 14, y);
    }

    doc.save("Quote-" + (q.quote_number || q.id.slice(0,8)) + ".pdf");
    toast("PDF downloaded.");
  } catch (err) {
    console.error("PDF generation error:", err);
    toast("Failed to generate PDF.", true);
  }
}

// ─── Sales ────────────────────────────────────────────────────────────────────
async function loadSales() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("leads")
      .select("id, name, pipeline_stage, value, created_at")
      .eq("company_id", currentCompanyId)
      .in("pipeline_stage", ["closed_won","closed_lost"])
      .order("created_at", { ascending: false });
    const leads = data || [];
    const el = document.getElementById("salesPanel");
    if (!el) return;

    const won     = leads.filter((l) => l.pipeline_stage === "closed_won");
    const lost    = leads.filter((l) => l.pipeline_stage === "closed_lost");
    const wonVal  = won.reduce((a, l) => a + (Number(l.value) || 0), 0);
    const lostVal = lost.reduce((a, l) => a + (Number(l.value) || 0), 0);
    const winRate = leads.length ? Math.round((won.length / leads.length) * 100) : 0;

    el.innerHTML = `
      <div class="mini-grid" style="margin-bottom:20px">
        <div class="mini-card"><h3>Closed Won</h3><b>${won.length}</b><span class="muted">${fmt(wonVal)} total</span></div>
        <div class="mini-card"><h3>Closed Lost</h3><b>${lost.length}</b><span class="muted">${fmt(lostVal)} lost</span></div>
        <div class="mini-card"><h3>Win Rate</h3><b>${winRate}%</b><span class="muted">of closed deals</span></div>
      </div>
      ${leads.length ? `<div class="table-lite">${leads.map((l) => `
        <div class="row">
          <div><strong style="font-size:13px">${l.name || "—"}</strong><span class="muted">${fmtDate(l.created_at)}</span></div>
          <div><span class="chip">${stageLabel(l.pipeline_stage)}</span></div>
          <div><strong style="font-size:13px">${fmt(l.value)}</strong></div>
        </div>`).join("")}</div>`
        : `<div class="empty"><p>No closed deals yet.</p></div>`}`;
  } catch (err) {
    toast("Failed to load sales data.", true);
  }
}

// ─── Appointments ─────────────────────────────────────────────────────────────
async function loadAppointments() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("appointments")
      .select("id, title, status, start_time, end_time, location, notes, appointment_type, lead_id, leads(name, phone)")
      .eq("company_id", currentCompanyId)
      .order("start_time", { ascending: false });
    const appointments = data || [];
    const el = document.getElementById("appointmentsPanel");
    if (!el) return;

    if (!appointments.length) {
      el.innerHTML = `<div class="empty"><h3>No appointments yet</h3><p>Appointments booked via AI or manually will appear here.</p></div>`;
      return;
    }

    el.innerHTML = `<div class="table-lite">${appointments.map((a) => `
      <div class="row">
        <div>
          <strong style="font-size:13px">${a.title || "Appointment"}</strong>
          <span class="muted">${a.leads?.name || "Unknown lead"}</span>
        </div>
        <div>
          <span class="chip">${a.status || "scheduled"}</span>
          ${a.appointment_type ? `<span class="chip">${a.appointment_type}</span>` : ""}
        </div>
        <div>
          <strong style="font-size:13px">${fmtDate(a.start_time)}</strong>
          <span class="muted">${fmtTime(a.start_time)}${a.end_time ? ` – ${fmtTime(a.end_time)}` : ""}</span>
        </div>
        <div><span class="muted">${a.location || "—"}</span></div>
      </div>`).join("")}</div>`;
  } catch (err) {
    toast("Failed to load appointments.", true);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  if (!currentCompanyId || !currentUser) return;
  try {
    const [{ data: company }, { data: profile }] = await Promise.all([
      sb.from("companies").select("*").eq("id", currentCompanyId).maybeSingle(),
      sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle(),
    ]);
    
    const settingsCompanyName = document.getElementById("settingsCompanyName");
    const settingsCompanyEmail = document.getElementById("settingsCompanyEmail");
    const settingsCompanyPhone = document.getElementById("settingsCompanyPhone");
    const settingsOwnerName = document.getElementById("settingsOwnerName");
    const settingsOwnerEmail = document.getElementById("settingsOwnerEmail");
    const settingsOwnerPhone = document.getElementById("settingsOwnerPhone");
    
    if (company) {
      if (settingsCompanyName) settingsCompanyName.value = company.name || "";
      if (settingsCompanyEmail) settingsCompanyEmail.value = company.email || "";
      if (settingsCompanyPhone) settingsCompanyPhone.value = company.phone || "";
    }
    if (profile) {
      if (settingsOwnerName) settingsOwnerName.value = profile.full_name || "";
      if (settingsOwnerEmail) settingsOwnerEmail.value = currentUser.email || "";
      if (settingsOwnerPhone) settingsOwnerPhone.value = profile.phone || "";
    }
    await loadCustomFields();
    renderSettingsCustomFields();
  } catch (err) {
    toast("Failed to load settings.", true);
  }
}

async function handleCompanyProfileSave(e) {
  e.preventDefault();
  const companyName = document.getElementById("settingsCompanyName")?.value;
  const ownerName   = document.getElementById("settingsOwnerName")?.value;
  
  try {
    const [{ error: ce }, { error: pe }] = await Promise.all([
      sb.from("companies").update({
        name:  companyName,
        email: document.getElementById("settingsCompanyEmail")?.value,
        phone: document.getElementById("settingsCompanyPhone")?.value,
      }).eq("id", currentCompanyId),
      sb.from("profiles").update({
        full_name: ownerName,
        phone:     document.getElementById("settingsOwnerPhone")?.value,
      }).eq("id", currentUser.id),
    ]);
    if (ce || pe) { toast((ce || pe).message, true); return; }
    toast("Profile saved.");
    
    const brandCompanyName = document.getElementById("brandCompanyName");
    const sidebarAccountName = document.getElementById("sidebarAccountName");
    if (brandCompanyName) brandCompanyName.textContent = companyName;
    if (sidebarAccountName) sidebarAccountName.textContent = ownerName;
  } catch (err) {
    toast("Failed to save profile.", true);
  }
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const np = document.getElementById("newPassword")?.value;
  const cp = document.getElementById("confirmNewPassword")?.value;
  if (np !== cp) { toast("Passwords do not match.", true); return; }
  try {
    const { error } = await sb.auth.updateUser({ password: np });
    if (error) { toast(error.message, true); return; }
    toast("Password updated.");
    document.getElementById("passwordForm")?.reset();
  } catch (err) {
    toast("Failed to update password.", true);
  }
}

// =============================================================================
// AI SETTINGS — UPDATED WITH ALL REQUIRED FIELDS
// =============================================================================

async function loadAiSettings() {
  if (!currentCompanyId) return;
  
  try {
    // Load AI settings
    const { data } = await sb
      .from("sms_agent_config")
      .select("*")
      .eq("company_id", currentCompanyId)
      .maybeSingle();
    
    // Get user profile to check if they can edit prompts
    const { data: profile } = await sb
      .from("profiles")
      .select("user_type")
      .eq("id", currentUser.id)
      .maybeSingle();
    
    const isInternal = profile?.user_type === "internal";
    currentUserType = profile?.user_type || "external";
    
    // Update account type display
    const accountTypeValue = document.getElementById("accountTypeValue");
    const accountTypeHelp = document.getElementById("accountTypeHelp");
    if (accountTypeValue) accountTypeValue.textContent = isInternal ? "Internal (Agency)" : "External";
    if (accountTypeHelp) {
      accountTypeHelp.textContent = isInternal 
        ? "Agency clients cannot edit AI prompts. Using agency defaults." 
        : "External workspaces can fully customize AI prompts.";
    }
    
    // Update key source display
    const keySourceValue = document.getElementById("keySourceValue");
    const keySourceHelp = document.getElementById("keySourceHelp");
    if (keySourceValue) keySourceValue.textContent = isInternal ? "Agency Keys" : "Customer Keys";
    if (keySourceHelp) {
      keySourceHelp.textContent = isInternal 
        ? "Using agency-managed API keys." 
        : "Using your own API keys from settings.";
    }
    
    // Populate form fields
    if (data) {
      // General settings
      setInputValue("aiModel", data.model);
      setInputValue("aiTwilioNumber", data.twilio_number);
      setInputValue("aiReplyDelay", data.reply_delay_seconds ?? "");
      setInputValue("aiMaxWords", data.max_sms_words ?? "");
      
      // Toggle switches
      setCheckboxValue("aiEnabled", data.is_active);
      setCheckboxValue("aiAutoReply", data.auto_reply);
      setCheckboxValue("aiNurtureEnabled", data.ai_nurture_enabled);
      setCheckboxValue("aiCallbackEnabled", data.callback_enabled);
      setCheckboxValue("aiOnsiteEnabled", data.onsite_enabled);
      setCheckboxValue("aiQuoteDraftingEnabled", data.quote_drafting_enabled);
      setCheckboxValue("aiLeadScoringEnabled", data.lead_scoring_enabled);
      setCheckboxValue("aiAutoCallInbound", data.auto_call_inbound);
      
      // Call-back settings
      setInputValue("aiAgentName", data.agent_name);
      setInputValue("aiCallbackStartTime", data.callback_hours_start);
      setInputValue("aiCallbackEndTime", data.callback_hours_end);
      setInputValue("aiSpecialOffers", data.special_offers);
      setInputValue("aiWelcomeMessage", data.welcome_message);
      
      // On-site settings
      setInputValue("aiServiceLocations", Array.isArray(data.service_locations) ? data.service_locations.join("\n") : "");
      setInputValue("aiMaxTravelDistance", data.max_travel_distance);
      setInputValue("aiMaxTravelUnit", data.max_travel_distance_unit);
      setInputValue("aiPreparationRequired", data.preparation_required);
      
      // Quote follow-up automation
      setCheckboxValue("aiAutomateQuoteFollowup", data.automate_quote_followup);
      setInputValue("aiFollowupMessage", data.followup_message);
      setInputValue("aiDaysUntilFollowup", data.days_until_followup);
      
      // System prompt (only editable for external users)
      const systemPromptEl = document.getElementById("aiSystemPrompt");
      if (systemPromptEl) {
        systemPromptEl.value = data.system_prompt || "";
        systemPromptEl.readOnly = isInternal;
        systemPromptEl.style.opacity = isInternal ? "0.6" : "1";
      }
      
      // Update prompt help text
      const promptHelp = document.getElementById("aiPromptHelp");
      if (promptHelp) {
        promptHelp.textContent = isInternal 
          ? "Internal users cannot edit the AI prompt. Contact your agency to make changes." 
          : "Customize how the AI responds to leads. Use {{first_name}} for personalization.";
      }
    }
    
    // Load Twilio numbers count
    const { data: nums } = await sb
      .from("twilio_numbers")
      .select("id")
      .eq("company_id", currentCompanyId);
    
    const twilioCountValue = document.getElementById("twilioCountValue");
    if (twilioCountValue) twilioCountValue.textContent = nums?.length || 0;
    
    loadTwilioNumbers();
    loadWorkflowRuns();
    
  } catch (err) {
    console.error("Load AI settings error:", err);
    toast("Failed to load AI settings.", true);
  }
}

// Helper functions for form population
function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function setCheckboxValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

async function handleAiSettingsSave(e) {
  e.preventDefault();
  
  // Get user type to check if they can edit prompts
  const { data: profile } = await sb
    .from("profiles")
    .select("user_type")
    .eq("id", currentUser.id)
    .maybeSingle();
  
  const isInternal = profile?.user_type === "internal";
  
  // Build payload
  const payload = {
    company_id:             currentCompanyId,
    model:                  document.getElementById("aiModel")?.value || "gpt-4o",
    twilio_number:          document.getElementById("aiTwilioNumber")?.value || null,
    reply_delay_seconds:    Number(document.getElementById("aiReplyDelay")?.value) || 0,
    max_sms_words:          Number(document.getElementById("aiMaxWords")?.value) || 160,
    is_active:              document.getElementById("aiEnabled")?.checked ?? true,
    auto_reply:             document.getElementById("aiAutoReply")?.checked ?? true,
    ai_nurture_enabled:     document.getElementById("aiNurtureEnabled")?.checked ?? true,
    callback_enabled:       document.getElementById("aiCallbackEnabled")?.checked ?? false,
    onsite_enabled:         document.getElementById("aiOnsiteEnabled")?.checked ?? false,
    quote_drafting_enabled: document.getElementById("aiQuoteDraftingEnabled")?.checked ?? false,
    lead_scoring_enabled:   document.getElementById("aiLeadScoringEnabled")?.checked ?? true,
    auto_call_inbound:     document.getElementById("aiAutoCallInbound")?.checked ?? false,
    
    // Call-back settings
    agent_name:             document.getElementById("aiAgentName")?.value || "Sales Team",
    callback_hours_start:   document.getElementById("aiCallbackStartTime")?.value || "09:00",
    callback_hours_end:     document.getElementById("aiCallbackEndTime")?.value || "17:00",
    special_offers:         document.getElementById("aiSpecialOffers")?.value || null,
    welcome_message:        document.getElementById("aiWelcomeMessage")?.value || "Hi {{first_name}}, thanks for reaching out!",
    
    // On-site settings
    service_locations:      document.getElementById("aiServiceLocations")?.value?.split("\n").filter(Boolean) || [],
    max_travel_distance:    Number(document.getElementById("aiMaxTravelDistance")?.value) || 50,
    max_travel_distance_unit: document.getElementById("aiMaxTravelUnit")?.value || "km",
    preparation_required:   document.getElementById("aiPreparationRequired")?.value || null,
    
    // Quote follow-up automation
    automate_quote_followup: document.getElementById("aiAutomateQuoteFollowup")?.checked ?? false,
    followup_message:       document.getElementById("aiFollowupMessage")?.value || "Hi {{first_name}}, just following up on your quote!",
    days_until_followup:    Number(document.getElementById("aiDaysUntilFollowup")?.value) || 3,
  };
  
  // Only include system_prompt for external users
  if (!isInternal) {
    payload.system_prompt = document.getElementById("aiSystemPrompt")?.value || null;
  }
  
  try {
    const { error } = await sb
      .from("sms_agent_config")
      .upsert(payload, { onConflict: "company_id" });
    
    if (error) { 
      toast(error.message, true); 
      return; 
    }
    
    toast("AI settings saved successfully.");
  } catch (err) {
    toast("Failed to save AI settings.", true);
    console.error("Save AI settings error:", err);
  }
}

async function loadTwilioNumbers() {
  try {
    const { data } = await sb
      .from("twilio_numbers")
      .select("*")
      .eq("company_id", currentCompanyId)
      .order("created_at");
    
    const el = document.getElementById("twilioNumbersTable");
    if (!el) return;
    
    if (!data?.length) { 
      el.innerHTML = `<div class="notice">No numbers added yet.</div>`; 
      return; 
    }
    
    el.innerHTML = `<div class="table-lite">${data.map((n) => `
      <div class="row">
        <div><strong style="font-size:13px">${n.phone_number}</strong></div>
        <div><span class="muted">${n.friendly_name || "—"}</span></div>
        <button class="iconbtn btn-danger" onclick="deleteTwilioNumber('${n.id}')" type="button">
          <span class="icon" data-icon="trash"></span>
        </button>
      </div>`).join("")}</div>`;
    renderIcons();
  } catch (err) {
    console.error("Load Twilio numbers error:", err);
  }
}

async function handleTwilioNumberSave(e) {
  e.preventDefault();
  try {
    const { error } = await sb.from("twilio_numbers").insert({
      company_id:    currentCompanyId,
      phone_number:  document.getElementById("twilioPhoneNumber")?.value,
      friendly_name: document.getElementById("twilioFriendlyName")?.value,
    });
    if (error) { toast(error.message, true); return; }
    toast("Number added.");
    document.getElementById("twilioNumberForm")?.reset();
    await loadTwilioNumbers();
    const { data: nums } = await sb.from("twilio_numbers").select("id").eq("company_id", currentCompanyId);
    const twilioCountValue = document.getElementById("twilioCountValue");
    if (twilioCountValue) twilioCountValue.textContent = nums?.length || 0;
  } catch (err) {
    toast("Failed to add number.", true);
  }
}

async function deleteTwilioNumber(id) {
  if (!confirm("Remove this number?")) return;
  try {
    await sb.from("twilio_numbers").delete().eq("id", id);
    loadTwilioNumbers();
  } catch (err) {
    toast("Failed to delete number.", true);
  }
}

async function loadWorkflowRuns() {
  try {
    const { data: runs } = await sb
      .from("ai_workflow_runs")
      .select("*")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(10);
    
    const el = document.getElementById("workflowRunSummary");
    if (!el) return;
    
    if (!runs?.length) {
      el.innerHTML = `<div class="notice">No workflow runs yet. Inbound SMS will trigger AI workflows.</div>`;
      return;
    }
    
    el.innerHTML = runs.map((run) => `
      <div class="run">
        <h3>${run.workflow_type} <span class="chip">${run.status}</span></h3>
        <p>Model: ${run.model || "—"} · Key Source: ${run.key_source || "—"}</p>
        <p style="margin-top:4px;"><span class="muted">${fmtDate(run.created_at)}</span></p>
        ${run.error_text ? `<p style="color:#c53535;margin-top:4px;">Error: ${run.error_text}</p>` : ''}
      </div>
    `).join("");
  } catch (err) {
    console.error("Load workflow runs error:", err);
  }
}

// ─── Team Members ─────────────────────────────────────────────────────────────
async function loadTeamMembers() {
  if (!currentCompanyId) return;

  try {
    const [{ data: profiles }, { data: invites }] = await Promise.all([
      sb.from("profiles")
        .select("id, full_name, phone, role, is_active, created_at")
        .eq("company_id", currentCompanyId)
        .order("created_at"),
      sb.from("sales_rep_invites")
        .select("id, email, full_name, status, invited_at")
        .eq("company_id", currentCompanyId)
        .eq("status", "pending")
        .order("invited_at", { ascending: false }),
    ]);

    renderTeamMembersList(profiles || [], invites || []);
  } catch (err) {
    toast("Failed to load team members.", true);
  }
}

function renderTeamMembersList(profiles, invites) {
  const el = document.getElementById("teamMembersList");
  if (!el) return;

  const memberRows = profiles.map((p) => `
    <div class="team-row">
      <div><strong style="font-size:13px">${p.full_name || "—"}</strong><span class="muted">${p.phone || "—"}</span></div>
      <div><span class="chip">${p.role || "member"}</span></div>
      <div><span class="chip ${p.is_active ? "" : "chip-pending"}">${p.is_active ? "Active" : "Inactive"}</span></div>
      <div></div>
    </div>`).join("");

  const inviteRows = invites.map((inv) => `
    <div class="team-row">
      <div><strong style="font-size:13px">${inv.full_name || inv.email}</strong><span class="muted">${inv.email}</span></div>
      <div><span class="chip chip-pending">Pending</span></div>
      <div><span class="muted" style="font-size:11px">Invited ${fmtDate(inv.invited_at)}</span></div>
      <div>
        <button class="iconbtn btn-danger" onclick="revokeInvite('${inv.id}')" type="button" title="Revoke invite">
          <span class="icon" data-icon="trash"></span>
        </button>
      </div>
    </div>`).join("");

  const hasAny = profiles.length || invites.length;
  el.innerHTML = hasAny
    ? memberRows + inviteRows
    : `<div class="notice">No team members yet. Invite someone below.</div>`;

  renderIcons();
}

async function handleTeamInvite(e) {
  e.preventDefault();
  const email    = document.getElementById("inviteEmail")?.value?.trim();
  const fullName = document.getElementById("inviteFullName")?.value?.trim();
  const phone    = document.getElementById("invitePhone")?.value?.trim();
  if (!email) { toast("Email is required.", true); return; }

  const btn = e.target.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated.");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-rep`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ email, name: fullName, phone }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "Invite failed.");

    toast(`Invite sent to ${email}. They'll receive an email to set up their account.`);
    document.getElementById("teamInviteForm")?.reset();
    loadTeamMembers();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send Invite"; }
  }
}

async function revokeInvite(inviteId) {
  if (!confirm("Revoke this invite?")) return;
  try {
    const { error } = await sb
      .from("sales_rep_invites")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", inviteId);
    if (error) { toast(error.message, true); return; }
    toast("Invite revoked.");
    loadTeamMembers();
  } catch (err) {
    toast("Failed to revoke invite.", true);
  }
}

// ─── Conversations ────────────────────────────────────────────────────────────
async function loadConversations() {
  if (!currentCompanyId) return;
  try {
    const { data: conversations } = await sb
      .from("conversations")
      .select("id, lead_id, last_message, last_message_at, leads(name, phone)")
      .eq("company_id", currentCompanyId)
      .order("last_message_at", { ascending: false });

    const list  = document.getElementById("conversationList");
    const empty = document.getElementById("convEmptyState");
    if (!list) return;

    if (!conversations?.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
      return;
    }
    empty?.classList.add("hidden");

    list.innerHTML = conversations.map((c) => {
      const name = c.leads?.name || "Unknown";
      const time = c.last_message_at ? fmtDate(c.last_message_at) : "";
      return `<div class="conv-item" data-conv-id="${c.id}" data-lead-id="${c.lead_id}"
                   data-lead-name="${name}" data-lead-phone="${c.leads?.phone || ""}">
        <h3>${name}<span class="conv-time">${time}</span></h3>
        <p>${c.last_message || "No messages yet"}</p>
      </div>`;
    }).join("");

    list.querySelectorAll(".conv-item").forEach((item) =>
      item.addEventListener("click", () => openConversation(
        item.dataset.convId,
        item.dataset.leadId,
        item.dataset.leadName,
        item.dataset.leadPhone,
        item
      ))
    );
  } catch (err) {
    toast("Failed to load conversations.", true);
  }
}

// ── New Conversation ──────────────────────────────────────────────────────────
async function openNewConvModal() {
  try {
    const { data: leads } = await sb
      .from("leads")
      .select("id, name, phone, email")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false });

    const sel = document.getElementById("newConvLeadSelect");
    if (sel && leads) {
      sel.innerHTML = `<option value="">— Select a lead —</option>` +
        leads.map((l) => {
          const label = l.name || l.email || l.id;
          const sub   = l.phone ? ` · ${l.phone}` : "";
          return `<option value="${l.id}">${label}${sub}</option>`;
        }).join("");
    }
    openModal("newConvModal");
  } catch (err) {
    toast("Failed to load leads.", true);
  }
}

async function handleNewConversation(e) {
  e.preventDefault();
  const leadId   = document.getElementById("newConvLeadSelect")?.value;
  const firstMsg = document.getElementById("newConvFirstMessage")?.value?.trim();
  if (!leadId) { toast("Please select a lead.", true); return; }

  try {
    // Check for existing conversation
    const { data: existing } = await sb
      .from("conversations")
      .select("id, leads(name, phone)")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .maybeSingle();

    if (existing) {
      closeModal("newConvModal");
      document.getElementById("newConvForm")?.reset();
      await loadConversations();
      const item = document.querySelector(`.conv-item[data-conv-id="${existing.id}"]`);
      if (item) item.click();
      toast("Conversation already exists — opened.");
      return;
    }

    // Create new
    const now = new Date().toISOString();
    const { data: conv, error } = await sb
      .from("conversations")
      .insert({
        company_id:      currentCompanyId,
        lead_id:         leadId,
        channel:         "sms",
        is_open:         true,
        last_message:    firstMsg || null,
        last_message_at: firstMsg ? now : null,
      })
      .select("id, leads(name, phone)")
      .single();

    if (error) { toast(error.message, true); return; }

    if (firstMsg) {
      await sb.from("messages").insert({
        conversation_id: conv.id,
        body:            firstMsg,
        direction:       "outbound",
        agent_type:      "human",
      });
    }

    toast("Conversation created.");
    closeModal("newConvModal");
    document.getElementById("newConvForm")?.reset();
    await loadConversations();

    const name  = conv.leads?.name  || "Lead";
    const phone = conv.leads?.phone || "";
    const item  = document.querySelector(`.conv-item[data-conv-id="${conv.id}"]`);
    openConversation(conv.id, leadId, name, phone, item);
  } catch (err) {
    toast("Failed to create conversation.", true);
  }
}

async function openConversation(convId, leadId, name, phone, itemEl) {
  currentConvId = convId;
  currentLeadId = leadId;

  document.getElementById("convDetailEmpty")?.classList.add("hidden");
  document.getElementById("convDetail")?.classList.remove("hidden");
  
  const convLeadName = document.getElementById("convLeadName");
  const convLeadPhone = document.getElementById("convLeadPhone");
  if (convLeadName) convLeadName.textContent = name;
  if (convLeadPhone) convLeadPhone.textContent = phone;

  document.querySelectorAll(".conv-item").forEach((el) => el.classList.remove("active"));
  itemEl?.classList.add("active");

  await loadMessages(convId);

  if (leadId) {
    try {
      const { data: lead } = await sb.from("leads").select("ai_enabled, ai_score").eq("id", leadId).maybeSingle();
      const tog    = document.getElementById("convAiToggle");
      const status = document.getElementById("convAiStatus");
      const scoreEl = document.getElementById("convLeadScore");
      
      if (tog && lead) {
        const on = lead.ai_enabled !== false;
        tog.checked = on;
        if (status) { 
          status.textContent = on ? "ON" : "OFF"; 
          status.className = `ai-toggle-status ${on ? "on" : "off"}`; 
        }
      }
      
      if (scoreEl && lead?.ai_score) {
        scoreEl.textContent = `Score: ${lead.ai_score}`;
      }
    } catch (err) {
      console.error("Load lead AI settings error:", err);
    }
  }
}

async function loadMessages(convId) {
  try {
    const { data: msgs } = await sb
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at");
    const el = document.getElementById("convMessages");
    if (!el) return;
    if (!msgs?.length) {
      el.innerHTML = `<div class="muted" style="text-align:center;padding:24px;font-size:12px">No messages yet</div>`;
      return;
    }
    el.innerHTML = msgs.map((m) => {
      const content = m.body || m.content || "";
      const badge   = m.agent_type || m.sender_type || "";
      return `<div class="msg ${m.direction === "inbound" ? "inbound" : "outbound"}">
        ${content}
        <div class="msg-meta">
          ${badge ? `<span class="msg-badge ${badge}">${badge}</span>` : ""}
          <span>${fmtDate(m.created_at)}</span>
        </div>
      </div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  } catch (err) {
    toast("Failed to load messages.", true);
  }
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input   = document.getElementById("convMessageInput");
  const content = input?.value?.trim();
  if (!content || !currentConvId) return;

  try {
    const { error } = await sb.from("messages").insert({
      conversation_id: currentConvId,
      body:            content,
      direction:       "outbound",
      agent_type:      "human",
    });
    if (error) { toast(error.message, true); return; }
    if (input) input.value = "";
    await Promise.all([
      loadMessages(currentConvId),
      sb.from("conversations").update({
        last_message: content, last_message_at: new Date().toISOString(),
      }).eq("id", currentConvId),
    ]);
  } catch (err) {
    toast("Failed to send message.", true);
  }
}

async function handleAiToggle() {
  if (!currentLeadId) return;
  const on     = document.getElementById("convAiToggle")?.checked;
  const status = document.getElementById("convAiStatus");
  if (status) { 
    status.textContent = on ? "ON" : "OFF"; 
    status.className = `ai-toggle-status ${on ? "on" : "off"}`; 
  }
  try {
    await sb.from("leads").update({ ai_enabled: on }).eq("id", currentLeadId);
  } catch (err) {
    toast("Failed to update AI setting.", true);
  }
}

// ─── Voice AI ─────────────────────────────────────────────────────────────────
async function loadVoiceAi() {
  if (!currentCompanyId) return;

  try {
    // Load voice agent config
    const { data: config } = await sb
      .from("voice_agent_config")
      .select("*")
      .eq("company_id", currentCompanyId)
      .maybeSingle();

    // Load profile to check user type
    const { data: profile } = await sb
      .from("profiles")
      .select("user_type")
      .eq("id", currentUser.id)
      .maybeSingle();

    const isInternal = profile?.user_type === "internal";

    // Update UI based on user type
    const voiceKeySource = document.getElementById("voiceKeySource");
    const voiceKeySourceHelp = document.getElementById("voiceKeySourceHelp");

    if (voiceKeySource) {
      voiceKeySource.textContent = isInternal ? "Agency Key" : "Customer Key";
    }
    if (voiceKeySourceHelp) {
      voiceKeySourceHelp.textContent = isInternal 
        ? "Using agency VAPI key for voice calls." 
        : "You must provide your own VAPI API key and Assistant ID.";
    }

    // Lock config fields for internal users (only prompt + greeting editable)
    const lockedFields = ["vapiAssistantId", "voiceAgentName", "voiceModel", "voiceId", "maxDuration", "transferPhone", "voiceAgentActive"];
    lockedFields.forEach((fid) => {
      const el = document.getElementById(fid);
      if (!el) return;
      if (isInternal) {
        el.disabled = true;
        el.style.opacity = "0.6";
        el.style.cursor = "not-allowed";
      } else {
        el.disabled = false;
        el.style.opacity = "1";
        el.style.cursor = "";
      }
    });

    // Update field hints for internal users
    const assistantHint = document.getElementById("vapiAssistantIdHint");
    if (assistantHint) {
      assistantHint.textContent = isInternal
        ? "Managed by your agency. Contact them to change."
        : "Required — enter your VAPI Assistant ID.";
    }

    // Show/hide provider key form based on user type
    const providerForm = document.getElementById("voiceProviderForm");
    const providerInfo = document.getElementById("voiceProviderInfo");
    if (providerForm) providerForm.style.display = isInternal ? "none" : "";
    if (providerInfo) {
      providerInfo.innerHTML = isInternal
        ? `<p><strong>Agency-Managed:</strong> Your voice agent is pre-configured by your agency. Only the system prompt and greeting are editable.</p>`
        : `<p><strong>External Users:</strong> You must provide your own VAPI API key and Assistant ID to use voice AI.</p>`;
    }

    // Populate form if config exists
    if (config) {
      const vapiAssistantId = document.getElementById("vapiAssistantId");
      const voiceAgentName = document.getElementById("voiceAgentName");
      const voiceModel = document.getElementById("voiceModel");
      const voiceId = document.getElementById("voiceId");
      const maxDuration = document.getElementById("maxDuration");
      const transferPhone = document.getElementById("transferPhone");
      const voiceSystemPrompt = document.getElementById("voiceSystemPrompt");
      const voiceGreeting = document.getElementById("voiceGreeting");
      const voiceAgentActive = document.getElementById("voiceAgentActive");
      const voiceAgentStatus = document.getElementById("voiceAgentStatus");
      const voiceAgentStatusHelp = document.getElementById("voiceAgentStatusHelp");

      if (vapiAssistantId) vapiAssistantId.value = config.vapi_assistant_id || "";
      if (voiceAgentName) voiceAgentName.value = config.name || "";
      if (voiceModel) voiceModel.value = config.model || "gpt-4o";
      if (voiceId) voiceId.value = config.voice_id || "";
      if (maxDuration) maxDuration.value = config.max_duration || 300;
      if (transferPhone) transferPhone.value = config.transfer_phone || "";
      if (voiceSystemPrompt) voiceSystemPrompt.value = config.system_prompt || "";
      if (voiceGreeting) voiceGreeting.value = config.greeting || "";
      if (voiceAgentActive) voiceAgentActive.checked = config.is_active || false;

      if (voiceAgentStatus) {
        voiceAgentStatus.textContent = config.is_active ? "Active" : "Inactive";
      }
      if (voiceAgentStatusHelp) {
        voiceAgentStatusHelp.textContent = config.is_active 
          ? "Voice agent is ready to receive calls." 
          : "Voice agent is not configured";
      }
    }

    // Load call count
    const { count } = await sb
      .from("voice_calls")
      .select("*", { count: "exact" })
      .eq("company_id", currentCompanyId);

    const voiceCallCount = document.getElementById("voiceCallCount");
    if (voiceCallCount) voiceCallCount.textContent = count || 0;

    // Load recent calls
    await loadVoiceCalls();

    // Load full voice logs
    voiceLogsPage = 0;
    await loadVoiceLogs();

  } catch (err) {
    console.error("Load voice AI error:", err);
    toast("Failed to load voice AI settings.", true);
  }
}

async function handleVoiceAgentSave(e) {
  e.preventDefault();

  try {
    // Check user type to restrict what internal users can save
    const { data: profile } = await sb
      .from("profiles")
      .select("user_type")
      .eq("id", currentUser.id)
      .maybeSingle();

    const isInternal = profile?.user_type === "internal";

    let payload;
    if (isInternal) {
      // Internal users can only update system prompt and greeting
      payload = {
        company_id:    currentCompanyId,
        system_prompt: document.getElementById("voiceSystemPrompt")?.value || null,
        greeting:      document.getElementById("voiceGreeting")?.value || null,
      };
    } else {
      // External users can configure everything
      payload = {
        company_id:       currentCompanyId,
        vapi_assistant_id: document.getElementById("vapiAssistantId")?.value || null,
        name:             document.getElementById("voiceAgentName")?.value || "Default Voice Agent",
        model:            document.getElementById("voiceModel")?.value || "gpt-4o",
        voice_id:         document.getElementById("voiceId")?.value || null,
        max_duration:     Number(document.getElementById("maxDuration")?.value) || 300,
        transfer_phone:   document.getElementById("transferPhone")?.value || null,
        system_prompt:    document.getElementById("voiceSystemPrompt")?.value || null,
        greeting:         document.getElementById("voiceGreeting")?.value || null,
        is_active:        document.getElementById("voiceAgentActive")?.checked || false,
      };
    }

    const { error } = await sb
      .from("voice_agent_config")
      .upsert(payload, { onConflict: "company_id" });

    if (error) { toast(error.message, true); return; }

    toast("Voice agent configuration saved.");

    // Update status display (only relevant for external users who can toggle active)
    if (!isInternal) {
      const voiceAgentStatus = document.getElementById("voiceAgentStatus");
      const voiceAgentStatusHelp = document.getElementById("voiceAgentStatusHelp");
      if (voiceAgentStatus) voiceAgentStatus.textContent = payload.is_active ? "Active" : "Inactive";
      if (voiceAgentStatusHelp) {
        voiceAgentStatusHelp.textContent = payload.is_active 
          ? "Voice agent is ready to receive calls." 
          : "Voice agent is not configured";
      }
    }

  } catch (err) {
    toast("Failed to save voice agent configuration.", true);
  }
}

async function handleVoiceProviderSave(e) {
  e.preventDefault();

  const externalKey = document.getElementById("externalVapiKey")?.value?.trim();
  if (!externalKey) {
    toast("Please enter your VAPI API key.", true);
    return;
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated.");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/voice-ai-provider`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ 
        action: "save_key",
        vapiKey: externalKey 
      }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "Failed to save provider key.");

    toast("Provider key saved securely.");
    document.getElementById("voiceProviderForm")?.reset();

  } catch (err) {
    toast(err.message, true);
  }
}

async function testVoiceAgent() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated.");

    toast("Testing voice agent connection...");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/voice-ai-provider`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "test" }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "Test failed.");

    toast("Voice agent test successful!");

  } catch (err) {
    toast(`Test failed: ${err.message}`, true);
  }
}

async function loadVoiceCalls() {
  if (!currentCompanyId) return;

  try {
    const { data: calls } = await sb
      .from("voice_calls")
      .select("*, leads(name, phone)")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(10);

    const el = document.getElementById("voiceCallsList");
    if (!el) return;

    if (!calls?.length) {
      el.innerHTML = `<div class="notice">No calls yet. Configure your voice agent to start receiving calls.</div>`;
      return;
    }

    el.innerHTML = calls.map((call) => `
      <div class="run">
        <h3>${call.leads?.name || "Unknown"} <span class="chip">${call.status}</span></h3>
        <p>${call.leads?.phone || "—"} · ${fmtDuration(call.duration)} · ${fmtDate(call.created_at)}</p>
        ${call.transcript ? `<p style="margin-top:6px;font-style:italic;">"${call.transcript.substring(0, 100)}${call.transcript.length > 100 ? '...' : ''}"</p>` : ''}
        ${call.summary ? `<p style="margin-top:4px;"><strong>Summary:</strong> ${call.summary}</p>` : ''}
      </div>
    `).join("");

  } catch (err) {
    console.error("Load voice calls error:", err);
  }
}

function fmtDuration(seconds) {
  if (!seconds) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ─── Voice AI Logs ────────────────────────────────────────────────────────────
let voiceLogsPage = 0;
const VOICE_LOGS_PER_PAGE = 20;

async function loadVoiceLogs() {
  if (!currentCompanyId) return;

  const statusFilter = document.getElementById("voiceLogsStatus")?.value || "";
  const dirFilter    = document.getElementById("voiceLogsDirection")?.value || "";
  const tableEl      = document.getElementById("voiceLogsTable");
  const pagEl        = document.getElementById("voiceLogsPagination");
  if (!tableEl) return;

  try {
    let query = sb
      .from("voice_calls")
      .select("*, leads(name, phone)", { count: "exact" })
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false })
      .range(voiceLogsPage * VOICE_LOGS_PER_PAGE, (voiceLogsPage + 1) * VOICE_LOGS_PER_PAGE - 1);

    if (statusFilter) query = query.eq("status", statusFilter);
    if (dirFilter) query = query.eq("direction", dirFilter);

    const { data: calls, count, error } = await query;

    if (error) throw error;

    if (!calls?.length) {
      tableEl.innerHTML = `<div class="notice">No call logs found.</div>`;
      if (pagEl) pagEl.innerHTML = "";
      return;
    }

    const statusColor = (s) => {
      const map = { completed: "#22c55e", missed: "#ef4444", failed: "#ef4444", voicemail: "#f59e0b", in_progress: "#3b82f6", ringing: "#8b5cf6" };
      return map[s] || "var(--muted)";
    };

    tableEl.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left">
            <th style="padding:8px 10px">Lead</th>
            <th style="padding:8px 10px">Direction</th>
            <th style="padding:8px 10px">Status</th>
            <th style="padding:8px 10px">Duration</th>
            <th style="padding:8px 10px">Date</th>
            <th style="padding:8px 10px">Transcript</th>
            <th style="padding:8px 10px">Recording</th>
            <th style="padding:8px 10px"></th>
          </tr>
        </thead>
        <tbody>
          ${calls.map((c) => `
            <tr style="border-bottom:1px solid var(--border);cursor:pointer" data-call-id="${esc(c.id)}">
              <td style="padding:8px 10px;font-weight:500">${esc(c.leads?.name || "Unknown")}</td>
              <td style="padding:8px 10px"><span class="chip">${c.direction || "—"}</span></td>
              <td style="padding:8px 10px"><span style="color:${statusColor(c.status)};font-weight:600">${c.status || "—"}</span></td>
              <td style="padding:8px 10px">${fmtDuration(c.duration)}</td>
              <td style="padding:8px 10px">${fmtDate(c.created_at)}</td>
              <td style="padding:8px 10px">${c.transcript ? '<span style="color:#22c55e">✓</span>' : '<span style="color:var(--muted)">—</span>'}</td>
              <td style="padding:8px 10px">${c.recording_url ? '<span style="color:#22c55e">✓</span>' : '<span style="color:var(--muted)">—</span>'}</td>
              <td style="padding:8px 10px"><button class="btn" type="button" style="font-size:12px;padding:4px 10px">View</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    // Attach click handlers via event delegation
    tableEl.querySelectorAll("tr[data-call-id]").forEach((row) => {
      row.addEventListener("click", () => openCallDetail(row.dataset.callId));
    });

    // Pagination
    if (pagEl) {
      const totalPages = Math.ceil((count || 0) / VOICE_LOGS_PER_PAGE);
      if (totalPages <= 1) {
        pagEl.innerHTML = "";
      } else {
        pagEl.innerHTML = `
          <button class="btn" id="voiceLogsPrev" ${voiceLogsPage === 0 ? "disabled" : ""} style="font-size:12px;padding:4px 12px">← Prev</button>
          <span style="font-size:13px;color:var(--muted);padding:4px 8px">Page ${voiceLogsPage + 1} of ${totalPages}</span>
          <button class="btn" id="voiceLogsNext" ${voiceLogsPage >= totalPages - 1 ? "disabled" : ""} style="font-size:12px;padding:4px 12px">Next →</button>
        `;
        document.getElementById("voiceLogsPrev")?.addEventListener("click", () => { voiceLogsPage--; loadVoiceLogs(); });
        document.getElementById("voiceLogsNext")?.addEventListener("click", () => { voiceLogsPage++; loadVoiceLogs(); });
      }
    }
  } catch (err) {
    console.error("Load voice logs error:", err);
    tableEl.innerHTML = `<div class="notice">Failed to load call logs.</div>`;
  }
}

async function openCallDetail(callId) {
  const body = document.getElementById("callDetailBody");
  if (!body) return;
  body.innerHTML = `<div class="notice">Loading…</div>`;
  openModal("callDetailModal");

  try {
    const { data: call, error } = await sb
      .from("voice_calls")
      .select("*, leads(name, phone, email)")
      .eq("id", callId)
      .single();

    if (error || !call) {
      body.innerHTML = `<div class="notice">Call not found.</div>`;
      return;
    }

    const title = document.getElementById("callDetailTitle");
    if (title) title.textContent = `Call with ${call.leads?.name || "Unknown"}`;

    const subtitle = document.getElementById("callDetailSubtitle");
    if (subtitle) subtitle.textContent = `${(call.direction || "").charAt(0).toUpperCase() + (call.direction || "").slice(1)} call · ${fmtDate(call.created_at)}`;

    let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">`;
    html += `<div><strong>Lead:</strong> ${esc(call.leads?.name || "Unknown")}</div>`;
    html += `<div><strong>Phone:</strong> ${esc(call.leads?.phone || call.from_number || "—")}</div>`;
    html += `<div><strong>Direction:</strong> <span class="chip">${call.direction || "—"}</span></div>`;
    html += `<div><strong>Status:</strong> ${call.status || "—"}</div>`;
    html += `<div><strong>Duration:</strong> ${fmtDuration(call.duration)}</div>`;
    html += `<div><strong>Sentiment:</strong> ${call.sentiment || "—"}</div>`;
    if (call.outcome) html += `<div><strong>Outcome:</strong> ${esc(call.outcome)}</div>`;
    if (call.cost) html += `<div><strong>Cost:</strong> $${Number(call.cost).toFixed(4)}</div>`;
    html += `</div>`;

    // Recording player
    if (call.recording_url) {
      html += `
        <div style="margin-bottom:20px">
          <h3 style="margin-bottom:8px;font-size:14px">Recording</h3>
          <audio controls preload="metadata" style="width:100%;border-radius:var(--radius)">
            <source src="${esc(call.recording_url)}" type="audio/mpeg">
            <source src="${esc(call.recording_url)}" type="audio/wav">
            Your browser does not support audio playback.
          </audio>
        </div>
      `;
    }

    // Summary
    if (call.summary) {
      html += `
        <div style="margin-bottom:20px">
          <h3 style="margin-bottom:8px;font-size:14px">AI Summary</h3>
          <div style="padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);font-size:13px;line-height:1.6">${esc(call.summary)}</div>
        </div>
      `;
    }

    // Transcript
    if (call.transcript) {
      html += `
        <div>
          <h3 style="margin-bottom:8px;font-size:14px">Transcript</h3>
          <div style="padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);max-height:400px;overflow-y:auto;font-size:13px;line-height:1.8;white-space:pre-wrap">${esc(call.transcript)}</div>
        </div>
      `;
    }

    if (!call.recording_url && !call.transcript && !call.summary) {
      html += `<div class="notice" style="margin-top:10px">No transcript or recording available for this call.</div>`;
    }

    body.innerHTML = html;

  } catch (err) {
    console.error("Open call detail error:", err);
    body.innerHTML = `<div class="notice">Failed to load call details.</div>`;
  }
}

function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ─── Opportunity Detail Modal ─────────────────────────────────────────────────
async function openOpportunityModal(leadId) {
  if (!leadId) return;

  const lead = allLeads.find((l) => l.id === leadId);
  if (!lead) {
    toast("Lead not found.", true);
    return;
  }

  // Store lead ID
  document.getElementById("oppModalLeadId").value = leadId;

  // Set title
  const oppModalTitle = document.getElementById("oppModalTitle");
  const oppModalSubtitle = document.getElementById("oppModalSubtitle");
  if (oppModalTitle) oppModalTitle.textContent = lead.name || "Opportunity Details";
  if (oppModalSubtitle) oppModalSubtitle.textContent = `Status: ${stageLabel(lead.pipeline_stage)} · Created: ${fmtDate(lead.created_at)}`;

  // Populate overview
  document.getElementById("oppOverviewName").value = lead.name || "—";
  document.getElementById("oppOverviewEmail").value = lead.email || "—";
  document.getElementById("oppOverviewPhone").value = lead.phone || "—";
  document.getElementById("oppOverviewStatus").value = stageLabel(lead.pipeline_stage) || "—";
  document.getElementById("oppOverviewSource").value = lead.source || "—";
  document.getElementById("oppOverviewValue").value = lead.value ? fmt(lead.value) : "—";
  document.getElementById("oppOverviewAddress").value = lead.address ? `${lead.address}${lead.postcode ? `, ${lead.postcode}` : ""}` : "—";
  document.getElementById("oppOverviewNotes").value = lead.notes || "—";

  // Reset tabs to overview
  document.querySelectorAll(".opp-tab").forEach((t) => t.classList.remove("active"));
  document.querySelector('.opp-tab[data-tab="overview"]')?.classList.add("active");
  document.querySelectorAll(".opp-tab-content").forEach((c) => c.classList.add("hidden"));
  document.getElementById("oppTabOverview")?.classList.remove("hidden");

  // Load assistants for call dropdown
  await loadVapiAssistants();

  openModal("opportunityModal");
}

async function loadOppConversations(leadId) {
  const el = document.getElementById("oppConversationsList");
  if (!el) return;

  try {
    const { data: conversations } = await sb
      .from("conversations")
      .select("id, last_message, last_message_at, is_open, channel")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .order("last_message_at", { ascending: false });

    if (!conversations?.length) {
      el.innerHTML = `<div class="notice">No conversations found for this lead.</div>`;
      return;
    }

    el.innerHTML = conversations.map((c) => `
      <div class="run" style="cursor:pointer" onclick="openConversationFromOpp('${c.id}', '${leadId}')">
        <h3>${c.channel?.toUpperCase() || "SMS"} Conversation <span class="chip">${c.is_open ? "Open" : "Closed"}</span></h3>
        <p>${c.last_message || "No messages"}</p>
        <p style="margin-top:4px;"><span class="muted">Last activity: ${fmtDate(c.last_message_at)}</span></p>
      </div>
    `).join("");
  } catch (err) {
    el.innerHTML = `<div class="notice">Failed to load conversations.</div>`;
  }
}

async function loadOppQuotes(leadId) {
  const el = document.getElementById("oppQuotesList");
  if (!el) return;

  try {
    const { data: quotes } = await sb
      .from("quotes")
      .select("id, quote_number, status, total, created_at, sent_at, accepted_at, quote_token")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (!quotes?.length) {
      el.innerHTML = `<div class="notice">No quotes found for this lead.</div>`;
      return;
    }

    el.innerHTML = quotes.map((q) => {
      const quoteLink = buildQuoteLink(q.quote_token);
      return `
      <div class="run">
        <h3>Quote #${q.quote_number || q.id.slice(0, 8)} <span class="chip">${q.status || "Draft"}</span></h3>
        <p><strong>Total:</strong> ${q.total ? fmt(q.total) : "—"}</p>
        <p style="margin-top:4px;"><span class="muted">Created: ${fmtDate(q.created_at)}${q.sent_at ? ` · Sent: ${fmtDate(q.sent_at)}` : ""}${q.accepted_at ? ` · Accepted: ${fmtDate(q.accepted_at)}` : ""}</span></p>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn" style="padding:4px 10px;font-size:11px" onclick="downloadQuotePDF('${q.id}')">PDF</button>
          ${quoteLink ? `<button class="btn" style="padding:4px 10px;font-size:11px" onclick="copyQuoteLink('${quoteLink}')">Copy Link</button>` : ""}
        </div>
      </div>`;
    }).join("");
  } catch (err) {
    el.innerHTML = `<div class="notice">Failed to load quotes.</div>`;
  }
}

async function loadOppAppointments(leadId) {
  const el = document.getElementById("oppAppointmentsList");
  if (!el) return;

  try {
    const { data: appointments } = await sb
      .from("appointments")
      .select("id, title, status, start_time, end_time, location, notes, appointment_type")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .order("start_time", { ascending: false });

    if (!appointments?.length) {
      el.innerHTML = `<div class="notice">No appointments found for this lead.</div>`;
      return;
    }

    el.innerHTML = appointments.map((a) => `
      <div class="run">
        <h3>${a.title || "Appointment"} <span class="chip">${a.status || "Scheduled"}</span>${a.appointment_type ? ` <span class="chip">${a.appointment_type}</span>` : ''}</h3>
        <p><strong>When:</strong> ${fmtDate(a.start_time)}${a.end_time ? ` - ${fmtTime(a.end_time)}` : ""}</p>
        ${a.location ? `<p><strong>Where:</strong> ${a.location}</p>` : ""}
        ${a.notes ? `<p style="margin-top:4px;font-style:italic;">${a.notes}</p>` : ""}
      </div>
    `).join("");
  } catch (err) {
    el.innerHTML = `<div class="notice">Failed to load appointments.</div>`;
  }
}

async function loadOppCalls(leadId) {
  const el = document.getElementById("oppCallsList");
  if (!el) return;

  try {
    const { data: calls } = await sb
      .from("voice_calls")
      .select("id, vapi_call_id, direction, status, duration, transcript, summary, sentiment, cost, created_at, recording_url")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (!calls?.length) {
      el.innerHTML = `<div class="notice">No AI calls found for this lead. Use "Call Lead with AI" to make your first call.</div>`;
      return;
    }

    el.innerHTML = calls.map((c) => `
      <div class="run">
        <h3>${c.direction === "outbound" ? "Outbound Call" : "Inbound Call"} <span class="chip">${c.status || "Unknown"}</span>${c.sentiment ? ` <span class="chip">${c.sentiment}</span>` : ""}</h3>
        <p><strong>Duration:</strong> ${fmtDuration(c.duration)} · <strong>Cost:</strong> $${c.cost?.toFixed(2) || "0.00"}</p>
        ${c.transcript ? `<p style="margin-top:6px;font-style:italic;">"${c.transcript.substring(0, 150)}${c.transcript.length > 150 ? "..." : ""}"</p>` : ""}
        ${c.summary ? `<p style="margin-top:4px;"><strong>Summary:</strong> ${c.summary}</p>` : ""}
        <p style="margin-top:4px;"><span class="muted">${fmtDate(c.created_at)}</span>${c.recording_url ? ` · <a href="${c.recording_url}" target="_blank">Listen to recording</a>` : ""}</p>
      </div>
    `).join("");
  } catch (err) {
    el.innerHTML = `<div class="notice">Failed to load call history.</div>`;
  }
}

function openConversationFromOpp(convId, leadId) {
  closeModal("opportunityModal");
  navigateTo("conversations");
  // Find and click the conversation item
  setTimeout(() => {
    const item = document.querySelector(`.conv-item[data-conv-id="${convId}"]`);
    if (item) item.click();
  }, 300);
}

// ─── Call Lead with AI ────────────────────────────────────────────────────────
async function openCallLeadModal() {
  const leadId = document.getElementById("oppModalLeadId")?.value;
  const lead = allLeads.find((l) => l.id === leadId);

  if (!lead) {
    toast("Lead not found.", true);
    return;
  }

  document.getElementById("callLeadId").value = leadId;
  document.getElementById("callLeadPhone").value = lead.phone || "";

  closeModal("opportunityModal");
  openModal("callLeadModal");
}

async function loadVapiAssistants() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/voice-ai-provider`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "get_config" }),
    });

    const json = await res.json();

    // Populate assistant dropdown if we have config
    const select = document.getElementById("callLeadAssistant");
    if (select && json.config?.vapi_assistant_id) {
      select.innerHTML = `
        <option value="">— Use default assistant —</option>
        <option value="${json.config.vapi_assistant_id}">${json.config.name || "Custom Assistant"}</option>
      `;
    }
  } catch (err) {
    console.error("Load VAPI assistants error:", err);
  }
}

async function handleCallLead() {
  const leadId = document.getElementById("callLeadId")?.value;
  const phone = document.getElementById("callLeadPhone")?.value?.trim();
  const assistantId = document.getElementById("callLeadAssistant")?.value;

  if (!phone) {
    toast("Please enter a phone number.", true);
    return;
  }

  const btn = document.getElementById("confirmCallLead");
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<span>Calling...</span>`;
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated.");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/voice-ai-provider`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ 
        action: "create_call",
        leadId: leadId,
        phoneNumber: phone,
        assistantId: assistantId || undefined,
        metadata: {
          source: "dashboard",
          initiated_by: currentUser?.id,
        }
      }),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || "Failed to create call.");

    toast(`Call initiated! Call ID: ${json.callId?.slice(0, 8) || "N/A"}`);
    closeModal("callLeadModal");

    // Refresh call list if we're viewing the opportunity
    const currentLeadId = document.getElementById("oppModalLeadId")?.value;
    if (currentLeadId === leadId) {
      loadOppCalls(leadId);
    }

  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || `<span class="icon" data-icon="phone"></span> Start Call`;
    }
  }
}
