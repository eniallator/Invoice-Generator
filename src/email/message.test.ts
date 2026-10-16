import { describe, expect, it } from "vitest";

import { lines } from "../test-helpers.ts";
import { parseEmail, parseRecipients } from "./message.ts";

describe("parseEmail", () => {
  it("takes the subject from the first line and the rest as the body", () => {
    expect(
      parseEmail(
        lines("Subject: Invoice AB0042", "", "Hi Jane,", "", "Thanks", "")
      )
    ).toEqual({ subject: "Invoice AB0042", body: "Hi Jane,\n\nThanks\n" });
  });

  it("trims the subject, and the blank lines around the body", () => {
    expect(
      parseEmail(lines("Subject:   Invoice  ", "", "", "Hi", "", ""))
    ).toEqual({ subject: "Invoice", body: "Hi\n" });
  });

  it("does not need a blank line after the subject", () => {
    expect(parseEmail(lines("Subject: Hi", "Body"))).toEqual({
      subject: "Hi",
      body: "Body\n",
    });
  });

  it("understands CRLF line endings", () => {
    expect(parseEmail("Subject: Hi\r\n\r\nLine one\r\nLine two\r\n")).toEqual({
      subject: "Hi",
      body: "Line one\nLine two\n",
    });
  });

  it("can have no body", () => {
    expect(parseEmail("Subject: Hi")).toEqual({ subject: "Hi", body: "\n" });
  });

  it("keeps a body line that looks like a subject", () => {
    expect(parseEmail(lines("Subject: Hi", "", "Subject: again"))).toEqual({
      subject: "Hi",
      body: "Subject: again\n",
    });
  });

  it.each([
    ["has no subject line", "Hello\n\nBody"],
    ["starts with a blank line", "\nSubject: Hi\n\nBody"],
    ["has an empty subject", "Subject:\n\nBody"],
    ["has a subject of just spaces", "Subject:    \n\nBody"],
    ["is empty", ""],
    ["has a subject in lowercase", "subject: Hi\n\nBody"],
  ])("rejects a template that %s", (_, template) => {
    expect(() => parseEmail(template)).toThrow(
      "The email template must start with a line like 'Subject: Invoice {{ invoice_id }}'"
    );
  });
});

describe("parseRecipients", () => {
  it("reads one address", () => {
    expect(parseRecipients("jane@example.com")).toEqual(["jane@example.com"]);
  });

  it("reads comma and semicolon separated addresses", () => {
    expect(
      parseRecipients("a@example.com, b@example.com;c@example.com")
    ).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("ignores spaces and empty entries", () => {
    expect(parseRecipients("  a@example.com ,, ;  b@example.com ,")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it.each(["", "  ", ",;", " , "])(
    "rejects %j as having no recipient",
    value => {
      expect(() => parseRecipients(value)).toThrow(
        "There is no recipient: set email=<address> in [INVOICE_TO], or use --to"
      );
    }
  );

  it.each([
    "jane",
    "jane@",
    "@example.com",
    "jane example@example.com",
    "Jane <jane@example.com>",
    "jane@example.com\nBcc: x@example.com",
  ])("rejects %j as an address", address => {
    expect(() => parseRecipients(`ok@example.com, ${address}`)).toThrow(
      /is not an email address/
    );
  });

  it("says which address it was", () => {
    expect(() => parseRecipients("a@example.com, nope")).toThrow(
      "'nope' is not an email address"
    );
  });
});
