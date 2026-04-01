// =============================================================================
// QuoteLeadsHQ — Dashboard Client (Fixed)
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
  btn.innerHTML = `<span class="icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${dark ? ICONS.sun : ICONS.moon}</svg></span>`;
}

// ─── State ────────────────────────────────────────────────────────────────────
let sb;
let currentUser      = null;
let currentCompanyId = null;
let currentConvId    = null;
let currentLeadId    = null;
let customFields     = [];
let allLeads         = [];
let dragLeadId       = null;
let authInitialized  = false;  // Prevent race conditions

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
    if (authInitialized) return; // Skip if already handled
    authInitialized = true;
    
    if (session?.user) { 
      currentUser = session.user; 
      showApp(); 
    } else { 
      currentUser = null; 
      showAuth(); 
    }
  });

  // Then check existing session (with slight delay to let listener set up)
  setTimeout(async () => {
    if (authInitialized) return; // Already handled by onAuthStateChange
    
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
    
    // Disable form during login
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
        // Re-enable form on error
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || "Sign In";
        }
        emailInput && (emailInput.disabled = false);
        passwordInput && (passwordInput.disabled = false);
      }
      // On success, onAuthStateChange will handle the transition
    } catch (err) {
      toast("Login failed. Please try again.", true);
      console.error("Login error:", err);
      // Re-enable form
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
      authInitialized = false; // Reset for next login
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
  ["openLeadModalTop","openLeadModal","openLeadModalEmpty","openLeadModalPipeline"].forEach((id) =>
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

  // ── Team Members ──────────────────────────────────────────────────────────
  document.getElementById("teamInviteForm")?.addEventListener("submit", handleTeamInvite);

  // ── Conversations ─────────────────────────────────────────────────────────
  document.getElementById("convSendForm")?.addEventListener("submit", handleSendMessage);
  document.getElementById("convAiToggle")?.addEventListener("change", handleAiToggle);

  // ── Search ────────────────────────────────────────────────────────────────
  document.getElementById("globalSearchInput")?.addEventListener("input", handleSearch);
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
    const [{ data: leads }, { data: cf }] = await Promise.all([
      sb.from("leads").select("id, name, email, status, value, created_at").eq("company_id", currentCompanyId),
      sb.from("custom_fields").select("id").eq("company_id", currentCompanyId),
    ]);

    const all    = leads || [];
    const cfLen  = cf?.length || 0;
    const open   = all.filter((l) => !["Closed Won","Closed Lost"].includes(l.status)).length;
    const quoted = all.filter((l) => l.status === "Quoted").length;

    const statLeadCount = document.getElementById("statLeadCount");
    const statOpenPipeline = document.getElementById("statOpenPipeline");
    const statQuotes = document.getElementById("statQuotes");
    const statCustomFields = document.getElementById("statCustomFields");
    
    if (statLeadCount) statLeadCount.textContent = all.length;
    if (statOpenPipeline) statOpenPipeline.textContent = open;
    if (statQuotes) statQuotes.textContent = quoted;
    if (statCustomFields) statCustomFields.textContent = cfLen;

    const weekAgo     = new Date(Date.now() - 7 * 864e5);
    const newThisWeek = all.filter((l) => new Date(l.created_at) > weekAgo).length;
    
    const leadGrowthChip = document.getElementById("leadGrowthChip");
    const qualifyingChip = document.getElementById("qualifyingChip");
    const quoteChip = document.getElementById("quoteChip");
    const customFieldChip = document.getElementById("customFieldChip");
    
    if (leadGrowthChip) leadGrowthChip.textContent = newThisWeek ? `+${newThisWeek} this week` : "No new";
    if (qualifyingChip) qualifyingChip.textContent = `${all.filter((l) => l.status === "Qualifying").length} qualifying`;
    if (quoteChip) quoteChip.textContent = `${quoted} quoted`;
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
      <div><span class="chip">${l.status || "—"}</span></div>
      <div><p style="font-size:11px;color:var(--muted)">${fmtDate(l.created_at)}</p></div>
    </div>`).join("")}</div>`;
}

function renderPipelineSnapshot(leads) {
  const el = document.getElementById("pipelineSnapshotPanel");
  if (!el) return;
  const STAGES = ["New Lead","Qualifying","Quote in Progress","Quoted","Closed Won","Closed Lost"];
  if (!leads.length) {
    el.innerHTML = `<div class="empty"><p>No pipeline data yet.</p></div>`;
    return;
  }
  el.innerHTML = STAGES.map((s) => {
    const items = leads.filter((l) => l.status === s);
    const val   = items.reduce((a, l) => a + (Number(l.value) || 0), 0);
    return `<div class="item" style="grid-template-columns:1.4fr 80px 110px">
      <div><h3>${s}</h3></div>
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
      <td><span class="chip">${l.status || "—"}</span></td>
      <td style="font-size:12px;color:var(--muted)">${renderCustomDataSummary(l.custom_data)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="iconbtn" onclick="openEditLead('${l.id}')" type="button"><span class="icon" data-icon="edit"></span></button>
          <button class="iconbtn btn-danger" onclick="deleteLead('${l.id}')" type="button"><span class="icon" data-icon="trash"></span></button>
        </div>
      </td>
    </tr>`).join("");
  renderIcons();
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
  if (leadStatus) leadStatus.value = l.status || "New Lead";
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
    name:     document.getElementById("leadName")?.value || null,
    email:    document.getElementById("leadEmail")?.value || null,
    phone:    document.getElementById("leadPhone")?.value || null,
    postcode: document.getElementById("leadPostcode")?.value || null,
    address:  document.getElementById("leadAddress")?.value || null,
    source:   document.getElementById("leadSource")?.value || null,
    status:   document.getElementById("leadStatus")?.value || "New Lead",
    value:    Number(document.getElementById("leadValue")?.value) || null,
    notes:    document.getElementById("leadNotes")?.value || null,
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

// ─── Opportunities / Kanban ───────────────────────────────────────────────────
const KANBAN_STAGES = ["New Lead","Qualifying","Quote in Progress","Quoted","Closed Won","Closed Lost"];

async function loadOpportunities() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("leads")
      .select("id, name, email, phone, status, value, created_at")
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
    const cards = leads.filter((l) => l.status === stage);
    return `
      <div class="col"
           data-stage="${stage}"
           ondragover="kanbanDragOver(event)"
           ondrop="kanbanDrop(event,'${stage}')"
           ondragleave="kanbanDragLeave(event)">
        <div class="colhead">
          <b>${stage}</b><span class="chip">${cards.length}</span>
        </div>
        <div class="cards">
          ${cards.length
            ? cards.map((l) => `
              <div class="kcard"
                   draggable="true"
                   data-lead-id="${l.id}"
                   ondragstart="kanbanDragStart(event,'${l.id}')"
                   ondragend="kanbanDragEnd(event)">
                <h3>${l.name || "—"}</h3>
                <p>${l.email || l.phone || "—"}</p>
                <span class="money">${l.value ? fmt(l.value) : "No value set"}</span>
              </div>`).join("")
            : `<div class="kanban-drop-hint">Drop leads here</div>`}
        </div>
      </div>`;
  }).join("");
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
  if (lead) lead.status = newStage;
  buildKanban(allLeads);

  try {
    const { error } = await sb.from("leads").update({ status: newStage }).eq("id", leadId);
    if (error) {
      toast(error.message, true);
      loadOpportunities(); // revert on failure
    } else {
      toast(`Moved to "${newStage}"`);
    }
  } catch (err) {
    toast("Failed to update status.", true);
    loadOpportunities();
  }
  dragLeadId = null;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
async function loadQuotes() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("leads")
      .select("id, name, email, phone, value, created_at")
      .eq("company_id", currentCompanyId)
      .eq("status", "Quoted")
      .order("created_at", { ascending: false });
    const leads = data || [];
    const el = document.getElementById("quotesPanel");
    if (!el) return;
    if (!leads.length) {
      el.innerHTML = `<div class="empty"><h3>No quoted leads</h3><p>Leads with status "Quoted" will appear here.</p></div>`;
      return;
    }
    el.innerHTML = `<div class="table-lite">${leads.map((l) => `
      <div class="row">
        <div><strong style="font-size:13px">${l.name || "—"}</strong><span class="muted">${l.email || l.phone || "—"}</span></div>
        <div><span class="chip">Quoted</span></div>
        <div><strong style="font-size:13px">${fmt(l.value)}</strong><span class="muted">${fmtDate(l.created_at)}</span></div>
      </div>`).join("")}</div>`;
  } catch (err) {
    toast("Failed to load quotes.", true);
  }
}

