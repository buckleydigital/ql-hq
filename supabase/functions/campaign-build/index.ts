// =============================================================================
// campaign-build - the approved ads become a paused campaign, and its leads
// come into the CRM
// =============================================================================
// Once a client approves a round (creative-approval), the autopilot builds, in
// the client's own ad account:
//
//   form      an instant form on their Page (name, phone, email, postcode and
//             what they need done), set for higher intent
//   campaign  Leads objective, PAUSED
//   ad set    their daily budget, their area, automatic placements, PAUSED
//   ads       one per approved ad, the same images and words the client
//             approved: the 4:5 image in feeds and the 9:16 one in Stories
//             and Reels, as they saw it in the previews
//
// then ticks "Campaign built", tells Mission Control, and emails the team to
// check it and launch. Nothing here ever spends: everything is made paused, and
// switching it on stays a person's job.
//
// A build moves one stage at a time and saves what it made after every call to
// Meta, so a retry carries on rather than building twice (and each stage looks
// for what it was about to make, by name, before making it).
//
// The same autopilot picks up new leads from our forms and delivers each once
// through intake-lead, exactly as any other lead arrives.
//
// Team actions (team login, scoped as in creative-rounds): state,
// save_settings, geo_search, build. self_test (ops and admins): makes a form,
// campaign, ad set and ad in the client's account and deletes them again.
// { action: "autopilot" } with x-autopilot-secret: pg_cron, every 5 minutes;
// { action: "self_test", company_id } with the same secret.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { act, graph } from "../_shared/meta-ads.ts";
import { type Ad, metaIds } from "../_shared/rounds.ts";
import { opsEmail, setStep, SITE } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LIVE = ["queued", "building", "built", "needs_team"];
const STAGES = ["settings", "form", "campaign", "adset", "ads", "register"] as const;
const MAX_ATTEMPTS = 3;
const DEFAULT_RADIUS_KM = 25;
const DEFAULT_AGE_MIN = 25;
const MIN_DAILY_BUDGET = 5;
// Meta labels for the two image shapes in one ad.
const FEED = "ql_feed", STORY = "ql_story";

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;
type Actor = { id: string | null; name: string };
type Place = { key: string; name: string; type: string; radius_km?: number };
type Settings = {
  daily_budget: number | null; locations: Place[]; unplaced: string[]; age_min: number;
  privacy_url: string; website: string | null; special: string[];
  sources: Record<string, string>;
};
type BuildMeta = {
  page_name?: string; form_id?: string; campaign_id?: string; adset_id?: string;
  ads?: Record<string, { creative_id?: string; ad_id?: string; format?: string }>;
  registered?: boolean; leads_after?: number; notes?: string[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({})) as Row;

    const secret = req.headers.get("x-autopilot-secret") || "";
    if (secret) {
      const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: secret });
      if (ok !== true) return json({ error: "unauthorized" }, 401);
      if (body.action === "autopilot") return json(await autopilot(admin));
      // The same check by the system, for a client it names.
      if (body.action === "self_test") {
        const company = await loadCompany(admin, String(body.company_id || ""));
        return company ? json(await selfTest(company)) : json({ error: "Client not found" }, 404);
      }
      return json({ error: "unauthorized" }, 401);
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated" }, 401);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Not authenticated" }, 401);
    const { data: me } = await admin.from("profiles").select("is_team, is_admin, full_name, team_role").eq("id", user.id).maybeSingle();
    const isTeam = me?.is_team === true, isAdmin = me?.is_admin === true;
    const isOps = isTeam && me?.team_role === "ops_manager";
    if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);
    const companyId = String(body.company_id || "");
    if (!companyId) return json({ error: "company_id is required" }, 400);
    if (!(isAdmin || isOps)) {
      const { data: assigned } = await admin.from("team_assignments").select("company_id")
        .eq("team_user_id", user.id).eq("company_id", companyId).maybeSingle();
      if (!assigned) return json({ error: "Forbidden: client not assigned to you" }, 403);
    }
    const company = await loadCompany(admin, companyId);
    if (!company) return json({ error: "Client not found" }, 404);
    const actor: Actor = { id: user.id, name: (me?.full_name as string) || "Internal Team" };

    switch (body.action) {
      case "state":         return json(await state(admin, company));
      case "save_settings": return json(await saveSettings(admin, company, body));
      case "geo_search":    return json({ places: await geoSearch(String(body.q || "")) });
      case "build":         return json(await teamBuild(admin, company, body, actor, isAdmin || isOps));
      case "self_test":
        if (!(isAdmin || isOps)) return json({ error: "Ops managers and admins only" }, 403);
        return json(await selfTest(company));
    }
    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    console.error("campaign-build error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

const COMPANY_COLS = "id, name, plan, niche, service_area, website_url, dfy_profile, max_daily_ad_spend, ad_policy_check, campaign_settings";

async function loadCompany(admin: Admin, id: string): Promise<Row | null> {
  const { data } = await admin.from("companies").select(COMPANY_COLS).eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

const liveBuild = async (admin: Admin, companyId: string) => {
  const { data } = await admin.from("campaign_builds").select("*").eq("company_id", companyId).in("status", LIVE).maybeSingle();
  return (data as Row | null) ?? null;
};

const latestApproved = async (admin: Admin, companyId: string) => {
  const { data } = await admin.from("creative_rounds").select("*").eq("company_id", companyId).eq("status", "approved")
    .order("round", { ascending: false }).limit(1).maybeSingle();
  return (data as Row | null) ?? null;
};

const stepDone = async (admin: Admin, companyId: string, keys: string[]) => {
  const { data } = await admin.from("company_fulfilment").select("step_key").eq("company_id", companyId)
    .in("step_key", keys).in("status", ["done", "skipped"]);
  return (data ?? []).length > 0;
};

const adsManager = (account: string, campaignId?: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account}${campaignId ? `&selected_campaign_ids=${campaignId}` : ""}`;

// ── Settings: the team's choices, else what onboarding told us ─────────────────

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function siteUrl(company: Row): string | null {
  const site = String(company.website_url || "").trim();
  if (!site) return null;
  return /^https?:\/\//i.test(site) ? site : `https://${site.replace(/^\/+/, "")}`;
}

/** Meta's places for some text: towns and postcodes in Australia. */
async function geoSearch(q: string, types = ["city", "zip", "region"]): Promise<Place[]> {
  if (!q.trim()) return [];
  const out = await graph(`search?type=adgeolocation&country_code=AU&limit=6&location_types=${encodeURIComponent(JSON.stringify(types))}&q=${encodeURIComponent(q.trim())}`);
  return ((out.data || []) as Row[]).map((p) => ({
    key: String(p.key), type: String(p.type),
    name: [p.name, p.region].filter(Boolean).join(", "),
  }));
}

async function resolveSettings(company: Row): Promise<Settings> {
  const s = (company.campaign_settings || {}) as Row;
  const dfy = (company.dfy_profile || {}) as Row;
  const sources: Record<string, string> = {};

  let daily_budget = num(s.daily_budget);
  if (daily_budget) sources.daily_budget = "set by the team";
  else if ((daily_budget = num(company.max_daily_ad_spend) ?? num(dfy.max_daily_spend))) sources.daily_budget = "from their onboarding form";

  let locations = Array.isArray(s.locations) ? (s.locations as Place[]).filter((p) => p?.key) : [];
  const unplaced: string[] = [];
  if (locations.length) sources.locations = "set by the team";
  else {
    // Their own words, one place at a time: "Gold Coast, Tweed Heads and 2486".
    const text = String(dfy.service_location || company.service_area || ((dfy.purchase || {}) as Row).service_location || dfy.service_area || "");
    const radius = Math.min(80, Math.max(10, num(s.radius_km) ?? num(dfy.service_radius) ?? DEFAULT_RADIUS_KM));
    const parts = text.split(/[,;\/&\n]|\band\b|\bplus\b/i).map((p) => p.trim()).filter((p) => p.length > 1).slice(0, 8);
    for (const part of parts) {
      // Towns and postcodes only: a whole state is never a guess we make.
      const hit = (await geoSearch(part, ["city", "zip"]).catch(() => []))[0];
      if (hit) locations.push(hit.type === "city" ? { ...hit, radius_km: radius } : hit);
      else unplaced.push(part);
    }
    const seen = new Set<string>();
    locations = locations.filter((p) => !seen.has(p.key) && seen.add(p.key));
    if (locations.length) sources.locations = `from "${text.slice(0, 120)}" in their onboarding`;
  }

  const age = num(s.age_min);
  const special = String(((company.ad_policy_check || {}) as Row).special_ad_category || "none").toUpperCase();
  return {
    daily_budget, locations, unplaced,
    // Meta's Advantage+ audience lets us suggest an age but caps the minimum at 25.
    age_min: Math.min(25, Math.max(18, age ?? DEFAULT_AGE_MIN)),
    privacy_url: String(s.privacy_url || "").trim() || `${SITE}/privacy.html`,
    website: siteUrl(company),
    special: ["HOUSING", "CREDIT", "EMPLOYMENT"].includes(special) ? [special] : [],
    sources,
  };
}

function settingsProblems(st: Settings): string[] {
  const out: string[] = [];
  if (!st.daily_budget) out.push("No daily ad budget. Their onboarding form didn't give one.");
  else if (st.daily_budget < MIN_DAILY_BUDGET) out.push(`A daily budget of $${st.daily_budget} is too low to run.`);
  if (!st.locations.length) out.push(st.unplaced.length ? `Couldn't find their area on Meta: ${st.unplaced.join(", ")}.` : "No service area to target.");
  return out;
}

async function saveSettings(admin: Admin, company: Row, body: Row) {
  const prev = (company.campaign_settings || {}) as Row;
  const next: Row = { ...prev };
  if ("daily_budget" in body) next.daily_budget = num(body.daily_budget);
  if ("age_min" in body) next.age_min = num(body.age_min);
  if ("privacy_url" in body) {
    const u = String(body.privacy_url || "").trim();
    if (u && !/^https:\/\/\S+\.\S+/.test(u)) throw new Error("The privacy policy link must start with https://");
    next.privacy_url = u || null;
  }
  if ("locations" in body) {
    const list = Array.isArray(body.locations) ? body.locations as Row[] : [];
    next.locations = list.filter((p) => p?.key).slice(0, 50).map((p) => ({
      key: String(p.key), name: String(p.name || p.key).slice(0, 120), type: String(p.type || "city"),
      ...(String(p.type || "city") === "city" ? { radius_km: Math.min(80, Math.max(10, num(p.radius_km) ?? DEFAULT_RADIUS_KM)) } : {}),
    }));
  }
  await admin.from("companies").update({ campaign_settings: next }).eq("id", company.id);
  company.campaign_settings = next;
  return await state(admin, company);
}

// ── What the team sees ──────────────────────────────────────────────────────────

async function state(admin: Admin, company: Row) {
  const ids = metaIds(company);
  const [build, approved] = await Promise.all([liveBuild(admin, String(company.id)), latestApproved(admin, String(company.id))]);
  const { data: past } = await admin.from("campaign_builds").select("id, status, created_at, built_at, meta, error")
    .eq("company_id", company.id).in("status", ["failed", "replaced"]).order("created_at", { ascending: false }).limit(5);
  // A built campaign shows what it was built with; otherwise what it would be.
  let settings: Settings | null = null, settingsError: string | null = null;
  try { settings = build?.status === "built" ? build.settings as Settings : await resolveSettings(company); }
  catch (e) { settingsError = (e as Error).message; }
  return {
    ok: true,
    meta: ids ? { ...ids, ads_manager: adsManager(ids.account, (build?.meta as BuildMeta | undefined)?.campaign_id) } : null,
    saved: company.campaign_settings || {},
    settings, settings_error: settingsError,
    problems: settings ? settingsProblems(settings) : [],
    approved_round: approved ? { id: approved.id, round: approved.round, ads: ((approved.ads || []) as Ad[]).length, decided_at: approved.decided_at } : null,
    build, past: past ?? [],
  };
}

// ── Building ────────────────────────────────────────────────────────────────────

async function teamBuild(admin: Admin, company: Row, body: Row, actor: Actor, canOverride: boolean) {
  const companyId = String(company.id);
  const live = await liveBuild(admin, companyId);
  if (live && live.status !== "built") {
    // Carry on from where it stopped, with fresh settings.
    await admin.from("campaign_builds").update({ status: "queued", stage: "settings", attempts: 0, error: null, started_by_name: actor.name, updated_at: new Date().toISOString() }).eq("id", live.id);
  } else {
    if (live && !body.rebuild) throw new Error("This client already has a campaign built. Rebuild to make a new one.");
    let round = await latestApproved(admin, companyId);
    // Ops can build from a round the client hasn't approved, to test.
    if (body.round_id && canOverride) {
      const { data } = await admin.from("creative_rounds").select("*").eq("id", String(body.round_id)).eq("company_id", companyId).maybeSingle();
      round = (data as Row | null) ?? null;
    }
    if (!round) throw new Error("There's no approved round of ads to build from yet.");
    if (live) await admin.from("campaign_builds").update({ status: "replaced", updated_at: new Date().toISOString() }).eq("id", live.id);
    const { error } = await admin.from("campaign_builds").insert({ company_id: companyId, round_id: round.id, status: "queued", started_by_name: actor.name });
    if (error) throw new Error(error.message);
  }
  // Run it now, so the team sees the result in the panel.
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const b = await liveBuild(admin, companyId);
    if (!b || !["queued", "building"].includes(String(b.status))) break;
    await advance(admin, b, actor);
  }
  return await state(admin, company);
}

