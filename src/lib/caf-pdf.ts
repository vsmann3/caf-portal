import "server-only";
import "regenerator-runtime/runtime";
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { readFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { z } from "zod";

const attachmentSchema = z.object({
  id: z.string(),
  originalName: z.string().max(500),
  documentType: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  storageProvider: z.enum(["local", "s3"]),
  storageKey: z.string(),
  sha256: z.string().nullable().optional(),
});
export const approvedCafSchema = z
  .object({
    customerId: z.string().regex(/^[1-9]\d{9}$/),
    cafNumber: z.string(),
    customerName: z.string(),
    company: z
      .object({ name: z.string(), companyCode: z.string() })
      .passthrough(),
    franchise: z.object({ name: z.string(), code: z.string() }).passthrough(),
    documents: z.array(attachmentSchema).max(100),
  })
  .passthrough();
export type ApprovedCaf = z.infer<typeof approvedCafSchema>;
export class CafPdfError extends Error {}
type Evidence = {
  document: ApprovedCaf["documents"][number];
  bytes: Buffer;
  hash: string;
};

export async function buildCafPdf(
  caf: ApprovedCaf,
  load: (doc: Evidence["document"]) => Promise<Buffer>,
) {
  const evidence: Evidence[] = [];
  let size = 0;
  for (const doc of caf.documents) {
    let bytes: Buffer;
    try {
      bytes = await load(doc);
    } catch {
      throw new CafPdfError(
        `Cannot read attachment: ${doc.originalName}. No partial PDF was generated.`,
      );
    }
    size += bytes.length;
    if (size > 128 * 1024 * 1024)
      throw new CafPdfError(
        "Attachments exceed the 128 MB export limit. Contact the administrator; no documents were omitted.",
      );
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (doc.sha256 && hash !== doc.sha256)
      throw new CafPdfError(
        `Attachment integrity check failed: ${doc.originalName}. Contact the administrator.`,
      );
    evidence.push({ document: doc, bytes, hash });
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const latin = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"),
    ),
    { subset: true },
  );
  const deva = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "assets/fonts/NotoSansDevanagari-Regular.ttf"),
    ),
    { subset: true },
  );
  const sets = [
    new Set(latin.getCharacterSet()),
    new Set(deva.getCharacterSet()),
  ];
  const ink = rgb(0.08, 0.14, 0.24),
    blue = rgb(0.12, 0.28, 0.48),
    muted = rgb(0.38, 0.43, 0.5);
  const W = 595.28,
    H = 841.89,
    M = 44,
    usable = W - 2 * M;
  let page!: PDFPage;
  let y = H - 100;
  const ownedPages: PDFPage[] = [];
  function font(text: string): PDFFont {
    return /[\u0900-\u097f]/u.test(text) ? deva : latin;
  }
  function safe(value: unknown) {
    const text = String(value ?? "Not recorded");
    const set = sets[/[\u0900-\u097f]/u.test(text) ? 1 : 0];
    return text
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, "")
      .replace(/\r/g, "")
      .replace(/[^\n]/gu, (c) => {
        const cp = c.codePointAt(0)!;
        return set.has(cp) ? c : `[U+${cp.toString(16).toUpperCase()}]`;
      });
  }
  function lines(value: unknown, width: number, size = 10) {
    const text = safe(value),
      result: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const token of paragraph.split(/\s+/u)) {
        if (!token) continue;
        const proposal = line ? `${line} ${token}` : token;
        if (font(proposal).widthOfTextAtSize(proposal, size) <= width) {
          line = proposal;
          continue;
        }
        if (line) result.push(line);
        line = "";
        for (const { segment } of new Intl.Segmenter(undefined, {
          granularity: "grapheme",
        }).segment(token)) {
          if (
            line &&
            font(line + segment).widthOfTextAtSize(line + segment, size) > width
          ) {
            result.push(line);
            line = "";
          }
          line += segment;
        }
      }
      result.push(line || " ");
    }
    return result;
  }
  function draw(
    text: unknown,
    x: number,
    top: number,
    width: number,
    size = 10,
    color = ink,
  ) {
    const rows = lines(text, width, size);
    rows.forEach((line, i) =>
      page.drawText(line, {
        x,
        y: top - i * (size + 4),
        size,
        font: font(line),
        color,
      }),
    );
    return rows.length * (size + 4);
  }
  function fresh(title = "Customer Application Form") {
    page = pdf.addPage([W, H]);
    ownedPages.push(page);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: blue });
    const titleHeight = draw(
      caf.company.name,
      M,
      H - 40,
      usable - 145,
      15,
      blue,
    );
    draw("APPROVED CAF", W - M - 126, H - 40, 126, 11, blue);
    y = H - 48 - Math.max(titleHeight, 22);
    y -= draw(title, M, y, usable, 12);
    y -= 10;
    page.drawLine({
      start: { x: M, y: y + 3 },
      end: { x: W - M, y: y + 3 },
      thickness: 0.6,
      color: rgb(0.8, 0.84, 0.89),
    });
    y -= 15;
  }
  function ensure(height: number) {
    if (y - height < 55) fresh("Customer Application Form - continued");
  }
  function section(title: string) {
    ensure(240);
    page.drawRectangle({
      x: M,
      y: y - 22,
      width: usable,
      height: 24,
      color: rgb(0.92, 0.95, 0.98),
    });
    draw(title, M + 8, y - 15, usable - 16, 11, blue);
    y -= 37;
  }
  function row(fields: [string, unknown][]) {
    const width = (usable - 18 * (fields.length - 1)) / fields.length;
    const height =
      Math.max(...fields.map(([, v]) => lines(v, width).length * 14)) + 27;
    ensure(height);
    fields.forEach(([label, value], i) => {
      const x = M + i * (width + 18);
      draw(label.toUpperCase(), x, y, width, 8, muted);
      draw(value || "Not recorded", x, y - 16, width, 10);
    });
    y -= height;
  }
  function value(key: string) {
    return caf[key];
  }
  const stamp = (v: unknown) =>
    typeof v === "string" && !Number.isNaN(Date.parse(v))
      ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) +
        " IST"
      : "Not recorded";
  fresh();
  row([
    ["Customer ID", caf.customerId],
    ["CAF number", caf.cafNumber],
  ]);
  row([
    ["Company", caf.company.name],
    ["Franchise", `${caf.franchise.name} (${caf.franchise.code})`],
  ]);
  row([
    ["Revision", value("revision") ?? 1],
    ["Customer type", value("customerType")],
  ]);
  section("Customer details");
  row([
    ["Customer / signatory", caf.customerName],
    ["Father / spouse", value("fatherName")],
  ]);
  row([
    ["Mobile", value("mobile")],
    ["Email", value("email")],
  ]);
  row([
    ["Alternate phone", value("altPhone")],
    ["Gender", value("gender")],
  ]);
  row([
    [
      "Date of birth",
      typeof value("dob") === "string"
        ? String(value("dob")).slice(0, 10)
        : null,
    ],
  ]);
  if (value("customerType") === "COMMERCIAL") {
    section("Business details");
    row([
      ["Registered business name", value("businessName")],
      ["GST number", value("gstNumber")],
    ]);
  }
  section("Installation address");
  row([
    [
      "Address",
      [value("addressLine1"), value("addressLine2")].filter(Boolean).join(", "),
    ],
  ]);
  row([
    ["City / town", value("city")],
    [
      "State / PIN",
      [value("state"), value("pincode")].filter(Boolean).join(" - "),
    ],
  ]);
  if (value("connectionAddress"))
    row([["Legacy additional address", value("connectionAddress")]]);
  section("Billing address");
  row([
    [
      "Address",
      [value("billingAddressLine1"), value("billingAddressLine2")]
        .filter(Boolean)
        .join(", "),
    ],
  ]);
  row([
    ["City / town", value("billingCity")],
    [
      "State / PIN",
      [value("billingState"), value("billingPincode")]
        .filter(Boolean)
        .join(" - "),
    ],
  ]);
  section("Identity and service");
  row([
    ["ID proof type", value("idProofType")],
    ["ID number", value("idNumber")],
  ]);
  row([
    ["Service username", value("broadbandUsername")],
    ["Application type", value("connectionType")],
  ]);
  row([
    ["Plan", value("planName")],
    ["Bandwidth", value("bandwidth")],
  ]);
  row([["Remarks", value("remarks")]]);
  section("Submission and approval");
  const submitted = value("submittedBy") as { name?: string } | undefined;
  const reviewed = (value("approvedBy") ?? value("reviewedBy")) as
    | { name?: string }
    | undefined;
  row([
    ["Submitted by", submitted?.name ?? value("submittedById")],
    ["Recorded at", stamp(value("createdAt"))],
  ]);
  row([
    ["Staff acknowledgement", stamp(value("declarationAcceptedAt"))],
    ["Approved by", reviewed?.name ?? value("reviewedById")],
  ]);
  row([["Approved at", stamp(value("approvedAt") ?? value("reviewedAt"))]]);
  row([
    [
      "Verification note",
      "Administrative approval is not a customer signature or provider identity verification. Those checks are not recorded by this export.",
    ],
  ]);
  if (value("legacySnapshot"))
    row([
      [
        "Historical record",
        "Snapshot captured from the existing approved record at first export; historical signing evidence is not inferred.",
      ],
    ]);
  section(`Attached evidence (${evidence.length})`);
  evidence.forEach((e, i) =>
    row([
      [
        `${i + 1}. ${e.document.documentType.replaceAll("_", " ")}`,
        e.document.originalName,
      ],
    ]),
  );
  row([
    [
      "Export note",
      "Document copies follow in the listed order. Originals are retained in the portal; validate electronic signatures on the original files. Unsupported font characters appear as explicit Unicode codes.",
    ],
  ]);
  for (const [index, e] of evidence.entries()) {
    const title = `Attachment ${index + 1}: ${e.document.documentType.replaceAll("_", " ")}`;
    fresh(title);
    row([["Original filename", e.document.originalName]]);
    row([
      [
        e.document.sha256
          ? "Recorded SHA-256 (verified)"
          : "SHA-256 measured at export",
        e.hash,
      ],
    ]);
    try {
      if (e.document.mimeType === "application/pdf") {
        const source = await PDFDocument.load(e.bytes);
        if (!source.getPageCount()) throw new Error("No PDF pages");
        if (pdf.getPageCount() + source.getPageCount() > 500)
          throw new CafPdfError(
            "Export exceeds 500 pages. No attachments were omitted.",
          );
        row([
          [
            "PDF document",
            `${source.getPageCount()} original page copies follow. Use the stored original for signature/form validation.`,
          ],
        ]);
        const copies = await pdf.copyPages(source, source.getPageIndices());
        for (const copy of copies) {
          // Retain appearance streams but remove page/annotation actions from share copies.
          copy.node.delete(PDFName.of("AA"));
          const annotations = copy.node.lookupMaybe(
            PDFName.of("Annots"),
            PDFArray,
          );
          if (annotations)
            for (let i = 0; i < annotations.size(); i++) {
              const annotation = pdf.context.lookup(annotations.get(i));
              if (annotation instanceof PDFDict) {
                annotation.delete(PDFName.of("A"));
                annotation.delete(PDFName.of("AA"));
              }
            }
          pdf.addPage(copy);
        }
      } else if (
        ["image/jpeg", "image/png", "image/webp"].includes(e.document.mimeType)
      ) {
        const png = await sharp(e.bytes, { limitInputPixels: 40000000 })
          .rotate()
          .resize({
            width: 4096,
            height: 4096,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        const image = await pdf.embedPng(png);
        const scale = Math.min(usable / image.width, (y - 65) / image.height);
        const width = image.width * scale,
          height = image.height * scale;
        page.drawImage(image, {
          x: M + (usable - width) / 2,
          y: y - 10 - height,
          width,
          height,
        });
      } else throw new Error("Unsupported format");
    } catch (error) {
      if (error instanceof CafPdfError) throw error;
      throw new CafPdfError(
        `Cannot include attachment: ${e.document.originalName}. It may be damaged, encrypted or unsupported. No partial PDF was generated.`,
      );
    }
  }
  for (const p of ownedPages) {
    const n = pdf.getPages().indexOf(p) + 1;
    p.drawText(
      `Customer ID ${caf.customerId} | Page ${n} of ${pdf.getPageCount()}`,
      { x: M, y: 27, size: 8, font: latin, color: muted },
    );
  }
  if (pdf.getPageCount() > 500)
    throw new CafPdfError("Export exceeds 500 pages. No attachments were omitted.");
  pdf.setTitle(`CAF ${caf.cafNumber} - Customer ID ${caf.customerId}`);
  pdf.setAuthor(caf.company.name);
  pdf.setSubject("Approved CAF with supporting document copies");
  const output = await pdf.save();
  if (output.length > 128 * 1024 * 1024)
    throw new CafPdfError(
      "Combined PDF exceeds the 128 MB export limit. No documents were omitted.",
    );
  return output;
}
