-- Per-person exceptions on top of their roles: give (grant) or take away (deny) one permission in one workspace.
CREATE TABLE user_permission_overrides (
  user_id        BIGINT UNSIGNED NOT NULL,
  workspace      ENUM('staff','parent','student') NOT NULL,
  permission_id  BIGINT UNSIGNED NOT NULL,
  effect         ENUM('grant','deny') NOT NULL,
  scope          ENUM('all','class','section','subject','assigned_students','own_records','own_children','assigned_route') NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, workspace, permission_id),
  CONSTRAINT fk_upo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_upo_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
