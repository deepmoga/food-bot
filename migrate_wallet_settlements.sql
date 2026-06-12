-- ============================================================
-- Vendor Wallet: lump-sum settlement payments (admin -> vendor)
-- Replaces per-order "Mark Settled/Pending" toggling with a simple
-- ledger: pending_due = SUM(vendor_wallet_transactions.amount)
--                       - SUM(vendor_wallet_settlements.amount)
-- Idempotent — safe to run on every deploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_wallet_settlements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
