-- Add two more feed kinds: 'research' (anthropic.com/research-style publication feeds) and
-- 'customers' (claude.com/customers-style case-study feeds — proof points by vertical, the
-- enterprise-AE gold). Feeds stay SEPARATE per kind (no super-feed); these get their own columns.
ALTER TABLE feed_items   DROP CONSTRAINT IF EXISTS feed_items_kind_check;
ALTER TABLE feed_items   ADD  CONSTRAINT feed_items_kind_check
    CHECK (kind IN ('news', 'blog', 'event', 'financial', 'research', 'customers'));

ALTER TABLE feed_digests DROP CONSTRAINT IF EXISTS feed_digests_kind_check;
ALTER TABLE feed_digests ADD  CONSTRAINT feed_digests_kind_check
    CHECK (kind IN ('news', 'blog', 'event', 'financial', 'research', 'customers'));
