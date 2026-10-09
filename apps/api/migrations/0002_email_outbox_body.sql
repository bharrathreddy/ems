-- Store the rendered email body so the outbox worker can retry delivery.
ALTER TABLE email_outbox
  ADD COLUMN body_html MEDIUMTEXT NOT NULL AFTER subject;
