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
  bell:              `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  "arrow-left":      `<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`,
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

const DEFAULT_TAX_RATE = 10;

function stageLabel(dbVal) { return STAGE_LABELS[dbVal] || dbVal || "—"; }
function stageKey(label)   { return STAGE_FROM_LABEL[label] || label; }

// AI status helper: derive heat label from score, or use stored ai_status
function aiStatusFromScore(score) {
  if (score == null) return "new";
  if (score >= 75) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function aiStatusLabel(lead) {
  const status = lead.ai_status || aiStatusFromScore(lead.ai_score);
  const labels = { hot: "🔥 Hot", warm: "🌤 Warm", cold: "❄️ Cold", new: "New" };
  return labels[status] || status;
}

function aiStatusChipClass(lead) {
  const status = lead.ai_status || aiStatusFromScore(lead.ai_score);
  return "chip-" + (status || "new");
}

function aiScoreDisplay(lead) {
  if (lead.ai_score == null) return "—";
  const status = lead.ai_status || aiStatusFromScore(lead.ai_score);
  const labels = { hot: "Hot", warm: "Warm", cold: "Cold", new: "New" };
  return `${labels[status] || status} ${lead.ai_score}/100`;
}


// ─── Auth helper ──────────────────────────────────────────────────────────────
// getSession() returns the cached session and may contain an expired JWT.
// This helper checks expiry and refreshes the token when needed so that
// edge-function fetch() calls never send a stale token.
// Set forceRefresh=true after a 401 to guarantee a fresh token on retry.
async function getAccessToken(forceRefresh = false) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) return null;

  if (forceRefresh) {
    const { data: { session: refreshed } } = await sb.auth.refreshSession();
    return refreshed?.access_token || null;
  }

  try {
    const parts = session.access_token.split(".");
    if (parts.length !== 3) throw new Error("malformed");
    // JWT uses base64url encoding; convert to standard base64 for atob()
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64));
    const nowSec  = Math.floor(Date.now() / 1000);
    // If the token expires within the next 60 seconds, force a refresh
    if (payload.exp && payload.exp - nowSec <= 60) {
      const { data: { session: refreshed } } = await sb.auth.refreshSession();
      return refreshed?.access_token || null;
    }
  } catch (e) {
    // Decode failed — token may be corrupt; try refreshing instead of using it as-is
    console.warn("JWT decode check failed, refreshing token:", e);
    const { data: { session: refreshed } } = await sb.auth.refreshSession();
    return refreshed?.access_token || null;
  }

  return session.access_token;
}

// ─── Edge-function caller ─────────────────────────────────────────────────────
// Centralises token refresh, header injection, and response parsing so every
// call-site gets robust error handling with useful messages.
// Automatically retries once with a fresh token on 401 (Invalid JWT).

function edgeFetch(fnName, body, token) {
  return fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey":        SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
}

async function edgeFn(fnName, body) {
  let token = await getAccessToken();
  if (!token) throw new Error("Not authenticated — please log in again.");

  let res = await edgeFetch(fnName, body, token);

  // On 401, force-refresh the token and retry once before giving up
  if (res.status === 401) {
    console.warn(`[edgeFn] ${fnName} returned 401, refreshing token and retrying…`);
    token = await getAccessToken(true);
    if (!token) throw new Error("Not authenticated — please log in again.");

    res = await edgeFetch(fnName, body, token);
  }

  // Read as text first so we can always inspect the raw body
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`[edgeFn] ${fnName} returned non-JSON (HTTP ${res.status}):`, text);
    throw new Error(`Server error (HTTP ${res.status}). Check the browser console for details.`);
  }

  if (!res.ok || json.error) {
    const msg =
      (typeof json.error === "string" ? json.error : null) ||
      json.message || json.msg ||
      `Request failed (HTTP ${res.status})`;
    console.error(`[edgeFn] ${fnName} error (HTTP ${res.status}):`, json);
    throw new Error(msg);
  }

  return json;
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
let authInitialized  = false;
let currentUserType  = null;  // 'internal' or 'external' — NEW
let currentUserRole  = null;  // 'owner' | 'admin' | 'member'
let currentUserPerms = {};    // permissions from sales_reps
let realtimeChannel  = null;  // Supabase realtime subscription

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
  sb.auth.onAuthStateChange((event, session) => {
    // Handle password recovery flow — show reset modal
    if (event === "PASSWORD_RECOVERY") {
      currentUser = session?.user || null;
      showApp();
      // Show password reset modal after app loads
      setTimeout(() => showPasswordResetModal(), 500);
      authInitialized = true;
      return;
    }

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
    
    // Get Turnstile token
    const turnstileInput = loginForm.querySelector('[name="cf-turnstile-response"]');
    const cfToken = turnstileInput ? turnstileInput.value : "";
    if (!cfToken) {
      toast("Please complete the CAPTCHA verification.", true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.textContent;
      submitBtn.textContent = "Signing in...";
    }
    emailInput && (emailInput.disabled = true);
    passwordInput && (passwordInput.disabled = true);
    
    try {
      // Verify Turnstile token server-side before authenticating
      const verifyRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-turnstile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ cf_turnstile_response: cfToken }),
      });
      if (!verifyRes.ok) {
        const verifyData = await verifyRes.json().catch(() => ({}));
        toast(verifyData.error || "CAPTCHA verification failed.", true);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || "Sign In";
        }
        emailInput && (emailInput.disabled = false);
        passwordInput && (passwordInput.disabled = false);
        if (window.turnstile) turnstile.reset(loginForm.querySelector('.cf-turnstile'));
        return;
      }

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
        if (window.turnstile) turnstile.reset(loginForm.querySelector('.cf-turnstile'));
      }
    } catch (err) {
      toast("Login failed. Please try again.", true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalText || "Sign In";
      }
      emailInput && (emailInput.disabled = false);
      passwordInput && (passwordInput.disabled = false);
      if (window.turnstile) turnstile.reset(loginForm.querySelector('.cf-turnstile'));
    }
  });

  // ── Forgot Password ──────────────────────────────────────────────────────
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const backToLogin = document.getElementById("backToLogin");
  const forgotPasswordForm = document.getElementById("forgotPasswordForm");
  const signupForm = document.getElementById("signupForm");
  const authTabs = document.getElementById("authTabs");

  // ── Auth Tab Switching (Sign In / Sign Up) ──────────────────────────────
  authTabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    const tab = btn.dataset.tab;

    // Update active tab
    authTabs.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Show the correct form, hide others
    loginForm?.classList.toggle("hidden", tab !== "login");
    signupForm?.classList.toggle("hidden", tab !== "signup");
    forgotPasswordForm?.classList.add("hidden");
  });

  forgotPasswordLink?.addEventListener("click", () => {
    loginForm?.classList.add("hidden");
    signupForm?.classList.add("hidden");
    forgotPasswordForm?.classList.remove("hidden");
    authTabs?.classList.add("hidden");
    // Pre-fill email if already entered on login form
    const loginEmail = document.getElementById("loginEmail");
    const forgotEmail = document.getElementById("forgotEmail");
    if (loginEmail?.value && forgotEmail) forgotEmail.value = loginEmail.value;
  });

  backToLogin?.addEventListener("click", () => {
    forgotPasswordForm?.classList.add("hidden");
    loginForm?.classList.remove("hidden");
    authTabs?.classList.remove("hidden");
    // Reset tab active state to Sign In
    authTabs?.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === "login");
    });
  });

  forgotPasswordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
    const emailInput = document.getElementById("forgotEmail");
    const email = emailInput?.value || "";

    if (!email) {
      toast("Please enter your email address.", true);
      return;
    }

    // Get Turnstile token
    const turnstileInput = forgotPasswordForm.querySelector('[name="cf-turnstile-response"]');
    const cfToken = turnstileInput ? turnstileInput.value : "";
    if (!cfToken) {
      toast("Please complete the CAPTCHA verification.", true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";
    }

    try {
      // Use our Resend-powered edge function for password reset
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, cf_turnstile_response: cfToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast(data.error || "Failed to send reset link. Please try again.", true);
        if (window.turnstile) turnstile.reset(forgotPasswordForm.querySelector('.cf-turnstile'));
      } else {
        toast("Password reset link sent! Check your email.");
        // Switch back to login form after a short delay
        setTimeout(() => {
          forgotPasswordForm?.classList.add("hidden");
          loginForm?.classList.remove("hidden");
        }, 2000);
      }
    } catch (err) {
      toast("Failed to send reset link. Please try again.", true);
      if (window.turnstile) turnstile.reset(forgotPasswordForm.querySelector('.cf-turnstile'));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Reset Link";
      }
    }
  });

  // ── Sign Up Form ──────────────────────────────────────────────────────────
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitBtn = signupForm.querySelector('button[type="submit"]');
    const nameInput = document.getElementById("signupName");
    const companyInput = document.getElementById("signupCompany");
    const emailInput = document.getElementById("signupEmail");
    const passwordInput = document.getElementById("signupPassword");
    const keyInput = document.getElementById("signupActivationKey");

    const full_name = nameInput?.value?.trim() || "";
    const company_name = companyInput?.value?.trim() || "";
    const email = emailInput?.value?.trim() || "";
    const password = passwordInput?.value || "";
    const activation_key = keyInput?.value?.trim() || "";

    // Get Turnstile token
    const turnstileInput = signupForm.querySelector('[name="cf-turnstile-response"]');
    const cfToken = turnstileInput ? turnstileInput.value : "";
    if (!cfToken) {
      toast("Please complete the CAPTCHA verification.", true);
      return;
    }

    if (!full_name || !company_name || !email || !password || !activation_key) {
      toast("Please fill in all fields.", true);
      return;
    }
    if (password.length < 6) {
      toast("Password must be at least 6 characters.", true);
      return;
    }

    // Disable form during submission
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";
    }
    const inputs = signupForm.querySelectorAll("input");
    inputs.forEach((i) => (i.disabled = true));

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email,
          password,
          full_name,
          company_name,
          activation_key,
          cf_turnstile_response: cfToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast(data.error || "Sign up failed. Please try again.", true);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Account";
        }
        inputs.forEach((i) => (i.disabled = false));
        if (window.turnstile) turnstile.reset(signupForm.querySelector('.cf-turnstile'));
        return;
      }

      // Account created — auto sign in
      toast("Account created! Signing you in...");
      const { error: signInError } = await sb.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        toast("Account created but auto sign-in failed. Please sign in manually.", true);
        // Switch to login tab and pre-fill email
        authTabs?.querySelectorAll("button").forEach((b) => {
          b.classList.toggle("active", b.dataset.tab === "login");
        });
        signupForm?.classList.add("hidden");
        loginForm?.classList.remove("hidden");
        const loginEmail = document.getElementById("loginEmail");
        if (loginEmail) loginEmail.value = email;
      }
    } catch (err) {
      toast("Sign up failed. Please try again.", true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      }
      inputs.forEach((i) => (i.disabled = false));
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

  // ── Import Leads Modal ─────────────────────────────────────────────────────
  document.getElementById("openImportLeadsModal")?.addEventListener("click", openImportLeadsModal);
  document.getElementById("cancelImportModal")?.addEventListener("click", () => { resetImportModal(); closeModal("importLeadsModal"); });
  document.getElementById("csvFileInput")?.addEventListener("change", handleCsvFileSelected);
  document.getElementById("importNextBtn")?.addEventListener("click", handleImportNext);
  document.getElementById("importBackBtn")?.addEventListener("click", handleImportBack);
  document.getElementById("importConsentCheck")?.addEventListener("change", updateImportButtonState);

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
  document.getElementById("settingsCompanyLogo")?.addEventListener("change", handleLogoFileChange);
  document.getElementById("removeLogoBtn")?.addEventListener("click", handleRemoveLogo);

  // ── AI Settings ───────────────────────────────────────────────────────────
  document.getElementById("aiSettingsForm")?.addEventListener("submit", handleAiSettingsSave);
  document.getElementById("twilioNumberForm")?.addEventListener("submit", handleTwilioNumberSave);
  document.getElementById("addPricingItemBtn")?.addEventListener("click", addPricingItemRow);

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
  document.getElementById("leadRoutingForm")?.addEventListener("submit", handleLeadRoutingSave);

  // ── Conversations ─────────────────────────────────────────────────────────
  document.getElementById("convSendForm")?.addEventListener("submit", handleSendMessage);
  document.getElementById("convAiToggle")?.addEventListener("change", handleAiToggle);
  document.getElementById("convBackBtn")?.addEventListener("click", closeConversationDetail);

  // ── Bulk SMS ────────────────────────────────────────────────────────────
  document.getElementById("bulkSmsStageFilter")?.addEventListener("change", updateBulkSmsLeadCount);
  document.getElementById("bulkSmsMessage")?.addEventListener("input", updateBulkSmsPreview);
  document.getElementById("bulkSmsPreviewLead")?.addEventListener("change", updateBulkSmsPreview);
  document.getElementById("bulkSmsSendBtn")?.addEventListener("click", handleBulkSmsSend);

  // ── Notifications ───────────────────────────────────────────────────────
  document.getElementById("markAllReadBtn")?.addEventListener("click", markAllNotificationsRead);

  // ── Search ────────────────────────────────────────────────────────────────
  document.getElementById("globalSearchInput")?.addEventListener("input", handleSearch);

  // ── Quote Modal ──────────────────────────────────────────────────────────
  document.getElementById("openQuoteModal")?.addEventListener("click", openQuoteModalHandler);
  document.getElementById("cancelQuoteModal")?.addEventListener("click", () => closeModal("quoteModal"));
  document.getElementById("quoteForm")?.addEventListener("submit", handleQuoteSave);
  document.getElementById("addQuoteLineItemBtn")?.addEventListener("click", () => addQuoteLineItemRow());
  document.getElementById("quoteLineTaxRate")?.addEventListener("input", recalcQuoteTotals);
  document.getElementById("quoteLineTaxMode")?.addEventListener("change", recalcQuoteTotals);
  document.getElementById("quoteDefaultsForm")?.addEventListener("submit", handleQuoteDefaultsSave);

  // ── Appointment Modal ────────────────────────────────────────────────────
  document.getElementById("openAppointmentModal")?.addEventListener("click", openAppointmentModalHandler);
  document.getElementById("cancelAppointmentModal")?.addEventListener("click", () => closeModal("appointmentModal"));
  document.getElementById("appointmentForm")?.addEventListener("submit", handleAppointmentSave);
  document.getElementById("deleteAppointmentBtn")?.addEventListener("click", deleteAppointment);

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

// ── Password Reset Modal ──────────────────────────────────────────────────
function showPasswordResetModal() {
  openModal("passwordResetModal");
}

// Password reset form handler
document.getElementById("passwordResetForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const newPassword = document.getElementById("newPassword")?.value || "";
  const confirmPassword = document.getElementById("confirmNewPassword")?.value || "";

  if (newPassword.length < 6) {
    toast("Password must be at least 6 characters.", true);
    return;
  }

  if (newPassword !== confirmPassword) {
    toast("Passwords do not match.", true);
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating...";
  }

  try {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) {
      toast(error.message, true);
    } else {
      toast("Password updated successfully!");
      closeModal("passwordResetModal");
      const pwEl = document.getElementById("newPassword");
      const cfEl = document.getElementById("confirmNewPassword");
      if (pwEl) pwEl.value = "";
      if (cfEl) cfEl.value = "";
    }
  } catch (err) {
    toast("Failed to update password. Please try again.", true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update Password";
    }
  }
});

function toast(msg, isError = false) {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = `toast${isError ? " err" : ""}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function cap(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
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
    loginForm.classList.remove("hidden");
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

  // Reset signup form state
  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    signupForm.reset();
    signupForm.classList.add("hidden");
  }

  // Reset forgot password form
  const forgotPasswordForm = document.getElementById("forgotPasswordForm");
  if (forgotPasswordForm) forgotPasswordForm.classList.add("hidden");

  // Reset tabs to Sign In
  const authTabs = document.getElementById("authTabs");
  if (authTabs) {
    authTabs.classList.remove("hidden");
    authTabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === "login");
    });
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
    currentUserRole = profile?.role || 'member';

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
        const sidebarCompany = document.getElementById("sidebarCompanyName");
        if (sidebarCompany) sidebarCompany.textContent = company.name;
      }
    }

    // Fetch current user's permissions from sales_reps
    if (currentCompanyId && currentUser) {
      const { data: repData } = await sb
        .from("sales_reps")
        .select("can_edit_leads, can_edit_quotes, can_edit_appointments, can_manage_pipeline, can_send_sms, can_initiate_calls, leads_visibility, quotes_visibility, appointments_visibility, sales_visibility, conversations_visibility")
        .eq("company_id", currentCompanyId)
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (repData) {
        currentUserPerms = repData;
      } else if (currentUserRole === 'owner' || currentUserRole === 'admin') {
        // Owners/admins get full permissions even without a sales_reps record
        currentUserPerms = {
          can_edit_leads: true, can_edit_quotes: true, can_edit_appointments: true,
          can_manage_pipeline: true, can_send_sms: true, can_initiate_calls: true,
          leads_visibility: 'all', quotes_visibility: 'all', appointments_visibility: 'all',
          sales_visibility: 'all', conversations_visibility: 'all',
        };
      }
      applyPermissionRestrictions();
    }

    // Set up realtime subscriptions for live message updates
    setupRealtimeSubscription();

    // Load notification badge count
    loadNotificationBadge();

    navigateTo("dashboard");
  } catch (err) {
    console.error("Error loading app:", err);
    toast("Error loading dashboard. Please refresh.", true);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const CRM_PAGES = ["pipeline","leads","quotes","appointments","sales"];

const PAGE_META = {
  dashboard:          ["Dashboard",         "A live view of your lead and pipeline workspace."],
  leads:              ["Leads",             "Manage and capture your lead records."],
  pipeline:           ["Pipeline",          "Track leads through your pipeline stages."],
  quotes:             ["Quotes",            "Leads that have been quoted."],
  appointments:       ["Appointments",      "Scheduled appointments and bookings."],
  sales:              ["Sales",             "Closed won and lost performance summary."],
  notifications:      ["Notifications",    "AI activity and goal completions."],
  conversations:      ["Conversations",     "SMS threads with leads."],
  "bulk-sms":         ["Bulk SMS",           "Database reactivation — send personalized SMS to multiple leads."],
  "general-settings": ["Account & Company", "Manage your company and personal profile."],
  "ai-settings":      ["AI Settings",       "Configure your SMS agent and Twilio numbers."],
  "voice-ai":         ["Voice AI",          "Configure VAPI voice agent for calls."],
  "ai-insights":      ["AI Insights",       "See how your AI agents are improving over time."],
  "team-members":     ["Team Members",      "Invite and manage your team."],
  "integrations":     ["Integrations",      "API keys, webhooks, and external connections."],
};

function isAdmin() {
  return currentUserRole === 'owner' || currentUserRole === 'admin';
}

function applyPermissionRestrictions() {
  // Non-admin users: hide admin-only nav items
  const adminOnlyPages = ['team-members', 'ai-settings', 'voice-ai', 'integrations'];
  adminOnlyPages.forEach((page) => {
    const navBtn = document.querySelector(`[data-page="${page}"]`);
    if (navBtn) navBtn.style.display = isAdmin() ? '' : 'none';
  });

  // Hide edit buttons based on permissions
  document.querySelectorAll('[data-perm]').forEach((el) => {
    const perm = el.dataset.perm;
    const allowed = isAdmin() || currentUserPerms[perm];
    el.style.display = allowed ? '' : 'none';
  });
}

function navigateTo(page) {
  document.querySelectorAll("[data-page]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.page === page)
  );
  const crmToggle = document.getElementById("crmToggle");
  if (crmToggle) crmToggle.classList.toggle("active", CRM_PAGES.includes(page));

  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.remove("hidden");

  // Reset conversation mobile view when navigating away
  document.querySelector(".conv-layout")?.classList.remove("conv-open");

  const [title, sub] = PAGE_META[page] || [page, ""];
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");
  if (pageTitle) pageTitle.textContent = title;
  if (pageSubtitle) pageSubtitle.textContent = sub;

  const loaders = {
    dashboard:          loadDashboard,
    leads:              loadLeads,
    pipeline:           loadPipeline,
    quotes:             loadQuotes,
    appointments:       loadAppointments,
    sales:              loadSales,
    conversations:      loadConversations,
    "bulk-sms":         loadBulkSms,
    notifications:      loadNotifications,
    "general-settings": loadSettings,
    "ai-settings":      loadAiSettings,
    "voice-ai":         loadVoiceAi,
    "ai-insights":      loadAiInsights,
    "team-members":     loadTeamMembers,
    "integrations":     loadIntegrations,
  };
  loaders[page]?.();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
let dashRange = "today";

function getDashRangeStart() {
  const now = new Date();
  switch (dashRange) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    case "trailing12":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

async function loadDashboard() {
  if (!currentCompanyId) return;

  // Attach range toggle listeners once
  const toggle = document.getElementById("dashRangeToggle");
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = "1";
    toggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".range-btn");
      if (!btn) return;
      dashRange = btn.dataset.range;
      toggle.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadDashboard();
    });
  }

  const rangeStart = getDashRangeStart();

  try {
    const [{ data: leads }, { data: quotes }, { data: appointments }] = await Promise.all([
      sb.from("leads").select("id, name, email, pipeline_stage, value, ai_enabled, created_at").eq("company_id", currentCompanyId),
      sb.from("quotes").select("id, lead_id, status, created_at").eq("company_id", currentCompanyId),
      sb.from("appointments").select("id, lead_id, status, created_at").eq("company_id", currentCompanyId),
    ]);

    const all          = leads || [];
    const allQuotes    = quotes || [];
    const allAppts     = appointments || [];
    const rangeLeads   = all.filter((l) => new Date(l.created_at) >= rangeStart);
    const rangeQuotes  = allQuotes.filter((q) => new Date(q.created_at) >= rangeStart);
    const rangeAppts   = allAppts.filter((a) => new Date(a.created_at) >= rangeStart);

    const open         = rangeLeads.filter((l) => !["closed_won","closed_lost"].includes(l.pipeline_stage)).length;
    const totalQuotes  = rangeQuotes.length;

    // AI conversion: % of AI-enabled leads that got appointments
    const aiLeads      = rangeLeads.filter((l) => l.ai_enabled !== false);
    const aiLeadIds    = new Set(aiLeads.map((l) => l.id));
    const aiAppts      = rangeAppts.filter((a) => aiLeadIds.has(a.lead_id));
    const aiLeadsWithAppts = new Set(aiAppts.map((a) => a.lead_id)).size;
    const aiConvRate   = aiLeads.length ? Math.round((aiLeadsWithAppts / aiLeads.length) * 100) : 0;

    // % of leads quoted
    const quotedLeadIds = new Set(rangeQuotes.map((q) => q.lead_id));
    const leadsQuotedPct = rangeLeads.length ? Math.round((quotedLeadIds.size / rangeLeads.length) * 100) : 0;

    // Sales conversion rate
    const closedWon    = rangeLeads.filter((l) => l.pipeline_stage === "closed_won");
    const closedLost   = rangeLeads.filter((l) => l.pipeline_stage === "closed_lost");
    const totalClosed  = closedWon.length + closedLost.length;
    const salesConv    = totalClosed ? Math.round((closedWon.length / totalClosed) * 100) : 0;

    // Revenue & Avg deal
    const revenue      = closedWon.reduce((a, l) => a + (Number(l.value) || 0), 0);
    const avgDeal      = closedWon.length ? Math.round(revenue / closedWon.length) : 0;

    // Update stat cards
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText("statLeadCount", rangeLeads.length);
    setText("statOpenPipeline", open);
    setText("statQuotes", totalQuotes);
    setText("statSalesConversion", salesConv + "%");
    setText("statAiConversion", aiConvRate + "%");
    setText("statLeadsQuoted", leadsQuotedPct + "%");
    setText("statRevenue", fmt(revenue));
    setText("statAvgDeal", fmt(avgDeal));

    // Chips
    const weekAgo     = new Date(Date.now() - 7 * 864e5);
    const newThisWeek = all.filter((l) => new Date(l.created_at) > weekAgo).length;
    setText("leadGrowthChip", newThisWeek ? `+${newThisWeek} this week` : "No new");
    setText("qualifyingChip", `${rangeLeads.filter((l) => l.pipeline_stage === "follow_up").length} qualifying`);
    setText("quoteChip", `${totalQuotes} quote${totalQuotes === 1 ? "" : "s"}`);
    setText("salesConversionChip", `${closedWon.length} won / ${totalClosed} closed`);
    setText("aiConversionChip", `${aiLeadsWithAppts} of ${aiLeads.length} AI leads`);
    setText("leadsQuotedChip", `${quotedLeadIds.size} of ${rangeLeads.length} leads`);
    setText("revenueChip", `${closedWon.length} deal${closedWon.length === 1 ? "" : "s"}`);
    setText("avgDealChip", closedWon.length ? `from ${closedWon.length} deal${closedWon.length === 1 ? "" : "s"}` : "No deals");

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
      <div><h3>${esc(l.name || "—")}</h3><p>${esc(l.email || "—")}</p></div>
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
      <td><span class="chip ${aiStatusChipClass(l)}">${aiScoreDisplay(l)}</span></td>
      <td><span class="chip ${aiStatusChipClass(l)}">${aiStatusLabel(l)}</span></td>
      <td style="font-size:12px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(l.ai_summary || '').replace(/"/g, '&quot;')}">${l.ai_summary || "—"}</td>
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
    // Auto-route new leads based on company routing config
    if (!id) {
      const { data: routedRep } = await sb.rpc("route_lead", {
        p_company_id: currentCompanyId,
        p_postcode: payload.postcode || null,
      });
      if (routedRep) payload.assigned_to = routedRep;
    }

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

