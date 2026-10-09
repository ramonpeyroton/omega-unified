-- 085 — Change orders with items and a price format.
--
-- Before: one free-text description + one amount.
-- Now the maker builds a list of items ({ title, details, price }) and picks
-- how the client sees the price:
--   'itemized' = each item shows its own price (amount = sum of the items)
--   'single'   = items listed without prices, one price for all (amount = that price)
--
-- `amount` stays the source of truth for money (job revenue, Finance, TV), and
-- `description` keeps a short summary (the title) for the screens and
-- notifications that already read it. Old rows (items = null) keep working:
-- they render as a single line with their description.

alter table public.change_orders add column if not exists title      text;
alter table public.change_orders add column if not exists items      jsonb;
alter table public.change_orders add column if not exists price_mode text default 'itemized';
