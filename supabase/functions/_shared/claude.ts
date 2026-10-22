// The model every creative call uses, and the refusal fallback it runs with.
// Ad copy for a real client should not silently come back empty because a
// classifier declined: with the fallback, the API re-runs a declined request
// on the fallback model inside the same call. It is a beta, so `fallbacks` is
// only accepted with this header; messages.parse doesn't pass a `betas` list
// on, so the header goes on each request.
export const MODEL = "claude-opus-5-5";
export const FALLBACK_BETA = { headers: { "anthropic-beta": "server-side-fallback-2026-07-01" } };
