# ADR 0003: Commit startup recovery and schema changes together

- Status: accepted for [#31](https://github.com/Lord-shaban/ZipZap/issues/31).
- Date: 2026-10-18.

## Decision

Keep the existing SQLite tables and JSON records at schema 1. This issue needs
no new job or settings fields: queue, schedule, category and appearance fields
belong to their scoped M6 implementation issues. Those changes must choose
explicit serde defaults for compatible optional data and advance `user_version`
when an older binary cannot safely interpret the persisted behavior. Do not add
placeholder fields or a migration framework.

After taking the existing single-owner lock, reject a newer schema before
changing journal mode or records. For supported schemas 0 and 1, use one SQLite
transaction for table creation, record validation, recovered job updates and
`user_version`. Preserve insertion order, IDs, validators, checkpoint hashes,
destinations and settings. On any failure, roll back the whole transaction before
returning an error; no manager or workers are exposed. Opening state must not
alter partial or completed files. Keep saved folders even if a drive is offline;
new folder selections still require an existing directory.

SQLite's journal provides rollback and crash recovery for this bounded upgrade;
no separate backup or copy of a live database/WAL pair is needed. The first-beta
fixture uses synthetic URLs and IDs and covers the existing optional folder
default. Future schema upgrades must extend these upgrade/failure/reopen tests.

## Recovery and downgrade limit

Malformed records and unsupported schemas fail explicitly without resetting the
database. Repair a private copy with ZipZap closed before retrying. Startup
failure must leave original records and owned files available for that repair.
Do not attach databases to public reports: URLs may be private.

This change does not raise the schema version or promise a general downgrade
path. Once a later feature raises the schema, an older binary must reject it.
Restore a coherent pre-upgrade SQLite backup with all instances closed, or use
the compatible newer binary; never lower `user_version` by hand. Completed files
remain separate from the database and must be kept.

[ADR 0004](0004-publication-recovery.md) extends this contract for schema 2:
validated publication recovery may clean owned temporary data after the entire
startup transaction commits. Completed user files remain untouched.
