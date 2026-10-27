-- A pack can be finished before the client's Meta access is in. It waits as
-- awaiting_access, and the creative-rounds autopilot puts it into their ad
-- account once the ad account and Page are connected.
alter table public.creative_rounds drop constraint creative_rounds_status_check;
alter table public.creative_rounds add constraint creative_rounds_status_check CHECK ((status = ANY (ARRAY[
  'building'::text, 'drawing'::text, 'awaiting_access'::text, 'team_review'::text, 'preparing'::text,
  'sent'::text, 'approved'::text, 'changes_requested'::text, 'superseded'::text])));
