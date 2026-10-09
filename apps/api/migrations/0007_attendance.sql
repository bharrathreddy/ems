-- =========================================================
-- 0007: Attendance (Release 3). MySQL 8.0+ / MariaDB 10.3+
-- =========================================================

-- School holidays per academic year (a single day or a range). Sundays and the
-- "Saturdays off" setting are applied in code and need no rows here.
CREATE TABLE holidays (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  name              VARCHAR(120) NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_hol_year (academic_year_id, start_date),
  CONSTRAINT fk_hol_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT chk_hol_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per student per day.
CREATE TABLE student_attendance (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  student_id        BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  att_date          DATE NOT NULL,
  status            ENUM('present','absent','late','half_day','leave') NOT NULL,
  source            ENUM('teacher','admin','leave','import') NOT NULL DEFAULT 'teacher',
  marked_by         BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_att_student_day (student_id, att_date),
  KEY ix_att_section_day (section_id, att_date),
  KEY ix_att_year_day (academic_year_id, att_date, status),
  CONSTRAINT fk_att_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_att_section FOREIGN KEY (section_id) REFERENCES sections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which sections took attendance on which day (separates "not marked" from "all present").
CREATE TABLE attendance_days (
  section_id        BIGINT UNSIGNED NOT NULL,
  att_date          DATE NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  marked_by         BIGINT UNSIGNED NOT NULL,
  marked_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NULL,
  PRIMARY KEY (section_id, att_date),
  KEY ix_ad_year (academic_year_id, att_date),
  CONSTRAINT fk_ad_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_ad_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Leave requests from families (for a child) and from staff (for themselves).
CREATE TABLE leave_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind           ENUM('student','staff') NOT NULL,
  student_id     BIGINT UNSIGNED NULL,
  staff_id       BIGINT UNSIGNED NULL,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  reason         VARCHAR(500) NOT NULL,
  status         ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by   BIGINT UNSIGNED NOT NULL,
  decided_by     BIGINT UNSIGNED NULL,
  decided_at     DATETIME(3) NULL,
  decision_note  VARCHAR(255) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_lr_student (student_id, status),
  KEY ix_lr_staff (staff_id, status),
  KEY ix_lr_status (kind, status, start_date),
  CONSTRAINT fk_lr_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_lr_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT fk_lr_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT chk_lr_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_lr_subject CHECK ((kind = 'student' AND student_id IS NOT NULL) OR (kind = 'staff' AND staff_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff attendance: self check-in on school premises (time and distance kept), admin can correct.
CREATE TABLE staff_attendance (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id         BIGINT UNSIGNED NOT NULL,
  att_date         DATE NOT NULL,
  status           ENUM('present','absent','half_day','leave') NOT NULL,
  source           ENUM('self','admin','leave') NOT NULL,
  check_in_at      DATETIME(3) NULL,
  distance_m       INT UNSIGNED NULL,
  accuracy_m       INT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sa_staff_day (staff_id, att_date),
  KEY ix_sa_day (att_date),
  CONSTRAINT fk_sa_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
