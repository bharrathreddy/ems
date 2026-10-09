-- =========================================================
-- 0009: Fee reminder emails (log, so a family is not reminded twice for the same thing)
-- MySQL 8.0+ / MariaDB 10.3+
-- =========================================================
CREATE TABLE fee_reminder_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id  BIGINT UNSIGNED NOT NULL,
  kind        ENUM('before_due','overdue','manual') NOT NULL,
  due_date    DATE NULL,
  sent_on     DATE NOT NULL,
  to_email    VARCHAR(190) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  sent_by     BIGINT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_frl_student (student_id, kind, sent_on),
  CONSTRAINT fk_frl_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
