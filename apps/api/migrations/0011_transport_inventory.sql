-- Release 7: transport operations (vehicles, stops, fuel and service log), stock and the sales counter.

-- ---------- Transport ----------
CREATE TABLE vehicles (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reg_no           VARCHAR(20)  NOT NULL,
  name             VARCHAR(80)  NULL,
  seats            INT NULL,
  driver_staff_id  BIGINT UNSIGNED NULL,
  helper_name      VARCHAR(100) NULL,
  helper_mobile    VARCHAR(15)  NULL,
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  notes            VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_reg (reg_no),
  KEY ix_vehicle_driver (driver_staff_id),
  CONSTRAINT fk_vehicle_driver FOREIGN KEY (driver_staff_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bus_routes ADD COLUMN vehicle_id BIGINT UNSIGNED NULL AFTER description;
ALTER TABLE bus_routes ADD CONSTRAINT fk_route_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE TABLE route_stops (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bus_route_id  BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(100) NOT NULL,
  landmark      VARCHAR(150) NULL,
  pickup_time   TIME NULL,
  drop_time     TIME NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY ix_stop_route (bus_route_id, sort_order),
  CONSTRAINT fk_stop_route FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The stop a bus student uses, per academic year (the route itself comes from the student's fee account).
CREATE TABLE student_stops (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  student_id        BIGINT UNSIGNED NOT NULL,
  route_stop_id     BIGINT UNSIGNED NOT NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (academic_year_id, student_id),
  KEY ix_ss_stop (route_stop_id),
  CONSTRAINT fk_sst_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_sst_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_sst_stop FOREIGN KEY (route_stop_id) REFERENCES route_stops(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fuel fills and services/repairs. Each entry is also an expense (expense_id).
CREATE TABLE vehicle_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26) NOT NULL,
  vehicle_id    BIGINT UNSIGNED NOT NULL,
  kind          ENUM('fuel','service') NOT NULL,
  log_date      DATE NOT NULL,
  odometer      INT UNSIGNED NULL,
  litres        DECIMAL(8,2) NULL,
  amount        DECIMAL(12,2) NOT NULL,
  vendor        VARCHAR(150) NULL,
  description   VARCHAR(255) NULL,
  expense_id    BIGINT UNSIGNED NULL,
  status        ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  cancel_reason VARCHAR(255) NULL,
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vlog_public (public_id),
  KEY ix_vlog_vehicle (vehicle_id, log_date),
  CONSTRAINT fk_vlog_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_vlog_expense FOREIGN KEY (expense_id) REFERENCES expenses(id),
  CONSTRAINT chk_vlog_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE expenses MODIFY COLUMN source ENUM('manual','payroll','transport','inventory') NOT NULL DEFAULT 'manual';

-- ---------- Stock ----------
CREATE TABLE inventory_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120) NOT NULL,
  category       VARCHAR(60)  NOT NULL,
  unit           VARCHAR(20)  NOT NULL DEFAULT 'pcs',
  sale_price     DECIMAL(12,2) NULL,            -- NULL: not sold to students
  track_stock    TINYINT(1) NOT NULL DEFAULT 1,
  stock_qty      DECIMAL(12,2) NOT NULL DEFAULT 0,
  low_stock_at   DECIMAL(12,2) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_name (name),
  KEY ix_item_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_id       BIGINT UNSIGNED NOT NULL,
  kind          ENUM('purchase','issue','sale','sale_cancel','adjust') NOT NULL,
  qty           DECIMAL(12,2) NOT NULL,          -- signed: + into stock, - out of stock
  move_date     DATE NOT NULL,
  amount        DECIMAL(12,2) NULL,              -- purchase cost
  party         VARCHAR(150) NULL,               -- vendor, or who received the items
  note          VARCHAR(255) NULL,
  expense_id    BIGINT UNSIGNED NULL,
  sale_id       BIGINT UNSIGNED NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_sm_item (item_id, id),
  KEY ix_sm_date (move_date),
  KEY ix_sm_sale (sale_id),
  CONSTRAINT fk_sm_item FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  CONSTRAINT fk_sm_expense FOREIGN KEY (expense_id) REFERENCES expenses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Class-wise book sets: a fixed list of items sold together at one price.
CREATE TABLE item_sets (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120) NOT NULL,
  class_id   BIGINT UNSIGNED NULL,
  price      DECIMAL(12,2) NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_set_name (name),
  CONSTRAINT fk_set_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_set_lines (
  set_id   BIGINT UNSIGNED NOT NULL,
  item_id  BIGINT UNSIGNED NOT NULL,
  qty      DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (set_id, item_id),
  CONSTRAINT fk_isl_set FOREIGN KEY (set_id) REFERENCES item_sets(id) ON DELETE CASCADE,
  CONSTRAINT fk_isl_item FOREIGN KEY (item_id) REFERENCES inventory_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Sales counter (paid at the counter; separate receipt numbers SALE/2026-27/00001) ----------
CREATE TABLE sales (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26) NOT NULL,
  receipt_no        VARCHAR(40) NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  student_id        BIGINT UNSIGNED NULL,
  buyer_name        VARCHAR(150) NULL,
  sale_date         DATE NOT NULL,
  total             DECIMAL(12,2) NOT NULL,
  method            ENUM('cash','upi','cheque','bank_transfer','card') NOT NULL,
  reference_no      VARCHAR(100) NULL,
  status            ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  cancel_reason     VARCHAR(255) NULL,
  cancelled_by      BIGINT UNSIGNED NULL,
  cancelled_at      DATETIME(3) NULL,
  created_by        BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sale_public (public_id),
  UNIQUE KEY uq_sale_receipt (receipt_no),
  KEY ix_sale_date (sale_date, status),
  KEY ix_sale_student (student_id),
  CONSTRAINT fk_sale_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_sale_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT chk_sale_total CHECK (total > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_lines (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id     BIGINT UNSIGNED NOT NULL,
  item_id     BIGINT UNSIGNED NULL,
  set_id      BIGINT UNSIGNED NULL,
  label       VARCHAR(150) NOT NULL,
  qty         DECIMAL(12,2) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_sl_sale (sale_id),
  CONSTRAINT fk_sl_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_item FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  CONSTRAINT fk_sl_set FOREIGN KEY (set_id) REFERENCES item_sets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
