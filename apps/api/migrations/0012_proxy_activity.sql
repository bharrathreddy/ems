-- Developer "Login as": a session opened by the developer on someone's behalf, and who really acted in each audit entry.
ALTER TABLE sessions ADD COLUMN impersonator_id BIGINT UNSIGNED NULL AFTER user_id;
ALTER TABLE sessions ADD CONSTRAINT fk_sess_impersonator FOREIGN KEY (impersonator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE audit_logs ADD COLUMN acting_user_id BIGINT UNSIGNED NULL AFTER user_id;
ALTER TABLE audit_logs ADD KEY ix_audit_acting (acting_user_id, created_at);
ALTER TABLE audit_logs ADD KEY ix_audit_created (created_at);
ALTER TABLE login_logs ADD KEY ix_ll_created (created_at);
