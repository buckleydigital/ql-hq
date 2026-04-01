// =============================================================================
// QuoteLeadsHQ — Dashboard Client
// =============================================================================

const SUPABASE_URL = "https://wjadekgptkstfdootuol.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqYWRla2dwdGtzdGZkb290dW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTc3NzQsImV4cCI6MjA5MDU3Mzc3NH0.g45wqe_F9KHh3TVzkq8LimxxT4UiuTZpJZcWkzzD7IM";

// ─── SVG Icon Map (Feather/Lucide stroke icons, viewBox 0 0 24 24) ───────────
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
  login:           `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>`,
  logout:          `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
  menu:            `<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`,
  sun:             `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
  moon:            `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
  trash:           `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`,
  edit:            `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
};

// Inject SVGs into every [data-icon] element currently in the DOM
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

// ─── State ───────────────────────────────────────────────────────────────────
let sb;
let currentUser        = null;
let currentCompanyId   = null;
let currentConvId      = null;
let currentLeadId      = null;
let customFields       = [];
let allLeads           = [];

// ─── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  renderIcons();

  await waitFor(() => window.supabase);
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Apply saved theme
  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
  updateThemeIcon();

  // Auth state
  sb.auth.onAuthStateChange((_event, session) => {
    if (session?.user) { currentUser = session.user; showApp(); }
    else               { currentUser = null;          showAuth(); }
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) { currentUser = session.user; showApp(); }
  else showAuth();

  // ── Auth ─────────────────────────────────────────────────────────────────
  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({
      email:    document.getElementById("loginEmail").value,
      password: document.getElementById("loginPassword").value,
    });
    if (error) toast(error.message, true);
  });

  document.getElementById("logoutButton")?.addEventListener("click", () => sb.auth.signOut());

  // ── Navigation ───────────────────────────────────────────────────────────
  document.querySelectorAll("[data-page]").forEach((btn) =>
    btn.addEventListener("click", () => navigateTo(btn.dataset.page))
  );
  document.querySelectorAll("[data-page-link]").forEach((btn) =>
    btn.addEventListener("click", () => navigateTo(btn.dataset.pageLink))
  );

  // ── Sidebar ──────────────────────────────────────────────────────────────
  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("appView")?.classList.toggle("collapsed");
  });

  document.getElementById("crmToggle")?.addEventListener("click", () => {
    document.getElementById("crmSubmenu")?.classList.toggle("closed");
  });

  // ── Theme ────────────────────────────────────────────────────────────────
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = dark ? "" : "dark";
    localStorage.setItem("theme", dark ? "light" : "dark");
    updateThemeIcon();
  });

  // ── Lead Modal ───────────────────────────────────────────────────────────
  const doOpenLeadModal = () => { resetLeadForm(); openModal("leadModal"); };
  ["openLeadModalTop","openLeadModal","openLeadModalEmpty","openLeadModalPipeline"].forEach((id) =>
    document.getElementById(id)?.addEventListener("click", doOpenLeadModal)
  );
  document.getElementById("cancelLeadModal")?.addEventListener("click", () => closeModal("leadModal"));
  document.getElementById("leadForm")?.addEventListener("submit", handleLeadSave);

  // ── Custom Field Modal ───────────────────────────────────────────────────
  const doOpenCFModal = () => openModal("customFieldModal");
  ["openCustomFieldModalFromLeads","openCustomFieldModalSettings"].forEach((id) =>
    document.getElementById(id)?.addEventListener("click", doOpenCFModal)
  );
  document.getElementById("closeCustomFieldModal")?.addEventListener("click", () => closeModal("customFieldModal"));
  document.getElementById("customFieldForm")?.addEventListener("submit", handleCustomFieldSave);

  // Close any modal by clicking its backdrop
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); })
  );

  // ── Settings Forms ───────────────────────────────────────────────────────
  document.getElementById("companyProfileForm")?.addEventListener("submit", handleCompanyProfileSave);
  document.getElementById("passwordForm")?.addEventListener("submit", handlePasswordChange);

  // ── AI Settings ──────────────────────────────────────────────────────────
  document.getElementById("aiSettingsForm")?.addEventListener("submit", handleAiSettingsSave);
  document.getElementById("twilioNumberForm")?.addEventListener("submit", handleTwilioNumberSave);

  // ── Sales Reps ───────────────────────────────────────────────────────────
  document.getElementById("salesRepForm")?.addEventListener("submit", handleSalesRepSave);

  // ── Conversations ────────────────────────────────────────────────────────
  document.getElementById("convSendForm")?.addEventListener("submit", handleSendMessage);
  document.getElementById("convAiToggle")?.addEventListener("change", handleAiToggle);

  // ── Search ───────────────────────────────────────────────────────────────
  document.getElementById("globalSearchInput")?.addEventListener("input", handleSearch);
});

