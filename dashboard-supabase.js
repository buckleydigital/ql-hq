// =============================================================================
// QuoteLeadsHQ — Dashboard Client
// =============================================================================
// Handles auth, page navigation, and the Conversations UI.
// Loaded by dashboard.html via <script defer src="./dashboard-supabase.js">
// =============================================================================

const SUPABASE_URL = "https://wjadekgptkstfdootuol.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqYWRla2dwdGtzdGZkb290dW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTc3NzQsImV4cCI6MjA5MDU3Mzc3NH0.g45wqe_F9KHh3TVzkq8LimxxT4UiuTZpJZcWkzzD7IM";

let sb; // supabase client
let currentUser = null;
let currentCompanyId = null;
let currentConversationId = null;
let currentLeadId = null;
let messagesSubscription = null;

// ─── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Wait for supabase-js to load (deferred script)
  await waitFor(() => window.supabase);
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Auth state
  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      currentUser = session.user;
      showApp();
    } else {
      currentUser = null;
      showAuth();
    }
  });

  // Check existing session
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    showApp();
  } else {
    showAuth();
  }

  // Login form
  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) toast(error.message, true);
  });

  // Logout
  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  // Page navigation
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });
  document.querySelectorAll("[data-page-link]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.pageLink));
  });

  // Sidebar toggle
  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.getElementById("appView")?.classList.toggle("collapsed");
  });

  // CRM submenu toggle
  document.getElementById("crmToggle")?.addEventListener("click", () => {
    document.getElementById("crmSubmenu")?.classList.toggle("closed");
  });

  // Theme toggle
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = isDark ? "" : "dark";
    localStorage.setItem("theme", isDark ? "light" : "dark");
  });
  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }

  // Conversation send form
  document.getElementById("convSendForm")?.addEventListener("submit", handleSendMessage);

  // AI toggle for lead
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

async function showApp() {
  document.getElementById("authView")?.classList.add("hidden");
  document.getElementById("appView")?.classList.remove("hidden");

  // Load profile
  const { data: profile } = await sb
    .from("profiles")
    .select("company_id, full_name, role, user_type")
    .eq("id", currentUser.id)
    .single();

  if (profile) {
    currentCompanyId = profile.company_id;
    document.getElementById("sidebarAccountName").textContent = profile.full_name || currentUser.email;
    document.getElementById("sidebarAccountMeta").textContent = currentUser.email;
    const initials = (profile.full_name || currentUser.email || "??")
      .split(/[\s@]/).map(s => s[0]?.toUpperCase() || "").join("").slice(0, 2);
    document.getElementById("sidebarAvatar").textContent = initials;
  }

  // Load company name
  const { data: company } = await sb
    .from("companies")
    .select("name")
    .eq("id", currentCompanyId)
    .single();
  if (company?.name) {
    document.getElementById("brandCompanyName").textContent = company.name;
  }
}

function navigateTo(page) {
  // Update nav
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  document.querySelectorAll(".sub-item[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  // Show page
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove("hidden");

  // Update header
  const titles = {
    dashboard: ["Dashboard", "A live view of your lead and pipeline workspace."],
    leads: ["Leads", "Capture name, email, phone, and custom fields."],
    opportunities: ["Opportunities", "Pipeline board with drag-and-drop stages."],
    quotes: ["Quotes", "Quoted opportunities generated from lead status."],
    appointments: ["Appointments", "Scheduled callbacks and site visits."],
    sales: ["Sales", "Closed won and lost totals."],
    conversations: ["Conversations", "SMS threads with leads."],
    "ai-settings": ["AI Settings", "Manage prompt, Twilio numbers, and SMS workflow switches."],
    "general-settings": ["Settings", "Company and account configuration."],
    "sales-reps": ["Sales Reps", "Manage team members and visibility."],
  };
  const [title, sub] = titles[page] || [page, ""];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = sub;

  // Load page-specific data
  if (page === "conversations") loadConversations();
}

function toast(msg, isError = false) {
  const wrap = document.getElementById("toastWrap");
  const t = document.createElement("div");
  t.className = `toast${isError ? " err" : ""}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ─── Conversations ──────────────────────────────────────────────────────────

async function loadConversations() {
  const { data: conversations, error } = await sb
    .from("conversations")
    .select("id, lead_id, channel, last_message, last_message_at, is_open, leads(id, first_name, last_name, phone, ai_enabled, ai_score)")
    .eq("channel", "sms")
    .order("last_message_at", { ascending: false });

  const list = document.getElementById("conversationList");
  const empty = document.getElementById("convEmptyState");

  if (error || !conversations?.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }

  empty?.classList.add("hidden");
  list.innerHTML = conversations.map((c) => {
    const lead = c.leads;
    const name = lead ? `${lead.first_name || ""} ${lead.last_name || ""}`.trim() : "Unknown";
    const isActive = c.id === currentConversationId;
    return `<div class="conv-item${isActive ? " active" : ""}" data-conv-id="${c.id}" data-lead-id="${lead?.id || ""}">
      <h3>${escapeHtml(name)}<span class="conv-time">${c.last_message_at ? timeAgo(c.last_message_at) : ""}</span></h3>
      <p>${escapeHtml(c.last_message || "No messages yet")}</p>
    </div>`;
  }).join("");

  // Click handlers
  list.querySelectorAll(".conv-item").forEach((el) => {
    el.addEventListener("click", () => {
      selectConversation(el.dataset.convId, el.dataset.leadId);
      // Update active state
      list.querySelectorAll(".conv-item").forEach((e) => e.classList.remove("active"));
      el.classList.add("active");
    });
  });
}

async function selectConversation(conversationId, leadId) {
  currentConversationId = conversationId;
  currentLeadId = leadId;

  document.getElementById("convDetailEmpty")?.classList.add("hidden");
  document.getElementById("convDetail")?.classList.remove("hidden");

  // Load lead info
  if (leadId) {
    const { data: lead } = await sb
      .from("leads")
      .select("id, first_name, last_name, phone, ai_enabled, ai_score, ai_score_reason")
      .eq("id", leadId)
      .single();

    if (lead) {
      document.getElementById("convLeadName").textContent =
        `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "SMS Lead";
      document.getElementById("convLeadPhone").textContent = lead.phone || "";

      const toggle = document.getElementById("convAiToggle");
      toggle.checked = lead.ai_enabled;
      const status = document.getElementById("convAiStatus");
      status.textContent = lead.ai_enabled ? "ON" : "OFF";
      status.className = `ai-toggle-status ${lead.ai_enabled ? "on" : "off"}`;

      const scoreChip = document.getElementById("convLeadScore");
      scoreChip.textContent = `Score: ${lead.ai_score || 0}`;
      scoreChip.title = lead.ai_score_reason || "No score reason yet";
    }
  }

  // Load messages
  await loadMessages(conversationId);

  // Subscribe to realtime updates
  subscribeToMessages(conversationId);
}

