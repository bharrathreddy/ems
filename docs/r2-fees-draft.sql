-- =========================================================
-- R2 SCHEMA: Fees & Receipts   (MySQL 8.4, InnoDB, utf8mb4)
-- =========================================================

-- Plans: yearly (1), half_yearly (2), quarterly (4)
CREATE TABLE fee_plans (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_key           ENUM('yearly','half_yearly','quarterly') NOT NULL,
  name               VARCHAR(50) NOT NULL,
  installment_count  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_key (plan_key),
  CONSTRAINT chk_plan_count CHECK (installment_count IN (1,2,4))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Default tuition plan per academic year (rule F2)
CREATE TABLE academic_year_fee_settings (
  academic_year_id     BIGINT UNSIGNED NOT NULL,
  default_fee_plan_id  BIGINT UNSIGNED NOT NULL,
  updated_by           BIGINT UNSIGNED NULL,
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (academic_year_id),
  CONSTRAINT fk_ayfs_ay   FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ayfs_plan FOREIGN KEY (default_fee_plan_id) REFERENCES fee_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Installment labels and due dates per plan per year (rule F5)
CREATE TABLE plan_installments (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  fee_plan_id       BIGINT UNSIGNED NOT NULL,
  installment_no    TINYINT UNSIGNED NOT NULL,
  label             VARCHAR(30) NOT NULL,     -- 'Q1', 'Term 1', 'Annual'
  due_date          DATE NOT NULL,
  PRIMARY KEY (academic_year_id, fee_plan_id, installment_no),
  CONSTRAINT fk_pi_ay   FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_pi_plan FOREIGN KEY (fee_plan_id) REFERENCES fee_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tuition fee per class per year
CREATE TABLE class_tuition_fees (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (academic_year_id, class_id),
  CONSTRAINT fk_ctf_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ctf_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT chk_ctf_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bus_routes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_route_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Bus fee per route per year (rule F15)
CREATE TABLE route_fees (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  bus_route_id      BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  due_date          DATE NULL,
  PRIMARY KEY (academic_year_id, bus_route_id),
  CONSTRAINT fk_rf_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_rf_route FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id),
  CONSTRAINT chk_rf_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE concession_types (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,     -- 'Sibling', 'Staff child'
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conc_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE one_time_fee_types (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,     -- 'Exam fee', 'Books'
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_otft_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One-time fee charged to a whole class (rules F19 to F22)
CREATE TABLE class_one_time_fees (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id    BIGINT UNSIGNED NOT NULL,
  class_id            BIGINT UNSIGNED NOT NULL,
  one_time_fee_type_id BIGINT UNSIGNED NOT NULL,
  title               VARCHAR(150) NOT NULL,   -- 'SA1 Exam fee'
  amount              DECIMAL(12,2) NOT NULL,
  due_date            DATE NULL,
  created_by          BIGINT UNSIGNED NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_cotf_class (academic_year_id, class_id),
  CONSTRAINT fk_cotf_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_cotf_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_cotf_type  FOREIGN KEY (one_time_fee_type_id) REFERENCES one_time_fee_types(id),
  CONSTRAINT chk_cotf_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per student per academic year: plan, discounts, route.
-- Plan locked after year start (F4); discounts locked after first payment (F10).
CREATE TABLE student_fee_accounts (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id          BIGINT UNSIGNED NOT NULL,
  student_id                BIGINT UNSIGNED NOT NULL,
  fee_plan_id               BIGINT UNSIGNED NOT NULL,
  tuition_gross             DECIMAL(12,2) NOT NULL,         -- copied from class fee
  tuition_discount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  tuition_concession_type_id BIGINT UNSIGNED NULL,
  bus_route_id              BIGINT UNSIGNED NULL,
  bus_gross                 DECIMAL(12,2) NOT NULL DEFAULT 0,
  bus_discount              DECIMAL(12,2) NOT NULL DEFAULT 0,
  bus_concession_type_id    BIGINT UNSIGNED NULL,
  has_payments              TINYINT(1) NOT NULL DEFAULT 0, -- set on first payment, locks discounts
  created_by                BIGINT UNSIGNED NULL,
  updated_by                BIGINT UNSIGNED NULL,
  created_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sfa (academic_year_id, student_id),
  KEY ix_sfa_student (student_id),
  CONSTRAINT fk_sfa_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_sfa_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_sfa_plan    FOREIGN KEY (fee_plan_id) REFERENCES fee_plans(id),
  CONSTRAINT fk_sfa_route   FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id),
  CONSTRAINT fk_sfa_tconc   FOREIGN KEY (tuition_concession_type_id) REFERENCES concession_types(id),
  CONSTRAINT fk_sfa_bconc   FOREIGN KEY (bus_concession_type_id) REFERENCES concession_types(id),
  CONSTRAINT chk_sfa_tdisc  CHECK (tuition_discount >= 0 AND tuition_discount <= tuition_gross),
  CONSTRAINT chk_sfa_bdisc  CHECK (bus_discount >= 0 AND bus_discount <= bus_gross)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every amount a student owes is one row here (tuition installments, bus, one-time).
CREATE TABLE fee_items (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id        BIGINT UNSIGNED NOT NULL,
  student_id              BIGINT UNSIGNED NOT NULL,
  student_fee_account_id  BIGINT UNSIGNED NOT NULL,
  category                ENUM('tuition','bus','one_time') NOT NULL,
  installment_no          TINYINT UNSIGNED NULL,          -- tuition only
  class_one_time_fee_id   BIGINT UNSIGNED NULL,           -- one_time only
  label                   VARCHAR(150) NOT NULL,          -- 'Tuition Q1', 'Bus fee', 'SA1 Exam fee'
  due_date                DATE NULL,
  amount                  DECIMAL(12,2) NOT NULL,
  paid_amount             DECIMAL(12,2) NOT NULL DEFAULT 0, -- maintained in the same transaction as allocations
  balance                 DECIMAL(12,2) GENERATED ALWAYS AS (amount - paid_amount) STORED,
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fi_tuition (student_fee_account_id, category, installment_no),
  UNIQUE KEY uq_fi_onetime (student_id, class_one_time_fee_id),
  KEY ix_fi_student_due (student_id, academic_year_id, category, installment_no),
  KEY ix_fi_balance (academic_year_id, balance),
  CONSTRAINT fk_fi_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_fi_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_fi_sfa     FOREIGN KEY (student_fee_account_id) REFERENCES student_fee_accounts(id),
  CONSTRAINT fk_fi_cotf    FOREIGN KEY (class_one_time_fee_id) REFERENCES class_one_time_fees(id),
  CONSTRAINT chk_fi_paid   CHECK (paid_amount >= 0 AND paid_amount <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A payment = one receipt. Never updated except to void.
CREATE TABLE payments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26)     NOT NULL,
  receipt_type      ENUM('regular','opening_balance') NOT NULL DEFAULT 'regular',
  receipt_no        VARCHAR(40)  NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,     -- year in which the money was received
  student_id        BIGINT UNSIGNED NOT NULL,
  payment_date      DATE NOT NULL,
  total_amount      DECIMAL(12,2) NOT NULL,
  method            ENUM('cash','upi','cheque','bank_transfer','card') NOT NULL,
  reference_no      VARCHAR(100) NULL,
  remarks           VARCHAR(255) NULL,
  collected_by      BIGINT UNSIGNED NOT NULL,
  status            ENUM('valid','void') NOT NULL DEFAULT 'valid',
  void_reason       VARCHAR(255) NULL,
  voided_by         BIGINT UNSIGNED NULL,
  voided_at         DATETIME(3)  NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pay_public (public_id),
  UNIQUE KEY uq_pay_receipt (receipt_type, receipt_no),
  KEY ix_pay_student (student_id, payment_date),
  KEY ix_pay_date (payment_date, status),
  KEY ix_pay_collector (collected_by, payment_date),
  CONSTRAINT fk_pay_ay        FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_pay_student   FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_pay_collector FOREIGN KEY (collected_by) REFERENCES users(id),
  CONSTRAINT fk_pay_voider    FOREIGN KEY (voided_by) REFERENCES users(id),
  CONSTRAINT chk_pay_amount   CHECK (total_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- How each payment was split across fee items (may point to a previous year's items, rule F30)
CREATE TABLE payment_allocations (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id   BIGINT UNSIGNED NOT NULL,
  fee_item_id  BIGINT UNSIGNED NOT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alloc (payment_id, fee_item_id),
  KEY ix_alloc_item (fee_item_id),
  CONSTRAINT fk_alloc_pay  FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_alloc_item FOREIGN KEY (fee_item_id) REFERENCES fee_items(id),
  CONSTRAINT chk_alloc_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