// ─── Utility ─────────────────────────────────────────────────────────────────
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
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/, "");
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById("authView")?.classList.remove("hidden");
  document.getElementById("appView")?.classList.add("hidden");
}

async function showApp() {
  document.getElementById("authView")?.classList.add("hidden");
  document.getElementById("appView")?.classList.remove("hidden");

  const { data: profile } = await sb
    .from("profiles")
    .select("company_id, full_name, phone, role, user_type")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (profile) {
    currentCompanyId = profile.company_id;
    document.getElementById("sidebarAccountName").textContent = profile.full_name || currentUser.email;
    document.getElementById("sidebarAccountMeta").textContent = currentUser.email;
    const initials = (profile.full_name || currentUser.email || "??")
      .split(/[\s@]/).map((s) => s[0]?.toUpperCase() || "").join("").slice(0, 2);
    document.getElementById("sidebarAvatar").textContent = initials;
  }

  if (currentCompanyId) {
    const { data: company } = await sb
      .from("companies")
      .select("name")
      .eq("id", currentCompanyId)
      .maybeSingle();
    if (company?.name) {
      document.getElementById("brandCompanyName").textContent = company.name;
    }
  }

  navigateTo("dashboard");
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const CRM_PAGES = ["opportunities","leads","quotes","appointments","sales"];

const PAGE_META = {
  dashboard:          ["Dashboard",          "A live view of your lead and pipeline workspace."],
  leads:              ["Leads",              "Manage and capture your lead records."],
  opportunities:      ["Opportunities",      "Track deals through your pipeline stages."],
  quotes:             ["Quotes",             "Leads that have been quoted."],
  appointments:       ["Appointments",       "Scheduled appointments and bookings."],
  sales:              ["Sales",              "Closed won and lost performance summary."],
  conversations:      ["Conversations",      "SMS threads with leads."],
  "general-settings": ["Account & Company",  "Manage your company and personal profile."],
  "ai-settings":      ["AI Settings",        "Configure your SMS agent and Twilio numbers."],
  "sales-reps":       ["Sales Reps",         "Manage active sales representatives."],
};

function navigateTo(page) {
  // Set active states on nav buttons
  document.querySelectorAll("[data-page]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.page === page)
  );
  // Highlight CRM parent when a sub-page is active
  const crmToggle = document.getElementById("crmToggle");
  if (crmToggle) crmToggle.classList.toggle("active", CRM_PAGES.includes(page));

  // Show the right page panel
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`page-${page}`)?.classList.remove("hidden");

  // Update header
  const [title, sub] = PAGE_META[page] || [page, ""];
  document.getElementById("pageTitle").textContent  = title;
  document.getElementById("pageSubtitle").textContent = sub;

  // Load data for the page
  const loaders = {
    dashboard:          loadDashboard,
    leads:              loadLeads,
    opportunities:      loadOpportunities,
    quotes:             loadQuotes,
    sales:              loadSales,
    conversations:      loadConversations,
    "general-settings": loadSettings,
    "ai-settings":      loadAiSettings,
    "sales-reps":       loadSalesReps,
  };
  loaders[page]?.();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentCompanyId) return;

  const [{ data: leads }, { data: cf }] = await Promise.all([
    sb.from("leads").select("id, name, email, status, value, created_at").eq("company_id", currentCompanyId),
    sb.from("custom_fields").select("id").eq("company_id", currentCompanyId),
  ]);

  const all    = leads || [];
  const cfLen  = cf?.length || 0;
  const open   = all.filter((l) => !["Closed Won","Closed Lost"].includes(l.status)).length;
  const quoted = all.filter((l) => l.status === "Quoted").length;

  // Stat cards
  document.getElementById("statLeadCount").textContent    = all.length;
  document.getElementById("statOpenPipeline").textContent = open;
  document.getElementById("statQuotes").textContent       = quoted;
  document.getElementById("statCustomFields").textContent = cfLen;

  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const newThisWeek = all.filter((l) => new Date(l.created_at) > weekAgo).length;
  document.getElementById("leadGrowthChip").textContent   = newThisWeek ? `+${newThisWeek} this week` : "No new";
  document.getElementById("qualifyingChip").textContent   = `${all.filter((l)=>l.status==="Qualifying").length} qualifying`;
  document.getElementById("quoteChip").textContent        = `${quoted} quoted`;
  document.getElementById("customFieldChip").textContent  = `${cfLen} field${cfLen===1?"":"s"}`;

  buildLeadVolumeChart(all);
  renderRecentLeads(all.slice().sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,5));
  renderPipelineSnapshot(all);
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
      <div class="bar" style="height:${Math.max((counts[i]/max)*160, 10)}px" title="${counts[i]} leads"></div>
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
      <div><h3>${l.name||"—"}</h3><p>${l.email||"—"}</p></div>
      <div><span class="chip">${l.status||"—"}</span></div>
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
    const val   = items.reduce((a, l) => a + (Number(l.value)||0), 0);
    return `<div class="item" style="grid-template-columns:1.4fr 80px 110px">
      <div><h3>${s}</h3></div>
      <div><p>${items.length} lead${items.length===1?"":"s"}</p></div>
      <div><p>${val ? fmt(val) : "—"}</p></div>
    </div>`;
  }).join("");
}