async function loadMessages(conversationId) {
  const { data: messages } = await sb
    .from("messages")
    .select("id, direction, body, is_ai_generated, agent_type, sender_id, created_at, metadata")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  renderMessages(messages || []);
}

function renderMessages(messages) {
  const container = document.getElementById("convMessages");

  if (!messages.length) {
    container.innerHTML = '<div class="empty" style="min-height:200px"><p>No messages in this thread yet.</p></div>';
    return;
  }

  container.innerHTML = messages.map((m) => {
    const dir = m.direction === "inbound" ? "inbound" : "outbound";
    let badge = "";
    if (dir === "outbound") {
      if (m.is_ai_generated) {
        badge = '<span class="msg-badge ai">AI</span>';
      } else {
        badge = '<span class="msg-badge human">Company</span>';
      }
    }

    const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const date = new Date(m.created_at).toLocaleDateString();

    return `<div class="msg ${dir}">
      <div>${escapeHtml(m.body)}</div>
      <div class="msg-meta">${badge}<span>${date} ${time}</span></div>
    </div>`;
  }).join("");

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function subscribeToMessages(conversationId) {
  // Unsubscribe from previous
  if (messagesSubscription) {
    sb.removeChannel(messagesSubscription);
    messagesSubscription = null;
  }

  messagesSubscription = sb
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        // Append the new message
        const m = payload.new;
        const container = document.getElementById("convMessages");
        const emptyState = container.querySelector(".empty");
        if (emptyState) emptyState.remove();

        const dir = m.direction === "inbound" ? "inbound" : "outbound";
        let badge = "";
        if (dir === "outbound") {
          badge = m.is_ai_generated
            ? '<span class="msg-badge ai">AI</span>'
            : '<span class="msg-badge human">Company</span>';
        }

        const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const date = new Date(m.created_at).toLocaleDateString();

        const div = document.createElement("div");
        div.className = `msg ${dir}`;
        div.innerHTML = `<div>${escapeHtml(m.body)}</div><div class="msg-meta">${badge}<span>${date} ${time}</span></div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;

        // Also refresh the conversation list to update last_message
        loadConversations();
      }
    )
    .subscribe();
}

// ─── Send Manual Message ────────────────────────────────────────────────────

async function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById("convMessageInput");
  const body = input.value.trim();
  if (!body || !currentConversationId) return;

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        conversation_id: currentConversationId,
        lead_id: currentLeadId,
        body,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      toast(result.error || "Failed to send", true);
    } else {
      input.value = "";
      // Message will appear via realtime subscription
    }
  } catch (err) {
    toast("Failed to send message", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send";
  }
}

// ─── Toggle AI per Lead ─────────────────────────────────────────────────────

async function handleAiToggle(e) {
  if (!currentLeadId) return;
  const enabled = e.target.checked;

  const status = document.getElementById("convAiStatus");
  status.textContent = enabled ? "ON" : "OFF";
  status.className = `ai-toggle-status ${enabled ? "on" : "off"}`;

  const { error } = await sb
    .from("leads")
    .update({ ai_enabled: enabled })
    .eq("id", currentLeadId);

  if (error) {
    toast("Failed to update AI setting", true);
    e.target.checked = !enabled;
    status.textContent = !enabled ? "ON" : "OFF";
    status.className = `ai-toggle-status ${!enabled ? "on" : "off"}`;
  } else {
    toast(`AI ${enabled ? "enabled" : "disabled"} for this lead`);
  }
}