/** One stage of one build. */
async function advance(admin: Admin, build: Row, actor: Actor): Promise<string> {
  const company = await loadCompany(admin, String(build.company_id));
  if (!company) {
    await admin.from("campaign_builds").update({ status: "failed", error: "Client not found" }).eq("id", build.id);
    return "client gone";
  }
  const meta = { ...((build.meta || {}) as BuildMeta) };
  const save = async (patch: Row) => {
    await admin.from("campaign_builds").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", build.id);
    Object.assign(build, patch);
  };
  const stage = String(build.stage) as (typeof STAGES)[number];
  try {
    const ids = metaIds(company);
    if (!ids) throw new Hold("Their ad account and Facebook Page aren't connected yet.");
    const name = `QuoteLeads | ${company.name} | Leads #${String(build.id).slice(0, 6)}`;

    if (stage === "settings") {
      const settings = await resolveSettings(company);
      const problems = settingsProblems(settings);
      if (problems.length) throw new Hold(problems.join(" "));
      await save({ status: "building", stage: "form", settings });
      return `settings for ${company.name}`;
    }
    const settings = build.settings as Settings;
    const pageToken = await pageAccess(ids.page);

    if (stage === "form") {
      meta.page_name = pageToken.name;
      if (!meta.form_id) meta.form_id = await ensureForm(ids.page, pageToken.token, name, settings, pageToken.name);
      await save({ stage: "campaign", meta });
      return `form for ${company.name}`;
    }
    if (stage === "campaign") {
      meta.campaign_id ??= await findByName(`${act(ids.account)}/campaigns`, name) ?? String((await graph(`${act(ids.account)}/campaigns`, {
        form: {
          name, objective: "OUTCOME_LEADS", status: "PAUSED", buying_type: "AUCTION",
          special_ad_categories: settings.special,
          ...(settings.special.length ? { special_ad_category_country: ["AU"] } : {}),
          is_adset_budget_sharing_enabled: false,
        },
      })).id);
      await save({ stage: "adset", meta });
      return `campaign for ${company.name}`;
    }
    if (stage === "adset") {
      meta.adset_id ??= await findByName(`${meta.campaign_id}/adsets`, name) ?? String((await graph(`${act(ids.account)}/adsets`, {
        form: {
          name, campaign_id: meta.campaign_id, status: "PAUSED",
          daily_budget: Math.round(Number(settings.daily_budget) * 100),
          billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          destination_type: "ON_AD", promoted_object: { page_id: ids.page },
          targeting: targeting(settings),
        },
      })).id);
      await save({ stage: "ads", meta });
      return `ad set for ${company.name}`;
    }
    if (stage === "ads") {
      const { data: round } = await admin.from("creative_rounds").select("ads").eq("id", build.round_id).maybeSingle();
      const ads = (((round as Row | null)?.ads || []) as Ad[]).filter(usable);
      if (!ads.length) throw new Hold("The approved round has no ads in the ad account to use.");
      meta.ads ??= {};
      // One ad per call, saved as it goes.
      const next = ads.find((a) => !meta.ads![a.key]?.ad_id);
      if (next) {
        const n = ads.indexOf(next) + 1;
        const done = meta.ads[next.key] || {};
        if (!done.creative_id) {
          const made = await makeCreative(ids, next, meta.form_id!, settings, `${name} | Ad ${n}`);
          Object.assign(done, made);
          meta.ads[next.key] = done;
          await save({ meta });
        }
        done.ad_id = await findByName(`${meta.adset_id}/ads`, `${name} | Ad ${n}`) ?? String((await graph(`${act(ids.account)}/ads`, {
          form: { name: `${name} | Ad ${n}`, adset_id: meta.adset_id, creative: { creative_id: done.creative_id }, status: "PAUSED" },
        })).id);
        meta.ads[next.key] = done;
        await save({ meta, attempts: 0 });
        return `ad ${n} for ${company.name}`;
      }
      await save({ stage: "register", meta });
      return `ads done for ${company.name}`;
    }
    if (stage === "register") {
      if (!meta.registered) {
        meta.registered = await registerInMc(company, ids.account, meta.campaign_id!, name);
      }
      await save({ status: "built", meta, built_at: new Date().toISOString(), error: null });
      await announce(admin, company, build, settings, ids.account);
      return `built ${company.name}`;
    }
    return "nothing to do";
  } catch (e) {
    let msg = (e as Error).message;
    // Meta makes no ads for an app still in development mode: nothing a retry fixes.
    if (/development mode/i.test(msg)) msg = "Meta won't make ads until the QuoteLeads app is Live (Meta for Developers, App Mode). Everything up to the ads is made and paused.";
    if (e instanceof Hold || /development mode|App Mode/i.test(msg)) {
      const wasHeld = build.status === "needs_team" && build.error === msg;
      await save({ status: "needs_team", error: msg });
      if (!wasHeld) {
        await setStep(admin, String(company.id), "campaign_built", "blocked", msg, { id: null, name: "Automation" });
        await opsEmail(`🟠 ${company.name}'s campaign needs you`,
          `<p>The ads for <strong>${company.name}</strong> are approved, but their campaign can't be built yet:</p><p>${esc(msg)}</p>` +
          `<p>Fix it under <em>Campaign</em> in their creative studio in the Team Panel, then press <em>Build campaign</em>.</p>`);
      }
      return `held ${company.name}`;
    }
    const attempts = Number(build.attempts || 0) + 1;
    console.error("build stage failed", build.id, stage, msg);
    if (attempts >= MAX_ATTEMPTS) {
      await save({ status: "failed", error: `${stage}: ${msg}`, attempts });
      await setStep(admin, String(company.id), "campaign_built", "blocked", `Automatic build failed at ${stage}: ${msg}`, { id: null, name: "Automation" });
      await opsEmail(`🔴 ${company.name}'s campaign didn't build`,
        `<p>Building the campaign for <strong>${company.name}</strong> stopped at <em>${stage}</em> after ${MAX_ATTEMPTS} tries.</p><p>Meta said: ${esc(msg)}</p>` +
        `<p>Anything already made is paused. Press <em>Build campaign</em> in their creative studio to carry on from there, or build it by hand.</p>`);
    } else {
      await save({ status: "building", error: `${stage}: ${msg}`, attempts });
    }
    return `failed ${stage} for ${company.name}`;
  }
}

