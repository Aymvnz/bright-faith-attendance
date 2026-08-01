// Direct Google Sheets API v4 access using a Google Cloud service account.
// Replaces Lovable's connector-gateway.lovable.dev proxy so this app can run
// anywhere (local, Vercel, Netlify) without depending on Lovable's hosting.
//
// Setup required (see README section "Google Sheets setup"):
//   1. Create a Google Cloud service account with the Sheets API enabled.
//   2. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//      in your environment (.env locally, project settings on your host).
//   3. Share the target Google Sheet with that service account's email
//      address (Editor access) — the same way you'd share it with a person.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getCredentials() {
  const email = process.env["GOOGLE_SERVICE_ACCOUNT_EMAIL"];
  const rawKey = process.env["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"];
  const privateKey = rawKey?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    const missing = [
      ...(!email ? ["GOOGLE_SERVICE_ACCOUNT_EMAIL"] : []),
      ...(!privateKey ? ["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"] : []),
    ];
    throw new Error(
      `Google Sheets is not configured. Missing env var(s): ${missing.join(", ")}.`,
    );
  }
  return { email, privateKey };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const { email, privateKey } = getCredentials();
  const { createSign } = await import("node:crypto");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(privateKey));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Google token request failed [${res.status}]: ${body}`);
    throw new Error("Could not authenticate with Google Sheets.");
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/** Calls the Google Sheets API v4. `path` is appended after `/spreadsheets`. */
export async function sheetsFetch(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets request failed [${res.status}]: ${body}`);
    throw new Error(`Google Sheets request failed [${res.status}].`);
  }
  return res.json();
}