// ─── CSV Import ──────────────────────────────────────────────────────────────
let csvParsedRows = [];
let csvHeaders = [];
let csvColumnMappings = {};
let importStep = 1;
let importDone = false;

const IMPORT_FIELD_OPTIONS = [
  { value: "",          label: "— Skip —" },
  { value: "name",      label: "Name (full)" },
  { value: "first_name",label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email",     label: "Email" },
  { value: "phone",     label: "Phone" },
  { value: "address",   label: "Address" },
  { value: "postcode",  label: "Postcode" },
  { value: "source",    label: "Source" },
  { value: "value",     label: "Estimated Value" },
  { value: "notes",     label: "Notes" },
];

function guessFieldMapping(header) {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^(name|fullname|customername|contactname|leadname)$/.test(h)) return "name";
  if (/^(firstname|first)$/.test(h)) return "first_name";
  if (/^(lastname|last|surname)$/.test(h)) return "last_name";
  if (/^(email|emailaddress|e-mail)$/.test(h)) return "email";
  if (/^(phone|phonenumber|mobile|cell|tel|telephone|contact)$/.test(h)) return "phone";
  if (/^(address|streetaddress|street|location)$/.test(h)) return "address";
  if (/^(postcode|postalcode|zip|zipcode)$/.test(h)) return "postcode";
  if (/^(source|leadsource|channel|origin)$/.test(h)) return "source";
  if (/^(value|estimatedvalue|dealvalue|amount|revenue)$/.test(h)) return "value";
  if (/^(notes|note|comment|comments|description)$/.test(h)) return "notes";
  return "";
}

function parseCSV(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (inQuotes) {
      current += "\n" + line;
    } else {
      current = line;
    }
    const quoteCount = (current.match(/"/g) || []).length;
    inQuotes = quoteCount % 2 !== 0;
    if (!inQuotes) {
      const row = [];
      let field = "";
      let insideQuote = false;
      for (let i = 0; i < current.length; i++) {
        const c = current[i];
        if (c === '"') {
          if (insideQuote && current[i + 1] === '"') { field += '"'; i++; }
          else insideQuote = !insideQuote;
        } else if (c === "," && !insideQuote) {
          row.push(field.trim());
          field = "";
        } else {
          field += c;
        }
      }
      row.push(field.trim());
      if (row.some((v) => v)) rows.push(row);
      current = "";
    }
  }
  return rows;
}

function openImportLeadsModal() {
  resetImportModal();
  loadCustomFields();
  openModal("importLeadsModal");
}

function resetImportModal() {
  csvParsedRows = [];
  csvHeaders = [];
  csvColumnMappings = {};
  importStep = 1;
  importDone = false;
  const fileInput = document.getElementById("csvFileInput");
  if (fileInput) fileInput.value = "";
  showImportStep(1);
  const nextBtn = document.getElementById("importNextBtn");
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = "Continue"; }
  document.getElementById("importBackBtn")?.classList.add("hidden");
  const consent = document.getElementById("importConsentCheck");
  if (consent) consent.checked = false;
  const helper = document.getElementById("importHelper");
  if (helper) helper.textContent = "Select a CSV file to get started.";
}

