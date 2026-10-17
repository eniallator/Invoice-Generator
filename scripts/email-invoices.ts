// Process entry point: kept thin like generate.ts, as the scripts are not
// covered by the tests. Creates a Gmail draft for each invoice, with its pdf
// attached, ready to review and send. Run `pnpm generate` and `pnpm export` for
// the invoice first, so that its pdf has been exported.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { raise } from "niall-utils";

import { renderTemplate } from "../src/build.ts";
import { loadConfig, META } from "../src/config/imports.ts";
import {
  createDraft,
  getAccessToken,
  parseCredentials,
} from "../src/email/gmail.ts";
import { parseEmail, parseRecipients } from "../src/email/message.ts";
import { buildMessage } from "../src/email/mime.ts";
import { loadEnv, requireEnv } from "../src/env.ts";
import { exportName } from "../src/export-invoice.ts";
import { isFile, readText } from "../src/io.ts";

const USAGE = `Usage: pnpm email-invoices <cfg>... [options]

Create a Gmail draft for each invoice, with its pdf attached. The pdf is the
one in EXPORT_PDF_DIR, which \`pnpm export <cfg>\` puts it in after
\`pnpm generate <cfg>\` makes it. Nothing is sent, you do that from Gmail.

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

const pdfDir = requireEnv("EXPORT_PDF_DIR");

for (const cfg of positionals) {
  const pdfPath = join(pdfDir, `${exportName(cfg)}.pdf`);
  if (!isFile(pdfPath)) {
    raise(
      new Error(
        `${pdfPath} does not exist, run pnpm generate ${cfg} and then pnpm export ${cfg} first`
      )
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
