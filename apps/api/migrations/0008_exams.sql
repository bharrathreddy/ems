-- =========================================================
-- 0008: Exams and report cards (Release 4). MySQL 8.0+ / MariaDB 10.3+
-- =========================================================

-- Grade scales (editable): a grade applies from min_pct upwards until the next band.
CREATE TABLE grade_scales (
  id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name  VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gs_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE grade_bands (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scale_id   BIGINT UNSIGNED NOT NULL,
  grade      VARCHAR(6) NOT NULL,
  min_pct    DECIMAL(5,2) NOT NULL,
  label      VARCHAR(40) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gb (scale_id, grade),
  CONSTRAINT fk_gb_scale FOREIGN KEY (scale_id) REFERENCES grade_scales(id) ON DELETE CASCADE,
  CONSTRAINT chk_gb_pct CHECK (min_pct >= 0 AND min_pct <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- How each class is assessed and reported in a year.
CREATE TABLE class_exam_settings (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  assessment        ENUM('marks','skills') NOT NULL DEFAULT 'marks',
  grade_scale_id    BIGINT UNSIGNED NULL,
  display           ENUM('marks','grades','both') NOT NULL DEFAULT 'both',
  formula           ENUM('term','year_end','weights') NOT NULL DEFAULT 'term',
  fa_weight         TINYINT UNSIGNED NOT NULL DEFAULT 20,
  pass_pct          DECIMAL(5,2) NOT NULL DEFAULT 35,
  PRIMARY KEY (academic_year_id, class_id),
  CONSTRAINT fk_ces_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ces_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_ces_scale FOREIGN KEY (grade_scale_id) REFERENCES grade_scales(id) ON DELETE SET NULL,
  CONSTRAINT chk_ces_w CHECK (fa_weight <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Exams of a year: FA1..SA2 (on the report card) and unit tests / pre-finals (tracking only).
CREATE TABLE exams (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  code              VARCHAR(20) NOT NULL,
  name              VARCHAR(80) NOT NULL,
  kind              ENUM('fa','sa','unit','prefinal') NOT NULL,
  term              TINYINT UNSIGNED NULL,
  max_marks         DECIMAL(6,2) NOT NULL,
  on_report_card    TINYINT(1) NOT NULL DEFAULT 1,
  position          SMALLINT NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_exam_code (academic_year_id, code),
  CONSTRAINT fk_exam_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT chk_exam_max CHECK (max_marks > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Classes that sit an exam.
CREATE TABLE exam_classes (
  exam_id   BIGINT UNSIGNED NOT NULL,
  class_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (exam_id, class_id),
  CONSTRAINT fk_ec_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_ec_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Date and time of each subject's paper (agreed E12).
CREATE TABLE exam_schedule (
  exam_id     BIGINT UNSIGNED NOT NULL,
  class_id    BIGINT UNSIGNED NOT NULL,
  subject_id  BIGINT UNSIGNED NOT NULL,
  exam_date   DATE NOT NULL,
  start_time  TIME NULL,
  end_time    TIME NULL,
  PRIMARY KEY (exam_id, class_id, subject_id),
  KEY ix_es_date (exam_date),
  CONSTRAINT fk_es_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_es_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_es_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One mark per student, exam and subject. AB = absent (counts as 0).
CREATE TABLE marks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_id     BIGINT UNSIGNED NOT NULL,
  student_id  BIGINT UNSIGNED NOT NULL,
  subject_id  BIGINT UNSIGNED NOT NULL,
  section_id  BIGINT UNSIGNED NOT NULL,
  marks       DECIMAL(6,2) NULL,
  is_absent   TINYINT(1) NOT NULL DEFAULT 0,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mark (exam_id, student_id, subject_id),
  KEY ix_mark_sheet (exam_id, section_id, subject_id),
  KEY ix_mark_student (student_id),
  CONSTRAINT fk_mark_exam FOREIGN KEY (exam_id) REFERENCES exams(id),
  CONSTRAINT fk_mark_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_mark_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_mark_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT chk_mark_value CHECK (marks IS NULL OR marks >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A subject's marks for one section in one exam move: draft -> submitted -> approved (or returned).
CREATE TABLE mark_sheets (
  exam_id       BIGINT UNSIGNED NOT NULL,
  section_id    BIGINT UNSIGNED NOT NULL,
  subject_id    BIGINT UNSIGNED NOT NULL,
  status        ENUM('draft','submitted','approved','returned') NOT NULL DEFAULT 'draft',
  submitted_by  BIGINT UNSIGNED NULL,
  submitted_at  DATETIME(3) NULL,
  approved_by   BIGINT UNSIGNED NULL,
  approved_at   DATETIME(3) NULL,
  return_note   VARCHAR(255) NULL,
  PRIMARY KEY (exam_id, section_id, subject_id),
  CONSTRAINT fk_ms_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_ms_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Results reach families only after the principal publishes the exam for a section.
CREATE TABLE exam_publications (
  exam_id       BIGINT UNSIGNED NOT NULL,
  section_id    BIGINT UNSIGNED NOT NULL,
  published_by  BIGINT UNSIGNED NOT NULL,
  published_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (exam_id, section_id),
  CONSTRAINT fk_ep_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_section FOREIGN KEY (section_id) REFERENCES sections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Correction of a published mark (agreed E8): teacher asks with a reason, principal decides.
CREATE TABLE mark_corrections (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mark_id       BIGINT UNSIGNED NOT NULL,
  old_marks     DECIMAL(6,2) NULL,
  old_absent    TINYINT(1) NOT NULL,
  new_marks     DECIMAL(6,2) NULL,
  new_absent    TINYINT(1) NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by  BIGINT UNSIGNED NOT NULL,
  decided_by    BIGINT UNSIGNED NULL,
  decided_at    DATETIME(3) NULL,
  decision_note VARCHAR(255) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_mc_status (status),
  CONSTRAINT fk_mc_mark FOREIGN KEY (mark_id) REFERENCES marks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Co-scholastic areas: school-wide (class_id NULL) or added by a class teacher for one class.
CREATE TABLE co_areas (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NULL,
  name              VARCHAR(80) NOT NULL,
  position          SMALLINT NOT NULL DEFAULT 0,
  created_by        BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_co_year (academic_year_id, class_id),
  CONSTRAINT fk_co_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_co_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE co_grades (
  area_id     BIGINT UNSIGNED NOT NULL,
  student_id  BIGINT UNSIGNED NOT NULL,
  term        TINYINT UNSIGNED NOT NULL,
  grade       VARCHAR(6) NOT NULL,
  updated_by  BIGINT UNSIGNED NULL,
  PRIMARY KEY (area_id, student_id, term),
  CONSTRAINT fk_cg_area FOREIGN KEY (area_id) REFERENCES co_areas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cg_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Class teacher's remarks per term.
CREATE TABLE term_remarks (
  student_id        BIGINT UNSIGNED NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  term              TINYINT UNSIGNED NOT NULL,
  remarks           VARCHAR(600) NOT NULL,
  updated_by        BIGINT UNSIGNED NULL,
  PRIMARY KEY (student_id, academic_year_id, term),
  CONSTRAINT fk_tr_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_tr_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pre-primary skills (agreed E5) and their ratings per term.
CREATE TABLE skills (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NULL,
  group_name        VARCHAR(60) NOT NULL,
  name              VARCHAR(120) NOT NULL,
  position          SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_sk_year (academic_year_id, class_id),
  CONSTRAINT fk_sk_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_sk_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE skill_ratings (
  skill_id    BIGINT UNSIGNED NOT NULL,
  student_id  BIGINT UNSIGNED NOT NULL,
  term        TINYINT UNSIGNED NOT NULL,
  rating      ENUM('excellent','good','needs_practice') NOT NULL,
  updated_by  BIGINT UNSIGNED NULL,
  PRIMARY KEY (skill_id, student_id, term),
  CONSTRAINT fk_sr_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Leaving students: relieving checklist (agreed E11). Certificates are prepared outside the app.
CREATE TABLE student_exits (
  student_id          BIGINT UNSIGNED NOT NULL,
  leaving_date        DATE NOT NULL,
  reason              VARCHAR(255) NOT NULL,
  tc_number           VARCHAR(40) NULL,
  tc_issued_on        DATE NULL,
  tc_marked_by        BIGINT UNSIGNED NULL,
  bonafide_number     VARCHAR(40) NULL,
  bonafide_issued_on  DATE NULL,
  bonafide_marked_by  BIGINT UNSIGNED NULL,
  created_by          BIGINT UNSIGNED NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (student_id),
  CONSTRAINT fk_se_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