function showImportStep(step) {
  importStep = step;
  document.getElementById("importStep1")?.classList.toggle("hidden", step !== 1);
  document.getElementById("importStep2")?.classList.toggle("hidden", step !== 2);
  document.getElementById("importStep3")?.classList.toggle("hidden", step !== 3);
}

function handleCsvFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const nextBtn = document.getElementById("importNextBtn");
  const helper = document.getElementById("importHelper");
  if (!file.name.toLowerCase().endsWith(".csv")) {
    toast("Please select a CSV file.", true);
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target?.result;
    if (!text) return;
    const allRows = parseCSV(text);
    if (allRows.length < 2) {
      toast("CSV must have a header row and at least one data row.", true);
      e.target.value = "";
      return;
    }
    csvHeaders = allRows[0];
    csvParsedRows = allRows.slice(1);
    if (nextBtn) nextBtn.disabled = false;
    if (helper) helper.textContent = `${csvParsedRows.length} row${csvParsedRows.length !== 1 ? "s" : ""} detected. Click Continue to map columns.`;
  };
  reader.readAsText(file);
}

function buildMappingTable() {
  const tbody = document.getElementById("importMappingBody");
  if (!tbody) return;

  const cfOptions = (customFields || []).map((f) => ({
    value: "cf_" + f.key,
    label: f.label + " (custom)",
  }));
  const allOptions = [...IMPORT_FIELD_OPTIONS, ...cfOptions];

  const usedValues = new Set();
  const guesses = csvHeaders.map((h) => {
    const g = guessFieldMapping(h);
    if (g && !usedValues.has(g)) { usedValues.add(g); return g; }
    const cfMatch = cfOptions.find((cf) => {
      const k = cf.value.replace("cf_", "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const hNorm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      return k === hNorm && !usedValues.has(cf.value);
    });
    if (cfMatch) { usedValues.add(cfMatch.value); return cfMatch.value; }
    return "";
  });

  tbody.innerHTML = csvHeaders.map((header, i) => {
    const sample = csvParsedRows.slice(0, 3).map((r) => r[i] || "").filter(Boolean).join(", ");
    const guess = guesses[i] || "";
    csvColumnMappings[i] = guess;
    const opts = allOptions.map((o) =>
      `<option value="${o.value}"${o.value === guess ? " selected" : ""}>${o.label}</option>`
    ).join("");
    return `<tr>
      <td><strong>${escapeHtml(header)}</strong></td>
      <td><select class="import-col-map" data-col="${i}">${opts}</select></td>
      <td class="muted">${escapeHtml(sample.substring(0, 80))}${sample.length > 80 ? "…" : ""}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".import-col-map").forEach((sel) =>
    sel.addEventListener("change", (e) => {
      csvColumnMappings[e.target.dataset.col] = e.target.value;
      updateImportPreview();
      updateImportButtonState();
    })
  );
  updateImportPreview();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function updateImportPreview() {
  const previewDiv = document.getElementById("importPreview");
  const head = document.getElementById("importPreviewHead");
  const body = document.getElementById("importPreviewBody");
  if (!previewDiv || !head || !body) return;

  const mapped = Object.entries(csvColumnMappings).filter(([, v]) => v);
  if (!mapped.length) { previewDiv.classList.add("hidden"); return; }
  previewDiv.classList.remove("hidden");

  const cfOptions = (customFields || []);
  const fieldLabel = (val) => {
    if (val === "first_name") return "First Name";
    if (val === "last_name") return "Last Name";
    const opt = IMPORT_FIELD_OPTIONS.find((o) => o.value === val);
    if (opt) return opt.label;
    const cf = cfOptions.find((f) => "cf_" + f.key === val);
    return cf ? cf.label : val;
  };

  head.innerHTML = `<tr>${mapped.map(([, v]) => `<th>${escapeHtml(fieldLabel(v))}</th>`).join("")}</tr>`;
  body.innerHTML = csvParsedRows.slice(0, 3).map((row) =>
    `<tr>${mapped.map(([colIdx]) => `<td>${escapeHtml(row[colIdx] || "")}</td>`).join("")}</tr>`
  ).join("");
}

function updateImportButtonState() {
  const nextBtn = document.getElementById("importNextBtn");
  if (!nextBtn) return;
  if (importStep === 2) {
    const hasMapping = Object.values(csvColumnMappings).some((v) => v);
    const consentOk = document.getElementById("importConsentCheck")?.checked;
    nextBtn.disabled = !(hasMapping && consentOk);
    nextBtn.textContent = "Import " + csvParsedRows.length + " Lead" + (csvParsedRows.length !== 1 ? "s" : "");
  }
}

function handleImportNext() {
  if (importDone) {
    resetImportModal();
    closeModal("importLeadsModal");
    return;
  }
  if (importStep === 1) {
    if (!csvHeaders.length) return;
    showImportStep(2);
    buildMappingTable();
    updateImportButtonState();
    document.getElementById("importBackBtn")?.classList.remove("hidden");
    const helper = document.getElementById("importHelper");
    if (helper) helper.textContent = "Map your columns, then confirm consent below.";
  } else if (importStep === 2) {
    runImport();
  }
}

function handleImportBack() {
  if (importStep === 2) {
    showImportStep(1);
    document.getElementById("importBackBtn")?.classList.add("hidden");
    const nextBtn = document.getElementById("importNextBtn");
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Continue"; }
    const helper = document.getElementById("importHelper");
    if (helper) helper.textContent = `${csvParsedRows.length} row${csvParsedRows.length !== 1 ? "s" : ""} detected. Click Continue to map columns.`;
  }
}

async function runImport() {
  const nextBtn = document.getElementById("importNextBtn");
  const backBtn = document.getElementById("importBackBtn");
  const cancelBtn = document.getElementById("cancelImportModal");
  if (nextBtn) nextBtn.disabled = true;
  backBtn?.classList.add("hidden");
  if (cancelBtn) cancelBtn.disabled = true;

  showImportStep(3);
  const progress = document.getElementById("importProgress");
  const details = document.getElementById("importResultDetails");
  if (progress) progress.textContent = "Importing leads…";
  if (details) details.textContent = "";

  const mapped = Object.entries(csvColumnMappings).filter(([, v]) => v);
  if (!mapped.length) {
    if (progress) progress.textContent = "No columns mapped.";
    if (cancelBtn) cancelBtn.disabled = false;
    return;
  }

  const hasFirstName = mapped.some(([, v]) => v === "first_name");
  const hasLastName = mapped.some(([, v]) => v === "last_name");
  const hasName = mapped.some(([, v]) => v === "name");

  const leads = [];
  const errors = [];
  csvParsedRows.forEach((row, rowIdx) => {
    const lead = { company_id: currentCompanyId, pipeline_stage: "new_lead" };
    const custom_data = {};
    let firstName = "";
    let lastName = "";

    mapped.forEach(([colIdx, field]) => {
      const val = (row[colIdx] || "").trim();
      if (!val) return;
      if (field === "first_name") { firstName = val; return; }
      if (field === "last_name")  { lastName = val; return; }
      if (field.startsWith("cf_")) {
        custom_data[field.replace("cf_", "")] = val;
        return;
      }
      if (field === "phone") { lead.phone = formatPhoneE164(val); return; }
      if (field === "value") { lead.value = Number(val) || null; return; }
      lead[field] = val;
    });

    if (!hasName && (hasFirstName || hasLastName)) {
      lead.name = [firstName, lastName].filter(Boolean).join(" ") || null;
    }

    if (!lead.source) lead.source = "CSV Import";

    if (Object.keys(custom_data).length) lead.custom_data = custom_data;

    if (!lead.name && !lead.phone && !lead.email) {
      errors.push(`CSV row ${rowIdx + 2}: skipped — no name, phone or email.`);
      return;
    }
    leads.push(lead);
  });

  if (!leads.length) {
    if (progress) progress.textContent = "No valid leads to import.";
    if (details) details.textContent = errors.join("\n");
    if (cancelBtn) cancelBtn.disabled = false;
    return;
  }

  const BATCH = 500;
  let imported = 0;
  let failed = 0;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    if (progress) progress.textContent = `Importing… ${Math.min(i + BATCH, leads.length)} / ${leads.length}`;
    try {
      const { error } = await sb.from("leads").insert(batch);
      if (error) { failed += batch.length; errors.push(error.message); }
      else imported += batch.length;
    } catch (err) {
      failed += batch.length;
      errors.push(err.message);
    }
  }

  if (progress) {
    progress.textContent = imported > 0
      ? `Successfully imported ${imported} lead${imported !== 1 ? "s" : ""}!`
      : "Import failed.";
  }
  if (details) {
    const parts = [];
    if (failed) parts.push(`${failed} failed.`);
    if (errors.length) parts.push(errors.slice(0, 5).join(" · "));
    details.textContent = parts.join(" ");
  }

  if (cancelBtn) cancelBtn.disabled = false;
  if (nextBtn) { nextBtn.textContent = "Done"; nextBtn.disabled = false; }
  importDone = true;

  if (imported > 0) {
    loadLeads();
    loadDashboard();
    loadPipeline();
  }
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
  document.getElementById("quoteLineItems").innerHTML = "";
  recalcQuoteTotals();
  // Load quote defaults from company settings
  await prefillQuoteDefaults();
  openModal("quoteModal");
}

async function prefillQuoteDefaults() {
  if (!currentCompanyId) return;
  try {
    const [{ data: company }, { data: agentConfig }] = await Promise.all([
      sb.from("companies").select("settings").eq("id", currentCompanyId).maybeSingle(),
      sb.from("sms_agent_config").select("quote_pricing_config").eq("company_id", currentCompanyId).maybeSingle(),
    ]);
    const s = company?.settings?.quote_defaults || {};
    document.getElementById("quoteAbn").value = s.abn || "";
    document.getElementById("quoteDepositMethod").value = s.deposit_method || "";
    document.getElementById("quoteDepositTerms").value = s.deposit_terms || "";
    document.getElementById("quoteServiceTerms").value = s.service_terms || "";
    document.getElementById("quoteShowAbn").checked = s.show_abn !== false;
    document.getElementById("quoteShowDeposit").checked = s.show_deposit !== false;
    document.getElementById("quoteShowServiceTerms").checked = s.show_service_terms !== false;
    document.getElementById("quoteShowValidUntil").checked = s.show_valid_until !== false;
    // Set tax rate from pricing config
    const pricingConfig = agentConfig?.quote_pricing_config || {};
    document.getElementById("quoteLineTaxRate").value = pricingConfig.tax_rate ?? DEFAULT_TAX_RATE;
    document.getElementById("quoteLineTaxMode").value = pricingConfig.tax_mode || "exclusive";
    // Set default valid_until date
    const validityDays = s.validity_days || 30;
    const validDate = new Date();
    validDate.setDate(validDate.getDate() + validityDays);
    document.getElementById("quoteValidUntil").value = validDate.toISOString().split("T")[0];
  } catch (err) {
    console.error("Failed to load quote defaults:", err);
  }
}

function addQuoteLineItemRow(item = {}) {
  const container = document.getElementById("quoteLineItems");
  const row = document.createElement("div");
  row.className = "quote-line-item-row";
  row.style.cssText = "display:grid;grid-template-columns:1.5fr .5fr .6fr .6fr auto;gap:8px;align-items:center";
  row.innerHTML = `
    <input type="text" class="qli-desc" placeholder="Description" value="${item.description || ""}">
    <input type="number" class="qli-qty" min="0" step="1" placeholder="Qty" value="${item.quantity || 1}">
    <input type="number" class="qli-rate" min="0" step="0.01" placeholder="Rate" value="${item.rate || ""}">
    <input type="text" class="qli-total" readonly style="background:var(--surface);font-weight:500" value="${item.total || ""}">
    <button type="button" class="iconbtn btn-danger qli-remove" title="Remove">
      <span class="icon" data-icon="trash"></span>
    </button>`;
  container.appendChild(row);
  // Attach event listeners
  row.querySelector(".qli-qty").addEventListener("input", recalcQuoteTotals);
  row.querySelector(".qli-rate").addEventListener("input", recalcQuoteTotals);
  row.querySelector(".qli-remove").addEventListener("click", function() {
    row.remove();
    recalcQuoteTotals();
  });
  recalcQuoteTotals();
  renderIcons();
}

function recalcQuoteTotals() {
  let subtotal = 0;
  document.querySelectorAll(".quote-line-item-row").forEach((row) => {
    const qty = parseFloat(row.querySelector(".qli-qty")?.value) || 0;
    const rate = parseFloat(row.querySelector(".qli-rate")?.value) || 0;
    const lineTotal = qty * rate;
    row.querySelector(".qli-total").value = lineTotal ? lineTotal.toFixed(2) : "";
    subtotal += lineTotal;
  });
  const taxRate = parseFloat(document.getElementById("quoteLineTaxRate")?.value) || DEFAULT_TAX_RATE;
  const taxMode = document.getElementById("quoteLineTaxMode")?.value || "exclusive";
  let tax, total;
  if (taxMode === "inclusive") {
    // Prices already include GST — back-calculate the tax component
    total = subtotal;
    tax = subtotal - (subtotal / (1 + taxRate / 100));
    subtotal = total - tax;
  } else {
    // Add GST on top of prices
    tax = subtotal * (taxRate / 100);
    total = subtotal + tax;
  }
  const taxLabel = taxMode === "inclusive" ? "GST (incl.)" : "GST";
  const subtotalLabel = taxMode === "inclusive" ? "Subtotal (excl. GST)" : "Subtotal";
  const fmtMoney = (v) => v ? fmt(v) : "";
  document.getElementById("quoteSubtotal").value = fmtMoney(subtotal);
  document.getElementById("quoteTax").value = fmtMoney(tax);
  document.getElementById("quoteTotal").value = fmtMoney(total);
  const taxLabelEl = document.getElementById("quoteTaxLabel");
  const subtotalLabelEl = document.getElementById("quoteSubtotalLabel");
  if (taxLabelEl) taxLabelEl.textContent = taxLabel;
  if (subtotalLabelEl) subtotalLabelEl.textContent = subtotalLabel;
}

function collectQuoteLineItems() {
  const items = [];
  document.querySelectorAll(".quote-line-item-row").forEach((row) => {
    const description = row.querySelector(".qli-desc")?.value?.trim();
    const quantity = parseFloat(row.querySelector(".qli-qty")?.value) || 1;
    const rate = parseFloat(row.querySelector(".qli-rate")?.value) || 0;
    const total = quantity * rate;
    if (description) items.push({ description, quantity, rate, total });
  });
  return items;
}

async function handleQuoteSave(e) {
  e.preventDefault();
  const leadId = document.getElementById("quoteLeadSelect")?.value;
  if (!leadId) { toast("Please select a lead.", true); return; }

  const lineItems = collectQuoteLineItems();
  const rawSubtotal = lineItems.reduce((sum, li) => sum + (li.total || 0), 0);
  const taxRate = parseFloat(document.getElementById("quoteLineTaxRate")?.value) || DEFAULT_TAX_RATE;
  const taxMode = document.getElementById("quoteLineTaxMode")?.value || "exclusive";
  let subtotal, tax, total;
  if (taxMode === "inclusive") {
    total = rawSubtotal;
    tax = rawSubtotal - (rawSubtotal / (1 + taxRate / 100));
    subtotal = total - tax;
  } else {
    subtotal = rawSubtotal;
    tax = subtotal * (taxRate / 100);
    total = subtotal + tax;
  }

  const payload = {
    company_id:   currentCompanyId,
    lead_id:      leadId,
    quote_number: document.getElementById("quoteNumber")?.value || null,
    subtotal:     subtotal || null,
    tax:          tax || null,
    total:        total || null,
    status:       document.getElementById("quoteStatus")?.value || "draft",
    notes:        document.getElementById("quoteNotes")?.value || null,
    valid_until:  document.getElementById("quoteValidUntil")?.value || null,
    line_items:   lineItems.length ? lineItems : [],
    metadata: {
      abn:                document.getElementById("quoteAbn")?.value?.trim() || null,
      deposit_method:     document.getElementById("quoteDepositMethod")?.value?.trim() || null,
      deposit_terms:      document.getElementById("quoteDepositTerms")?.value?.trim() || null,
      service_terms:      document.getElementById("quoteServiceTerms")?.value?.trim() || null,
      show_abn:           document.getElementById("quoteShowAbn")?.checked ?? true,
      show_deposit:       document.getElementById("quoteShowDeposit")?.checked ?? true,
      show_service_terms: document.getElementById("quoteShowServiceTerms")?.checked ?? true,
      show_valid_until:   document.getElementById("quoteShowValidUntil")?.checked ?? true,
      tax_rate:           taxRate,
      tax_mode:           taxMode,
    },
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
  document.getElementById("apptEditId").value = "";
  document.getElementById("apptModalTitle").textContent = "New Appointment";
  document.getElementById("deleteAppointmentBtn").style.display = "none";
  openModal("appointmentModal");
}

async function openEditAppointment(apptId) {
  try {
    const { data: a } = await sb.from("appointments").select("*").eq("id", apptId).single();
    if (!a) { toast("Appointment not found.", true); return; }
    await populateLeadSelector("apptLeadSelect");
    document.getElementById("apptEditId").value = a.id;
    document.getElementById("apptModalTitle").textContent = "Edit Appointment";
    document.getElementById("apptLeadSelect").value = a.lead_id || "";
    document.getElementById("apptTitle").value = a.title || "";
    document.getElementById("apptType").value = a.appointment_type || "callback";
    document.getElementById("apptStatus").value = a.status || "scheduled";
    document.getElementById("apptStart").value = a.start_time ? a.start_time.slice(0, 16) : "";
    document.getElementById("apptEnd").value = a.end_time ? a.end_time.slice(0, 16) : "";
    document.getElementById("apptLocation").value = a.location || "";
    document.getElementById("apptNotes").value = a.notes || "";
    document.getElementById("deleteAppointmentBtn").style.display = "inline-flex";
    openModal("appointmentModal");
  } catch (err) {
    toast("Failed to load appointment.", true);
  }
}

async function handleAppointmentSave(e) {
  e.preventDefault();
  const leadId = document.getElementById("apptLeadSelect")?.value;
  if (!leadId) { toast("Please select a lead.", true); return; }

  const editId = document.getElementById("apptEditId")?.value;
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
    let error;
    if (editId) {
      ({ error } = await sb.from("appointments").update(payload).eq("id", editId));
    } else {
      ({ error } = await sb.from("appointments").insert(payload));
    }
    if (error) { toast(error.message, true); return; }
    toast(editId ? "Appointment updated." : "Appointment created.");
    closeModal("appointmentModal");
    loadAppointments();
  } catch (err) {
    toast("Failed to save appointment.", true);
  }
}

async function deleteAppointment() {
  const editId = document.getElementById("apptEditId")?.value;
  if (!editId) return;
  if (!confirm("Delete this appointment?")) return;
  try {
    await sb.from("appointments").delete().eq("id", editId);
    toast("Appointment deleted.");
    closeModal("appointmentModal");
    loadAppointments();
  } catch (err) {
    toast("Failed to delete appointment.", true);
  }
}

// ─── Sale Modal Handlers ─────────────────────────────────────────────────────
async function openSaleModalHandler() {
  await populateLeadSelector("saleLeadSelect");
  document.getElementById("saleForm")?.reset();
  document.getElementById("saleEditId").value = "";
  document.getElementById("saleModalTitle").textContent = "Record Sale";
  openModal("saleModal");
}

async function openEditSale(leadId) {
  try {
    const { data: lead } = await sb.from("leads").select("id, name, pipeline_stage, value, notes").eq("id", leadId).single();
    if (!lead) { toast("Lead not found.", true); return; }
    await populateLeadSelector("saleLeadSelect");
    document.getElementById("saleEditId").value = lead.id;
    document.getElementById("saleModalTitle").textContent = "Edit Sale";
    document.getElementById("saleLeadSelect").value = lead.id;
    document.getElementById("saleOutcome").value = lead.pipeline_stage || "closed_won";
    document.getElementById("saleValue").value = lead.value || "";
    document.getElementById("saleNotes").value = lead.notes || "";
    openModal("saleModal");
  } catch (err) {
    toast("Failed to load sale.", true);
  }
}

async function handleSaleSave(e) {
  e.preventDefault();
  const editId = document.getElementById("saleEditId")?.value;
  const leadId = editId || document.getElementById("saleLeadSelect")?.value;
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
    toast(editId ? "Sale updated." : "Sale recorded.");
    closeModal("saleModal");
    loadSales();
  } catch (err) {
    toast("Failed to save sale.", true);
  }
}

// ─── Pipeline / Kanban ────────────────────────────────────────────────────────
const KANBAN_STAGES = ["new_lead","follow_up","quote_in_progress","quoted","closed_won","closed_lost"];

async function loadPipeline() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("leads")
      .select("id, name, email, phone, pipeline_stage, value, ai_score, ai_status, ai_summary, created_at")
      .eq("company_id", currentCompanyId);
    allLeads = data || [];
    buildKanban(allLeads);
  } catch (err) {
    toast("Failed to load pipeline.", true);
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
                ${l.ai_score != null ? `<div style="margin-top:6px"><span class="chip ${aiStatusChipClass(l)}" style="font-size:10px">${aiScoreDisplay(l)}</span></div>` : ""}
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
      loadPipeline();
    } else {
      toast(`Moved to "${stageLabel(newStage)}"`);

    }
  } catch (err) {
    toast("Failed to update status.", true);
    loadPipeline();
  }
  dragLeadId = null;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
function buildQuoteLink(token) {
  if (!token) return "";
  const url = new URL("quote-public.html", window.location.href);
  url.searchParams.set("token", token);
  return url.href;
}

async function loadQuotes() {
  if (!currentCompanyId) return;
  try {
    const { data } = await sb
      .from("quotes")
      .select("id, quote_number, status, total, subtotal, tax, notes, created_at, sent_at, viewed_at, accepted_at, quote_token, valid_until, line_items, metadata, lead_id, leads(name, email, phone)")
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
      const isDraft = q.status === "draft";
      const itemCount = Array.isArray(q.line_items) ? q.line_items.length : 0;
      return `
      <div class="row" style="grid-template-columns:1.4fr .7fr .6fr auto">
        <div><strong style="font-size:13px">Quote #${esc(q.quote_number || q.id.slice(0,8))}</strong><span class="muted">${esc(lead.name || lead.email || lead.phone || "—")}${itemCount ? ` · ${itemCount} item${itemCount > 1 ? "s" : ""}` : ""}</span></div>
        <div><span class="chip">${cap(q.status || "draft")}</span></div>
        <div><strong style="font-size:13px">${fmt(q.total)}</strong><span class="muted">${fmtDate(q.created_at)}${q.valid_until ? ` · Valid: ${fmtDate(q.valid_until)}` : ""}</span></div>
        <div style="display:flex;gap:6px;align-items:center">
          ${isDraft ? `<button class="btn2" style="padding:4px 10px;font-size:11px" onclick="approveAndSendQuote('${q.id}')" title="Approve quote and send link to lead">Approve &amp; Send</button>` : ""}
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
      .select("id, quote_number, status, subtotal, tax, total, valid_until, notes, line_items, metadata, created_at, sent_at, lead_id, leads(name, email, phone, address)")
      .eq("id", quoteId)
      .single();
    if (!q) { toast("Quote not found.", true); return; }

    const { data: company } = await sb
      .from("companies")
      .select("name, email, phone, logo_url")
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

    // Company logo
    if (co.logo_url) {
      try {
        doc.addImage(co.logo_url, "PNG", pw - 54, 10, 40, 40);
      } catch (e) { /* skip logo if format unsupported */ }
    }

    // Company info header with ABN
    doc.setFontSize(22);
    doc.setFont(undefined, "bold");
    doc.text(co.name || "Company", 14, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    if (co.email) { doc.text(co.email + (co.phone ? "  ·  " + co.phone : ""), 14, y); y += 6; }
    const meta = q.metadata || {};
    if (meta.show_abn !== false && meta.abn) { doc.text("ABN: " + meta.abn, 14, y); y += 6; }

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
    if (meta.show_valid_until !== false && q.valid_until) {
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
      y += lines.length * 5 + 4;
    }

    // Deposit terms
    if (meta.show_deposit !== false && (meta.deposit_terms || meta.deposit_method)) {
      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.text("Deposit:", 14, y); y += 5;
      doc.setFont(undefined, "normal");
      const depositText = (meta.deposit_method ? meta.deposit_method + ". " : "") + (meta.deposit_terms || "");
      const depLines = doc.splitTextToSize(depositText, pw - 28);
      doc.text(depLines, 14, y);
      y += depLines.length * 5 + 4;
    }

    // Service terms
    if (meta.show_service_terms !== false && meta.service_terms) {
      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.text("Service Terms:", 14, y); y += 5;
      doc.setFont(undefined, "normal");
      const stLines = doc.splitTextToSize(meta.service_terms, pw - 28);
      doc.text(stLines, 14, y);
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
        <div class="row" style="cursor:pointer" onclick="openEditSale('${l.id}')">
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
      .select("id, title, status, start_time, end_time, location, notes, appointment_type, booked_by, lead_id, leads(name, phone)")
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
      <div class="row" style="cursor:pointer" onclick="openEditAppointment('${a.id}')">
        <div>
          <strong style="font-size:13px">${esc(a.title || "Appointment")}</strong>
          <span class="muted">${esc(a.leads?.name || "Unknown lead")}</span>
        </div>
        <div>
          <span class="chip">${cap(a.status || "scheduled")}</span>
          ${a.appointment_type ? `<span class="chip">${cap(esc(a.appointment_type))}</span>` : ""}
          ${a.booked_by === "ai" ? `<span class="chip" style="background:#8b5cf6;color:#fff">Booked by AI</span>` : ""}
        </div>
        <div>
          <strong style="font-size:13px">${fmtDate(a.start_time)}</strong>
          <span class="muted">${fmtTime(a.start_time)}${a.end_time ? ` – ${fmtTime(a.end_time)}` : ""}</span>
        </div>
        <div><span class="muted">${esc(a.location || "—")}</span></div>
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
      updateLogoPreview(company.logo_url);
      // Load quote defaults
      loadQuoteDefaultsUI(company.settings?.quote_defaults || {});
    }
    if (profile) {
      if (settingsOwnerName) settingsOwnerName.value = profile.full_name || "";
      if (settingsOwnerEmail) settingsOwnerEmail.value = currentUser.email || "";
      if (settingsOwnerPhone) settingsOwnerPhone.value = profile.phone || "";
    }
    await loadCustomFields();
    renderSettingsCustomFields();
    loadLeadRoutingUI(company?.settings || {});
  } catch (err) {
    toast("Failed to load settings.", true);
  }
}

// ── Lead Routing ────────────────────────────────────────────────────────────
function loadLeadRoutingUI(settings) {
  const routing = settings?.lead_routing || {};
  const mode = routing.mode || "all";

  // Set radio
  const radios = document.querySelectorAll('[name="routingMode"]');
  radios.forEach((r) => { r.checked = r.value === mode; });

  // Show/hide postcode rules
  togglePostcodeRules(mode);

  // Load postcode rules
  if (routing.postcode_rules?.length) {
    const list = document.getElementById("postcodeRulesList");
    if (list) {
      list.innerHTML = "";
      routing.postcode_rules.forEach((rule) => addPostcodeRule(rule));
    }
  }

  // Radio change handler
  radios.forEach((r) => r.addEventListener("change", () => togglePostcodeRules(r.value)));

  // Hide panel for non-admins
  const panel = document.getElementById("leadRoutingPanel");
  if (panel) panel.style.display = isAdmin() ? "" : "none";
}

function togglePostcodeRules(mode) {
  const container = document.getElementById("postcodeRulesContainer");
  if (container) container.style.display = mode === "postcode" ? "block" : "none";
}

async function addPostcodeRule(existing) {
  const list = document.getElementById("postcodeRulesList");
  if (!list) return;

  // Fetch reps for dropdown
  let repsOptions = "";
  if (!list._repsCache) {
    const { data: reps } = await sb
      .from("sales_reps")
      .select("id, user_id, name")
      .eq("company_id", currentCompanyId)
      .eq("is_active", true);
    list._repsCache = reps || [];
  }
  repsOptions = list._repsCache.map((r) =>
    `<option value="${r.user_id}" ${existing?.rep_id === r.user_id ? "selected" : ""}>${r.name}</option>`
  ).join("");

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center";
  row.innerHTML = `
    <input type="text" class="pc-postcodes" placeholder="e.g. 2000, 2010-2050" value="${existing?.postcodes?.join(", ") || ""}" style="flex:1;font-size:12px">
    <select class="pc-rep" style="font-size:12px;min-width:140px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2)">
      <option value="">Select rep…</option>
      ${repsOptions}
    </select>
    <button type="button" class="iconbtn btn-danger" onclick="this.parentElement.remove()" style="flex-shrink:0"><span class="icon" data-icon="trash"></span></button>
  `;
  list.appendChild(row);
  renderIcons();
}
window.addPostcodeRule = addPostcodeRule;

async function handleLeadRoutingSave(e) {
  e.preventDefault();
  const mode = document.querySelector('[name="routingMode"]:checked')?.value || "all";

  const routing = { mode, round_robin_index: 0 };

  if (mode === "postcode") {
    const rules = [];
    document.querySelectorAll("#postcodeRulesList > div").forEach((row) => {
      const postcodes = row.querySelector(".pc-postcodes")?.value
        .split(",").map((s) => s.trim()).filter(Boolean);
      const rep_id = row.querySelector(".pc-rep")?.value;
      if (postcodes.length && rep_id) rules.push({ postcodes, rep_id });
    });
    routing.postcode_rules = rules;
  }

  try {
    // Read current settings, merge in lead_routing
    const { data: company } = await sb
      .from("companies")
      .select("settings")
      .eq("id", currentCompanyId)
      .maybeSingle();

    const settings = company?.settings || {};
    settings.lead_routing = routing;

    const { error } = await sb
      .from("companies")
      .update({ settings })
      .eq("id", currentCompanyId);

    if (error) { toast(error.message, true); return; }
    toast("Lead routing saved.");
  } catch (err) {
    toast("Failed to save routing.", true);
  }
}

let pendingLogoDataUrl = null;
let removeLogo = false;

function updateLogoPreview(url) {
  const preview = document.getElementById("settingsLogoPreview");
  const removeBtn = document.getElementById("removeLogoBtn");
  if (!preview) return;
  if (url) {
    preview.innerHTML = `<img src="${url}" style="width:48px;height:48px;object-fit:contain" alt="Logo">`;
    if (removeBtn) removeBtn.style.display = "inline-flex";
  } else {
    preview.innerHTML = `<span class="muted" style="font-size:10px">No logo</span>`;
    if (removeBtn) removeBtn.style.display = "none";
  }
}

function handleLogoFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 500 * 1024) { toast("Logo must be under 500KB.", true); e.target.value = ""; return; }
  const reader = new FileReader();
  reader.onload = function (ev) {
    pendingLogoDataUrl = ev.target.result;
    removeLogo = false;
    updateLogoPreview(pendingLogoDataUrl);
  };
  reader.readAsDataURL(file);
}

function handleRemoveLogo() {
  pendingLogoDataUrl = null;
  removeLogo = true;
  updateLogoPreview(null);
  const logoInput = document.getElementById("settingsCompanyLogo");
  if (logoInput) logoInput.value = "";
}

async function handleCompanyProfileSave(e) {
  e.preventDefault();
  const companyName = document.getElementById("settingsCompanyName")?.value;
  const ownerName   = document.getElementById("settingsOwnerName")?.value;
  
  try {
    const companyUpdate = {
      name:  companyName,
      email: document.getElementById("settingsCompanyEmail")?.value,
      phone: document.getElementById("settingsCompanyPhone")?.value,
    };
    if (pendingLogoDataUrl) companyUpdate.logo_url = pendingLogoDataUrl;
    if (removeLogo) companyUpdate.logo_url = null;

    const [{ error: ce }, { error: pe }] = await Promise.all([
      sb.from("companies").update(companyUpdate).eq("id", currentCompanyId),
      sb.from("profiles").update({
        full_name: ownerName,
        phone:     document.getElementById("settingsOwnerPhone")?.value,
      }).eq("id", currentUser.id),
    ]);
    if (ce || pe) { toast((ce || pe).message, true); return; }
    pendingLogoDataUrl = null;
    removeLogo = false;
    toast("Profile saved.");
    
    const brandCompanyName = document.getElementById("brandCompanyName");
    const sidebarAccountName = document.getElementById("sidebarAccountName");
    if (brandCompanyName) brandCompanyName.textContent = companyName;
    if (sidebarAccountName) sidebarAccountName.textContent = ownerName;
  } catch (err) {
    toast("Failed to save profile.", true);
  }
}

// ─── Quote Defaults ───────────────────────────────────────────────────────────
function loadQuoteDefaultsUI(defaults) {
  setInputValue("defaultAbn", defaults.abn);
  setInputValue("defaultQuoteValidityDays", defaults.validity_days ?? 30);
  setInputValue("defaultDepositMethod", defaults.deposit_method);
  setInputValue("defaultDepositTerms", defaults.deposit_terms);
  setInputValue("defaultServiceTerms", defaults.service_terms);
  setCheckboxValue("defaultShowAbn", defaults.show_abn !== false);
  setCheckboxValue("defaultShowDeposit", defaults.show_deposit !== false);
  setCheckboxValue("defaultShowServiceTerms", defaults.show_service_terms !== false);
  setCheckboxValue("defaultShowValidUntil", defaults.show_valid_until !== false);
}

async function handleQuoteDefaultsSave(e) {
  e.preventDefault();
  if (!currentCompanyId) return;
  try {
    // Fetch current settings to merge
    const { data: company } = await sb.from("companies").select("settings").eq("id", currentCompanyId).maybeSingle();
    const currentSettings = company?.settings || {};
    const quoteDefaults = {
      abn:                document.getElementById("defaultAbn")?.value?.trim() || "",
      validity_days:      parseInt(document.getElementById("defaultQuoteValidityDays")?.value) || 30,
      deposit_method:     document.getElementById("defaultDepositMethod")?.value?.trim() || "",
      deposit_terms:      document.getElementById("defaultDepositTerms")?.value?.trim() || "",
      service_terms:      document.getElementById("defaultServiceTerms")?.value?.trim() || "",
      show_abn:           document.getElementById("defaultShowAbn")?.checked ?? true,
      show_deposit:       document.getElementById("defaultShowDeposit")?.checked ?? true,
      show_service_terms: document.getElementById("defaultShowServiceTerms")?.checked ?? true,
      show_valid_until:   document.getElementById("defaultShowValidUntil")?.checked ?? true,
    };
    const updatedSettings = { ...currentSettings, quote_defaults: quoteDefaults };
    const { error } = await sb.from("companies").update({ settings: updatedSettings }).eq("id", currentCompanyId);
    if (error) { toast(error.message, true); return; }
    toast("Quote defaults saved.");
  } catch (err) {
    toast("Failed to save quote defaults.", true);
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
        ? "Using agency defaults." 
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
      
      // Quote pricing config
      loadPricingConfigUI(data.quote_pricing_config);
      
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
        promptHelp.textContent = "Customize how the AI responds to leads. Use {{first_name}} for personalization.";
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
    
    // Quote pricing config
    quote_pricing_config:   collectPricingConfig(),
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

// ─── Quote Pricing Item Management ────────────────────────────────────────────
function addPricingItemRow(item) {
  const container = document.getElementById("quotePricingItems");
  if (!container) return;
  const defaults = typeof item === "object" && item !== null && !(item instanceof Event)
    ? item
    : { description: "", type: "fixed", rate: "", unit: "" };

  const row = document.createElement("div");
  row.className = "pricing-item-row";
  row.style.cssText = "display:grid;grid-template-columns:1.5fr .8fr .6fr .8fr auto;gap:8px;align-items:center";
  row.innerHTML = `
    <input type="text" class="pi-desc" placeholder="e.g. Material Cost" value="${esc(defaults.description || "")}">
    <select class="pi-type">
      <option value="fixed"${defaults.type === "fixed" ? " selected" : ""}>Fixed</option>
      <option value="per_hour"${defaults.type === "per_hour" ? " selected" : ""}>Per Hour</option>
      <option value="per_m2"${defaults.type === "per_m2" ? " selected" : ""}>Per m²</option>
      <option value="per_kw"${defaults.type === "per_kw" ? " selected" : ""}>Per kW</option>
      <option value="per_unit"${defaults.type === "per_unit" ? " selected" : ""}>Per Unit</option>
    </select>
    <input type="number" class="pi-rate" min="0" step="0.01" placeholder="Rate" value="${defaults.rate ?? ""}">
    <input type="text" class="pi-unit" placeholder="e.g. per job" value="${esc(defaults.unit || "")}">
    <button type="button" class="iconbtn btn-danger" onclick="this.closest('.pricing-item-row').remove()" title="Remove item">
      <span class="icon" data-icon="trash"></span>
    </button>`;
  container.appendChild(row);
  renderIcons();
}

function collectPricingConfig() {
  const items = [];
  document.querySelectorAll(".pricing-item-row").forEach((row) => {
    const desc = row.querySelector(".pi-desc")?.value?.trim();
    const type = row.querySelector(".pi-type")?.value || "fixed";
    const rate = parseFloat(row.querySelector(".pi-rate")?.value) || 0;
    const unit = row.querySelector(".pi-unit")?.value?.trim() || "";
    if (desc) items.push({ description: desc, type, rate, unit });
  });
  return {
    items,
    formula: document.getElementById("quotePricingFormula")?.value?.trim() || "",
    tax_rate: parseFloat(document.getElementById("quoteTaxRate")?.value) || 0,
    tax_mode: document.getElementById("quoteTaxMode")?.value || "exclusive",
    currency: document.getElementById("quoteCurrency")?.value?.trim() || "AUD",
  };
}

function loadPricingConfigUI(config) {
  const container = document.getElementById("quotePricingItems");
  if (!container) return;
  container.innerHTML = "";
  const cfg = config || {};
  if (Array.isArray(cfg.items)) {
    cfg.items.forEach((item) => addPricingItemRow(item));
  }
  setInputValue("quotePricingFormula", cfg.formula);
  setInputValue("quoteTaxRate", cfg.tax_rate ?? 10);
  setInputValue("quoteTaxMode", cfg.tax_mode || "exclusive");
  setInputValue("quoteCurrency", cfg.currency || "AUD");
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
        <div><strong style="font-size:13px">${esc(n.phone_number)}</strong></div>
        <div><span class="muted">${esc(n.friendly_name || "—")}</span></div>
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
        <h3>${run.workflow_type} <span class="chip">${cap(run.status)}</span></h3>
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
    const [{ data: profiles }, { data: invites }, { data: reps }] = await Promise.all([
      sb.from("profiles")
        .select("id, full_name, phone, role, is_active, created_at")
        .eq("company_id", currentCompanyId)
        .order("created_at"),
      sb.from("sales_rep_invites")
        .select("id, email, full_name, status, invited_at")
        .eq("company_id", currentCompanyId)
        .eq("status", "pending")
        .order("invited_at", { ascending: false }),
      sb.from("sales_reps")
        .select("*")
        .eq("company_id", currentCompanyId),
    ]);

    renderTeamMembersList(profiles || [], invites || [], reps || []);
  } catch (err) {
    toast("Failed to load team members.", true);
  }
}

function renderTeamMembersList(profiles, invites, reps) {
  const el = document.getElementById("teamMembersList");
  if (!el) return;

  const repMap = {};
  reps.forEach((r) => { repMap[r.user_id] = r; });

  const VIS_LABELS = { all: "All", assigned_only: "Assigned Only", none: "None" };

  const memberRows = profiles.map((p) => {
    const rep = repMap[p.id];
    const isOwnerAdmin = p.role === "owner" || p.role === "admin";
    const canManage = isAdmin() && !isOwnerAdmin && p.id !== currentUser?.id;

    let permsHtml = "";
    if (rep && !isOwnerAdmin) {
      permsHtml = `
        <div class="team-perms" data-rep-id="${rep.id}" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:none">
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Visibility</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;margin-bottom:12px">
            ${["leads","quotes","appointments","sales","conversations"].map((s) => `
              <div style="display:flex;align-items:center;gap:6px;font-size:12px">
                <span style="min-width:90px;color:var(--muted)">${s.charAt(0).toUpperCase()+s.slice(1)}</span>
                <select data-vis="${s}" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2)" ${canManage ? "" : "disabled"}>
                  ${["all","assigned_only","none"].map((v) => `<option value="${v}" ${rep[s+"_visibility"]===v?"selected":""}>${VIS_LABELS[v]}</option>`).join("")}
                </select>
              </div>`).join("")}
          </div>
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Permissions</div>
          <div class="toggle-group" style="gap:8px">
            ${[
              ["can_edit_leads","Edit Leads"],
              ["can_edit_quotes","Edit Quotes"],
              ["can_edit_appointments","Edit Appointments"],
              ["can_manage_pipeline","Manage Pipeline"],
              ["can_send_sms","Send SMS"],
              ["can_initiate_calls","Initiate Calls"],
            ].map(([key, label]) => `
              <label class="toggle-item" style="padding:6px 10px;font-size:11px">
                <input type="checkbox" data-perm-key="${key}" ${rep[key]?"checked":""} ${canManage?"":"disabled"}>
                <span class="toggle-label">${label}</span>
              </label>`).join("")}
          </div>
          ${canManage ? `<div class="actions" style="margin-top:10px"><button class="btn" type="button" onclick="saveRepPerms('${rep.id}', this)" style="font-size:11px;padding:6px 14px">Save Permissions</button></div>` : ""}
        </div>`;
    } else if (isOwnerAdmin) {
      permsHtml = `<div class="team-perms" style="margin-top:4px;display:none"><span class="muted" style="font-size:11px">Owners and admins have full access to all sections.</span></div>`;
    }

    return `
    <div class="team-row" style="flex-wrap:wrap">
      <div style="flex:1;min-width:150px"><strong style="font-size:13px">${p.full_name || "—"}</strong><span class="muted">${p.phone || "—"}</span></div>
      <div><span class="chip">${p.role || "member"}</span></div>
      <div><span class="chip ${p.is_active ? "" : "chip-pending"}">${p.is_active ? "Active" : "Inactive"}</span></div>
      <div>
        ${(rep || isOwnerAdmin) ? `<button class="btn" type="button" onclick="toggleTeamPerms(this)" style="font-size:11px;padding:4px 10px"><span class="icon" data-icon="settings" style="width:12px;height:12px"></span> Permissions</button>` : ""}
      </div>
      ${permsHtml}
    </div>`;
  }).join("");

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
    ? `<div class="team-list">${memberRows}${inviteRows}</div>`
    : `<div class="notice">No team members yet. Invite someone below.</div>`;

  renderIcons();
}

async function saveRepPerms(repId, btn) {
  const container = btn.closest('.team-perms');
  if (!container) return;

  const update = {};
  // Visibility selects
  container.querySelectorAll('[data-vis]').forEach((sel) => {
    update[sel.dataset.vis + '_visibility'] = sel.value;
  });
  // Permission toggles
  container.querySelectorAll('[data-perm-key]').forEach((cb) => {
    update[cb.dataset.permKey] = cb.checked;
  });

  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const { error } = await sb.from("sales_reps").update(update).eq("id", repId);
    if (error) { toast(error.message, true); return; }
    toast("Permissions saved.");
  } catch (err) {
    toast("Failed to save permissions.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Permissions";
  }
}
window.saveRepPerms = saveRepPerms;

function toggleTeamPerms(btn) {
  const perms = btn.closest('.team-row')?.querySelector('.team-perms');
  if (perms) perms.style.display = perms.style.display === 'none' ? 'block' : 'none';
}
window.toggleTeamPerms = toggleTeamPerms;

async function handleTeamInvite(e) {
  e.preventDefault();
  const email    = document.getElementById("inviteEmail")?.value?.trim();
  const fullName = document.getElementById("inviteFullName")?.value?.trim();
  const phone    = document.getElementById("invitePhone")?.value?.trim();
  if (!email) { toast("Email is required.", true); return; }

  const btn = e.target.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

  try {
    const result = await edgeFn("invite-rep", { email, name: fullName, phone, visibility: {
      leads: "assigned_only", quotes: "assigned_only", appointments: "assigned_only",
      sales: "assigned_only", conversations: "assigned_only",
    }});

    if (result.email_sent) {
      toast(`Invite sent to ${email}. They'll receive an email to set up their account.`);
    } else {
      toast(`User added but the invitation email could not be sent${result.email_error ? ": " + result.email_error : ""}`, true);
    }
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

// ─── Notifications ────────────────────────────────────────────────────────────
async function loadNotifications() {
  if (!currentCompanyId) return;
  try {
    const { data: notifications } = await sb
      .from("notifications")
      .select("*")
      .eq("company_id", currentCompanyId)
      .order("created_at", { ascending: false })
      .limit(50);

    const el = document.getElementById("notificationsPanel");
    if (!el) return;

    // Update unread badge count
    const unread = (notifications || []).filter((n) => !n.is_read).length;
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? "inline-flex" : "none";
    }

    if (!notifications?.length) {
      el.innerHTML = `<div class="empty"><h3>No notifications yet</h3><p>When AI books appointments, triggers quotes, or completes goals, notifications will appear here.</p></div>`;
      return;
    }

    const typeIcons = {
      callback_booked: "📞",
      onsite_booked: "📍",
      quote_drafted: "📄",
      sale_completed: "💰",
    };

    el.innerHTML = `<div class="table-lite">${notifications.map((n) => `
      <div class="row${n.is_read ? "" : " unread"}" style="cursor:pointer;${n.is_read ? "" : "border-left:3px solid #8b5cf6;"}" onclick="markNotificationRead('${n.id}')">
        <div>
          <strong style="font-size:13px">${typeIcons[n.type] || "🔔"} ${esc(n.title)}</strong>
          <span class="muted">${esc(n.message || "")}</span>
        </div>
        <div>
          <span class="chip">${cap(n.type?.replace(/_/g, " ") || "notification")}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="muted">${fmtDate(n.created_at)}</span>
          ${n.type === "quote_drafted" && n.metadata?.quote_id ? `<button class="btn2" style="padding:3px 8px;font-size:11px" onclick="event.stopPropagation();approveAndSendQuote('${n.metadata.quote_id}')">Approve &amp; Send</button>` : ""}
        </div>
      </div>`).join("")}</div>`;
  } catch (err) {
    console.error("Load notifications error:", err);
    const el = document.getElementById("notificationsPanel");
    if (el) el.innerHTML = `<div class="notice">Failed to load notifications.</div>`;
  }
}

async function markNotificationRead(notifId) {
  try {
    await sb.from("notifications").update({ is_read: true }).eq("id", notifId);
    loadNotifications();
  } catch (err) {
    console.error("Mark notification read error:", err);
  }
}

async function markAllNotificationsRead() {
  if (!currentCompanyId) return;
  try {
    await sb.from("notifications").update({ is_read: true }).eq("company_id", currentCompanyId).eq("is_read", false);
    toast("All notifications marked as read.");
    loadNotifications();
  } catch (err) {
    toast("Failed to mark notifications as read.", true);
  }
}

async function loadNotificationBadge() {
  if (!currentCompanyId) return;
  try {
    const { count } = await sb
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("company_id", currentCompanyId)
      .eq("is_read", false);
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = count || 0;
      badge.style.display = (count && count > 0) ? "inline-flex" : "none";
    }
  } catch (err) {
    console.error("Load notification badge error:", err);
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

    let smsFailed = false;
    if (firstMsg) {
      try {
        await edgeFn("send-sms", {
          conversation_id: conv.id,
          body:            firstMsg,
        });
      } catch (smsErr) {
        smsFailed = true;
        toast("Conversation created but SMS failed: " + (smsErr.message || "Unknown error"), true);
      }
    }

    if (!smsFailed) toast("Conversation created.");
    closeModal("newConvModal");
    document.getElementById("newConvForm")?.reset();
    await loadConversations();

    const name  = conv.leads?.name  || "Lead";
    const phone = conv.leads?.phone || "";
    const item  = document.querySelector(`.conv-item[data-conv-id="${conv.id}"]`);
    openConversation(conv.id, leadId, name, phone, item);
  } catch (err) {
    console.error("handleNewConversation error:", err);
    toast(err.message || "Failed to create conversation.", true);
  }
}

async function openConversation(convId, leadId, name, phone, itemEl) {
  currentConvId = convId;
  currentLeadId = leadId;

  document.getElementById("convDetailEmpty")?.classList.add("hidden");
  document.getElementById("convDetail")?.classList.remove("hidden");
  document.querySelector(".conv-layout")?.classList.add("conv-open");
  
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

function closeConversationDetail() {
  document.querySelector(".conv-layout")?.classList.remove("conv-open");
  currentConvId = null;
  currentLeadId = null;
  document.getElementById("convDetail")?.classList.add("hidden");
  document.getElementById("convDetailEmpty")?.classList.remove("hidden");
  document.querySelectorAll(".conv-item").forEach((el) => el.classList.remove("active"));
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
      // Determine badge: for outbound messages, show 'AI' or 'Human'
      // agent_type "sms" is a legacy value from before migration to "ai"
      let badge = "";
      if (m.direction === "outbound") {
        badge = m.is_ai_generated || m.agent_type === "ai" || m.agent_type === "sms" ? "ai" : "human";
      }
      const badgeLabel = badge === "ai" ? "AI" : badge === "human" ? "Human" : "";
      return `<div class="msg ${m.direction === "inbound" ? "inbound" : "outbound"}">
        ${content}
        <div class="msg-meta">
          ${badgeLabel ? `<span class="msg-badge ${badge}">${badgeLabel}</span>` : ""}
          <span>${fmtDate(m.created_at)}</span>
        </div>
      </div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  } catch (err) {
    toast("Failed to load messages.", true);
  }
}

// ── Realtime Subscription ─────────────────────────────────────────────────────
function setupRealtimeSubscription() {
  if (!currentCompanyId || !sb) return;

  // Clean up previous subscription
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = sb
    .channel("conversations-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      (payload) => {
        const row = payload.new || payload.old;
        if (row?.company_id !== currentCompanyId) return;

        // Refresh conversation list
        loadConversations();

        // If viewing this conversation, refresh messages
        if (currentConvId && row?.id === currentConvId) {
          loadMessages(currentConvId);
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const msg = payload.new;
        if (!msg || !currentConvId) return;

        // If the new message belongs to the open conversation, refresh it
        if (msg.conversation_id === currentConvId) {
          loadMessages(currentConvId);
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      (payload) => {
        const notif = payload.new;
        if (notif?.company_id !== currentCompanyId) return;
        loadNotificationBadge();
      }
    )
    .subscribe();
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input   = document.getElementById("convMessageInput");
  const content = input?.value?.trim();
  if (!content || !currentConvId) return;

  try {
    await edgeFn("send-sms", {
      conversation_id: currentConvId,
      body:            content,
    });

    if (input) input.value = "";
    await loadMessages(currentConvId);
    toast("SMS sent.");
  } catch (err) {
    console.error("handleSendMessage error:", err);
    toast(err.message, true);
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

// ─── Bulk SMS ─────────────────────────────────────────────────────────────────
let bulkSmsLeads = [];

async function loadBulkSms() {
  if (!currentCompanyId) return;
  await updateBulkSmsLeadCount();
  updateBulkSmsPreview();
}

async function updateBulkSmsLeadCount() {
  if (!currentCompanyId) return;
  const stage = document.getElementById("bulkSmsStageFilter")?.value || "all";
  try {
    let query = sb
      .from("leads")
      .select("id, name, first_name, last_name, phone, pipeline_stage")
      .eq("company_id", currentCompanyId);

    if (stage !== "all") {
      query = query.eq("pipeline_stage", stage);
    }

    const { data } = await query.order("created_at", { ascending: false });
    const all = data || [];
    bulkSmsLeads = all.filter((l) => l.phone?.trim());
    const noPhone = all.length - bulkSmsLeads.length;

    const countEl = document.getElementById("bulkSmsLeadCount");
    const noPhoneEl = document.getElementById("bulkSmsNoPhone");
    const sendBtn = document.getElementById("bulkSmsSendBtn");
    if (countEl) countEl.textContent = bulkSmsLeads.length;
    if (noPhoneEl) noPhoneEl.textContent = noPhone > 0 ? `(${noPhone} skipped — no phone number)` : "";
    if (sendBtn) sendBtn.disabled = bulkSmsLeads.length === 0 || !document.getElementById("bulkSmsMessage")?.value?.trim();

    // Populate preview lead selector
    const previewSelect = document.getElementById("bulkSmsPreviewLead");
    if (previewSelect) {
      const prevVal = previewSelect.value;
      previewSelect.innerHTML = '<option value="">Sample Lead (John Smith)</option>';
      bulkSmsLeads.forEach((l) => {
        const displayName = l.name?.trim() || [l.first_name, l.last_name].filter(Boolean).join(" ") || l.phone;
        const opt = document.createElement("option");
        opt.value = l.id;
        opt.textContent = displayName;
        previewSelect.appendChild(opt);
      });
      // Restore previous selection if still in list
      if (prevVal && bulkSmsLeads.some((l) => l.id === prevVal)) {
        previewSelect.value = prevVal;
      }
    }
    updateBulkSmsPreview();
  } catch (err) {
    toast("Failed to load leads for bulk SMS.", true);
  }
}

function updateBulkSmsPreview() {
  const msgEl = document.getElementById("bulkSmsMessage");
  const previewEl = document.getElementById("bulkSmsPreview");
  const sendBtn = document.getElementById("bulkSmsSendBtn");
  const raw = msgEl?.value || "";
  if (!raw.trim()) {
    if (previewEl) previewEl.textContent = "Type a message above to see a preview…";
    if (sendBtn) sendBtn.disabled = true;
    return;
  }
  // Show preview using selected lead, or fall back to first lead / sample name
  const selectedId = document.getElementById("bulkSmsPreviewLead")?.value;
  const sampleLead = selectedId
    ? bulkSmsLeads.find((l) => l.id === selectedId) || null
    : bulkSmsLeads.length > 0 ? bulkSmsLeads[0] : null;
  const sampleName = sampleLead ? getFirstName(sampleLead) : "John";
  const sampleLastName = sampleLead ? getLastName(sampleLead) : "Smith";
  const preview = replaceMergeTags(raw, sampleName, sampleLastName);
  if (previewEl) previewEl.textContent = preview;
  if (sendBtn) sendBtn.disabled = bulkSmsLeads.length === 0;
}

function getFirstName(lead) {
  if (lead.name?.trim()) return lead.name.trim().split(/\s+/)[0];
  if (lead.first_name?.trim()) return lead.first_name.trim();
  return "there";
}

function getLastName(lead) {
  if (lead.name?.trim()) {
    const parts = lead.name.trim().split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  }
  if (lead.last_name?.trim()) return lead.last_name.trim();
  return "";
}

// Matches {{first_name}}, {{first.name}}, {{firstName}}, {{first name}} (case-insensitive)
const FIRST_NAME_RE = /\{\{\s*first[_. ]?name\s*\}\}/gi;
const LAST_NAME_RE  = /\{\{\s*last[_. ]?name\s*\}\}/gi;

function replaceMergeTags(text, firstName, lastName) {
  return text
    .replace(FIRST_NAME_RE, firstName)
    .replace(LAST_NAME_RE, lastName);
}

async function handleBulkSmsSend() {
  const msgTemplate = document.getElementById("bulkSmsMessage")?.value?.trim();
  if (!msgTemplate) { toast("Please enter a message.", true); return; }
  if (!bulkSmsLeads.length) { toast("No leads to send to.", true); return; }

  const count = bulkSmsLeads.length;
  if (!confirm(`You are about to send ${count} SMS message${count > 1 ? "s" : ""}. This will use ${count} SMS credit${count > 1 ? "s" : ""}. Continue?`)) return;

  const sendBtn = document.getElementById("bulkSmsSendBtn");
  const progressWrap = document.getElementById("bulkSmsProgress");
  const progressBar = document.getElementById("bulkSmsProgressBar");
  const progressText = document.getElementById("bulkSmsProgressText");
  const resultSummary = document.getElementById("bulkSmsResultSummary");

  if (sendBtn) sendBtn.disabled = true;
  if (progressWrap) progressWrap.classList.remove("hidden");
  if (progressBar) progressBar.style.width = "0%";
  if (progressText) progressText.textContent = `0 / ${count}`;
  if (resultSummary) resultSummary.textContent = "";

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const lead of bulkSmsLeads) {
    const firstName = getFirstName(lead);
    const lastName = getLastName(lead);
    const body = replaceMergeTags(msgTemplate, firstName, lastName);

    try {
      await edgeFn("send-sms", { lead_id: lead.id, body });
      sent++;
    } catch (err) {
      failed++;
      errors.push(`${lead.name || lead.id}: ${err.message}`);
    }

    const done = sent + failed;
    const pct = Math.round((done / count) * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `${done} / ${count}`;
  }

  let summary = `✅ ${sent} sent`;
  if (failed) summary += ` · ❌ ${failed} failed`;
  if (resultSummary) resultSummary.textContent = summary;
  if (sendBtn) sendBtn.disabled = false;

  if (failed && errors.length) {
    console.error("Bulk SMS errors:", errors);
    toast(`Bulk SMS complete: ${sent} sent, ${failed} failed. Check console for details.`, true);
  } else {
    toast(`Bulk SMS complete! ${sent} message${sent > 1 ? "s" : ""} sent.`);
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

    // Lock config fields for internal users (only prompt, greeting, transfer phone & voice select editable)
    const lockedFields = ["vapiPhoneNumberId", "voiceAgentName", "voiceModel", "maxDuration", "voiceAgentActive"];
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

    // Hide VAPI Assistant ID field entirely for internal users
    const assistantField = document.getElementById("vapiAssistantIdField");
    if (assistantField) assistantField.style.display = isInternal ? "none" : "";

    // For internal users: hide raw Voice ID input, show voice dropdown
    // For external users: show raw Voice ID input, hide dropdown
    const voiceIdField = document.getElementById("voiceIdField");
    const voiceSelectField = document.getElementById("voiceSelectField");
    const customVoiceIdField = document.getElementById("customVoiceIdField");
    if (voiceIdField) voiceIdField.style.display = isInternal ? "none" : "";
    if (voiceSelectField) voiceSelectField.style.display = isInternal ? "" : "none";
    if (customVoiceIdField) customVoiceIdField.style.display = "none";

    // Populate voice dropdown for internal users
    if (isInternal) {
      const voiceSelect = document.getElementById("voiceSelect");
      if (voiceSelect) {
        const { data: voices, error: voicesErr } = await sb.from("elevenlabs_voices").select("name, voice_id").order("name");
        if (voicesErr) console.warn("Failed to load voices:", voicesErr.message);
        voiceSelect.innerHTML = '<option value="">Select a voice…</option>';
        (voices || []).forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.voice_id;
          opt.textContent = v.name;
          voiceSelect.appendChild(opt);
        });
        // Add "Custom Voice ID" option at the end
        const customOpt = document.createElement("option");
        customOpt.value = "__custom__";
        customOpt.textContent = "Custom Voice ID…";
        voiceSelect.appendChild(customOpt);

        // Toggle custom voice ID input when "Custom" is selected
        voiceSelect.addEventListener("change", () => {
          if (customVoiceIdField) {
            customVoiceIdField.style.display = voiceSelect.value === "__custom__" ? "" : "none";
          }
        });
      }
    }

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
        ? `<p><strong>Agency-Managed:</strong> Your voice agent is pre-configured by your agency. You can edit the system prompt, greeting, transfer number, and voice selection.</p>`
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

      const vapiPhoneNumberId = document.getElementById("vapiPhoneNumberId");
      if (vapiPhoneNumberId) vapiPhoneNumberId.value = config.vapi_phone_number_id || "";
      if (vapiAssistantId) vapiAssistantId.value = config.vapi_assistant_id || "";
      if (voiceAgentName) voiceAgentName.value = config.name || "";
      if (voiceModel) voiceModel.value = config.model || "gpt-4o";
      if (voiceId) voiceId.value = config.voice_id || "";
      const voiceSelect = document.getElementById("voiceSelect");
      if (voiceSelect && config.voice_id) {
        voiceSelect.value = config.voice_id;
        // If the saved voice_id isn't in the preset options, select "Custom" and populate the custom input
        if (voiceSelect.value !== config.voice_id) {
          voiceSelect.value = "__custom__";
          const customInput = document.getElementById("customVoiceId");
          if (customInput) customInput.value = config.voice_id;
          const customField = document.getElementById("customVoiceIdField");
          if (customField) customField.style.display = "";
        }
      }
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
      // Internal users can update system prompt, greeting, transfer phone, and voice selection
      const selectedVoice = document.getElementById("voiceSelect")?.value;
      const resolvedVoiceId = selectedVoice === "__custom__"
        ? (document.getElementById("customVoiceId")?.value || null)
        : (selectedVoice || null);
      payload = {
        company_id:    currentCompanyId,
        system_prompt: document.getElementById("voiceSystemPrompt")?.value || null,
        greeting:      document.getElementById("voiceGreeting")?.value || null,
        transfer_phone: document.getElementById("transferPhone")?.value || null,
        voice_id:      resolvedVoiceId,
      };
    } else {
      // External users can configure everything
      payload = {
        company_id:            currentCompanyId,
        vapi_phone_number_id:  document.getElementById("vapiPhoneNumberId")?.value || null,
        vapi_assistant_id:     document.getElementById("vapiAssistantId")?.value || null,
        name:                  document.getElementById("voiceAgentName")?.value || "Default Voice Agent",
        model:                 document.getElementById("voiceModel")?.value || "gpt-4o",
        voice_id:              document.getElementById("voiceId")?.value || null,
        max_duration:          Number(document.getElementById("maxDuration")?.value) || 300,
        transfer_phone:        document.getElementById("transferPhone")?.value || null,
        system_prompt:         document.getElementById("voiceSystemPrompt")?.value || null,
        greeting:              document.getElementById("voiceGreeting")?.value || null,
        is_active:             document.getElementById("voiceAgentActive")?.checked || false,
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
    await edgeFn("voice-ai-provider", { action: "save_key", vapiKey: externalKey });

    toast("Provider key saved securely.");
    document.getElementById("voiceProviderForm")?.reset();

  } catch (err) {
    toast(err.message, true);
  }
}

async function testVoiceAgent() {
  try {
    toast("Testing voice agent connection...");
    await edgeFn("voice-ai-provider", { action: "test" });
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
        <h3>${call.leads?.name || "Unknown"} <span class="chip">${cap(call.status)}</span></h3>
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
              <td style="padding:8px 10px"><span class="chip">${cap(c.direction || "—")}</span></td>
              <td style="padding:8px 10px"><span style="color:${statusColor(c.status)};font-weight:600">${cap(c.status || "—")}</span></td>
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
    html += `<div><strong>Direction:</strong> <span class="chip">${cap(call.direction || "—")}</span></div>`;
    html += `<div><strong>Status:</strong> ${cap(call.status || "—")}</div>`;
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
  if (oppModalTitle) oppModalTitle.textContent = lead.name || "Lead Details";
  if (oppModalSubtitle) oppModalSubtitle.textContent = `Status: ${stageLabel(lead.pipeline_stage)} · Created: ${fmtDate(lead.created_at)}`;

  // Populate overview
  document.getElementById("oppOverviewName").value = lead.name || "—";
  document.getElementById("oppOverviewEmail").value = lead.email || "—";
  document.getElementById("oppOverviewPhone").value = lead.phone || "—";
  document.getElementById("oppOverviewStatus").value = stageLabel(lead.pipeline_stage) || "—";
  document.getElementById("oppOverviewSource").value = lead.source || "—";
  document.getElementById("oppOverviewValue").value = lead.value ? fmt(lead.value) : "—";
  document.getElementById("oppOverviewAiScore").value = aiScoreDisplay(lead);
  document.getElementById("oppOverviewAiStatus").value = aiStatusLabel(lead);
  document.getElementById("oppOverviewAddress").value = lead.address ? `${lead.address}${lead.postcode ? `, ${lead.postcode}` : ""}` : "—";
  document.getElementById("oppOverviewAiSummary").value = lead.ai_summary || "No AI summary yet.";
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
      .select("id, quote_number, status, total, created_at, sent_at, accepted_at, quote_token, line_items, valid_until")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (!quotes?.length) {
      el.innerHTML = `<div class="notice">No quotes found for this lead.</div>`;
      return;
    }

    el.innerHTML = quotes.map((q) => {
      const quoteLink = buildQuoteLink(q.quote_token);
      const isDraft = q.status === "draft";
      const itemCount = Array.isArray(q.line_items) ? q.line_items.length : 0;
      return `
      <div class="run">
        <h3>Quote #${q.quote_number || q.id.slice(0, 8)} <span class="chip">${cap(q.status || "draft")}</span></h3>
        <p><strong>Total:</strong> ${q.total ? fmt(q.total) : "—"}${itemCount ? ` · ${itemCount} line item${itemCount > 1 ? "s" : ""}` : ""}</p>
        <p style="margin-top:4px;"><span class="muted">Created: ${fmtDate(q.created_at)}${q.sent_at ? ` · Sent: ${fmtDate(q.sent_at)}` : ""}${q.accepted_at ? ` · Accepted: ${fmtDate(q.accepted_at)}` : ""}${q.valid_until ? ` · Valid until: ${fmtDate(q.valid_until)}` : ""}</span></p>
        <div style="margin-top:8px;display:flex;gap:8px">
          ${isDraft ? `<button class="btn2" style="padding:4px 10px;font-size:11px" onclick="approveAndSendQuote('${q.id}')">Approve & Send</button>` : ""}
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
      .select("id, title, status, start_time, end_time, location, notes, appointment_type, booked_by")
      .eq("company_id", currentCompanyId)
      .eq("lead_id", leadId)
      .order("start_time", { ascending: false });

    if (!appointments?.length) {
      el.innerHTML = `<div class="notice">No appointments found for this lead.</div>`;
      return;
    }

    el.innerHTML = appointments.map((a) => `
      <div class="run">
        <h3>${a.title || "Appointment"} <span class="chip">${cap(a.status || "scheduled")}</span>${a.appointment_type ? ` <span class="chip">${cap(a.appointment_type)}</span>` : ''}${a.booked_by === "ai" ? ` <span class="chip" style="background:#8b5cf6;color:#fff">Booked by AI</span>` : ''}</h3>
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
        <h3>${c.direction === "outbound" ? "Outbound Call" : "Inbound Call"} <span class="chip">${cap(c.status || "unknown")}</span>${c.sentiment ? ` <span class="chip">${cap(c.sentiment)}</span>` : ""}</h3>
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
    const json = await edgeFn("voice-ai-provider", { action: "get_config" });

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
    const json = await edgeFn("voice-ai-provider", {
      action: "create_call",
      leadId: leadId,
      phoneNumber: phone,
      assistantId: assistantId || undefined,
      metadata: {
        source: "dashboard",
        initiated_by: currentUser?.id,
      }
    });

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

// ─── Approve & Send Quote ─────────────────────────────────────────────────────
// Updates quote status to "sent", sends the public link via SMS to the lead,
// and creates a message in the conversation thread.
async function approveAndSendQuote(quoteId) {
  if (!currentCompanyId) return;
  if (!confirm("Approve this quote and send it to the lead via SMS?")) return;

  try {
    // 1. Load quote with lead info
    const { data: quote, error: qErr } = await sb
      .from("quotes")
      .select("id, quote_number, quote_token, status, lead_id, total, leads(name, phone)")
      .eq("id", quoteId)
      .single();

    if (qErr || !quote) { toast("Quote not found.", true); return; }
    if (quote.status !== "draft") { toast("Only draft quotes can be approved.", true); return; }

    const lead = quote.leads || {};
    if (!lead.phone) { toast("Lead has no phone number — cannot send SMS.", true); return; }

    // 2. Update quote status to "sent"
    const { error: updateErr } = await sb
      .from("quotes")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", quoteId);

    if (updateErr) { toast("Failed to update quote status.", true); return; }

    // 3. Build quote link and SMS body
    const quoteLink = buildQuoteLink(quote.quote_token);
    const leadName = lead.name ? lead.name.split(" ")[0] : "there";
    const smsBody = `Hi ${leadName}, here's your quote #${quote.quote_number || quoteId.slice(0, 8)}${quote.total ? " for " + fmt(quote.total) : ""}. You can view, accept, or decline it here: ${quoteLink}`;

    // 4. Send SMS via edge function
    const result = await edgeFn("send-sms", {
      lead_id: quote.lead_id,
      body: smsBody,
    });

    // 5. Log activity
    await sb.from("activity_log").insert({
      company_id: currentCompanyId,
      action: "quote.approved_and_sent",
      entity_type: "quote",
      entity_id: quoteId,
      details: {
        quote_number: quote.quote_number,
        lead_id: quote.lead_id,
        conversation_id: result.conversation_id || null,
        sent_via: "sms",
      },
    });

    toast("Quote approved and sent to " + (lead.name || lead.phone) + "!");

    // 6. Refresh relevant UI
    loadQuotes();
    loadNotifications();
    loadNotificationBadge();

    // Refresh opportunity quotes if modal is open
    const currentLeadId = document.getElementById("oppModalLeadId")?.value;
    if (currentLeadId === quote.lead_id) loadOppQuotes(quote.lead_id);

  } catch (err) {
    toast(err.message || "Failed to approve and send quote.", true);
    console.error("approveAndSendQuote error:", err);
  }
}

// =============================================================================
// ── AI Insights ───────────────────────────────────────────────────────────────
// =============================================================================

async function loadAiInsights() {
  if (!currentCompanyId) return;

  const statsEl = document.getElementById("aiInsightsStats");
  const convEl = document.getElementById("aiConversionBars");
  const knowledgeEl = document.getElementById("aiKnowledgeList");

  // ── Fetch performance stats ─────────────────────────────────────────────
  const { data: stats } = await sb
    .from("ai_performance_stats")
    .select("*")
    .eq("company_id", currentCompanyId)
    .eq("period", "all_time")
    .maybeSingle();

  if (statsEl) {
    if (!stats) {
      statsEl.innerHTML = `<div class="notice">No data yet. AI insights will appear as your AI agents handle more conversations.</div>`;
    } else {
      const statCards = [
        { label: "Total Leads", value: stats.total_leads, icon: "users" },
        { label: "AI-Handled", value: stats.ai_handled_leads, icon: "spark" },
        { label: "AI Conversions", value: stats.ai_conversions, icon: "chart" },
        { label: "Avg AI Score", value: Math.round(stats.avg_ai_score || 0), icon: "spark" },
        { label: "Callbacks Booked", value: stats.callbacks_booked, icon: "phone" },
        { label: "On-sites Booked", value: stats.onsites_booked, icon: "calendar" },
        { label: "Quotes Generated", value: stats.quotes_generated, icon: "file" },
        { label: "Voice Calls", value: stats.voice_calls_completed, icon: "phone" },
        { label: "Knowledge Items", value: stats.knowledge_items_count, icon: "spark" },
      ];

      statsEl.innerHTML = statCards.map((s) => `
        <div style="background:var(--surface-2);border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--text)">${s.value}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">${esc(s.label)}</div>
        </div>
      `).join("");
    }
  }

  // ── Conversion comparison ───────────────────────────────────────────────
  if (convEl) {
    if (!stats || stats.total_leads === 0) {
      convEl.innerHTML = `<div class="notice">Not enough data to compare conversion rates yet.</div>`;
    } else {
      const aiRate = stats.ai_conversion_rate || 0;
      const humanRate = stats.human_conversion_rate || 0;
      const maxRate = Math.max(aiRate, humanRate, 1);

      convEl.innerHTML = `
        <div style="flex:1;text-align:center">
          <div style="background:var(--accent,#1f6fff);border-radius:6px 6px 0 0;height:${Math.max(8, (aiRate / maxRate) * 120)}px;margin:0 auto;width:60px"></div>
          <div style="margin-top:8px;font-weight:600;font-size:20px">${aiRate.toFixed(1)}%</div>
          <div style="font-size:12px;color:var(--muted)">AI Conversion</div>
          <div style="font-size:11px;color:var(--muted)">${stats.ai_conversions} / ${stats.ai_handled_leads} leads</div>
        </div>
        <div style="flex:1;text-align:center">
          <div style="background:var(--muted);border-radius:6px 6px 0 0;height:${Math.max(8, (humanRate / maxRate) * 120)}px;margin:0 auto;width:60px"></div>
          <div style="margin-top:8px;font-weight:600;font-size:20px">${humanRate.toFixed(1)}%</div>
          <div style="font-size:12px;color:var(--muted)">Human Conversion</div>
          <div style="font-size:11px;color:var(--muted)">${stats.human_conversions} / ${stats.human_handled_leads} leads</div>
        </div>
      `;
    }
  }

  // ── Knowledge base ──────────────────────────────────────────────────────
  if (knowledgeEl) {
    const { data: knowledge } = await sb
      .from("company_knowledge")
      .select("id, category, insight, tags, source_type, times_used, created_at")
      .eq("company_id", currentCompanyId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!knowledge || knowledge.length === 0) {
      knowledgeEl.innerHTML = `<div class="notice">No AI learnings yet. As leads progress through your pipeline, the AI will extract insights automatically.</div>`;
    } else {
      const categoryLabels = {
        winning_pattern: "✅ Winning Pattern",
        failed_pattern: "⚠️ Failed Pattern",
        objection_response: "💬 Objection Response",
        scheduling_approach: "📅 Scheduling",
        quote_approach: "💰 Quote Approach",
        service_insight: "🔧 Service Insight",
        style_preference: "🎨 Style Preference",
      };

      knowledgeEl.innerHTML = knowledge.map((k) => {
        const catLabel = categoryLabels[k.category] || k.category;
        const tags = (k.tags || []).map((t) => `<span style="background:var(--surface-2);padding:2px 6px;border-radius:4px;font-size:10px">${esc(t)}</span>`).join(" ");
        const ts = new Date(k.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px">${catLabel} <span style="font-weight:400;margin-left:4px">${esc(k.source_type)}</span></div>
            <div style="font-size:13px;color:var(--text)">${esc(k.insight)}</div>
            <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${tags}</div>
          </div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap">${ts}</div>
        </div>`;
      }).join("");
    }
  }

  // ── Industry insights ───────────────────────────────────────────────────
  const industryEl = document.getElementById("aiIndustryInsights");
  if (industryEl) {
    const { data: insights } = await sb
      .from("industry_insights")
      .select("industry, insight, sample_size, confidence, updated_at")
      .eq("is_active", true)
      .order("confidence", { ascending: false })
      .limit(10);

    if (!insights || insights.length === 0) {
      industryEl.innerHTML = `<div class="notice">Industry insights will appear as more companies use the platform.</div>`;
    } else {
      industryEl.innerHTML = insights.map((i) => {
        const confPct = Math.round((i.confidence || 0) * 100);
        const ts = new Date(i.updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
        return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;text-transform:capitalize">${esc(i.industry.replace(/_/g, " "))}</div>
            <div style="font-size:13px;color:var(--text)">${esc(i.insight)}</div>
            <div style="margin-top:4px;font-size:11px;color:var(--muted)">${i.sample_size} companies · ${confPct}% confidence</div>
          </div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap">${ts}</div>
        </div>`;
      }).join("");
    }
  }

  renderIcons();
}

// =============================================================================
// ── Integrations (API Keys & Webhooks) ────────────────────────────────────────
// =============================================================================

async function loadIntegrations() {
  if (!currentCompanyId) return;
  await Promise.all([loadApiKeys(), loadWebhooks(), loadWebhookDeliveries()]);
  wireIntegrationsUI();
  renderIcons();
}

let integrationsWired = false;
function wireIntegrationsUI() {
  if (integrationsWired) return;
  integrationsWired = true;

  // API Key buttons
  document.getElementById("createApiKeyBtn")?.addEventListener("click", () => {
    document.getElementById("apiKeyFormPanel").style.display = "";
    document.getElementById("apiKeyCreatedPanel").style.display = "none";
    document.getElementById("apiKeyForm")?.reset();
  });
  document.getElementById("cancelApiKeyBtn")?.addEventListener("click", () => {
    document.getElementById("apiKeyFormPanel").style.display = "none";
  });
  document.getElementById("apiKeyCreatedDoneBtn")?.addEventListener("click", () => {
    document.getElementById("apiKeyCreatedPanel").style.display = "none";
  });
  document.getElementById("copyApiKeyBtn")?.addEventListener("click", () => {
    const val = document.getElementById("apiKeyRawValue")?.textContent;
    if (val) {
      navigator.clipboard.writeText(val).then(() => toast("API key copied to clipboard!"));
    }
  });
  document.getElementById("apiKeyForm")?.addEventListener("submit", handleCreateApiKey);

  // Webhook buttons
  document.getElementById("createWebhookBtn")?.addEventListener("click", () => {
    document.getElementById("webhookFormPanel").style.display = "";
    document.getElementById("webhookForm")?.reset();
    document.getElementById("webhookEditId").value = "";
  });
  document.getElementById("cancelWebhookBtn")?.addEventListener("click", () => {
    document.getElementById("webhookFormPanel").style.display = "none";
  });
  document.getElementById("copyWebhookSecretBtn")?.addEventListener("click", () => {
    const val = document.getElementById("webhookSecretValue")?.textContent;
    if (val) {
      navigator.clipboard.writeText(val).then(() => toast("Webhook secret copied to clipboard!"));
    }
  });
  document.getElementById("webhookSecretDoneBtn")?.addEventListener("click", () => {
    document.getElementById("webhookSecretPanel").style.display = "none";
  });
  document.getElementById("webhookForm")?.addEventListener("submit", handleSaveWebhook);
}

// ── API Keys ──────────────────────────────────────────────────────────────────

async function loadApiKeys() {
  const container = document.getElementById("apiKeysTable");
  if (!container) return;

  const { data, error } = await sb
    .from("company_api_tokens")
    .select("*")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false });

  if (error) { container.innerHTML = `<div class="notice">Failed to load API keys.</div>`; return; }

  if (!data || data.length === 0) {
    container.innerHTML = `<div class="notice">No API keys yet. Create one to start integrating.</div>`;
    return;
  }

  const rows = data.map((k) => {
    const revoked = !!k.revoked_at;
    const expired = k.expires_at && new Date(k.expires_at) < new Date();
    const status = revoked ? "Revoked" : expired ? "Expired" : "Active";
    const statusClass = revoked || expired ? "muted" : "";
    const lastUsed = k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never";
    const created = new Date(k.created_at).toLocaleDateString();

    return `<div class="row${revoked ? " muted" : ""}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <b>${esc(k.name)}</b>
        <span style="font-family:monospace;font-size:12px;color:var(--text-2);margin-left:8px">${esc(k.token_prefix)}…</span>
      </div>
      <div style="font-size:12px;color:var(--text-2);display:flex;gap:16px;align-items:center">
        <span>${status}</span>
        <span>Created ${created}</span>
        <span>Last used: ${lastUsed}</span>
        ${!revoked ? `<button class="btn" style="font-size:11px;padding:4px 10px" onclick="revokeApiKey('${k.id}')">Revoke</button>` : ""}
      </div>
    </div>`;
  }).join("");

  container.innerHTML = rows;
}

async function handleCreateApiKey(e) {
  e.preventDefault();
  if (!currentCompanyId) return;

  const name = document.getElementById("apiKeyName")?.value?.trim();
  if (!name) { toast("Key name is required", true); return; }

  // Collect scopes
  const scopes = [];
  if (document.getElementById("scopeLeadsRead")?.checked) scopes.push("leads:read");
  if (document.getElementById("scopeLeadsWrite")?.checked) scopes.push("leads:write");
  if (document.getElementById("scopeQuotesRead")?.checked) scopes.push("quotes:read");
  if (document.getElementById("scopeAppointmentsRead")?.checked) scopes.push("appointments:read");
  if (document.getElementById("scopeVoiceCallsRead")?.checked) scopes.push("voice-calls:read");
  if (document.getElementById("scopePipelineRead")?.checked) scopes.push("pipeline:read");
  if (document.getElementById("scopeSmsSend")?.checked) scopes.push("sms:send");

  if (scopes.length === 0) { toast("Select at least one scope", true); return; }

  // Expiry
  const expiryDays = document.getElementById("apiKeyExpiry")?.value;
  let expiresAt = null;
  if (expiryDays) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiryDays));
    expiresAt = d.toISOString();
  }

  // Generate a random token (48 bytes = 64 base64 chars)
  const rawBytes = new Uint8Array(48);
  crypto.getRandomValues(rawBytes);
  const rawToken = "qlhq_" + Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const tokenPrefix = rawToken.slice(0, 12);

  // SHA-256 hash
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await sb.from("company_api_tokens").insert({
    company_id: currentCompanyId,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    name,
    scopes,
    expires_at: expiresAt,
  });

  if (error) { toast("Failed to create API key: " + error.message, true); return; }

  // Show the raw key to the user
  document.getElementById("apiKeyFormPanel").style.display = "none";
  document.getElementById("apiKeyCreatedPanel").style.display = "";
  document.getElementById("apiKeyRawValue").textContent = rawToken;

  toast("API key created! Copy it now — it won't be shown again.");
  loadApiKeys();
}