// ─── Custom Fields ────────────────────────────────────────────────────────────
async function loadCustomFields() {
  if (!currentCompanyId) return [];
  const { data } = await sb
    .from("custom_fields")
    .select("*")
    .eq("company_id", currentCompanyId)
    .order("created_at");
  customFields = data || [];
  return customFields;
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
          : `<input type="${f.type||"text"}" name="cf_${f.key}" value="${values[f.key] || ""}">`}
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
  const label = document.getElementById("customFieldLabel").value.trim();
  const type  = document.getElementById("customFieldType").value;
  if (!label) return;
  const key = slugify(label);

  const { error } = await sb.from("custom_fields").insert({
    company_id: currentCompanyId, label, type, key,
  });
  if (error) { toast(error.message, true); return; }
  toast("Custom field added.");
  document.getElementById("customFieldForm").reset();
  await loadCustomFields();
  renderSettingsCustomFields();
  await renderCustomFieldInputs();
  document.getElementById("statCustomFields").textContent = customFields.length;
  document.getElementById("customFieldChip").textContent  = `${customFields.length} field${customFields.length===1?"":"s"}`;
}

async function deleteCustomField(id) {
  if (!confirm("Delete this custom field? Values stored in leads will be lost.")) return;
  const { error } = await sb.from("custom_fields").delete().eq("id", id);
  if (error) { toast(error.message, true); return; }
  toast("Custom field deleted.");
  await loadCustomFields();
  renderSettingsCustomFields();
}

// ─── Leads ────────────────────────────────────────────────────────────────────
async function loadLeads() {
  if (!currentCompanyId) return;
  await loadCustomFields();
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false });
  if (error) { toast(error.message, true); return; }
  allLeads = data || [];
  renderLeadsTable(allLeads);
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
      <td><strong>${l.name||"—"}</strong><span class="muted">${fmtDate(l.created_at)}</span></td>
      <td><strong>${l.email||"—"}</strong>${l.phone?`<span class="muted">${l.phone}</span>`:""}</td>
      <td><strong>${l.address||"—"}</strong>${l.postcode?`<span class="muted">${l.postcode}</span>`:""}</td>
      <td>${l.source?`<span class="chip">${l.source}</span>`:"—"}</td>
      <td><span class="chip">${l.status||"—"}</span></td>
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
  return Object.entries(data).slice(0, 2).map(([k, v]) => `<div>${k}: ${v||"—"}</div>`).join("");
}

