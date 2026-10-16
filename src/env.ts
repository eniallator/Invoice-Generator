import { raise } from "niall-utils";

import { isFile } from "./io.ts";

/** Loads the variables in the .env file, if there is one. Real environment variables take priority. */
export const loadEnv = (path = ".env"): void => {
  if (isFile(path)) process.loadEnvFile(path);
};

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  return value === undefined || value === ""
    ? raise(new Error(`Set ${name} in .env (see .env.example)`))
    : value;
};
