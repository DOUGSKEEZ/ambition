-- Add a 'general' feed kind — the catch-all bucket for category-split feeds (e.g. OpenAI's news RSS
-- splits into Company / Research+Product / Safety+Eng+Security, with everything else landing here).
ALTER TABLE feed_items   DROP CONSTRAINT IF EXISTS feed_items_kind_check;
ALTER TABLE feed_items   ADD  CONSTRAINT feed_items_kind_check
    CHECK (kind IN ('news', 'blog', 'event', 'financial', 'research', 'customers', 'general'));

ALTER TABLE feed_digests DROP CONSTRAINT IF EXISTS feed_digests_kind_check;
ALTER TABLE feed_digests ADD  CONSTRAINT feed_digests_kind_check
    CHECK (kind IN ('news', 'blog', 'event', 'financial', 'research', 'customers', 'general'));
