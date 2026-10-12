-- 087 — second client email (Ramon, 12/10/26)
--
-- Some clients (couples, a house owner + a property manager) want
-- everything the app sends to reach two addresses. jobs.client_email stays
-- the main one — it's the DocuSign signer; client_email_2 is optional and
-- gets every email too (estimate, change order, invoice, receipt, visit
-- notice) plus a copy of the signed contract.

alter table public.jobs add column if not exists client_email_2 text;
