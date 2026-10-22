// The ad rules check: every line that will run, read against the rules that
// get ads rejected or accounts restricted, and Australian consumer law. Lines
// that must change come back rewritten (within their length limit, and
// re-checked here before they are used); judgement calls are flagged for a
// person and left alone.
//
// Callers hand in numbered lines and get back what to change; where a line
// lives (the studio's copy, or one ad in a preview round) is theirs to know.
import Anthropic from "npm:@anthropic-ai/sdk@0";
import { z } from "npm:zod@4";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0/helpers/zod";
import { FALLBACK_BETA, MODEL } from "./claude.ts";
import { briefText } from "./brief.ts";

// Where a line lives, and the most characters it may have there.
export const LIMITS: Record<string, number> = {
  meta_headline: 40, meta_primary_text: 600, meta_description: 200,
  image_headline: 45, image_subline: 70, image_cta: 22,
  google_headline: 30, google_long_headline: 90, google_description: 90,
};
export type Where = keyof typeof LIMITS;
export type Line = { where: Where; index: number; text: string };
type Issue = Record<string, unknown> & { where: Where; index: number; severity: string; rewrite: string; text: string };

const PolicySchema = z.object({
  issues: z.array(z.object({
    where: z.enum(["meta_headline", "meta_primary_text", "meta_description", "image_headline", "image_subline",
      "image_cta", "google_headline", "google_long_headline", "google_description"]),
    index: z.number().describe("The line's index exactly as given in the list"),
    severity: z.enum(["must_fix", "check"]).describe("must_fix: would be rejected or is untrue or unsupported by the brief. check: a judgement call for a person"),
    rule: z.string().describe("The rule, in a few words"),
    reason: z.string().describe("One sentence on what is wrong"),
    rewrite: z.string().describe("A compliant replacement within the same character limit, or empty if a person has to decide"),
  })),
  special_ad_category: z.enum(["none", "financial_products_and_services"])
    .describe("financial_products_and_services if any line promotes finance, payment plans, $0 deposit or interest free"),
  summary: z.string().describe("Two sentences for the team: is this safe to send, and what needs a person"),
});

const SYSTEM = [
  "You check ad copy for Australian home services businesses (solar, batteries, air conditioning, trades) before it runs on Meta and Google.",
  "Flag a line only when it breaks one of these. Most lines will be fine; do not flag style preferences.",
  "",
  "MUST FIX (would be rejected, or is untrue):",
  "- States a fact that is not in the brief: a price, saving, rebate amount, discount, guarantee, timeframe, rating, review count, years in business, accreditation or award.",
  "- Meta personal attributes: asserts or implies the reader's personal characteristics, such as their finances, debt, health or age ('Are you struggling to pay your bills?', 'Behind on payments?'). Talking about the product is fine ('Lower your power bills').",
  "- Implies a government endorsement or that the business is a government program, or names a rebate or scheme that the brief does not mention.",
  "- Unrealistic or absolute outcomes ('never pay for power again', 'eliminate your bill', 'guaranteed savings'), or claims of being best, cheapest or number one.",
  "- 'Free' or 'no cost' unless the brief says so. Invented urgency or scarcity ('only 3 left', 'ends tonight').",
  "- Google editorial: an exclamation mark in a headline, repeated punctuation, gimmicky capitals, a phone number or 'click here'.",
  "- Any em dash or en dash.",
  "",
  "CHECK (a person decides; leave rewrite empty unless a clearly better line exists):",
  "- Savings or rebate wording that is true to the brief but may need the conditions stated.",
  "- Finance, payment plans, $0 deposit or interest free: also set special_ad_category, because Meta then limits targeting.",
  "- Anything else that could reasonably be questioned by Meta's review.",
  "",
  "A rewrite keeps the line's angle and meaning, keeps to its character limit, uses Australian English and sentence case, and invents nothing.",
  "Refer to a line by its where and index exactly as given.",
].join("\n");

