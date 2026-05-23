# Database Cleanup — Managed Advertising Removal

The following database columns and migration files exist solely to support managed
advertising (Admatic, Meta Ads, Google Ads) and the onboarding wizard. The application
code no longer references them. Review and drop them at your convenience — do NOT drop
without a recent backup.

---

## Migration files to delete (or leave in place — they're already applied)

| File | Purpose |
|------|---------|
| `supabase/migrations/20260522000002_advertising_system.sql` | `has_advertising_system`, `advertising_system_purchased_at` |
| `supabase/migrations/20260522000007_onboarding_fulfillment.sql` | Onboarding wizard columns, ad copy, landing page URLs |
| `supabase/migrations/20260522000008_campaign_tracking.sql` | Meta/Google campaign IDs, campaign_status |
| `supabase/migrations/20260522000011_campaign_preview.sql` | Creative regeneration tracking |

---

## Columns to drop from `public.companies`

```sql
-- From 20260522000002_advertising_system.sql
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS has_advertising_system,
  DROP COLUMN IF EXISTS advertising_system_purchased_at;

-- From 20260522000007_onboarding_fulfillment.sql
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS onboarding_completed,
  DROP COLUMN IF EXISTS lead_goals,
  DROP COLUMN IF EXISTS max_daily_ad_spend,
  DROP COLUMN IF EXISTS meta_ad_account_id,
  DROP COLUMN IF EXISTS google_ads_customer_id,
  DROP COLUMN IF EXISTS onboarding_images,
  DROP COLUMN IF EXISTS generated_page_url,
  DROP COLUMN IF EXISTS generated_page_repo,
  DROP COLUMN IF EXISTS generated_ad_copy;

-- NOTE: website_url (also in 20260522000007) may be used elsewhere — verify before dropping.

-- From 20260522000008_campaign_tracking.sql
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS meta_page_id,
  DROP COLUMN IF EXISTS meta_campaign_id,
  DROP COLUMN IF EXISTS meta_ad_set_ids,
  DROP COLUMN IF EXISTS meta_ad_ids,
  DROP COLUMN IF EXISTS google_campaign_id,
  DROP COLUMN IF EXISTS google_ad_group_id,
  DROP COLUMN IF EXISTS campaign_status,
  DROP COLUMN IF EXISTS campaigns_created_at;

-- From 20260522000011_campaign_preview.sql
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS creative_regeneration_count,
  DROP COLUMN IF EXISTS creative_last_regenerated_at;
```

---

## Supabase Edge Functions — already deleted from repo

These directories have been removed from `supabase/functions/`:

- `manage-campaign`
- `approve-campaign`
- `regenerate-creatives`
- `generate-hooks`
- `generate-fulfillment`
- `create-advert-upgrade-checkout`
- `create-advertising-checkout`
- `create-google-campaign`
- `create-meta-campaign`

You will need to **delete them from the Supabase Dashboard** (Functions → select each → Delete)
if they have been previously deployed there.

The `notify-internal` and `provision-twilio` functions are still used by other features
(AI SMS) — do NOT delete them.

---

## Environment variables / secrets to review

Check the Supabase Dashboard → Project Settings → Edge Functions secrets for any keys
related to:

- Admatic API key / token
- Meta (Facebook) API token / App secret
- Google Ads API credentials
- Any ad platform webhook signing secrets

These are not stored in `.env.example` and must be removed manually from the Supabase
secrets store.
