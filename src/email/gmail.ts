import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { guardOrThrow, isObjectOf, isString, type Guard } from "deep-guards";
import { attempt, attemptAsync, raise } from "niall-utils";

import { isFile, readText, writeText } from "../io.ts";

/** Lets the app create drafts, and nothing else (it cannot read or send mail) */
export const GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
const DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

export interface Credentials {
  clientId: string;
  clientSecret: string;
  authUri: string;
  tokenUri: string;
}

type Fetch = typeof fetch;

const isCredentialsFile = isObjectOf({
  installed: isObjectOf({
    client_id: isString,
    client_secret: isString,
    auth_uri: isString,
    token_uri: isString,
  }),
});
const isRefreshToken = isObjectOf({ refresh_token: isString });
const isAccessToken = isObjectOf({ access_token: isString });
const isDraft = isObjectOf({ id: isString });

/** Reads the OAuth client file from the Google Cloud console (a "Desktop app" client) */
export const parseCredentials = (json: string): Credentials => {
  const { installed } = guardOrThrow(
    attempt(() => JSON.parse(json) as unknown),
    isCredentialsFile,
    "The Google credentials should be the JSON of a 'Desktop app' OAuth client: an 'installed' section with a client_id, client_secret, auth_uri and token_uri"
  );
  return {
    clientId: installed.client_id,
    clientSecret: installed.client_secret,
    authUri: installed.auth_uri,
    tokenUri: installed.token_uri,
  };
};

export const createPkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};

export const authUrl = (
  credentials: Credentials,
  redirectUri: string,
  state: string,
  challenge: string
): string => {
  const url = new URL(credentials.authUri);
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_COMPOSE_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Asks for a refresh token, so that this only has to be done once
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
};

const requestToken = async <T>(
  credentials: Credentials,
  params: Record<string, string>,
  guard: Guard<T>,
  fetchFn: Fetch
): Promise<T> => {
  const response = await fetchFn(credentials.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      ...params,
    }),
  });
  const data: unknown = await attemptAsync(() => response.json());
  if (!response.ok) {
    raise(
      new Error(
        `Google refused the token request (${
          response.status
        }): ${JSON.stringify(data)}`
      )
    );
  }
  return guardOrThrow(
    data,
    guard,
    "Google's token response was not as expected"
  );
};

/** Swaps the authorisation code for a refresh token */
export const exchangeCode = async (
  credentials: Credentials,
  request: { code: string; redirectUri: string; verifier: string },
  fetchFn: Fetch
): Promise<string> =>
  (
    await requestToken(
      credentials,
      {
        grant_type: "authorization_code",
        code: request.code,
        redirect_uri: request.redirectUri,
        code_verifier: request.verifier,
      },
      isRefreshToken,
      fetchFn
    )
  ).refresh_token;

export const refreshAccessToken = async (
  credentials: Credentials,
  refreshToken: string,
  fetchFn: Fetch
): Promise<string> =>
  (
    await requestToken(
      credentials,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      isAccessToken,
      fetchFn
    )
  ).access_token;

/** Saves the message (an RFC 822 email, see `buildMessage`) as a draft, and returns the draft's id */
export const createDraft = async (
  accessToken: string,
  message: string,
  fetchFn: Fetch
): Promise<string> => {
  const response = await fetchFn(DRAFTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { raw: Buffer.from(message).toString("base64url") },
    }),
  });
  const data: unknown = await attemptAsync(() => response.json());
  if (!response.ok) {
    raise(
      new Error(
        `Gmail did not create the draft (${response.status}): ${JSON.stringify(data)}`
      )
    );
  }
  return guardOrThrow(data, isDraft, "Gmail's response was not as expected").id;
};

/**
 * Listens on a free local port for Google to send the browser back to with the
 * authorisation code, and stops listening once it has.
 */
export const startLoopback = async (
  state: string
): Promise<{ redirectUri: string; code: Promise<string> }> => {
  const { promise: code, resolve, reject } = Promise.withResolvers<string>();
  const server = createServer((request, response) => {
    const { searchParams } = new URL(String(request.url), "http://127.0.0.1");
    const authCode = searchParams.get("code");
    const error = searchParams.get("error");
    // Anything else (like a browser asking for the favicon) is ignored
    if (
      searchParams.get("state") !== state ||
      (authCode === null && error === null)
    ) {
      response.writeHead(400).end("This is not the response from Google");
      return;
    }
    response.end("You can close this tab now.");
    if (authCode === null) {
      reject(new Error(`Google did not authorise this: ${String(error)}`));
    } else {
      resolve(authCode);
    }
  });
  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  void code.then(stop, stop);

  await new Promise<void>(listening =>
    server.listen(0, "127.0.0.1", listening)
  );
  const { port } = server.address() as AddressInfo;
  return { redirectUri: `http://127.0.0.1:${port}`, code };
};

/** Has the person approve access in their browser, and returns the refresh token that this gives */
export const authorise = async (
  credentials: Credentials,
  showUrl: (url: string) => void,
  fetchFn: Fetch
): Promise<string> => {
  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = createPkce();
  const { redirectUri, code } = await startLoopback(state);
  showUrl(authUrl(credentials, redirectUri, state, challenge));
  return exchangeCode(
    credentials,
    { code: await code, redirectUri, verifier },
    fetchFn
  );
};

const readRefreshToken = (tokenPath: string): string =>
  guardOrThrow(
    attempt(() => JSON.parse(readText(tokenPath)) as unknown),
    isRefreshToken,
    `${tokenPath} is not valid, delete it to authorise again`
  ).refresh_token;

/**
 * An access token for Gmail. The first time, the person approves access in
 * their browser and the refresh token that gives is kept in `tokenPath`, after
 * which a new access token is just asked for.
 */
export const getAccessToken = async (
  credentials: Credentials,
  tokenPath: string,
  showUrl: (url: string) => void,
  fetchFn: Fetch
): Promise<string> => {
  if (isFile(tokenPath)) {
    return refreshAccessToken(
      credentials,
      readRefreshToken(tokenPath),
      fetchFn
    );
  }
  const refreshToken = await authorise(credentials, showUrl, fetchFn);
  writeText(
    tokenPath,
    `${JSON.stringify({ refresh_token: refreshToken }, null, 2)}\n`
  );
  return refreshAccessToken(credentials, refreshToken, fetchFn);
};