/** Something a person has to decide or fix before the build can go on. */
class Hold extends Error {}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

const usable = (a: Ad) => a.kind === "video" ? !!(a.meta?.video_id && a.meta?.video_ready) : !!a.meta?.feed_hash;

function targeting(st: Settings) {
  const cities = st.locations.filter((p) => p.type === "city").map((p) => ({ key: p.key, radius: p.radius_km ?? DEFAULT_RADIUS_KM, distance_unit: "kilometer" }));
  const zips = st.locations.filter((p) => p.type === "zip").map((p) => ({ key: p.key }));
  const regions = st.locations.filter((p) => p.type === "region").map((p) => ({ key: p.key }));
  return {
    geo_locations: {
      ...(cities.length ? { cities } : {}), ...(zips.length ? { zips } : {}), ...(regions.length ? { regions } : {}),
      location_types: ["home", "recent"],
    },
    age_min: st.age_min, age_max: 65,
    targeting_automation: { advantage_audience: 1 },
  };
}

async function pageAccess(pageId: string): Promise<{ token: string; name: string }> {
  const out = await graph(`${pageId}?fields=name,access_token`);
  if (!out.access_token) throw new Hold("We can't act for their Facebook Page. Check the Page is shared with QuoteLeads with full control.");
  return { token: String(out.access_token), name: String(out.name || "") };
}

