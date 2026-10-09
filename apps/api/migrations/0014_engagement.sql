-- 0.15.0: phone notifications, two-step login, homework & class diary, admission enquiries.

-- Which phone-notification group an in-app notification belongs to (NULL = in-app only),
-- and when it was sent to phones. Older notifications are marked as already handled.
ALTER TABLE notifications
  ADD COLUMN push_group ENUM('absence','notices','results','approvals') NULL AFTER category,
  ADD COLUMN pushed_at DATETIME(3) NULL AFTER read_at,
  ADD KEY ix_notif_push (pushed_at, push_group, id);
UPDATE notifications SET pushed_at = created_at;

-- One row per phone/browser that allowed notifications. Each device keeps its own on/off per group.
CREATE TABLE push_subscriptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  workspace       ENUM('staff','parent','student') NOT NULL,
  endpoint_hash   CHAR(64)     NOT NULL,
  endpoint        VARCHAR(1000) NOT NULL,
  p256dh          VARCHAR(255) NOT NULL,
  auth_key        VARCHAR(255) NOT NULL,
  device          VARCHAR(120) NULL,
  want_absence    TINYINT(1)   NOT NULL DEFAULT 1,
  want_notices    TINYINT(1)   NOT NULL DEFAULT 1,
  want_results    TINYINT(1)   NOT NULL DEFAULT 1,
  want_approvals  TINYINT(1)   NOT NULL DEFAULT 1,
  failures        INT UNSIGNED NOT NULL DEFAULT 0,
  last_sent_at    DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY ix_push_user (user_id, workspace),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Two-step login: a 6-digit code emailed after the password is accepted.
CREATE TABLE login_challenges (
  id           CHAR(32)     NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  workspace    ENUM('staff','parent','student') NOT NULL,
  code_hash    CHAR(64)     NOT NULL,
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at   DATETIME(3)  NOT NULL,
  used_at      DATETIME(3)  NULL,
  ip_address   VARCHAR(45)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_lc_user (user_id, created_at),
  CONSTRAINT fk_lc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Homework and class diary, posted by any teacher of the section.
CREATE TABLE homework (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  subject_id        BIGINT UNSIGNED NULL,
  entry_type        ENUM('homework','diary') NOT NULL DEFAULT 'homework',
  title             VARCHAR(200) NOT NULL,
  details           TEXT NULL,
  for_date          DATE NOT NULL,
  due_date          DATE NULL,
  file_id           BIGINT UNSIGNED NULL,
  posted_by         BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_hw_section (section_id, for_date),
  KEY ix_hw_year (academic_year_id, for_date),
  CONSTRAINT fk_hw_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_hw_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_hw_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_hw_file FOREIGN KEY (file_id) REFERENCES files(id),
  CONSTRAINT fk_hw_user FOREIGN KEY (posted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Website contact messages become admission enquiries with a simple pipeline and notes.
ALTER TABLE contact_messages
  MODIFY status ENUM('new','read','archived','contacted','visit','admitted','closed') NOT NULL DEFAULT 'new',
  ADD COLUMN seen_at DATETIME(3) NULL AFTER status,
  ADD COLUMN follow_up_on DATE NULL AFTER seen_at,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL AFTER follow_up_on,
  ADD COLUMN updated_at DATETIME(3) NULL AFTER created_at;
UPDATE contact_messages SET seen_at = created_at WHERE status IN ('read','archived');
UPDATE contact_messages SET status = 'new' WHERE status = 'read';
UPDATE contact_messages SET status = 'closed' WHERE status = 'archived';
ALTER TABLE contact_messages
  MODIFY status ENUM('new','contacted','visit','admitted','closed') NOT NULL DEFAULT 'new';

CREATE TABLE enquiry_notes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id  BIGINT UNSIGNED NOT NULL,
  note        VARCHAR(1000) NOT NULL,
  status_to   ENUM('new','contacted','visit','admitted','closed') NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_en_msg (message_id, id),
  CONSTRAINT fk_en_msg FOREIGN KEY (message_id) REFERENCES contact_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
