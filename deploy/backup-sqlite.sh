#!/usr/bin/env bash
# Consistent, encrypted database snapshots for the single-VPS Compose setup.
# The private age identity belongs off-server. The server needs only a recipient.
set -euo pipefail
umask 077
if [[ $EUID -ne 0 || $# -ne 2 ]]; then
  echo "Use as root: backup-sqlite.sh /srv/sayboard RECIPIENT_FILE" >&2
  exit 1
fi
cd "$1"
recipient=$(cat "$2")
if [[ ! $recipient =~ ^age1[0-9a-z]{58}$ ]]; then
  echo "Expected one age public recipient." >&2
  exit 1
fi
command -v age >/dev/null
exec 9>/run/lock/sayboard-backup.lock
flock -n 9 || exit 0
install -d -m 700 backups
temporary=$(mktemp -d backups/.snapshot.XXXXXX)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot="/data/backup-${stamp}-$$.sqlite"
compose=(docker compose -p sayboard -f compose.yaml -f deploy/compose.small.yaml)
cleanup() {
  "${compose[@]}" exec -T app node -e \
    'require("node:fs").rmSync(process.argv[1], {force:true})' "$snapshot" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT
"${compose[@]}" exec -T app node server-dist/manage.cjs backup "$snapshot"
"${compose[@]}" exec -T app node -e \
  'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1],{readOnly:true}); if(db.prepare("PRAGMA quick_check").get().quick_check!=="ok") process.exit(1); db.close();' "$snapshot"
container=$("${compose[@]}" ps --quiet app)
docker cp "$container:$snapshot" "$temporary/database.sqlite" >/dev/null
age -r "$recipient" -o "$temporary/database.sqlite.age" "$temporary/database.sqlite"
destination="backups/sayboard-db-${stamp}.sqlite.age"
if [[ -e $destination ]]; then
  echo "Backup destination already exists." >&2
  exit 1
fi
mv "$temporary/database.sqlite.age" "$destination"
find backups -maxdepth 1 -type f -name 'sayboard-db-????????T??????Z.sqlite.age' -mtime +7 -delete
echo "Encrypted Sayboard database backup completed."
