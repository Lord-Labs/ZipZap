// Replace only an isolated synthetic dataset, after its native process has exited.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export function prepareHistory(source, destination) {
  const count = Number(/^history-(100|1000)\.sqlite$/.exec(path.basename(source))?.[1]);
  assert.ok(count, "Expected the generated 100/1000-row history");
  assert.equal(path.basename(destination), "zipzap.sqlite");
  assert.match(path.basename(path.dirname(destination)), /^com\.zipzap\.smoke\.[a-f0-9]{32}$/);
  const fixture = new DatabaseSync(source, { readOnly: true });
  try {
    assert.equal(fixture.prepare("PRAGMA quick_check").get().quick_check, "ok");
    const rows = fixture.prepare("SELECT data FROM jobs").all();
    assert.equal(rows.length, count);
    for (const row of rows) {
      const job = JSON.parse(row.data);
      assert.equal(job.status, "paused");
      assert.equal(job.downloaded, 0);
      assert.match(job.url, /^https:\/\/example\.invalid\/fixture-\d+$/);
    }
  } finally {
    fixture.close();
  }
  assert.ok(
    !existsSync(`${source}-wal`) || statSync(`${source}-wal`).size === 0,
    "Checkpoint the generated source history before copying it",
  );
  if (existsSync(destination)) {
    const previous = new DatabaseSync(destination);
    try {
      // App exit can leave a valid WAL; never replay its pages onto another database.
      assert.equal(previous.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy, 0);
    } finally {
      previous.close();
    }
  }
  assert.ok(
    !existsSync(`${destination}-wal`) && !existsSync(`${destination}-shm`),
    "Close all owners of the isolated database before replacing it",
  );
  copyFileSync(source, destination);
  const copied = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(copied.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(copied.prepare("SELECT count(*) AS count FROM jobs").get().count, count);
  } finally {
    copied.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(
    process.argv.length,
    4,
    "usage: node scripts/prepare-performance-history.mjs <history-N.sqlite> <isolated-state/zipzap.sqlite>",
  );
  prepareHistory(process.argv[2], process.argv[3]);
}