async function findByName(edge: string, name: string, token?: string): Promise<string | null> {
  const filter = encodeURIComponent(JSON.stringify([{ field: "name", operator: "EQUAL", value: name }]));
  const out = await graph(`${edge}?fields=id,name&filtering=${filter}&limit=5`, { token }).catch(() => ({ data: [] }));
  const hit = ((out.data || []) as Row[]).find((r) => r.name === name);
  return hit ? String(hit.id) : null;
}

async function ensureForm(pageId: string, pageToken: string, name: string, st: Settings, pageName: string): Promise<string> {
  // Forms can't be filtered by name, so look through the newest.
  const existing = await graph(`${pageId}/leadgen_forms?fields=id,name&limit=50`, { token: pageToken }).catch(() => ({ data: [] }));
  const hit = ((existing.data || []) as Row[]).find((f) => f.name === name);
  if (hit) return String(hit.id);
  const website = st.website || `https://www.facebook.com/${pageId}`;
  const out = await graph(`${pageId}/leadgen_forms`, {
    token: pageToken,
    form: {
      name,
      questions: [
        { type: "FULL_NAME" }, { type: "PHONE" }, { type: "EMAIL" }, { type: "POST_CODE" },
        { type: "CUSTOM", key: "job_details", label: "What do you need done?" },
      ],
      privacy_policy: { url: st.privacy_url, link_text: "Privacy policy" },
      follow_up_action_url: website,
      thank_you_page: {
        title: "Thanks, we've got your details",
        body: `${pageName || "We"} will be in touch soon.`,
        button_type: st.website ? "VIEW_WEBSITE" : "VIEW_ON_FACEBOOK",
        button_text: st.website ? "Visit our website" : "View our Page",
        website_url: website,
      },
      // "Higher intent": a review step before sending, for fewer junk leads.
      is_optimized_for_quality: true,
    },
  });
  if (!out.id) throw new Error("Meta returned no form id");
  return String(out.id);
}

