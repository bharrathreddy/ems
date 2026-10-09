#!/usr/bin/env sh
# Nightly MySQL backup (requirement AU7). Cron on the VPS:
#   15 2 * * * /opt/ems/infra/backup.sh >> /var/log/ems-backup.log 2>&1
# Copy the files off the server (e.g. rclone to object storage) and test a restore monthly.
set -eu
STAMP=$(date +%Y%m%d-%H%M)
DIR=${BACKUP_DIR:-/opt/ems/backups}
mkdir -p "$DIR"
docker compose -f /opt/ems/infra/docker-compose.yml --env-file /opt/ems/infra/.env.production exec -T mysql \
  sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers ems' | gzip > "$DIR/ems-$STAMP.sql.gz"
find "$DIR" -name 'ems-*.sql.gz' -mtime +30 -delete
echo "Backup written: $DIR/ems-$STAMP.sql.gz"
