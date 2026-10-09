-- 0.16.0: hall tickets. Instructions printed on each exam's hall tickets (NULL = the standard text).
ALTER TABLE exams ADD COLUMN hall_ticket_note TEXT NULL AFTER on_report_card;