/**
 * The creative for one approved ad. An image ad carries both shapes and tells
 * Meta which goes where, so it runs as the client saw it; if Meta won't take
 * that, the 4:5 image alone, and the team is told.
 */
async function makeCreative(ids: { account: string; page: string }, ad: Ad, formId: string, st: Settings, name: string): Promise<{ creative_id: string; format: string }> {
  const cta = { type: "GET_QUOTE", value: { lead_gen_form_id: formId } };
  const m = ad.meta || {};
  if (ad.kind === "video") {
    const out = await graph(`${act(ids.account)}/adcreatives`, {
      form: {
        name,
        object_story_spec: {
          page_id: ids.page,
          video_data: { video_id: m.video_id, image_url: m.thumbnail, message: ad.message, title: ad.headline, link_description: ad.description, call_to_action: cta },
        },
      },
    });
    return { creative_id: String(out.id), format: "video" };
  }
  if (m.story_hash) {
    try {
      const out = await graph(`${act(ids.account)}/adcreatives`, { form: { name, ...placementSpec(ids.page, ad, formId) } });
      return { creative_id: String(out.id), format: "feed + stories" };
    } catch (e) {
      console.warn("placement creative refused, using one image:", (e as Error).message);
    }
  }
  const out = await graph(`${act(ids.account)}/adcreatives`, {
    form: {
      name,
      object_story_spec: {
        page_id: ids.page,
        link_data: {
          image_hash: m.feed_hash, link: "http://fb.me/", message: ad.message, name: ad.headline,
          description: ad.description, call_to_action: cta,
        },
      },
    },
  });
  return { creative_id: String(out.id), format: m.story_hash ? "feed image only (Meta crops Stories)" : "feed image" };
}