function resetLeadForm() {
  document.getElementById("leadForm")?.reset();
  document.getElementById("leadId").value = "";
  document.getElementById("leadModalTitle").textContent = "New Lead";
  renderCustomFieldInputs();
}

async function openEditLead(id) {
  const l = allLeads.find((x) => x.id === id);
  if (!l) return;
  document.getElementById("leadModalTitle").textContent = "Edit Lead";
  document.getElementById("leadId").value        = l.id;
  document.getElementById("leadName").value       = l.name    || "";
  document.getElementById("leadEmail").value      = l.email   || "";
  document.getElementById("leadPhone").value      = l.phone   || "";
  document.getElementById("leadPostcode").value   = l.postcode|| "";
  document.getElementById("leadAddress").value    = l.address || "";
  document.getElementById("leadSource").value     = l.source  || "";
  document.getElementById("leadStatus").value     = l.status  || "New Lead";
  document.getElementById("leadValue").value      = l.value   || "";
  document.getElementById("leadNotes").value      = l.notes   || "";
  await renderCustomFieldInputs(l.custom_data || {});
  openModal("leadModal");
}

async function handleLeadSave(e) {
  e.preventDefault();
  const id = document.getElementById("leadId").value;

  // Collect custom field values
  const custom_data = {};
  customFields.forEach((f) => {
    const el = document.querySelector(`[name="cf_${f.key}"]`);
    if (el) custom_data[f.key] = el.value;
  });

  const payload = {
    company_id: currentCompanyId,
    name:     document.getElementById("leadName").value       || null,
    email:    document.getElementById("leadEmail").value      || null,
    phone:    document.getElementById("leadPhone").value      || null,
    postcode: document.getElementById("leadPostcode").value   || null,
    address:  document.getElementById("leadAddress").value    || null,
    source:   document.getElementById("leadSource").value     || null,
    status:   document.getElementById("leadStatus").value,
    value:    Number(document.getElementById("leadValue").value) || null,
    notes:    document.getElementById("leadNotes").value      || null,
    custom_data,
  };

  const { error } = id
    ? await sb.from("leads").update(payload).eq("id", id)
    : await sb.from("leads").insert(payload);

  if (error) { toast(error.message, true); return; }
  toast(id ? "Lead updated." : "Lead created.");
  closeModal("leadModal");
  loadLeads();
  loadDashboard();
}

async function deleteLead(id) {
  if (!confirm("Delete this lead? This cannot be undone.")) return;
  const { error } = await sb.from("leads").delete().eq("id", id);
  if (error) { toast(error.message, true); return; }
  toast("Lead deleted.");
  loadLeads();
  loadDashboard();
}

// ─── Search ───────────────────────────────────────────────────────────────────
function handleSearch(e) {
  const q = e.target.value.toLowerCase().trim();
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
  const { data } = await sb
    .from("leads")
    .select("id, name, email, phone, status, value, created_at")
    .eq("company_id", currentCompanyId);
  allLeads = data || [];
  buildKanban(allLeads);
}

