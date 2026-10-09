-- Migration 083: installments follow their contract / agreement.
--
-- payment_milestones.contract_id and sub_payments.agreement_id had no
-- foreign key, so deleting a contract (Void & Revise, Reset job, Delete
-- job) left its installments behind — and they kept adding up in
-- "Receivable" on the Finance Company tab. On 09/10/26 there were 7 such
-- rows ($15,450 open), all from jobs that no longer exist.
--
-- 1. Delete the orphan rows.
-- 2. Add the foreign keys with ON DELETE CASCADE so it can't happen again.
--
-- Idempotent.

DELETE FROM public.payment_milestones m
 WHERE m.contract_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = m.contract_id);

DELETE FROM public.sub_payments p
 WHERE p.agreement_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.subcontractor_agreements a WHERE a.id = p.agreement_id);

ALTER TABLE public.payment_milestones
  DROP CONSTRAINT IF EXISTS payment_milestones_contract_id_fkey;
ALTER TABLE public.payment_milestones
  ADD CONSTRAINT payment_milestones_contract_id_fkey
  FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;

ALTER TABLE public.sub_payments
  DROP CONSTRAINT IF EXISTS sub_payments_agreement_id_fkey;
ALTER TABLE public.sub_payments
  ADD CONSTRAINT sub_payments_agreement_id_fkey
  FOREIGN KEY (agreement_id) REFERENCES public.subcontractor_agreements(id) ON DELETE CASCADE;
