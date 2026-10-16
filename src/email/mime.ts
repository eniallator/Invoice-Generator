import { randomUUID } from "node:crypto";
import { raise } from "niall-utils";

export interface Attachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

export interface EmailMessage {
  to: string[];
  subject: string;
  body: string;
  attachment?: Attachment;
}

const CRLF = "\r\n";
const BASE64_LINE_LENGTH = 76;
// An encoded word can be at most 75 characters, and 45 bytes is 60 of those
// once it is base64 encoded, with room for the `=?UTF-8?B?` and `?=` around it
const MAX_WORD_BYTES = 45;

const singleLine = (name: string, value: string): string =>
  /[\r\n]/.test(value)
    ? raise(new Error(`${name} must be a single line`))
    : value;

const base64Lines = (data: Uint8Array): string => {
  const encoded = Buffer.from(data).toString("base64");
  const lines: string[] = [];
  for (let start = 0; start < encoded.length; start += BASE64_LINE_LENGTH) {
    lines.push(encoded.slice(start, start + BASE64_LINE_LENGTH));
  }
  return lines.join(CRLF);
};

/** Header text that is not plain ASCII is split into UTF-8 encoded words (RFC 2047) */
const encodeHeader = (text: string): string => {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let current = "";
  for (const character of text) {
    if (Buffer.byteLength(current + character) > MAX_WORD_BYTES) {
      words.push(current);
      current = "";
    }
    current += character;
  }
  words.push(current);
  return words
    .map(word => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`)
    .join(" ");
};

const textPart = (body: string): string[] => [
  'Content-Type: text/plain; charset="UTF-8"',
  "Content-Transfer-Encoding: base64",
  "",
  base64Lines(Buffer.from(body.replaceAll(/\r?\n/g, CRLF))),
];

const attachmentPart = ({
  filename,
  contentType,
  data,
}: Attachment): string[] => {
  // Keeps the name to plain ASCII so that it never needs encoding
  const name = singleLine("The attachment's name", filename).replaceAll(
    /[^\w. -]/g,
    "_"
  );
  return [
    `Content-Type: ${singleLine("The attachment's type", contentType)}; name="${name}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${name}"`,
    "",
    base64Lines(data),
  ];
};

/** Builds the email as the text of an RFC 822 message, ready to be sent or saved as a draft */
export const buildMessage = (
  { to, subject, body, attachment }: EmailMessage,
  boundary = `=_${randomUUID()}`
): string => {
  if (to.length === 0) raise(new Error("An email needs a recipient"));
  const headers = [
    "MIME-Version: 1.0",
    `To: ${to.map(address => singleLine("A recipient", address)).join(", ")}`,
    `Subject: ${encodeHeader(singleLine("The subject", subject))}`,
  ];
  if (attachment === undefined) {
    return [...headers, ...textPart(body), ""].join(CRLF);
  }
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart(body),
    `--${boundary}`,
    ...attachmentPart(attachment),
    `--${boundary}--`,
    "",
  ].join(CRLF);
};