function placementSpec(pageId: string, ad: Ad, formId: string) {
  const m = ad.meta || {};
  return {
    object_story_spec: { page_id: pageId },
    asset_feed_spec: {
      images: [{ hash: m.feed_hash, adlabels: [{ name: FEED }] }, { hash: m.story_hash, adlabels: [{ name: STORY }] }],
      bodies: [{ text: ad.message }],
      titles: [{ text: ad.headline }],
      descriptions: [{ text: ad.description }],
      link_urls: [{ website_url: "http://fb.me/" }],
      call_to_action_types: ["GET_QUOTE"],
      call_to_actions: [{ type: "GET_QUOTE", value: { lead_gen_form_id: formId } }],
      ad_formats: ["SINGLE_IMAGE"],
      optimization_type: "PLACEMENT",
      asset_customization_rules: [
        {
          customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels"] },
          image_label: { name: STORY }, priority: 1,
        },
        {
          customization_spec: { publisher_platforms: ["facebook", "instagram", "audience_network", "messenger"] },
          image_label: { name: FEED }, priority: 2,
        },
      ],
    },
  };
}

/** Mission Control learns the campaign, so its spend checks and switch see it. */
async function registerInMc(company: Row, account: string, campaignId: string, name: string): Promise<boolean> {
  const url = Deno.env.get("QL_MC_API_URL"), secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) return false;
  try {
    const res = await fetch(`${url}/register-campaign`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-secret": secret },
      body: JSON.stringify({
        hq_company_id: company.id,
        campaign: { meta_campaign_id: campaignId, ad_account_id: account, name, status: "PAUSED", notes: "Built automatically from the client's approved ads." },
      }),
    });
    if (!res.ok) console.warn("register_campaign:", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.warn("register_campaign failed:", (e as Error).message);
    return false;
  }
}

async function announce(admin: Admin, company: Row, build: Row, st: Settings, account: string) {
  const meta = build.meta as BuildMeta;
  const ads = Object.values(meta.ads || {});
  const cropped = ads.filter((a) => a.format?.startsWith("feed image only")).length;
  const where = st.locations.map((p) => p.radius_km ? `${p.name} (+${p.radius_km}km)` : p.name).join("; ");
  const notes = [
    `Campaign ${meta.campaign_id}, ${ads.length} ads, $${st.daily_budget}/day, ${where}. Paused.`,
    cropped ? `${cropped} ad(s) use the feed image everywhere.` : "",
    st.unplaced.length ? `Not targeted (couldn't place): ${st.unplaced.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  await setStep(admin, String(company.id), "campaign_built", "done", notes, { id: null, name: "Automation" });
  await opsEmail(`🟢 ${company.name}'s campaign is built and paused`,
    `<p>The approved ads for <strong>${company.name}</strong> are now a campaign in their ad account, <strong>paused</strong>, ready for you to check and launch.</p>` +
    `<ul><li>Budget: $${st.daily_budget} a day (${st.sources.daily_budget || ""})</li>` +
    `<li>Area: ${esc(where)} (${esc(st.sources.locations || "")})</li>` +
    (st.unplaced.length ? `<li><strong>Not targeted, couldn't find on Meta:</strong> ${esc(st.unplaced.join(", "))}</li>` : "") +
    `<li>Ages ${st.age_min}+, Advantage+ audience and placements</li>` +
    `<li>${ads.length} ads with our instant form (name, phone, email, postcode, the job). Leads go straight into their CRM.</li>` +
    (cropped ? `<li>${cropped} ad(s) couldn't carry the Stories image, so Meta will crop the feed image there.</li>` : "") +
    `</ul><p><a href="${adsManager(account, meta.campaign_id)}">Open it in Ads Manager</a></p>`);
}

// ── Autopilot ───────────────────────────────────────────────────────────────────

async function autopilot(admin: Admin) {
  const started = Date.now();
  const done: string[] = [];
  done.push(...await queueApproved(admin));
  // Builds a stage at a time, oldest first; one that fails waits for the next run.
  const failed = new Set<string>();
  while (Date.now() - started < 50_000) {
    const { data } = await admin.from("campaign_builds").select("*").in("status", ["queued", "building"]).order("updated_at").limit(10);
    const build = ((data ?? []) as Row[]).find((b) => !failed.has(String(b.id)));
    if (!build) break;
    const did = await advance(admin, build, { id: null, name: "Automation" });
    if (did.startsWith("failed")) failed.add(String(build.id));
    done.push(did);
  }
  const leads = await pickUpLeads(admin, started);
  return { ok: true, done, leads };
}

