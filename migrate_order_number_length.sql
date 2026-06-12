-- Widen orders.order_number to fit the new "ORD-{vendorId}-{date}-{seq}" format
-- (e.g. "ORD-12-20260612-0001"), and to leave headroom for future formats.
-- MODIFY COLUMN is safe to run repeatedly (idempotent).
ALTER TABLE orders MODIFY order_number VARCHAR(40) NOT NULL;
