-- meta-access-watch assigns our system user to each client's Meta dataset once
-- they share it. meta_dataset_connected is the ID it last connected (so a
-- changed ID is picked up again), meta_dataset_error why it couldn't yet.
-- meta-capi holds sales for a dataset that isn't connected.
alter table public.companies add column if not exists meta_dataset_connected text;
alter table public.companies add column if not exists meta_dataset_error text;
