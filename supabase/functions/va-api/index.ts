// =============================================================================
// va-api - DEPRECATED. Forwards to team-api.
// =============================================================================
// The panel was renamed from "VA" to "Internal Team", and this function moved
// with it. This shim exists because renaming a Supabase function does not
// un-deploy the old one: `va-api` stays live at its URL until it is explicitly
// deleted, and the code previously deployed there reads columns the rename
// migration has already renamed away (is_va, va_assignments, va_intro_done).
// Left alone it would answer a browser holding a cached page with 500s.
//
// So: deploy this over the old `va-api` at the same time as `team-api`, and a
// stale page keeps working instead of breaking. Once the dashboards have turned
// over, `supabase functions delete va-api` and delete this directory.
//
// It forwards rather than reimplementing anything. Every auth and authorisation
// decision is team-api's, made against the caller's own Authorization header,
// which is passed straight through. This shim grants nothing and checks
// nothing - it cannot, and must not, become a second place where access is
// decided.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Same project, same gateway - swap the function name in the path we were
  // called on rather than rebuilding the URL from environment variables, so
  // this keeps working on any project or custom domain.
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/\/va-api(\/|$)/, "/team-api$1");

  try {
    const res = await fetch(url.toString(), {
      method: req.method,
      // Headers are forwarded verbatim: the Authorization header is the
      // caller's own JWT, and team-api resolves who they are from it.
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") || "application/json",
        // So a stale caller is visible in logs rather than silently supported
        // forever.
        "Deprecation": "true",
        "Link": '</functions/v1/team-api>; rel="successor-version"',
      },
    });
  } catch (e) {
    console.error("va-api shim could not reach team-api:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: "This endpoint has moved to team-api. Please reload the page." }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
