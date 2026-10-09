-- =========================================================
-- R1 SCHEMA: Foundation & People   (MySQL 8.0+ or MariaDB 10.4+, InnoDB, utf8mb4)
-- =========================================================
SET NAMES utf8mb4;

-- ---------- Institution & configuration ----------

CREATE TABLE institution_settings (
  id                    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  institution_type      ENUM('school','college') NOT NULL DEFAULT 'school',
  name                  VARCHAR(200) NOT NULL,
  short_name            VARCHAR(50)  NULL,
  logo_file_id          BIGINT UNSIGNED NULL,
  favicon_file_id       BIGINT UNSIGNED NULL,
  address               VARCHAR(500) NULL,
  phone                 VARCHAR(20)  NULL,
  contact_email         VARCHAR(190) NULL,
  contact_whatsapp      VARCHAR(20)  NULL,
  website_url           VARCHAR(255) NULL,
  timezone              VARCHAR(50)  NOT NULL DEFAULT 'Asia/Kolkata',
  currency              CHAR(3)      NOT NULL DEFAULT 'INR',
  college_login_holder  ENUM('student','parent') NOT NULL DEFAULT 'student',
  brand_primary         CHAR(7)      NULL,
  brand_secondary       CHAR(7)      NULL,
  smtp_config           JSON         NULL,   -- password encrypted at application level
  updated_by            BIGINT UNSIGNED NULL,
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_inst_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE feature_flags (
  module_key   VARCHAR(50) NOT NULL,
  is_enabled   TINYINT(1)  NOT NULL DEFAULT 0,
  updated_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  setting_group VARCHAR(50)  NOT NULL,   -- e.g. 'auth', 'notifications', 'receipts'
  setting_key   VARCHAR(100) NOT NULL,
  value         JSON         NOT NULL,
  is_developer_only TINYINT(1) NOT NULL DEFAULT 0,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_group, setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE number_sequences (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seq_key       VARCHAR(50)  NOT NULL,   -- 'receipt', 'opening_receipt', 'admission', 'employee'
  scope_key     VARCHAR(50)  NOT NULL DEFAULT 'global',  -- e.g. academic year name '2026-27'
  prefix        VARCHAR(30)  NOT NULL DEFAULT '',
  next_value    INT UNSIGNED NOT NULL DEFAULT 1,
  pad_length    TINYINT UNSIGNED NOT NULL DEFAULT 5,
  PRIMARY KEY (id),
  UNIQUE KEY uq_seq (seq_key, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Identity ----------

CREATE TABLE users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id             CHAR(26)     NOT NULL,
  name                  VARCHAR(150) NOT NULL,
  email                 VARCHAR(190) NULL,
  mobile                VARCHAR(15)  NULL,
  password_hash         VARCHAR(255) NULL,
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 1,
  is_super_admin        TINYINT(1)   NOT NULL DEFAULT 0,
  status                ENUM('active','disabled','auto_disabled') NOT NULL DEFAULT 'active',
  email_verified_at     DATETIME(3)  NULL,
  failed_login_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until          DATETIME(3)  NULL,
  last_login_at         DATETIME(3)  NULL,
  password_changed_at   DATETIME(3)  NULL,
  created_by            BIGINT UNSIGNED NULL,
  updated_by            BIGINT UNSIGNED NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public (public_id),
  UNIQUE KEY uq_users_email  (email),
  UNIQUE KEY uq_users_mobile (mobile),
  KEY ix_users_status (status),
  CONSTRAINT chk_users_identifier CHECK (email IS NOT NULL OR mobile IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_key     VARCHAR(60)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  description  VARCHAR(255) NULL,
  workspace    ENUM('staff','parent','student') NOT NULL DEFAULT 'staff',
  is_system    TINYINT(1)   NOT NULL DEFAULT 0,   -- system roles cannot be deleted
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_key (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  module_key   VARCHAR(50)  NOT NULL,
  action       VARCHAR(30)  NOT NULL,
  description  VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_perm (module_key, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id        BIGINT UNSIGNED NOT NULL,
  permission_id  BIGINT UNSIGNED NOT NULL,
  scope          ENUM('all','class','section','subject','assigned_students',
                      'own_records','own_children','assigned_route') NOT NULL DEFAULT 'all',
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  user_id     BIGINT UNSIGNED NOT NULL,
  role_id     BIGINT UNSIGNED NOT NULL,
  valid_from  DATE NULL,
  valid_to    DATE NULL,       -- temporary roles
  assigned_by BIGINT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  KEY ix_ur_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE field_policies (
  role_id     BIGINT UNSIGNED NOT NULL,
  entity      VARCHAR(50) NOT NULL,   -- 'student', 'family', 'staff'
  field_key   VARCHAR(80) NOT NULL,   -- 'family.mobile', 'student.address', 'fees'
  access      ENUM('hidden','view','edit') NOT NULL,
  PRIMARY KEY (role_id, entity, field_key),
  CONSTRAINT fk_fp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             BIGINT UNSIGNED NOT NULL,
  refresh_token_hash  CHAR(64)     NOT NULL,
  device_label        VARCHAR(150) NULL,
  ip_address          VARCHAR(45)  NULL,
  user_agent          VARCHAR(255) NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at        DATETIME(3)  NULL,
  expires_at          DATETIME(3)  NOT NULL,
  revoked_at          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sess_token (refresh_token_hash),
  KEY ix_sess_user (user_id, revoked_at),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_reset_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64)    NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_prt_token (token_hash),
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log of temporary password generation. The password itself is NEVER stored here.
CREATE TABLE credential_issues (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  issued_by   BIGINT UNSIGNED NOT NULL,
  channel     ENUM('whatsapp_manual','copy','email') NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ci_user (user_id),
  CONSTRAINT fk_ci_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ci_by   FOREIGN KEY (issued_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  identifier   VARCHAR(190) NOT NULL,     -- email or mobile entered
  success      TINYINT(1)   NOT NULL,
  reason       VARCHAR(50)  NULL,         -- 'bad_password', 'disabled', 'locked'
  ip_address   VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ll_user (user_id, created_at),
  KEY ix_ll_ident (identifier, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  workspace    ENUM('staff','parent','student','developer','system') NOT NULL,
  module_key   VARCHAR(50)  NOT NULL,
  action       VARCHAR(50)  NOT NULL,
  entity_type  VARCHAR(50)  NULL,
  entity_id    BIGINT UNSIGNED NULL,
  before_data  JSON NULL,
  after_data   JSON NULL,
  ip_address   VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity_type, entity_id),
  KEY ix_audit_user (user_id, created_at),
  KEY ix_audit_module (module_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE files (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)     NOT NULL,
  disk           ENUM('local','s3') NOT NULL,
  storage_path   VARCHAR(500) NOT NULL,
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  visibility     ENUM('public','private') NOT NULL DEFAULT 'private',
  module_key     VARCHAR(50)  NULL,
  entity_type    VARCHAR(50)  NULL,
  entity_id      BIGINT UNSIGNED NULL,
  uploaded_by    BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_files_public (public_id),
  KEY ix_files_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Academic structure ----------

CREATE TABLE academic_years (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(20) NOT NULL,      -- '2026-27'
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_current   TINYINT(1) NOT NULL DEFAULT 0,
  status       ENUM('planned','active','closed') NOT NULL DEFAULT 'planned',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  current_flag TINYINT GENERATED ALWAYS AS (IF(is_current = 1, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ay_name (name),
  UNIQUE KEY uq_ay_one_current (current_flag),   -- only one current year
  CONSTRAINT chk_ay_dates CHECK (end_date > start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE classes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(50) NOT NULL,    -- 'Nursery', 'LKG', 'Class 5'
  level_order    SMALLINT NOT NULL,       -- sort and promotion order
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_class_name (name),
  KEY ix_class_order (level_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sections (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  class_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(20) NOT NULL,       -- 'A', 'B'
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_section (class_id, name),
  CONSTRAINT fk_section_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subjects (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  code        VARCHAR(20)  NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subject_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE class_subjects (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  subject_id        BIGINT UNSIGNED NOT NULL,
  display_order     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (academic_year_id, class_id, subject_id),
  CONSTRAINT fk_cs_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_cs_class   FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_cs_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- People ----------

CREATE TABLE staff (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)     NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  employee_code    VARCHAR(30)  NOT NULL,
  designation      VARCHAR(100) NULL,
  department       VARCHAR(100) NULL,
  qualification    VARCHAR(200) NULL,
  experience_years DECIMAL(4,1) NULL,
  joining_date     DATE NULL,
  gender           ENUM('male','female','other') NULL,
  dob              DATE NULL,
  address          VARCHAR(500) NULL,
  photo_file_id    BIGINT UNSIGNED NULL,
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  custom_data      JSON NULL,
  created_by       BIGINT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at       DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_public (public_id),
  UNIQUE KEY uq_staff_user (user_id),
  UNIQUE KEY uq_staff_code (employee_code),
  KEY ix_staff_status (status),
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE teacher_assignments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  staff_id          BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  subject_id        BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ta (academic_year_id, section_id, subject_id, staff_id),
  KEY ix_ta_staff (staff_id, academic_year_id),
  CONSTRAINT fk_ta_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ta_staff   FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT fk_ta_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_ta_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE class_teachers (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  staff_id          BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (academic_year_id, section_id),
  KEY ix_ct_staff (staff_id),
  CONSTRAINT fk_ct_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ct_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_ct_staff   FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One family = one login account (users row). A staff member's own family
-- points to the staff member's user_id, which enables the Staff/Parent switch.
CREATE TABLE families (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)     NOT NULL,
  user_id        BIGINT UNSIGNED NULL,
  family_name    VARCHAR(150) NOT NULL,
  father_name    VARCHAR(150) NULL,
  mother_name    VARCHAR(150) NULL,
  guardian_name  VARCHAR(150) NULL,
  primary_mobile VARCHAR(15)  NOT NULL,
  alt_mobile     VARCHAR(15)  NULL,
  email          VARCHAR(190) NULL,
  address        VARCHAR(500) NULL,
  custom_data    JSON NULL,
  created_by     BIGINT UNSIGNED NULL,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_family_public (public_id),
  UNIQUE KEY uq_family_user (user_id),
  UNIQUE KEY uq_family_mobile (primary_mobile),
  CONSTRAINT fk_family_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE students (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)     NOT NULL,
  admission_no     VARCHAR(30)  NOT NULL,
  family_id        BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,     -- college student login only
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NULL,
  dob              DATE NULL,
  gender           ENUM('male','female','other') NULL,
  blood_group      VARCHAR(5)   NULL,
  admission_date   DATE NULL,
  address          VARCHAR(500) NULL,
  photo_file_id    BIGINT UNSIGNED NULL,
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  inactive_reason  VARCHAR(255) NULL,
  inactive_at      DATETIME(3)  NULL,
  custom_data      JSON NULL,
  created_by       BIGINT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_public (public_id),
  UNIQUE KEY uq_student_adm (admission_no),
  UNIQUE KEY uq_student_user (user_id),
  KEY ix_student_family (family_id),
  KEY ix_student_status_name (status, first_name),
  FULLTEXT KEY ft_student_name (first_name, last_name, admission_no),
  CONSTRAINT fk_student_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_student_user   FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enrollments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id        BIGINT UNSIGNED NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  roll_no           VARCHAR(10) NULL,
  joined_on         DATE NULL,
  status            ENUM('enrolled','promoted','detained','transferred','left','completed')
                    NOT NULL DEFAULT 'enrolled',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_enroll (student_id, academic_year_id),
  KEY ix_enroll_section (academic_year_id, section_id),
  KEY ix_enroll_class (academic_year_id, class_id),
  CONSTRAINT fk_en_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_en_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_en_class   FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_en_section FOREIGN KEY (section_id) REFERENCES sections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Communication ----------

CREATE TABLE announcements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title         VARCHAR(200) NOT NULL,
  body_html     MEDIUMTEXT   NOT NULL,     -- sanitised before save
  audience      JSON NOT NULL,             -- {"type":"section","ids":[3,4]}
  is_public     TINYINT(1) NOT NULL DEFAULT 0,
  status        ENUM('draft','scheduled','published','archived') NOT NULL DEFAULT 'draft',
  publish_at    DATETIME(3) NULL,
  expire_at     DATETIME(3) NULL,
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ann_status (status, publish_at),
  CONSTRAINT fk_ann_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  workspace    ENUM('staff','parent','student') NOT NULL,
  category     ENUM('system','academic','finance','communication') NOT NULL,
  title        VARCHAR(200) NOT NULL,
  body         VARCHAR(500) NULL,
  link_path    VARCHAR(255) NULL,
  read_at      DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_notif_user (user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_templates (
  template_key  VARCHAR(60)  NOT NULL,     -- 'password_reset', 'fee_reminder'
  subject       VARCHAR(200) NOT NULL,
  body_html     MEDIUMTEXT   NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_outbox (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  to_email      VARCHAR(190) NOT NULL,
  template_key  VARCHAR(60)  NULL,
  subject       VARCHAR(200) NOT NULL,
  status        ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error    VARCHAR(500) NULL,
  sent_at       DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_outbox_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Imports ----------

CREATE TABLE import_jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_type   ENUM('families_students','staff','opening_fees','attendance') NOT NULL,
  file_id       BIGINT UNSIGNED NOT NULL,
  status        ENUM('uploaded','validating','invalid','ready','importing','completed','failed')
                NOT NULL DEFAULT 'uploaded',
  total_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  error_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  errors        JSON NULL,               -- [{row, column, message}]
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at  DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_imp_file FOREIGN KEY (file_id) REFERENCES files(id),
  CONSTRAINT fk_imp_by   FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
