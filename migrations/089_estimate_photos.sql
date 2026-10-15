-- 089 — photos & PDF pages on estimates (Inácio, 15/10/26)
--
-- Photos can go inside each section (stored in sections[i].photos — the
-- sections column is already jsonb, no change) and in a "Photos &
-- references" gallery at the end of the estimate (this column).
-- A PDF (plan, drawing, supplier sheet) is turned into one image per page
-- when it's added, so every entry here is an image:
--   [{ id, url, caption, kind: 'photo' | 'pdf_page', source, page, pages }]
-- Shown on the client page and in the downloaded PDF; not on the contract.

alter table public.estimates add column if not exists photos jsonb not null default '[]'::jsonb;
