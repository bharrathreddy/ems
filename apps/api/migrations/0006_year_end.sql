-- =========================================================
-- 0006: Year-end (promotion remarks) and fee waivers for closed years
-- MySQL 8.0+ / MariaDB 10.4+
-- =========================================================

-- Why a student was detained or left (shown in the student's History).
ALTER TABLE enrollments ADD COLUMN remarks VARCHAR(255) NULL AFTER status;

-- Waivers write off unpaid old-year dues without changing the fee or any receipt.
-- Fee = Paid + Waived + Still due, enforced by the database.
-- ix_fi_balance also serves the academic year foreign key, so give that key its own index first.
ALTER TABLE fee_items ADD INDEX ix_fi_year (academic_year_id);
ALTER TABLE fee_items DROP INDEX ix_fi_balance;
ALTER TABLE fee_items DROP COLUMN balance;
ALTER TABLE fee_items ADD COLUMN waived_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER paid_amount;
ALTER TABLE fee_items ADD COLUMN balance DECIMAL(12,2) GENERATED ALWAYS AS (amount - paid_amount - waived_amount) STORED AFTER waived_amount;
ALTER TABLE fee_items ADD INDEX ix_fi_balance (academic_year_id, balance);
ALTER TABLE fee_items ADD CONSTRAINT chk_fi_settled CHECK (waived_amount >= 0 AND paid_amount + waived_amount <= amount);

CREATE TABLE fee_waivers (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id        BIGINT UNSIGNED NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,     -- the closed year whose dues are waived
  amount            DECIMAL(12,2) NOT NULL,
  reason            VARCHAR(255) NOT NULL,
  created_by        BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_waiver_student (student_id, academic_year_id),
  CONSTRAINT fk_waiver_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_waiver_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_waiver_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_waiver_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fee_waiver_items (
  waiver_id    BIGINT UNSIGNED NOT NULL,
  fee_item_id  BIGINT UNSIGNED NOT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (waiver_id, fee_item_id),
  CONSTRAINT fk_wi_waiver FOREIGN KEY (waiver_id) REFERENCES fee_waivers(id),
  CONSTRAINT fk_wi_item FOREIGN KEY (fee_item_id) REFERENCES fee_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
