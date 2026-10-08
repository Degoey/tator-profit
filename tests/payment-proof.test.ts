import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  MAX_MULTIPART_BYTES,
  MAX_PROOF_BYTES,
  ProofError,
  deleteProofFile,
  detectProofKind,
  kindFromExtension,
  kindFromMime,
  parseBoundedMultipart,
  proofResponseHeaders,
  readBoundedRequestBody,
  readProofFile,
  resolveProofPath,
  sanitizeProofFileName,
  storeProofFile,
  validateProofUpload,
} from "../src/lib/payment-proof";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

let storageDir = "";
let previousDir: string | undefined;

before(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "proof-test-"));
  previousDir = process.env.PAYMENT_PROOF_DIR;
  process.env.PAYMENT_PROOF_DIR = storageDir;
});

after(async () => {
  if (previousDir === undefined) delete process.env.PAYMENT_PROOF_DIR;
  else process.env.PAYMENT_PROOF_DIR = previousDir;
  await rm(storageDir, { recursive: true, force: true });
});

describe("kind detection", () => {
  it("mengenali magic bytes PNG, JPEG, dan PDF", () => {
    assert.equal(detectProofKind(PNG), "png");
    assert.equal(detectProofKind(JPEG), "jpeg");
    assert.equal(detectProofKind(PDF), "pdf");
  });

  it("mengembalikan null untuk berkas yang tidak dikenal", () => {
    assert.equal(detectProofKind(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null);
    assert.equal(detectProofKind(new Uint8Array()), null);
  });

  it("memetakan MIME dan ekstensi", () => {

describe("validateProofUpload", () => {
  it("menerima berkas yang MIME, ekstensi, dan tanda tangannya cocok", () => {
    const result = validateProofUpload({ fileName: "bukti.png", declaredMime: "image/png", bytes: PNG });
    assert.equal(result.kind, "png");
    assert.equal(result.mimeType, "image/png");
  });

  it("menolak ekstensi yang salah walau MIME valid", () => {
    assert.throws(
      () => validateProofUpload({ fileName: "bukti.png", declaredMime: "application/pdf", bytes: PDF }),
      (error: unknown) => error instanceof ProofError && error.code === "PROOF_SIGNATURE_MISMATCH",
    );
  });

  it("menolak tanda tangan yang tidak cocok dengan MIME dan ekstensi", () => {
    assert.throws(
      () => validateProofUpload({ fileName: "bukti.png", declaredMime: "image/png", bytes: PDF }),
      (error: unknown) => error instanceof ProofError && error.code === "PROOF_SIGNATURE_MISMATCH",
    );
  });

  it("menolak tipe yang tidak diizinkan", () => {
    assert.throws(
      () => validateProofUpload({ fileName: "bukti.exe", declaredMime: "application/octet-stream", bytes: PDF }),
      (error: unknown) => error instanceof ProofError && error.code === "UNSUPPORTED_PROOF_TYPE",
    );
  });

  it("menolak berkas kosong dan berkas yang melebihi 5 MiB", () => {
    assert.throws(
      () => validateProofUpload({ fileName: "bukti.png", declaredMime: "image/png", bytes: new Uint8Array() }),
      (error: unknown) => error instanceof ProofError && error.code === "EMPTY_PROOF",
    );

    const oversized = new Uint8Array(MAX_PROOF_BYTES + 1);
    oversized.set(PNG, 0);
    assert.throws(
      () => validateProofUpload({ fileName: "bukti.png", declaredMime: "image/png", bytes: oversized }),
      (error: unknown) => error instanceof ProofError && error.code === "PROOF_TOO_LARGE",
    );
  });
});

    assert.equal(kindFromMime("image/png"), "png");
    assert.equal(kindFromMime("application/pdf"), "pdf");
    assert.equal(kindFromMime("text/plain"), null);
    assert.equal(kindFromExtension("proof.JPG"), "jpeg");
    assert.equal(kindFromExtension("proof.exe"), null);

describe("proof storage", () => {
  it("menyimpan berkas dengan nama acak di luar public", async () => {
    const stored = await storeProofFile({ bytes: PNG, kind: "png", originalName: "../../etc/passwd.png" });

    assert.ok(!stored.storagePath.includes(".."));
    assert.ok(!stored.storagePath.startsWith("public"));
    assert.match(stored.storagePath, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.equal(stored.fileName, "passwd.png");
    assert.equal(stored.mimeType, "image/png");
    assert.equal(stored.sizeBytes, PNG.byteLength);
    assert.match(stored.sha256, /^[0-9a-f]{64}$/);

    const absolute = resolveProofPath(stored.storagePath);
    assert.ok(absolute.startsWith(storageDir));
    assert.ok(existsSync(absolute));

    const read = await readProofFile(stored.storagePath);
    assert.deepEqual(new Uint8Array(read!), PNG);

    await deleteProofFile(stored.storagePath);
    assert.equal(existsSync(absolute), false);
  });

  it("menjaga nama berkas tetap bersih untuk ekstensi ganda dan traversal", () => {
    assert.equal(sanitizeProofFileName("proof.pdf.exe"), "proof.pdf.exe");
    assert.equal(sanitizeProofFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeProofFileName("C:\\temp\\bukti.png"), "bukti.png");
    assert.equal(sanitizeProofFileName(""), "bukti");
  });

  it("menolak path penyimpanan yang keluar dari direktori privat", () => {
    assert.throws(
      () => resolveProofPath("../../etc/passwd"),
      (error: unknown) => error instanceof ProofError && error.code === "INVALID_PROOF_PATH",
    );
  });
});

  });

describe("bounded body reading", () => {
  it("menghitung byte sebenarnya dan mengabaikan Content-Length yang menipu", async () => {
    const body = new Uint8Array(64);
    const request = new Request("http://localhost/api/deposits", {
      method: "POST",
      headers: { "content-length": "1" },
      body,
    });

    await assert.rejects(
      () => readBoundedRequestBody(request, 32),
      (error: unknown) => error instanceof ProofError && error.code === "PAYLOAD_TOO_LARGE",
    );
  });

  it("menolak lebih awal ketika Content-Length sudah melebihi batas", async () => {
    const request = new Request("http://localhost/api/deposits", {
      method: "POST",
      headers: { "content-length": String(MAX_MULTIPART_BYTES + 1) },
      body: new Uint8Array(8),
    });

    await assert.rejects(
      () => readBoundedRequestBody(request),
      (error: unknown) => error instanceof ProofError && error.code === "PAYLOAD_TOO_LARGE",
    );
  });

  it("membaca ulang multipart yang sudah dibatasi", async () => {
    const formData = new FormData();
    formData.set("amount", "500.00");
    formData.set("proof", new File([PNG], "bukti.png", { type: "image/png" }));

    const request = new Request("http://localhost/api/deposits", { method: "POST", body: formData });
    const parsed = await parseBoundedMultipart(request);

    assert.equal(parsed.get("amount"), "500.00");
    const file = parsed.get("proof");
    assert.ok(file instanceof File);
    assert.equal(file.name, "bukti.png");
  });

  it("menolak permintaan yang bukan multipart", async () => {
    const request = new Request("http://localhost/api/deposits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    await assert.rejects(
      () => parseBoundedMultipart(request),
      (error: unknown) => error instanceof ProofError && error.code === "INVALID_CONTENT_TYPE",
    );
  });
});

describe("proofResponseHeaders", () => {
  it("memaksa unduhan privat yang tidak bisa disniff", () => {
    const headers = proofResponseHeaders({ fileName: "bukti.png", mimeType: "image/png", sizeBytes: 10 });

    assert.equal(headers["Content-Disposition"], 'attachment; filename="bukti.png"');
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["Cache-Control"], "private, no-store, max-age=0");
    const csp = headers["Content-Security-Policy"];
    assert.ok(csp, "CSP harus selalu dikirim untuk berkas bukti");
    assert.match(csp, /sandbox/);
    assert.match(csp, /default-src 'none'/);
  });
});

});
