-- Release 6: HR records, leave types, salary structures, monthly payroll, payslips, expenses.

-- HR details kept apart from the basic staff record so they can be shown only to HR and payroll.
CREATE TABLE staff_hr (
  staff_id          BIGINT UNSIGNED NOT NULL,
  employment_type   ENUM('permanent','probation','contract','part_time') NULL,
  bank_name         VARCHAR(100) NULL,
  bank_account_no   VARCHAR(30)  NULL,
  bank_ifsc         VARCHAR(15)  NULL,
  pan_no            VARCHAR(15)  NULL,
  uan_no            VARCHAR(20)  NULL,
  esi_no            VARCHAR(20)  NULL,
  emergency_name    VARCHAR(100) NULL,
  emergency_mobile  VARCHAR(15)  NULL,
  exit_date         DATE NULL,
  exit_reason       VARCHAR(255) NULL,
  notes             VARCHAR(1000) NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (staff_id),
  CONSTRAINT fk_shr_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Leave types with a yearly allowance per academic year (NULL = no limit).
CREATE TABLE leave_types (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(10)  NOT NULL,
  name           VARCHAR(60)  NOT NULL,
  days_per_year  DECIMAL(5,1) NULL,
  is_paid        TINYINT(1)   NOT NULL DEFAULT 1,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order     INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lt_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO leave_types (code, name, days_per_year, is_paid, sort_order) VALUES
  ('CL', 'Casual leave', 12, 1, 1),
  ('SL', 'Sick leave', 6, 1, 2),
  ('LWP', 'Leave without pay', NULL, 0, 3);

ALTER TABLE leave_requests ADD COLUMN leave_type_id BIGINT UNSIGNED NULL AFTER staff_id;
ALTER TABLE leave_requests ADD CONSTRAINT fk_lr_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id);

-- Pay items. Earnings are a fixed amount or a % of Basic; deductions and employer contributions
-- can also be a % of Gross. An optional cap limits the amount (e.g. a contribution ceiling).
CREATE TABLE pay_components (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(12)  NOT NULL,
  name            VARCHAR(60)  NOT NULL,
  kind            ENUM('earning','deduction','employer') NOT NULL,
  calc            ENUM('fixed','pct_basic','pct_gross') NOT NULL DEFAULT 'fixed',
  default_value   DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_amount      DECIMAL(12,2) NULL,
  prorate         TINYINT(1)   NOT NULL DEFAULT 1,  -- reduced for loss-of-pay days (fixed amounts only)
  is_basic        TINYINT(1)   NOT NULL DEFAULT 0,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order      INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pc_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pay_components (code, name, kind, calc, default_value, prorate, is_basic, sort_order) VALUES
  ('BASIC', 'Basic pay', 'earning', 'fixed', 0, 1, 1, 0);

CREATE TABLE salary_templates (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80) NOT NULL,
  is_active   TINYINT(1)  NOT NULL DEFAULT 1,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_st_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE salary_template_lines (
  template_id   BIGINT UNSIGNED NOT NULL,
  component_id  BIGINT UNSIGNED NOT NULL,
  value         DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (template_id, component_id),
  CONSTRAINT fk_stl_t FOREIGN KEY (template_id) REFERENCES salary_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_stl_c FOREIGN KEY (component_id) REFERENCES pay_components(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A staff member's salary; a new row for every revision, the latest one in force for a month applies.
CREATE TABLE staff_salaries (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id        BIGINT UNSIGNED NOT NULL,
  effective_from  DATE NOT NULL,
  template_id     BIGINT UNSIGNED NULL,
  note            VARCHAR(255) NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ss_staff_from (staff_id, effective_from),
  CONSTRAINT fk_ss_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT fk_ss_tpl FOREIGN KEY (template_id) REFERENCES salary_templates(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff_salary_lines (
  staff_salary_id  BIGINT UNSIGNED NOT NULL,
  component_id     BIGINT UNSIGNED NOT NULL,
  value            DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (staff_salary_id, component_id),
  CONSTRAINT fk_ssl_s FOREIGN KEY (staff_salary_id) REFERENCES staff_salaries(id) ON DELETE CASCADE,
  CONSTRAINT fk_ssl_c FOREIGN KEY (component_id) REFERENCES pay_components(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  month           CHAR(7) NOT NULL,                      -- 2026-10
  status          ENUM('draft','finalised','paid') NOT NULL DEFAULT 'draft',
  divisor_rule    ENUM('month_days','thirty','working_days') NOT NULL,
  divisor_days    DECIMAL(5,1) NOT NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finalised_by    BIGINT UNSIGNED NULL,
  finalised_at    DATETIME(3) NULL,
  paid_on         DATE NULL,
  paid_method     ENUM('cash','upi','cheque','bank_transfer','card') NULL,
  paid_reference  VARCHAR(100) NULL,
  expense_id      BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pr_month (month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Each payslip keeps a full copy of its lines, so later salary changes never alter an issued payslip.
CREATE TABLE payslips (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26) NOT NULL,
  run_id            BIGINT UNSIGNED NOT NULL,
  staff_id          BIGINT UNSIGNED NOT NULL,
  staff_salary_id   BIGINT UNSIGNED NULL,
  lop_days          DECIMAL(5,1) NOT NULL DEFAULT 0,
  paid_days         DECIMAL(5,1) NOT NULL,
  gross             DECIMAL(12,2) NOT NULL,
  total_deductions  DECIMAL(12,2) NOT NULL,
  employer_total    DECIMAL(12,2) NOT NULL,
  net_pay           DECIMAL(12,2) NOT NULL,
  slip_lines        JSON NOT NULL,
  adjustments       JSON NULL,
  note              VARCHAR(255) NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ps_public (public_id),
  UNIQUE KEY uq_ps_run_staff (run_id, staff_id),
  KEY ix_ps_staff (staff_id),
  CONSTRAINT fk_ps_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_ps_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE expense_categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80) NOT NULL,
  is_active   TINYINT(1)  NOT NULL DEFAULT 1,
  is_system   TINYINT(1)  NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ec_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO expense_categories (name, is_system, sort_order) VALUES
  ('Salaries', 1, 1), ('Electricity', 0, 2), ('Water', 0, 3), ('Rent', 0, 4), ('Repairs & maintenance', 0, 5),
  ('Stationery & printing', 0, 6), ('Transport & fuel', 0, 7), ('Events & functions', 0, 8),
  ('Internet & phone', 0, 9), ('Housekeeping', 0, 10), ('Other', 0, 99);

CREATE TABLE expenses (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26) NOT NULL,
  voucher_no        VARCHAR(40) NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  category_id       BIGINT UNSIGNED NOT NULL,
  expense_date      DATE NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  paid_to           VARCHAR(150) NOT NULL,
  method            ENUM('cash','upi','cheque','bank_transfer','card') NOT NULL,
  reference_no      VARCHAR(100) NULL,
  description       VARCHAR(500) NULL,
  bill_file_id      BIGINT UNSIGNED NULL,
  source            ENUM('manual','payroll') NOT NULL DEFAULT 'manual',
  status            ENUM('pending','approved','rejected','cancelled') NOT NULL,
  created_by        BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_by        BIGINT UNSIGNED NULL,
  decided_at        DATETIME(3) NULL,
  decision_note     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exp_public (public_id),
  UNIQUE KEY uq_exp_voucher (voucher_no),
  KEY ix_exp_date (expense_date, status),
  KEY ix_exp_status (status),
  CONSTRAINT fk_exp_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_exp_cat FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_exp_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_exp_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
