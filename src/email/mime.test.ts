import { describe, expect, it } from "vitest";

import { buildMessage } from "./mime.ts";

const CRLF = "\r\n";
const crlf = (...lines: string[]) => lines.join(CRLF);

const decode = (base64Lines: string) =>
  Buffer.from(base64Lines.replaceAll(CRLF, ""), "base64");

/** The words of a header with its UTF-8 encoded words (RFC 2047) decoded again */
const decodeHeader = (header: string): string =>
  header
    .split(" ")
    .map(word => {
      const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(word);
      return match === null
        ? word
        : Buffer.from(match[1] ?? "", "base64").toString("utf8");
    })
    .join("");

const headerOf = (message: string, name: string): string =>
  message
    .split(CRLF)
    .find(line => line.startsWith(`${name}: `))
    ?.slice(name.length + 2) ?? "";

describe("buildMessage", () => {
  it("builds a plain text email", () => {
    expect(
      buildMessage({
        to: ["jane@example.com"],
        subject: "Invoice AB0042",
        body: "Hi\n",
      })
    ).toBe(
      crlf(
        "MIME-Version: 1.0",
        "To: jane@example.com",
        "Subject: Invoice AB0042",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        "SGkNCg==",
        ""
      )
    );
  });

  it("builds an email with an attachment", () => {
    expect(
      buildMessage(
        {
          to: ["jane@example.com"],
          subject: "Invoice",
          body: "Hi\n",
          attachment: {
            filename: "Invoice AB0042.pdf",
            contentType: "application/pdf",
            data: Buffer.from("PDF"),
          },
        },
        "BOUNDARY"
      )
    ).toBe(
      crlf(
        "MIME-Version: 1.0",
        "To: jane@example.com",
        "Subject: Invoice",
        'Content-Type: multipart/mixed; boundary="BOUNDARY"',
        "",
        "--BOUNDARY",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        "SGkNCg==",
        "--BOUNDARY",
        'Content-Type: application/pdf; name="Invoice AB0042.pdf"',
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="Invoice AB0042.pdf"',
        "",
        "UERG",
        "--BOUNDARY--",
        ""
      )
    );
  });

  it("sends to every recipient", () => {
    const message = buildMessage({
      to: ["a@example.com", "b@example.com"],
      subject: "Hi",
      body: "Hi",
    });
    expect(headerOf(message, "To")).toBe("a@example.com, b@example.com");
  });

  describe("the body", () => {
    const bodyOf = (body: string) =>
      decode(
        buildMessage({ to: ["a@example.com"], subject: "Hi", body }).split(
          CRLF + CRLF
        )[1] ?? ""
      ).toString("utf8");

    it("uses CRLF line endings", () => {
      expect(bodyOf("a\nb\n")).toBe("a\r\nb\r\n");
    });

    it("keeps CRLF line endings as they are", () => {
      expect(bodyOf("a\r\nb")).toBe("a\r\nb");
    });

    it("keeps any characters", () => {
      expect(bodyOf("Café ✓ £10 \u{1F600}")).toBe("Café ✓ £10 \u{1F600}");
    });
  });

  describe("the subject", () => {
    const subjectOf = (subject: string) =>
      headerOf(
        buildMessage({ to: ["a@example.com"], subject, body: "Hi" }),
        "Subject"
      );

    it("is left alone if it is plain ASCII", () => {
      expect(subjectOf("Invoice AB0042 (March) - £0")).not.toBe("");
      expect(subjectOf("Invoice AB0042 (March)")).toBe(
        "Invoice AB0042 (March)"
      );
      expect(subjectOf("")).toBe("");
    });

    it("is encoded if it is not plain ASCII", () => {
      const subject = subjectOf("Invoice £10 ✓");
      expect(subject).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(decodeHeader(subject)).toBe("Invoice £10 ✓");
    });

    it("is split into encoded words that are short enough", () => {
      const long = "é".repeat(100) + "\u{1F600}".repeat(30);
      const subject = subjectOf(long);
      const words = subject.split(" ");
      expect(words.length).toBeGreaterThan(1);
      for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
      expect(decodeHeader(subject)).toBe(long);
    });

    it("never splits a character between encoded words", () => {
      const long = "\u{1F600}".repeat(40);
      for (const word of subjectOf(long).split(" ")) {
        const text = decodeHeader(word);
        expect(text).not.toContain("�");
        expect(text.length % 2).toBe(0);
      }
    });
  });

  describe("the attachment", () => {
    const attachmentOf = (data: Uint8Array, filename = "x.pdf") =>
      buildMessage(
        {
          to: ["a@example.com"],
          subject: "Hi",
          body: "Hi",
          attachment: { filename, contentType: "application/pdf", data },
        },
        "B"
      );

    it("is wrapped at 76 characters, and can be decoded again", () => {
      const data = Uint8Array.from({ length: 500 }, (_, index) => index % 256);
      // The blocks are: the headers, the body's headers, the body and the
      // attachment's headers, and finally the attachment's data
      const part = attachmentOf(data).split(CRLF + CRLF)[3] ?? "";
      const lines = part
        .split(CRLF)
        .filter(line => line !== "" && !line.startsWith("--"));
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(76);
      expect(lines.slice(0, -1).every(line => line.length === 76)).toBe(true);
      expect(decode(lines.join(CRLF))).toEqual(Buffer.from(data));
    });

    it("can be empty", () => {
      const message = attachmentOf(new Uint8Array());
      expect(message).toContain(crlf("", "--B--"));
    });

    it("has a name that is plain ASCII", () => {
      expect(attachmentOf(new Uint8Array(), 'a/b"c é.pdf')).toContain(
        'name="a_b_c _.pdf"'
      );
      expect(attachmentOf(new Uint8Array(), "Invoice-1_a.b.pdf")).toContain(
        'filename="Invoice-1_a.b.pdf"'
      );
    });
  });

  describe("the boundary", () => {
    const attached = () =>
      buildMessage({
        to: ["a@example.com"],
        subject: "Hi",
        body: "Hi",
        attachment: {
          filename: "x.pdf",
          contentType: "application/pdf",
          data: new Uint8Array(),
        },
      });
    const boundaryOf = (message: string) =>
      /boundary="([^"]+)"/.exec(message)?.[1];

    it("is random by default", () => {
      expect(boundaryOf(attached())).toMatch(/^=_[0-9a-f-]{36}$/);
      expect(boundaryOf(attached())).not.toBe(boundaryOf(attached()));
    });

    it("is used for every part", () => {
      const message = attached();
      const boundary = boundaryOf(message) ?? "";
      expect(message.split(`--${boundary}`)).toHaveLength(4);
      expect(message).toContain(`--${boundary}--`);
    });
  });

  describe("headers that could be abused", () => {
    it.each([
      ["a recipient", { to: ["a@example.com\r\nBcc: me@example.com"] }],
      ["a recipient", { to: ["a@example.com\nBcc: me@example.com"] }],
      ["The subject", { subject: "Hi\r\nBcc: me@example.com" }],
      ["The subject", { subject: "Hi\nBcc: me@example.com" }],
    ])("rejects a line break in %s", (name, overrides) => {
      expect(() =>
        buildMessage({
          to: ["a@example.com"],
          subject: "Hi",
          body: "Hi",
          ...overrides,
        })
      ).toThrow(new RegExp(`${name} must be a single line`, "i"));
    });

    it.each([
      ["The attachment's name", { filename: "a\r\nb.pdf" }],
      ["The attachment's type", { contentType: "a/b\r\nBcc: x" }],
    ])("rejects a line break in %s", (name, overrides) => {
      expect(() =>
        buildMessage({
          to: ["a@example.com"],
          subject: "Hi",
          body: "Hi",
          attachment: {
            filename: "x.pdf",
            contentType: "application/pdf",
            data: new Uint8Array(),
            ...overrides,
          },
        })
      ).toThrow(`${name} must be a single line`);
    });

    it("rejects having nobody to send to", () => {
      expect(() => buildMessage({ to: [], subject: "Hi", body: "Hi" })).toThrow(
        "An email needs a recipient"
      );
    });
  });
});
