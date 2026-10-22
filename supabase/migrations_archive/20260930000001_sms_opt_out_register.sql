-- An SMS opt-out register, keyed by phone number.
--
-- Until now an opt-out was only a flag on a lead row (leads.sms_opted_out).
-- That left real gaps, each a way to text someone who had replied STOP:
--
--   * a STOP from a number with no lead in the company was recorded nowhere
--     (flagOptOutIfKeyword only updated a lead it could find) - which is every
--     agency lead first contacted from ql-mc;
--   * several early returns in twilio-inbound-sms (no SMS credits, AI switched
--     off for the lead) returned before the STOP handling ran;
--   * the public API's send and the welcome SMS never checked at all;
--   * a STOP given to ql-mc never reached here.
--
-- The register is the source of truth, per company (an opt-out is from that
-- sender, not from every business on the platform). The leads flag is kept in
-- step with it for the dashboard. Every sender asks sms_is_opted_out() before
-- sending; every STOP/START goes through sms_set_opt_out().

create or replace function public.norm_au_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null then null
    else (
      select case
        when v like '04%'  then '+61' || substr(v, 2)
        when v like '614%' then '+' || v
        when v like '61%'  then '+' || v
        else v
      end
      from (select regexp_replace(p, '[\s\-().]', '', 'g') as v) s
    )
  end
$$;

create table if not exists public.sms_opt_outs (
  company_id  uuid        not null,
  phone       text        not null,  -- E.164, via norm_au_phone()
  opted_out   boolean     not null default true,
  -- sms-reply, ql-mc, manual, backfill: where the latest change came from.
  source      text,
  updated_at  timestamptz not null default now(),
  primary key (company_id, phone)
);

alter table public.sms_opt_outs enable row level security;
alter table public.sms_opt_outs force  row level security;
revoke all on table public.sms_opt_outs from public, anon, authenticated;
grant all  on table public.sms_opt_outs to service_role;

-- Everyone already opted out on a lead row goes into the register now.
insert into public.sms_opt_outs (company_id, phone, opted_out, source, updated_at)
select distinct on (l.company_id, public.norm_au_phone(l.phone))
       l.company_id, public.norm_au_phone(l.phone), true, 'backfill', coalesce(l.sms_opted_out_at, now())
  from public.leads l
 where l.sms_opted_out = true and l.phone is not null and l.company_id is not null
on conflict (company_id, phone) do nothing;

-- True if this number must not be texted by this company: in the register, or
-- flagged on any of the company's leads with that number.
create or replace function public.sms_is_opted_out(p_company_id uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.sms_opt_outs o
            where o.company_id = p_company_id
              and o.phone = public.norm_au_phone(p_phone)
              and o.opted_out
         )
      or exists (
           select 1 from public.leads l
            where l.company_id = p_company_id
              and l.sms_opted_out = true
              and public.norm_au_phone(l.phone) = public.norm_au_phone(p_phone)
         )
$$;

-- Record a STOP (true) or START (false) for a number, and bring every lead of
-- the company with that number into line.
create or replace function public.sms_set_opt_out(
  p_company_id uuid, p_phone text, p_opted_out boolean, p_source text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := public.norm_au_phone(p_phone);
begin
  if p_company_id is null or v_phone is null or v_phone = '' then
    return;
  end if;
  insert into public.sms_opt_outs (company_id, phone, opted_out, source, updated_at)
  values (p_company_id, v_phone, p_opted_out, p_source, now())
  on conflict (company_id, phone)
  do update set opted_out = excluded.opted_out, source = excluded.source, updated_at = now();

  update public.leads
     set sms_opted_out    = p_opted_out,
         sms_opted_out_at = case when p_opted_out then now() else null end
   where company_id = p_company_id
     and public.norm_au_phone(phone) = v_phone
     and sms_opted_out is distinct from p_opted_out;
end;
$$;

revoke all on function public.sms_is_opted_out(uuid, text)                from public, anon, authenticated;
revoke all on function public.sms_set_opt_out(uuid, text, boolean, text)  from public, anon, authenticated;
grant execute on function public.sms_is_opted_out(uuid, text)               to service_role;
grant execute on function public.sms_set_opt_out(uuid, text, boolean, text) to service_role;
