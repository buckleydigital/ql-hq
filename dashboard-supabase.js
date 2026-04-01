// =============================================================================
// QuoteLeadsHQ — Dashboard Client
// =============================================================================

const SUPABASE_URL = "https://wjadekgptkstfdootuol.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqYWRla2dwdGtzdGZkb290dW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTc3NzQsImV4cCI6MjA5MDU3Mzc3NH0.g45wqe_F9KHh3TVzkq8LimxxT4UiuTZpJZcWkzzD7IM";

let sb;
let currentUser = null;
let currentCompanyId = null;
let currentConversationId = null;
let currentLeadId = null;
let messagesSubscription = null;

// ─── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await waitFor(() => window.supabase);
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      currentUser = session.user;
      showApp();
    } else {
      currentUser = null;
      showAuth();
    }
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    showApp();
  } else {
    showAuth();
  }

  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      toast(error.message, true);
    }
  });

  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });

  document.querySelectorAll("[data-page-link]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.pageLink));
  });

  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("appView")?.classList.toggle("collapsed");
  });

  document.getElementById("crmToggle")?.addEventListener("click", () => {
    document.getElementById("crmSubmenu")?.classList.toggle("closed");
  });

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = isDark ? "" : "dark";
    localStorage.setItem("theme", isDark ? "light" : "dark");
  });

  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }

  document.getElementById("convSendForm")?.addEventListener("submit", handleSendMessage);
  document.getElementById("convAiToggle")?.addEventListener("change", handleAiToggle);
});

// ─── Helpers ────────────────────────────────────────────────────────────────
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

function showAuth() {
  document.getElementById("authView")?.classList.remove("hidden");
  document.getElementById("appView")?.classList.add("hidden");
}

// ✅ FIXED FUNCTION
async function showApp() {
  document.getElementById("authView")?.classList.add("hidden");
  document.getElementById("appView")?.classList.remove("hidden");

  // SAFE profile fetch
  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("company_id, full_name, role, user_type")
    .eq("id", currentUser.id)
    .maybeSingle(); // 🔥 FIX

  if (profileError) {
    console.error("Profile error:", profileError);
  }

  if (profile) {
    currentCompanyId = profile.company_id;

    document.getElementById("sidebarAccountName").textContent =
      profile.full_name || currentUser.email;

    document.getElementById("sidebarAccountMeta").textContent =
      currentUser.email;

    const initials = (profile.full_name || currentUser.email || "??")
      .split(/[\s@]/)
      .map(s => s[0]?.toUpperCase() || "")
      .join("")
      .slice(0, 2);

    document.getElementById("sidebarAvatar").textContent = initials;
  }

  // SAFE company fetch
  if (currentCompanyId) {
    const { data: company } = await sb
      .from("companies")
      .select("name")
      .eq("id", currentCompanyId)
      .maybeSingle(); // 🔥 FIX

    if (company?.name) {
      document.getElementById("brandCompanyName").textContent = company.name;
    }
  }
}

// ─── Navigation ─────────────────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  document.querySelectorAll(".sub-item[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));

  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove("hidden");

  const titles = {
    dashboard: ["Dashboard", "A live view of your lead and pipeline workspace."],
    conversations: ["Conversations", "SMS threads with leads."]
  };

  const [title, sub] = titles[page] || [page, ""];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = sub;

  if (page === "conversations") loadConversations();
}

// ─── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, isError = false) {
  const wrap = document.getElementById("toastWrap");
  const t = document.createElement("div");
  t.className = `toast${isError ? " err" : ""}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ─── Conversations (unchanged) ──────────────────────────────────────────────

async function loadConversations() {
  const { data: conversations } = await sb
    .from("conversations")
    .select("id, lead_id, last_message, last_message_at, leads(first_name,last_name)")
    .order("last_message_at", { ascending: false });

  const list = document.getElementById("conversationList");

  if (!conversations?.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = conversations.map((c) => {
    const name = c.leads
      ? `${c.leads.first_name || ""} ${c.leads.last_name || ""}`.trim()
      : "Unknown";

    return `<div class="conv-item">${name}</div>`;
  }).join("");
}

// ─── Send Message ───────────────────────────────────────────────────────────
async function handleSendMessage(e) {
  e.preventDefault();
}

// ─── AI Toggle ──────────────────────────────────────────────────────────────
async function handleAiToggle() {}