function buildKanban(leads) {
  const board = document.getElementById("kanbanBoard");
  if (!board) return;
  board.innerHTML = KANBAN_STAGES.map((stage) => {
    const cards = leads.filter((l) => l.status === stage);
    return `<div class="col">
      <div class="colhead">
        <b>${stage}</b><span class="chip">${cards.length}</span>
      </div>
      <div class="cards">
        ${cards.length
          ? cards.map((l) => `<div class="kcard">
              <h3>${l.name||"—"}</h3>
              <p>${l.email||l.phone||"—"}</p>
              <span class="money">${l.value ? fmt(l.value) : "No value set"}</span>
            </div>`).join("")
          : `<div class="empty" style="min-height:80px"><p>No leads here</p></div>`}
      </div>
    </div>`;
  }).join("");
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
async function loadQuotes() {
  if (!currentCompanyId) return;
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
      <div><strong style="font-size:13px">${l.name||"—"}</strong><span class="muted">${l.email||l.phone||"—"}</span></div>
      <div><span class="chip">Quoted</span></div>
      <div><strong style="font-size:13px">${fmt(l.value)}</strong><span class="muted">${fmtDate(l.created_at)}</span></div>
    </div>`).join("")}</div>`;
}

// ─── Sales ────────────────────────────────────────────────────────────────────
async function loadSales() {
  if (!currentCompanyId) return;
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
  const wonVal  = won.reduce((a, l) => a + (Number(l.value)||0), 0);
  const lostVal = lost.reduce((a, l) => a + (Number(l.value)||0), 0);
  const winRate = leads.length ? Math.round((won.length / leads.length) * 100) : 0;

  el.innerHTML = `
    <div class="mini-grid" style="margin-bottom:20px">
      <div class="mini-card"><h3>Closed Won</h3><b>${won.length}</b><span class="muted">${fmt(wonVal)} total</span></div>
      <div class="mini-card"><h3>Closed Lost</h3><b>${lost.length}</b><span class="muted">${fmt(lostVal)} lost</span></div>
      <div class="mini-card"><h3>Win Rate</h3><b>${winRate}%</b><span class="muted">of closed deals</span></div>
    </div>
    ${leads.length ? `<div class="table-lite">${leads.map((l) => `
      <div class="row">
        <div><strong style="font-size:13px">${l.name||"—"}</strong><span class="muted">${fmtDate(l.created_at)}</span></div>
        <div><span class="chip">${l.status}</span></div>
        <div><strong style="font-size:13px">${fmt(l.value)}</strong></div>
      </div>`).join("")}</div>`
      : `<div class="empty"><p>No closed deals yet.</p></div>`}`;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  if (!currentCompanyId) return;

  const [{ data: company }, { data: profile }] = await Promise.all([
    sb.from("companies").select("*").eq("id", currentCompanyId).maybeSingle(),
    sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle(),
  ]);

  if (company) {
    document.getElementById("settingsCompanyName").value  = company.name  || "";
    document.getElementById("settingsCompanyEmail").value = company.email || "";
    document.getElementById("settingsCompanyPhone").value = company.phone || "";
  }
  if (profile) {
    document.getElementById("settingsOwnerName").value  = profile.full_name || "";
    document.getElementById("settingsOwnerEmail").value = currentUser.email || "";
    document.getElementById("settingsOwnerPhone").value = profile.phone || "";
  }
  await loadCustomFields();
  renderSettingsCustomFields();
}

async function handleCompanyProfileSave(e) {
  e.preventDefault();
  const companyName = document.getElementById("settingsCompanyName").value;
  const ownerName   = document.getElementById("settingsOwnerName").value;

  const [{ error: ce }, { error: pe }] = await Promise.all([
    sb.from("companies").update({
      name:  companyName,
      email: document.getElementById("settingsCompanyEmail").value,
      phone: document.getElementById("settingsCompanyPhone").value,
    }).eq("id", currentCompanyId),
    sb.from("profiles").update({
      full_name: ownerName,
      phone:     document.getElementById("settingsOwnerPhone").value,
    }).eq("id", currentUser.id),
  ]);

  if (ce || pe) { toast((ce || pe).message, true); return; }
  toast("Profile saved.");
  document.getElementById("brandCompanyName").textContent  = companyName;
  document.getElementById("sidebarAccountName").textContent = ownerName;
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const np = document.getElementById("newPassword").value;
  const cp = document.getElementById("confirmNewPassword").value;
  if (np !== cp) { toast("Passwords do not match.", true); return; }
  const { error } = await sb.auth.updateUser({ password: np });
  if (error) { toast(error.message, true); return; }
  toast("Password updated.");
  document.getElementById("passwordForm").reset();
}

// ─── AI Settings ──────────────────────────────────────────────────────────────
async function loadAiSettings() {
  if (!currentCompanyId) return;
  const { data } = await sb
    .from("ai_settings")
    .select("*")
    .eq("company_id", currentCompanyId)
    .maybeSingle();

  if (data) {
    document.getElementById("aiModel").value               = data.model             || "";
    document.getElementById("aiTwilioNumber").value        = data.twilio_number     || "";
    document.getElementById("aiReplyDelay").value          = data.reply_delay_seconds ?? "";
    document.getElementById("aiMaxWords").value            = data.max_sms_words     ?? "";
    document.getElementById("aiEnabled").checked           = !!data.is_active;
    document.getElementById("aiAutoReply").checked         = !!data.auto_reply;
    document.getElementById("aiCallbackEnabled").checked   = !!data.callback_enabled;
    document.getElementById("aiOnsiteEnabled").checked     = !!data.onsite_enabled;
    document.getElementById("aiQuoteDraftingEnabled").checked = !!data.quote_drafting_enabled;
    document.getElementById("aiLeadScoringEnabled").checked   = !!data.lead_scoring_enabled;
    document.getElementById("aiSystemPrompt").value        = data.system_prompt     || "";
  }

  const { data: nums } = await sb
    .from("twilio_numbers")
    .select("id")
    .eq("company_id", currentCompanyId);
  document.getElementById("twilioCountValue").textContent = nums?.length || 0;
  loadTwilioNumbers();
}

async function handleAiSettingsSave(e) {
  e.preventDefault();
  const payload = {
    company_id:              currentCompanyId,
    model:                   document.getElementById("aiModel").value,
    twilio_number:           document.getElementById("aiTwilioNumber").value,
    reply_delay_seconds:     Number(document.getElementById("aiReplyDelay").value)  || 0,
    max_sms_words:           Number(document.getElementById("aiMaxWords").value)    || 160,
    is_active:               document.getElementById("aiEnabled").checked,
    auto_reply:              document.getElementById("aiAutoReply").checked,
    callback_enabled:        document.getElementById("aiCallbackEnabled").checked,
    onsite_enabled:          document.getElementById("aiOnsiteEnabled").checked,
    quote_drafting_enabled:  document.getElementById("aiQuoteDraftingEnabled").checked,
    lead_scoring_enabled:    document.getElementById("aiLeadScoringEnabled").checked,
    system_prompt:           document.getElementById("aiSystemPrompt").value,
  };
  const { error } = await sb.from("ai_settings").upsert(payload, { onConflict: "company_id" });
  if (error) { toast(error.message, true); return; }
  toast("AI settings saved.");
}

async function loadTwilioNumbers() {
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
      <div><span class="muted">${n.friendly_name||"—"}</span></div>
      <button class="iconbtn btn-danger" onclick="deleteTwilioNumber('${n.id}')" type="button">
        <span class="icon" data-icon="trash"></span>
      </button>
    </div>`).join("")}</div>`;
  renderIcons();
}

async function handleTwilioNumberSave(e) {
  e.preventDefault();
  const { error } = await sb.from("twilio_numbers").insert({
    company_id:    currentCompanyId,
    phone_number:  document.getElementById("twilioPhoneNumber").value,
    friendly_name: document.getElementById("twilioFriendlyName").value,
  });
  if (error) { toast(error.message, true); return; }
  toast("Number added.");
  document.getElementById("twilioNumberForm").reset();
  await loadTwilioNumbers();
  const { data: nums } = await sb.from("twilio_numbers").select("id").eq("company_id", currentCompanyId);
  document.getElementById("twilioCountValue").textContent = nums?.length || 0;
}

async function deleteTwilioNumber(id) {
  if (!confirm("Remove this number?")) return;
  await sb.from("twilio_numbers").delete().eq("id", id);
  loadTwilioNumbers();
}

// ─── Sales Reps ───────────────────────────────────────────────────────────────
async function loadSalesReps() {
  if (!currentCompanyId) return;

  // Populate the member dropdown
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, full_name, email")
    .eq("company_id", currentCompanyId);
  const sel = document.getElementById("salesRepUser");
  if (sel && profiles) {
    sel.innerHTML = `<option value="">Select member</option>` +
      profiles.map((p) => `<option value="${p.id}">${p.full_name||p.email}</option>`).join("");
  }

  // List existing reps
  const { data: reps } = await sb
    .from("sales_reps")
    .select("*")
    .eq("company_id", currentCompanyId)
    .order("created_at");
  const el = document.getElementById("salesRepsList");
  if (!el) return;
  if (!reps?.length) {
    el.innerHTML = `<div class="notice">No sales reps added yet.</div>`;
    return;
  }
  el.innerHTML = `<div class="table-lite">${reps.map((r) => `
    <div class="row">
      <div><strong style="font-size:13px">${r.name||"—"}</strong><span class="muted">${r.email||"—"}</span></div>
      <div><span class="muted">${r.phone||"—"}</span></div>
      <button class="iconbtn btn-danger" onclick="deleteSalesRep('${r.id}')" type="button">
        <span class="icon" data-icon="trash"></span>
      </button>
    </div>`).join("")}</div>`;
  renderIcons();
}

async function handleSalesRepSave(e) {
  e.preventDefault();
  const { error } = await sb.from("sales_reps").insert({
    company_id: currentCompanyId,
    user_id:    document.getElementById("salesRepUser").value || null,
    name:       document.getElementById("salesRepName").value,
    email:      document.getElementById("salesRepEmail").value,
    phone:      document.getElementById("salesRepPhone").value,
  });
  if (error) { toast(error.message, true); return; }
  toast("Sales rep added.");
  document.getElementById("salesRepForm").reset();
  loadSalesReps();
}

async function deleteSalesRep(id) {
  if (!confirm("Remove this sales rep?")) return;
  await sb.from("sales_reps").delete().eq("id", id);
  loadSalesReps();
}

// ─── Conversations ────────────────────────────────────────────────────────────
async function loadConversations() {
  const { data: conversations } = await sb
    .from("conversations")
    .select("id, lead_id, last_message, last_message_at, leads(name, phone)")
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
                 data-lead-name="${name}" data-lead-phone="${c.leads?.phone||""}">
      <h3>${name}<span class="conv-time">${time}</span></h3>
      <p>${c.last_message||"No messages yet"}</p>
    </div>`;
  }).join("");

  // Wire clicks after render
  list.querySelectorAll(".conv-item").forEach((item) =>
    item.addEventListener("click", () => openConversation(
      item.dataset.convId,
      item.dataset.leadId,
      item.dataset.leadName,
      item.dataset.leadPhone,
      item
    ))
  );
}

async function openConversation(convId, leadId, name, phone, itemEl) {
  currentConvId  = convId;
  currentLeadId  = leadId;

  document.getElementById("convDetailEmpty")?.classList.add("hidden");
  document.getElementById("convDetail")?.classList.remove("hidden");
  document.getElementById("convLeadName").textContent  = name;
  document.getElementById("convLeadPhone").textContent = phone;

  document.querySelectorAll(".conv-item").forEach((el) => el.classList.remove("active"));
  itemEl?.classList.add("active");

  await loadMessages(convId);

  // Sync AI toggle state from lead record
  if (leadId) {
    const { data: lead } = await sb.from("leads").select("ai_enabled").eq("id", leadId).maybeSingle();
    const tog = document.getElementById("convAiToggle");
    const status = document.getElementById("convAiStatus");
    if (tog && lead) {
      const on = lead.ai_enabled !== false; // default true if null
      tog.checked = on;
      if (status) { status.textContent = on ? "ON" : "OFF"; status.className = `ai-toggle-status ${on?"on":"off"}`; }
    }
  }
}

async function loadMessages(convId) {
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
  el.innerHTML = msgs.map((m) => `
    <div class="msg ${m.direction === "inbound" ? "inbound" : "outbound"}">
      ${m.content}
      <div class="msg-meta">
        ${m.sender_type ? `<span class="msg-badge ${m.sender_type}">${m.sender_type}</span>` : ""}
        <span>${fmtDate(m.created_at)}</span>
      </div>
    </div>`).join("");
  el.scrollTop = el.scrollHeight;
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input   = document.getElementById("convMessageInput");
  const content = input.value.trim();
  if (!content || !currentConvId) return;

  const { error } = await sb.from("messages").insert({
    conversation_id: currentConvId,
    content,
    direction:   "outbound",
    sender_type: "human",
  });
  if (error) { toast(error.message, true); return; }
  input.value = "";
  await Promise.all([
    loadMessages(currentConvId),
    sb.from("conversations").update({
      last_message: content, last_message_at: new Date().toISOString(),
    }).eq("id", currentConvId),
  ]);
}

async function handleAiToggle() {
  if (!currentLeadId) return;
  const on = document.getElementById("convAiToggle").checked;
  const status = document.getElementById("convAiStatus");
  if (status) { status.textContent = on ? "ON" : "OFF"; status.className = `ai-toggle-status ${on?"on":"off"}`; }
  await sb.from("leads").update({ ai_enabled: on }).eq("id", currentLeadId);
}