// ─── Sales ────────────────────────────────────────────────────────────────────
async function loadSales() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("leads")
      .select("id, name, status, value, created_at")
      .eq("company_id", currentCompanyId)
      .in("status", ["Closed Won","Closed Lost"])
      .order("created_at", { ascending: false });
    const leads = data || [];
    const el = document.getElementById("salesPanel");
    if (!el) return;

    const won     = leads.filter((l) => l.status === "Closed Won");
    const lost    = leads.filter((l) => l.status === "Closed Lost");
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
          <div><span class="chip">${l.status}</span></div>
          <div><strong style="font-size:13px">${fmt(l.value)}</strong></div>
        </div>`).join("")}</div>`
        : `<div class="empty"><p>No closed deals yet.</p></div>`}`;
  } catch (err) {
    toast("Failed to load sales data.", true);
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

// ─── AI Settings ──────────────────────────────────────────────────────────────
async function loadAiSettings() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("ai_settings")
      .select("*")
      .eq("company_id", currentCompanyId)
      .maybeSingle();
      
    if (data) {
      const aiModel = document.getElementById("aiModel");
      const aiTwilioNumber = document.getElementById("aiTwilioNumber");
      const aiReplyDelay = document.getElementById("aiReplyDelay");
      const aiMaxWords = document.getElementById("aiMaxWords");
      const aiEnabled = document.getElementById("aiEnabled");
      const aiAutoReply = document.getElementById("aiAutoReply");
      const aiCallbackEnabled = document.getElementById("aiCallbackEnabled");
      const aiOnsiteEnabled = document.getElementById("aiOnsiteEnabled");
      const aiQuoteDraftingEnabled = document.getElementById("aiQuoteDraftingEnabled");
      const aiLeadScoringEnabled = document.getElementById("aiLeadScoringEnabled");
      const aiSystemPrompt = document.getElementById("aiSystemPrompt");
      
      if (aiModel) aiModel.value = data.model || "";
      if (aiTwilioNumber) aiTwilioNumber.value = data.twilio_number || "";
      if (aiReplyDelay) aiReplyDelay.value = data.reply_delay_seconds ?? "";
      if (aiMaxWords) aiMaxWords.value = data.max_sms_words ?? "";
      if (aiEnabled) aiEnabled.checked = !!data.is_active;
      if (aiAutoReply) aiAutoReply.checked = !!data.auto_reply;
      if (aiCallbackEnabled) aiCallbackEnabled.checked = !!data.callback_enabled;
      if (aiOnsiteEnabled) aiOnsiteEnabled.checked = !!data.onsite_enabled;
      if (aiQuoteDraftingEnabled) aiQuoteDraftingEnabled.checked = !!data.quote_drafting_enabled;
      if (aiLeadScoringEnabled) aiLeadScoringEnabled.checked = !!data.lead_scoring_enabled;
      if (aiSystemPrompt) aiSystemPrompt.value = data.system_prompt || "";
    }
    
    const { data: nums } = await sb
      .from("twilio_numbers").select("id").eq("company_id", currentCompanyId);
    const twilioCountValue = document.getElementById("twilioCountValue");
    if (twilioCountValue) twilioCountValue.textContent = nums?.length || 0;
    loadTwilioNumbers();
  } catch (err) {
    toast("Failed to load AI settings.", true);
  }
}

async function handleAiSettingsSave(e) {
  e.preventDefault();
  const payload = {
    company_id:             currentCompanyId,
    model:                  document.getElementById("aiModel")?.value,
    twilio_number:          document.getElementById("aiTwilioNumber")?.value,
    reply_delay_seconds:    Number(document.getElementById("aiReplyDelay")?.value) || 0,
    max_sms_words:          Number(document.getElementById("aiMaxWords")?.value) || 160,
    is_active:              document.getElementById("aiEnabled")?.checked,
    auto_reply:             document.getElementById("aiAutoReply")?.checked,
    callback_enabled:       document.getElementById("aiCallbackEnabled")?.checked,
    onsite_enabled:         document.getElementById("aiOnsiteEnabled")?.checked,
    quote_drafting_enabled: document.getElementById("aiQuoteDraftingEnabled")?.checked,
    lead_scoring_enabled:   document.getElementById("aiLeadScoringEnabled")?.checked,
    system_prompt:          document.getElementById("aiSystemPrompt")?.value,
  };
  
  try {
    const { error } = await sb.from("ai_settings").upsert(payload, { onConflict: "company_id" });
    if (error) { toast(error.message, true); return; }
    toast("AI settings saved.");
  } catch (err) {
    toast("Failed to save AI settings.", true);
  }
}

async function loadTwilioNumbers() {
  try {
    const { data } = await sb
      .from("twilio_numbers").select("*").eq("company_id", currentCompanyId).order("created_at");
    const el = document.getElementById("twilioNumbersTable");
    if (!el) return;
    if (!data?.length) { el.innerHTML = `<div class="notice">No numbers added yet.</div>`; return; }
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

// ─── Team Members ─────────────────────────────────────────────────────────────
async function loadTeamMembers() {
  if (!currentCompanyId) return;

  try {
    const [{ data: profiles }, { data: invites }] = await Promise.all([
      sb.from("profiles")
        .select("id, full_name, email, role, is_active, created_at")
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
      <div><strong style="font-size:13px">${p.full_name || "—"}</strong><span class="muted">${p.email || "—"}</span></div>
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

    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-sales-rep`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ email, fullName, phone }),
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
      const { data: lead } = await sb.from("leads").select("ai_enabled").eq("id", leadId).maybeSingle();
      const tog    = document.getElementById("convAiToggle");
      const status = document.getElementById("convAiStatus");
      if (tog && lead) {
        const on = lead.ai_enabled !== false;
        tog.checked = on;
        if (status) { 
          status.textContent = on ? "ON" : "OFF"; 
          status.className = `ai-toggle-status ${on ? "on" : "off"}`; 
        }
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
        : "You must provide your own VAPI Assistant ID.";
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
    const { data: calls, count } = await sb
      .from("voice_calls")
      .select("*", { count: "exact" })
      .eq("company_id", currentCompanyId);

    const voiceCallCount = document.getElementById("voiceCallCount");
    if (voiceCallCount) voiceCallCount.textContent = count || 0;

    // Load recent calls
    await loadVoiceCalls();

  } catch (err) {
    console.error("Load voice AI error:", err);
    toast("Failed to load voice AI settings.", true);
  }
}

async function handleVoiceAgentSave(e) {
  e.preventDefault();

  try {
    const payload = {
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

    const { error } = await sb
      .from("voice_agent_config")
      .upsert(payload, { onConflict: "company_id" });

    if (error) { toast(error.message, true); return; }

    toast("Voice agent configuration saved.");

    // Update status display
    const voiceAgentStatus = document.getElementById("voiceAgentStatus");
    const voiceAgentStatusHelp = document.getElementById("voiceAgentStatusHelp");
    if (voiceAgentStatus) voiceAgentStatus.textContent = payload.is_active ? "Active" : "Inactive";
    if (voiceAgentStatusHelp) {
      voiceAgentStatusHelp.textContent = payload.is_active 
        ? "Voice agent is ready to receive calls." 
        : "Voice agent is not configured";
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
