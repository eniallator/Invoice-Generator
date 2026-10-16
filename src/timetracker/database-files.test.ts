import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFiles } from "../test-helpers.ts";
import { fetchLatestDatabase, latestDatabase } from "./database-files.ts";

// Fake backups: the tests build their own files, nothing here is real data
const OLD = "timetracker_2000_01_09_auto_database.db";
const NEW = "timetracker_2000_02_28_auto_database.db";

describe("latestDatabase", () => {
  it("picks the most recent backup by the date in its name", () => {
    expect(
      latestDatabase([OLD, NEW, "timetracker_1999_12_31_auto_database.db"])
    ).toBe(NEW);
  });

  it("does not depend on the order of the files", () => {
    expect(latestDatabase([NEW, OLD])).toBe(NEW);
    expect(latestDatabase([OLD, NEW])).toBe(NEW);
  });

  it("compares years, then months, then days", () => {
    expect(
      latestDatabase([
        "timetracker_1999_12_31_auto_database.db",
        "timetracker_2000_01_01_auto_database.db",
      ])
    ).toBe("timetracker_2000_01_01_auto_database.db");
  });

  it("ignores files that are not backups", () => {
    expect(
      latestDatabase([
        OLD,
        "notes.txt",
        "timetracker_2001_01_01_auto_database.db.tmp",
        "timetracker_2001_1_1_auto_database.db",
        "copy of timetracker_2001_01_01_auto_database.db",
      ])
    ).toBe(OLD);
  });

  it("is undefined if there are no backups", () => {
    expect(latestDatabase([])).toBeUndefined();
    expect(latestDatabase(["notes.txt"])).toBeUndefined();
  });
});

describe("fetchLatestDatabase", () => {
  it("copies the newest backup into the databases folder", () => {
    const dir = createFiles({
      [`drive/${OLD}`]: "old",
      [`drive/${NEW}`]: "new",
      "drive/notes.txt": "ignored",
    });
    const databases = join(dir, "databases");

    expect(fetchLatestDatabase(join(dir, "drive"), databases)).toBe(NEW);

    expect(readFileSync(join(databases, NEW), "utf8")).toBe("new");
    expect(existsSync(join(databases, OLD))).toBe(false);
    expect(existsSync(join(databases, "notes.txt"))).toBe(false);
  });

  it("replaces an earlier copy of the same backup", () => {
    const dir = createFiles({
      [`drive/${NEW}`]: "updated",
      [`databases/${NEW}`]: "stale",
    });
    fetchLatestDatabase(join(dir, "drive"), join(dir, "databases"));
    expect(readFileSync(join(dir, "databases", NEW), "utf8")).toBe("updated");
  });

  it("leaves the other databases already downloaded alone", () => {
    const dir = createFiles({
      [`drive/${NEW}`]: "new",
      [`databases/${OLD}`]: "kept",
    });
    fetchLatestDatabase(join(dir, "drive"), join(dir, "databases"));
    expect(readFileSync(join(dir, "databases", OLD), "utf8")).toBe("kept");
  });

  it("throws if the drive folder does not exist", () => {
    const dir = createFiles({ "other.txt": "" });
    expect(() =>
      fetchLatestDatabase(join(dir, "missing"), join(dir, "databases"))
    ).toThrow(
      /Drive folder not found: .*missing \(is Google Drive running\?\)/
    );
  });

  it("throws if the drive folder path is a file", () => {
    const dir = createFiles({ drive: "not a folder" });
    expect(() =>
      fetchLatestDatabase(join(dir, "drive"), join(dir, "databases"))
    ).toThrow("Drive folder not found");
  });

  it("throws if there is no backup in the drive folder", () => {
    const dir = createFiles({ "drive/notes.txt": "" });
    expect(() =>
      fetchLatestDatabase(join(dir, "drive"), join(dir, "databases"))
    ).toThrow(/No timetracker database found in .*drive/);
    expect(existsSync(join(dir, "databases"))).toBe(false);
  });
});
