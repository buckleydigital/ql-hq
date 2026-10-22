// Everything we actually know about a client, and nothing invented. The
// onboarding form is the source: a blank field is left out rather than filled
// with a plausible guess, because a guess reads as fact in finished ad copy.
type Row = Record<string, unknown>;

export function briefFacts(c: Row): string[] {
  const profile = (c.dfy_profile || {}) as Row;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = profile[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const facts: string[] = [];
  const add = (label: string, v: unknown) => {
    if (v != null && String(v).trim()) facts.push(`${label}: ${String(v).trim().slice(0, 1200)}`);
  };
  add("Business name", c.name);
  add("Industry", c.niche || pick("industry"));
  add("Service area", c.service_area || pick("service_location"));
  add("Service radius", pick("service_radius"));
  add("Website", c.website_url);
  add("Current offers or promotions", pick("special_offers"));
  add("Products and brands they install", pick("products_brands"));
  add("Anything else they told us", pick("additional_info"));
  add("Reviews and testimonials they gave us (quote only these, word for word)", c.client_testimonials);
  add("Max daily ad spend", c.max_daily_ad_spend);
  return facts;
}

/** The brief as prompt text, with the team's note for this client counted as part of it. */
export function briefText(c: Row, note?: string | null): string {
  const facts = briefFacts(c);
  const n = String(note ?? c.creative_note ?? "").trim().slice(0, 2000);
  return [
    facts.length ? facts.map((f) => `  - ${f}`).join("\n") : "  - (No onboarding detail captured yet)",
    n ? `\nFROM OUR TEAM ABOUT THIS CLIENT (part of the brief):\n${n}` : "",
  ].join("\n");
}
