import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEnv, requireEnv } from "./env.ts";
import { createFiles } from "./test-helpers.ts";

const NAME = "INVOICE_GENERATOR_TEST_VARIABLE";

afterEach(() => {
  delete process.env[NAME];
  vi.unstubAllEnvs();
});

describe("loadEnv", () => {
  it("loads the variables in the .env file", () => {
    const dir = createFiles({ ".env": `${NAME}=from the file` });
    loadEnv(join(dir, ".env"));
    expect(process.env[NAME]).toBe("from the file");
  });

  it("does nothing if there is no .env file", () => {
    const dir = createFiles({ "other.txt": "" });
    expect(() => {
      loadEnv(join(dir, ".env"));
    }).not.toThrow();
    expect(process.env[NAME]).toBeUndefined();
  });

  it("does not override variables that are already set", () => {
    vi.stubEnv(NAME, "already set");
    const dir = createFiles({ ".env": `${NAME}=from the file` });
    loadEnv(join(dir, ".env"));
    expect(process.env[NAME]).toBe("already set");
  });
});

describe("requireEnv", () => {
  it("returns the value of the variable", () => {
    vi.stubEnv(NAME, "value");
    expect(requireEnv(NAME)).toBe("value");
  });

  it.each([undefined, ""])("throws if the variable is %j", value => {
    vi.stubEnv(NAME, value);
    expect(() => requireEnv(NAME)).toThrow(
      `Set ${NAME} in .env (see .env.example)`
    );
  });
});