// Checks that need no judgement, so they are never left to the model.
function mechanicalIssues(lines: Line[]): Issue[] {
  const out: Issue[] = [];
  for (const l of lines) {
    const max = LIMITS[l.where];
    if (l.text.length > max) out.push({ ...l, severity: "must_fix", rule: "Length limit", reason: `${l.text.length} characters, the limit is ${max}.`, rewrite: "" });
    if (/[–—―]/.test(l.text)) out.push({ ...l, severity: "must_fix", rule: "House style", reason: "Contains a dash we never use.", rewrite: "" });
    if (l.where.startsWith("google") && /!/.test(l.text) && l.where !== "google_description") {
      out.push({ ...l, severity: "must_fix", rule: "Google punctuation", reason: "Google rejects an exclamation mark in a headline.", rewrite: "" });
    }
  }
  return out;
}

// A rewrite is only used if it is itself clean.
const usableRewrite = (where: Where, t: string) =>
  !!t.trim() && t.length <= LIMITS[where] && !/[–—―]/.test(t) &&
  !(where.startsWith("google") && where !== "google_description" && t.includes("!"));

export type PolicyResult = {
  /** Lines to replace, keyed "where:index", when apply was asked for. */
  rewrites: Map<string, string>;
  /** What to keep on record and show the team. */
  record: Record<string, unknown>;
};

/** Check the lines for one client. Throws on an API failure or a refusal. */
export async function runPolicy(company: Record<string, unknown>, lines: Line[], opts: { apply: boolean; actor: string }): Promise<PolicyResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on this project");
  const user = [
    "BRIEF (everything we know about this business; anything not here is unsupported):",
    briefText(company),
    "",
    "LINES TO CHECK (where, index, character limit, text):",
    lines.map((l) => `  - ${l.where} ${l.index} (max ${LIMITS[l.where]}): ${JSON.stringify(l.text)}`).join("\n"),
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(PolicySchema), effort: "high" },
    fallbacks: "default",
  } as Parameters<typeof client.messages.parse>[0], FALLBACK_BETA);
  if (res.stop_reason === "refusal") throw new Error(`The model declined this request: ${res.stop_details?.explanation || "no reason given"}`);
  const parsed = res.parsed_output as z.infer<typeof PolicySchema> | null;
  if (!parsed) throw new Error("The check returned nothing usable. Try again.");

  // Only issues that point at a real line count; the model's and the
  // mechanical ones are merged.
  const known = new Map(lines.map((l) => [`${l.where}:${l.index}`, l]));
  const issues: Issue[] = [
    ...parsed.issues.filter((i) => known.has(`${i.where}:${i.index}`))
      .map((i) => ({ ...i, text: known.get(`${i.where}:${i.index}`)!.text })),
    ...mechanicalIssues(lines),
  ];

  // One rewrite per line. A mechanical issue on a line the model rewrote is
  // fixed by that rewrite, because the rewrite itself passed usableRewrite.
  const rewrites = new Map<string, string>();
  if (opts.apply) {
    for (const i of issues) {
      const key = `${i.where}:${i.index}`;
      if (i.severity !== "must_fix" || rewrites.has(key) || !usableRewrite(i.where, String(i.rewrite || ""))) continue;
      rewrites.set(key, i.rewrite);
    }
  }
  const final = issues.map((i) => {
    const key = `${i.where}:${i.index}`;
    return { ...i, applied: rewrites.has(key) && i.severity === "must_fix", now: rewrites.get(key) ?? i.text };
  });
  return {
    rewrites,
    record: {
      checked_at: new Date().toISOString(),
      checked_by: opts.actor,
      model: MODEL,
      lines_checked: lines.length,
      summary: parsed.summary,
      special_ad_category: parsed.special_ad_category,
      issues: final,
      fixed: rewrites.size,
      must_fix_open: final.filter((i) => i.severity === "must_fix" && !i.applied).length,
      to_check: final.filter((i) => i.severity === "check").length,
    },
  };
}