async function revokeApiKey(id) {
  if (!confirm("Revoke this API key? Any integrations using it will stop working.")) return;

  const { error } = await sb
    .from("company_api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", currentCompanyId);

  if (error) { toast("Failed to revoke key: " + error.message, true); return; }
  toast("API key revoked.");
  loadApiKeys();
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

async function loadWebhooks() {
  const container = document.getElementById("webhooksTable");
  if (!container) return;

  const { data, error } = await sb
    .from("webhook_endpoints")
    .select("*")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false });

  if (error) { container.innerHTML = `<div class="notice">Failed to load webhooks.</div>`; return; }

  if (!data || data.length === 0) {
    container.innerHTML = `<div class="notice">No webhooks configured. Add one to receive event notifications.</div>`;
    return;
  }

  const rows = data.map((wh) => {
    const events = Array.isArray(wh.events) ? wh.events.join(", ") : "";
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-family:monospace;font-size:13px">${esc(wh.url)}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:2px">${esc(events)}</div>
      </div>
      <div style="font-size:12px;display:flex;gap:8px;align-items:center">
        <span style="color:${wh.active ? "var(--green)" : "var(--text-2)"}">${wh.active ? "Active" : "Inactive"}</span>
        <button class="btn" style="font-size:11px;padding:4px 10px" onclick="toggleWebhook('${wh.id}', ${!wh.active})">${wh.active ? "Disable" : "Enable"}</button>
        <button class="btn" style="font-size:11px;padding:4px 10px" onclick="deleteWebhook('${wh.id}')">Delete</button>
      </div>
    </div>`;
  }).join("");

  container.innerHTML = rows;
}

async function handleSaveWebhook(e) {
  e.preventDefault();
  if (!currentCompanyId) return;

  const url = document.getElementById("webhookUrl")?.value?.trim();
  if (!url) { toast("Webhook URL is required", true); return; }

  // Collect events
  const events = [];
  document.querySelectorAll(".wh-event:checked").forEach((el) => events.push(el.value));
  if (events.length === 0) { toast("Select at least one event", true); return; }

  // Generate signing secret
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret = "whsec_" + Array.from(secretBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const editId = document.getElementById("webhookEditId")?.value;

  if (editId) {
    const { error } = await sb
      .from("webhook_endpoints")
      .update({ url, events })
      .eq("id", editId)
      .eq("company_id", currentCompanyId);
    if (error) { toast("Failed to update webhook: " + error.message, true); return; }
    toast("Webhook updated.");
  } else {
    const { error } = await sb.from("webhook_endpoints").insert({
      company_id: currentCompanyId,
      url,
      events,
      secret,
    });
    if (error) { toast("Failed to create webhook: " + error.message, true); return; }
    // Show signing secret in a persistent panel so user can copy it
    document.getElementById("webhookSecretPanel").style.display = "";
    document.getElementById("webhookSecretValue").textContent = secret;
    toast("Webhook created! Copy the signing secret below.");
  }

  document.getElementById("webhookFormPanel").style.display = "none";
  loadWebhooks();
}

async function toggleWebhook(id, active) {
  const { error } = await sb
    .from("webhook_endpoints")
    .update({ active })
    .eq("id", id)
    .eq("company_id", currentCompanyId);
  if (error) { toast("Failed to update webhook", true); return; }
  toast(active ? "Webhook enabled." : "Webhook disabled.");
  loadWebhooks();
}

async function deleteWebhook(id) {
  if (!confirm("Delete this webhook endpoint? This cannot be undone.")) return;
  const { error } = await sb
    .from("webhook_endpoints")
    .delete()
    .eq("id", id)
    .eq("company_id", currentCompanyId);
  if (error) { toast("Failed to delete webhook: " + error.message, true); return; }
  toast("Webhook deleted.");
  loadWebhooks();
}

async function loadWebhookDeliveries() {
  const container = document.getElementById("webhookDeliveriesTable");
  if (!container) return;

  const { data, error } = await sb
    .from("webhook_deliveries")
    .select("*, webhook_endpoints(url)")
    .eq("company_id", currentCompanyId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { container.innerHTML = `<div class="notice">Failed to load deliveries.</div>`; return; }

  if (!data || data.length === 0) {
    container.innerHTML = `<div class="notice">No webhook deliveries yet.</div>`;
    return;
  }

  const rows = data.map((d) => {
    const ts = new Date(d.created_at).toLocaleString();
    const statusColor = d.success ? "var(--green)" : "var(--red, #e74c3c)";
    const url = d.webhook_endpoints?.url || "—";
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px">
      <div style="flex:1;display:flex;gap:12px;align-items:center">
        <span style="color:${statusColor};font-weight:600">${d.response_status || "ERR"}</span>
        <span>${esc(d.event)}</span>
        <span class="muted" style="font-family:monospace;font-size:11px">${esc(url)}</span>
      </div>
      <span class="muted">${ts}</span>
    </div>`;
  }).join("");

  container.innerHTML = rows;
}
