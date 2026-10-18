# First-beta state fixture

`first-beta-state.json` is a representative synthetic fixture of the
`0.1.0-beta.1` jobs/settings JSON shape, not an export of personal state. URLs
use the reserved `.invalid` domain; IDs are fixed test identities. Tests replace
relative destinations with isolated temporary paths. The omitted optional
`download_folder` exercises the existing serde default.

The order deliberately differs from `created_at`: queued, interrupted download,
completed history. The interrupted entry includes a durable six-byte `prefix`
checkpoint, its SHA-256 and a strong validator; its displayed progress exceeds
the checkpoint to exercise recovery. The completed entry owns a separate file.
Migration tests construct the original tables at schema 0/1 and verify that order,
validators, hashes, paths and settings survive recovery or remain unchanged on
failure. The HTTP fixture adapts the interrupted record to its local resource and
checks validated range continuation and final-file integrity.
