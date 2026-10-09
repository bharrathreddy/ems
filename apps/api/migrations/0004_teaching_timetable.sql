-- =========================================================
-- 0004: Teaching grid (one teacher per section + subject) and timetable
-- MySQL 8.0+ / MariaDB 10.4+
-- =========================================================

-- One teacher per section and subject per year (the teaching grid). Remove older duplicates first.
DELETE t1 FROM teacher_assignments t1
  JOIN teacher_assignments t2
    ON t1.academic_year_id = t2.academic_year_id AND t1.section_id = t2.section_id
   AND t1.subject_id = t2.subject_id AND t1.id > t2.id;
ALTER TABLE teacher_assignments
  DROP INDEX uq_ta,
  ADD UNIQUE KEY uq_ta_cell (academic_year_id, section_id, subject_id);

-- Bell-schedule groups per academic year (e.g. Pre-primary, Primary, High school).
CREATE TABLE bell_groups (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  name              VARCHAR(80) NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bg_name (academic_year_id, name),
  CONSTRAINT fk_bg_ay FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Each class belongs to one group per year.
CREATE TABLE bell_group_classes (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  bell_group_id     BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (academic_year_id, class_id),
  KEY ix_bgc_group (bell_group_id),
  CONSTRAINT fk_bgc_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_bgc_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_bgc_group FOREIGN KEY (bell_group_id) REFERENCES bell_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Periods and breaks of a group (same timings Monday to Saturday).
CREATE TABLE bell_periods (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bell_group_id  BIGINT UNSIGNED NOT NULL,
  seq            SMALLINT UNSIGNED NOT NULL,
  kind           ENUM('period','break','lunch','assembly') NOT NULL DEFAULT 'period',
  label          VARCHAR(40) NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  PRIMARY KEY (id),
  KEY ix_bp_group (bell_group_id, seq),
  CONSTRAINT fk_bp_group FOREIGN KEY (bell_group_id) REFERENCES bell_groups(id) ON DELETE CASCADE,
  CONSTRAINT chk_bp_time CHECK (end_time > start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One subject per section, day (1 = Monday ... 6 = Saturday) and period.
-- The teacher is not stored here: it always comes from the teaching grid.
CREATE TABLE timetable_slots (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  day_of_week       TINYINT UNSIGNED NOT NULL,
  bell_period_id    BIGINT UNSIGNED NOT NULL,
  subject_id        BIGINT UNSIGNED NOT NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_slot (section_id, day_of_week, bell_period_id),
  KEY ix_slot_year (academic_year_id, day_of_week),
  KEY ix_slot_subject (academic_year_id, section_id, subject_id),
  CONSTRAINT fk_slot_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_slot_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_slot_period  FOREIGN KEY (bell_period_id) REFERENCES bell_periods(id) ON DELETE CASCADE,
  CONSTRAINT fk_slot_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT chk_slot_day CHECK (day_of_week BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
