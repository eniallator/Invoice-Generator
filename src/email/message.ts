import { raise } from "niall-utils";

const SUBJECT_PREFIX = "Subject:";
const ADDRESS_RE = /^[^\s@,;]+@[^\s@,;]+$/;

/**
 * Splits a rendered email template into its subject and body. The template's
 * first line is the subject, e.g. `Subject: Invoice {{ invoice_id }}`, and
 * everything after it is the body.
 */
export const parseEmail = (
  rendered: string
): { subject: string; body: string } => {
  const [first = "", ...rest] = rendered.replaceAll("\r\n", "\n").split("\n");
  const subject = first.startsWith(SUBJECT_PREFIX)
    ? first.slice(SUBJECT_PREFIX.length).trim()
    : "";
  if (subject === "") {
    raise(
      new Error(
        `The email template must start with a line like '${
          SUBJECT_PREFIX
        } Invoice {{ invoice_id }}'`
      )
    );
  }
  return { subject, body: `${rest.join("\n").trim()}\n` };
};

/** The addresses in a comma or semicolon separated list */
export const parseRecipients = (value: string): string[] => {
  const addresses = value
    .split(/[,;]/)
    .map(address => address.trim())
    .filter(address => address !== "");
  if (addresses.length === 0) {
    raise(
      new Error(
        "There is no recipient: set email=<address> in [INVOICE_TO], or use --to"
      )
    );
  }
  const invalid = addresses.find(address => !ADDRESS_RE.test(address));
  if (invalid !== undefined) {
    raise(new Error(`'${invalid}' is not an email address`));
  }
  return addresses;
};
