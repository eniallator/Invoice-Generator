// Process entry point: kept thin (and excluded from coverage) like generate.ts.
// Creates a Gmail draft for each invoice, with its pdf attached, ready to review
// and send. Run `pnpm generate` for the invoice first, so that its pdf exists.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { raise } from "niall-utils";

import { renderTemplate } from "./build.ts";
import { resolvePaths } from "./cli.ts";
import { loadConfig, META } from "./config/imports.ts";
import {
  createDraft,
  getAccessToken,
  parseCredentials,
} from "./email/gmail.ts";
import { parseEmail, parseRecipients } from "./email/message.ts";
import { buildMessage } from "./email/mime.ts";
import { loadEnv, requireEnv } from "./env.ts";
import { isFile, readText } from "./io.ts";

const USAGE = `Usage: pnpm email-invoices <cfg>... [options]

Create a Gmail draft for each invoice, with its pdf attached. The pdf is the
one that \`pnpm generate <cfg>\` makes. Nothing is sent, you do that from Gmail.

Options:
  -t, --template <path>  Email template, with the subject on its first line
                         (default: ./email_template.txt)
      --to <addresses>   Send to these (comma separated) instead of the
                         invoice's INVOICE_TO email
  -h, --help             Show this help`;

loadEnv();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: "string", short: "t", default: "./email_template.txt" },
    to: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const credentials = parseCredentials(
  readText(requireEnv("GMAIL_CREDENTIALS_FILE"))
);
const tokenPath = process.env["GMAIL_TOKEN_FILE"] ?? "./.gmail-token.json";
const showUrl = (url: string) => {
  console.log(
    `Open this in your browser to let this create drafts:\n\n${url}\n`
  );
};

const accessToken = await getAccessToken(
  credentials,
  tokenPath,
  showUrl,
  fetch
);

for (const cfg of positionals) {
  const pdfPath = resolvePaths({
    cfg,
    template: undefined,
    outPath: "SAME",
    quote: false,
  }).outPath.replace(/\.tex$/, ".pdf");
  if (!isFile(pdfPath)) {
    raise(
      new Error(`${pdfPath} does not exist, run pnpm generate ${cfg} first`)
    );
  }

  const config = loadConfig(cfg);
  const { subject, body } = parseEmail(renderTemplate(cfg, values.template));
  const to = parseRecipients(
    values.to ?? config.get("INVOICE_TO", "email") ?? ""
  );
  const invoiceId = config.get(META, "invoice_id") ?? basename(pdfPath, ".pdf");

  const draftId = await createDraft(
    accessToken,
    buildMessage({
      to,
      subject,
      body,
      attachment: {
        filename: `Invoice ${invoiceId}.pdf`,
        contentType: "application/pdf",
        data: readFileSync(pdfPath),
      },
    }),
    fetch
  );
  console.log(
    `${cfg}: created draft ${draftId} to ${to.join(", ")} (${subject})`
  );
}
