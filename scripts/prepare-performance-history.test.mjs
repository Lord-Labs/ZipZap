import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { prepareHistory } from "./prepare-performance-history.mjs";

test("replace isolated history after native-style exit with a retained WAL", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zipzap-history-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("zipzap-history-test-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const source = path.join(directory, "history-1000.sqlite");
  const db = new DatabaseSync(source);
  db.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO jobs VALUES (?, ?)");
  db.exec("BEGIN");
  for (let i = 0; i < 1000; i++)
    insert.run(
      String(i),
      JSON.stringify({
        status: "paused",
        downloaded: 0,
        url: `https://example.invalid/fixture-${i}`,
      }),
    );
  db.exec("COMMIT");
  db.close();
  const isolated = path.join(directory, `com.zipzap.smoke.${randomUUID().replaceAll("-", "")}`);
  mkdirSync(isolated);
  const destination = path.join(isolated, "zipzap.sqlite");
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {DatabaseSync} from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    db.prepare('INSERT INTO jobs VALUES (?, ?)').run('old', JSON.stringify({status:'paused', downloaded:0, url:'https://example.invalid/fixture-0'}));
    process.exit(0); // Deliberately skip SQLite destructors, as native process exit can.
  `,
      destination,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.ok(existsSync(`${destination}-wal`));
  prepareHistory(source, destination);
  const replaced = new DatabaseSync(destination, { readOnly: true });
  assert.equal(replaced.prepare("SELECT count(*) AS count FROM jobs").get().count, 1000);
  assert.equal(replaced.prepare("PRAGMA quick_check").get().quick_check, "ok");
  replaced.close();

  const pendingSource = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {DatabaseSync} from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA journal_mode=WAL; CREATE INDEX fixture_index ON jobs(data)');
    process.exit(0);
  `,
      source,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(pendingSource.status, 0, pendingSource.stderr);
  assert.throws(
    () => prepareHistory(source, destination),
    /Checkpoint the generated source history/,
  );

  const before = new DatabaseSync(source);
  before.prepare("UPDATE jobs SET data=? WHERE id='0'").run(
    JSON.stringify({
      status: "downloading",
      downloaded: 1,
      url: "https://example.invalid/fixture-0",
    }),
  );
  before.close();
  assert.throws(() => prepareHistory(source, destination));
  assert.throws(() => prepareHistory(source, path.join(directory, "zipzap.sqlite")));
  const preserved = new DatabaseSync(destination, { readOnly: true });
  assert.equal(preserved.prepare("SELECT count(*) AS count FROM jobs").get().count, 1000);
  assert.equal(
    JSON.parse(preserved.prepare("SELECT data FROM jobs WHERE id='0'").get().data).status,
    "paused",
  );
  preserved.close();
});
