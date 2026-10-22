-- Extend is_ppl to also cover source = 'QuoteLeads PPL' (case-insensitive).
-- Both 'PPL' and 'QuoteLeads PPL' leads are Pay-Per-Lead and should be
-- disputable and count towards PPL orders.

create or replace function public.sync_is_ppl_from_source()
returns trigger
language plpgsql
as $$
begin
  NEW.is_ppl := lower(NEW.source) in ('ppl', 'quoteleads ppl');
  return NEW;
end;
$$;

-- Backfill any existing 'QuoteLeads PPL' leads that have is_ppl = false
update public.leads
set is_ppl = true
where lower(source) = 'quoteleads ppl' and is_ppl = false;