/** Approved, managed, never built: queue a build. Clients built by hand are left alone. */
async function queueApproved(admin: Admin): Promise<string[]> {
  const out: string[] = [];
  const { data: rounds } = await admin.from("creative_rounds").select("id, company_id, round").eq("status", "approved")
    .order("decided_at", { ascending: false }).limit(50);
  const seen = new Set<string>();
  for (const r of (rounds ?? []) as Row[]) {
    const cid = String(r.company_id);
    if (seen.has(cid)) continue;
    seen.add(cid);
    const { count } = await admin.from("campaign_builds").select("id", { count: "exact", head: true }).eq("company_id", cid);
    if (count) continue;
    const { data: co } = await admin.from("companies").select("plan").eq("id", cid).maybeSingle();
    if ((co as Row | null)?.plan !== "managed") continue;
    if (await stepDone(admin, cid, ["campaign_built", "ads_live"])) continue;
    const { error } = await admin.from("campaign_builds").insert({ company_id: cid, round_id: r.id, status: "queued", started_by_name: "Automation" });
    if (!error) out.push(`queued ${cid}`);
  }
  return out;
}

// ── Leads from our forms ────────────────────────────────────────────────────────

async function pickUpLeads(admin: Admin, started: number) {
  let found = 0, delivered = 0;
  const { data: builds } = await admin.from("campaign_builds").select("id, company_id, meta").in("status", ["built", "replaced"])
    .not("meta->>form_id", "is", null);
  const tokens = new Map<string, string>();
  for (const b of (builds ?? []) as Row[]) {
    if (Date.now() - started > 100_000) break;
    const meta = b.meta as BuildMeta;
    try {
      const { data: co } = await admin.from("companies").select("dfy_profile").eq("id", b.company_id).maybeSingle();
      const ids = co ? metaIds(co as Row) : null;
      if (!ids) continue;
      if (!tokens.has(ids.page)) tokens.set(ids.page, (await pageAccess(ids.page)).token);
      const since = Math.max(0, Number(meta.leads_after || 0) - 3600);
      const filter = since ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]))}` : "";
      const out = await graph(`${meta.form_id}/leads?fields=id,created_time,ad_id,field_data&limit=100${filter}`, { token: tokens.get(ids.page) });
      const rows = ((out.data || []) as Row[]).map((l) => ({
        leadgen_id: String(l.id), company_id: b.company_id, build_id: b.id, form_id: meta.form_id,
        ad_id: l.ad_id ? String(l.ad_id) : null, meta_created_at: l.created_time,
        fields: Object.fromEntries(((l.field_data || []) as { name: string; values: string[] }[]).map((f) => [f.name, (f.values || []).join(", ")])),
      }));
      if (rows.length) {
        const { data: fresh } = await admin.from("meta_leads").upsert(rows, { onConflict: "leadgen_id", ignoreDuplicates: true }).select("leadgen_id");
        found += (fresh ?? []).length;
        const newest = Math.max(...rows.map((r) => Date.parse(String(r.meta_created_at)) / 1000).filter(Number.isFinite));
        if (newest > Number(meta.leads_after || 0)) {
          await admin.from("campaign_builds").update({ meta: { ...meta, leads_after: Math.floor(newest) } }).eq("id", b.id);
        }
      }
    } catch (e) {
      console.warn("lead pickup failed for", b.id, (e as Error).message);
    }
  }

  // Deliver what hasn't been, new or retried.
  const { data: waiting } = await admin.from("meta_leads").select("*").is("lead_id", null).lt("attempts", 5).order("created_at").limit(50);
  for (const l of (waiting ?? []) as Row[]) {
    if (Date.now() - started > 130_000) break;
    if (await deliver(admin, l)) delivered++;
  }
  return { found, delivered };
}

async function deliver(admin: Admin, l: Row): Promise<boolean> {
  const f = (l.fields || {}) as Record<string, string>;
  const { full_name, first_name, last_name, phone_number, email, post_code, zip_code, job_details, ...rest } = f;
  const payload = {
    company_id: l.company_id,
    name: full_name || [first_name, last_name].filter(Boolean).join(" ") || "Facebook lead",
    phone: phone_number || undefined, email: email || undefined, postcode: post_code || zip_code || undefined,
    source: "Facebook Lead Ad",
    ...(job_details ? { job_details } : {}), ...rest,
    meta_lead_id: l.leadgen_id, meta_form_id: l.form_id, ...(l.ad_id ? { meta_ad_id: l.ad_id } : {}),
  };
  let leadId: string | null = null, error: string | null = null;
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/intake-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({})) as Row;
    if (res.ok && out.lead_id) leadId = String(out.lead_id);
    else error = String(out.error || `HTTP ${res.status}`);
  } catch (e) {
    error = (e as Error).message;
  }
  await admin.from("meta_leads").update({ lead_id: leadId, error, attempts: Number(l.attempts || 0) + 1 }).eq("leadgen_id", l.leadgen_id);
  if (leadId && !(await stepDone(admin, String(l.company_id), ["first_lead"]))) {
    await setStep(admin, String(l.company_id), "first_lead", "done", "First lead from their Facebook instant form.", { id: null, name: "Automation" });
  }
  return !!leadId;
}

// ── Self-test: make everything once in the client's account, then remove it ─────

async function selfTest(company: Row) {
  const ids = metaIds(company);
  if (!ids) return { ok: false, error: "No ad account and Page for this client" };
  const log: { step: string; ok: boolean; detail?: string }[] = [];
  const made: { campaign?: string; form?: string } = {};
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try { const v = await fn(); log.push({ step: name, ok: true, detail: typeof v === "string" ? v : JSON.stringify(v).slice(0, 300) }); return v; }
    catch (e) { log.push({ step: name, ok: false, detail: (e as Error).message }); return null; }
  };
  const tag = `QL self-test ${new Date().toISOString().slice(0, 16)}`;
  const st = await step("settings", () => resolveSettings(company));
  const settings: Settings = st && st.locations.length && st.daily_budget ? st : {
    daily_budget: 10, locations: [{ key: "", name: "", type: "city" }], unplaced: [], age_min: 25,
    privacy_url: `${SITE}/privacy.html`, website: siteUrl(company), special: [], sources: {},
  };
  if (!settings.locations[0].key) {
    const gc = await step("geo search", () => geoSearch("Gold Coast", ["city"]));
    settings.locations = gc?.length ? [{ ...gc[0], radius_km: 25 }] : [];
  }
  const images = await step("an image in the account", async () => {
    const out = await graph(`${act(ids.account)}/adimages?fields=hash,width,height&limit=10`);
    const list = (out.data || []) as Row[];
    if (!list.length) throw new Error("no images in the ad account to test with");
    return list.map((i) => String(i.hash));
  });
  // Logged by name only: the Page's token never leaves this function.
  let page: { token: string; name: string } | null = null;
  await step("page token", async () => { page = await pageAccess(ids.page); return page.name; });
  if (page && images) {
    const pg = page as { token: string; name: string };
    made.form = await step("form", () => ensureForm(ids.page, pg.token, tag, settings, pg.name)) ?? undefined;
    made.campaign = await step("campaign", async () => String((await graph(`${act(ids.account)}/campaigns`, {
      form: { name: tag, objective: "OUTCOME_LEADS", status: "PAUSED", buying_type: "AUCTION", special_ad_categories: [], is_adset_budget_sharing_enabled: false },
    })).id)) ?? undefined;
    const adset = made.campaign ? await step("ad set", async () => String((await graph(`${act(ids.account)}/adsets`, {
      form: {
        name: tag, campaign_id: made.campaign, status: "PAUSED", daily_budget: 1000,
        billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        destination_type: "ON_AD", promoted_object: { page_id: ids.page }, targeting: targeting(settings),
      },
    })).id)) : null;
    if (made.form && adset) {
      const ad: Ad = {
        key: "t1", kind: "image", message: "Self-test, never runs.", headline: "Self-test", description: "Self-test",
        meta: { feed_hash: images[0], story_hash: images[1] },
      };
      // Meta wants two different images for this; an account with one can't test it.
      const placement = images[1] ? await step("creative, feed + stories", async () =>
        String((await graph(`${act(ids.account)}/adcreatives`, { form: { name: tag, ...placementSpec(ids.page, ad, made.form!) } })).id)) : null;
      const single = await step("creative, one image", async () => (await makeCreative(ids, { ...ad, meta: { feed_hash: images[0] } }, made.form!, settings, `${tag} single`)).creative_id);
      const creative = placement || single;
      if (creative) {
        await step("ad", async () => String((await graph(`${act(ids.account)}/ads`, {
          form: { name: tag, adset_id: adset, creative: { creative_id: creative }, status: "PAUSED" },
        })).id));
      }
      // The campaign goes first: Meta won't delete a creative an ad still uses.
      if (made.campaign) await step("delete campaign", async () => { await graph(made.campaign!, { method: "DELETE", form: {} }); return "deleted"; });
      made.campaign = undefined;
      for (const c of [placement, single].filter(Boolean)) await step(`delete creative ${c}`, async () => { await graph(String(c), { method: "DELETE", form: {} }); return "deleted"; });
    }
    if (made.campaign) await step("delete campaign", async () => { await graph(made.campaign!, { method: "DELETE", form: {} }); return "deleted"; });
    if (made.form) await step("archive form", async () => { await graph(made.form!, { token: pg.token, form: { status: "ARCHIVED" } }); return "archived"; });
  }
  return { ok: log.every((l) => l.ok), log };
}
