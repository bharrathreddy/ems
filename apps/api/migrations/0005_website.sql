-- =========================================================
-- 0005: Public website (CMS). MySQL 8.0+ / MariaDB 10.4+
-- =========================================================

-- Pages: system pages (home, about, contact, privacy) cannot be deleted; custom pages can.
CREATE TABLE cms_pages (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug             VARCHAR(80)  NOT NULL,
  kind             ENUM('home','about','contact','privacy','custom') NOT NULL DEFAULT 'custom',
  title            VARCHAR(150) NOT NULL,
  body             MEDIUMTEXT   NULL,              -- simple formatting (# heading, **bold**, - list), rendered safely
  seo_title        VARCHAR(150) NULL,
  seo_description  VARCHAR(300) NULL,
  is_published     TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by       BIGINT UNSIGNED NULL,
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_page_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Home page sections: order, visibility and content (JSON).
CREATE TABLE cms_home_sections (
  section_key  VARCHAR(30) NOT NULL,   -- banner, welcome, principal, highlights, facilities, notices, events, gallery, videos, testimonials, admissions
  position     SMALLINT NOT NULL,
  is_visible   TINYINT(1) NOT NULL DEFAULT 1,
  content      JSON NOT NULL,
  updated_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (section_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Header and footer menus. link_type: page (slug), builtin (events/gallery/videos/contact/home), url (external).
CREATE TABLE cms_menu_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  location      ENUM('header','footer') NOT NULL,
  label         VARCHAR(60) NOT NULL,
  link_type     ENUM('page','builtin','url') NOT NULL,
  target        VARCHAR(300) NOT NULL,
  position      SMALLINT NOT NULL DEFAULT 0,
  is_visible    TINYINT(1) NOT NULL DEFAULT 1,
  new_tab       TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_menu (location, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cms_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(120) NOT NULL,
  title           VARCHAR(150) NOT NULL,
  event_date      DATE NOT NULL,
  end_date        DATE NULL,
  location        VARCHAR(150) NULL,
  description     MEDIUMTEXT NULL,
  cover_file_id   BIGINT UNSIGNED NULL,
  is_published    TINYINT(1) NOT NULL DEFAULT 1,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_slug (slug),
  KEY ix_event_date (is_published, event_date),
  CONSTRAINT fk_event_cover FOREIGN KEY (cover_file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Photo albums, optionally linked to an event (rule W6).
CREATE TABLE cms_albums (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(120) NOT NULL,
  title           VARCHAR(150) NOT NULL,
  event_id        BIGINT UNSIGNED NULL,
  cover_file_id   BIGINT UNSIGNED NULL,
  is_published    TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_album_slug (slug),
  CONSTRAINT fk_album_event FOREIGN KEY (event_id) REFERENCES cms_events(id) ON DELETE SET NULL,
  CONSTRAINT fk_album_cover FOREIGN KEY (cover_file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cms_photos (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  album_id    BIGINT UNSIGNED NOT NULL,
  file_id     BIGINT UNSIGNED NOT NULL,
  caption     VARCHAR(200) NULL,
  position    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_photo_album (album_id, position),
  CONSTRAINT fk_photo_album FOREIGN KEY (album_id) REFERENCES cms_albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_photo_file FOREIGN KEY (file_id) REFERENCES files(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cms_videos (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  youtube_id    VARCHAR(20)  NOT NULL,
  title         VARCHAR(150) NOT NULL,
  description   VARCHAR(500) NULL,
  event_id      BIGINT UNSIGNED NULL,
  is_published  TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_video_event FOREIGN KEY (event_id) REFERENCES cms_events(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contact form messages (rules W8 to W11).
CREATE TABLE contact_messages (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  mobile      VARCHAR(15)  NULL,
  message     VARCHAR(2000) NOT NULL,
  status      ENUM('new','read','archived') NOT NULL DEFAULT 'new',
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_msg_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
