import {
  getModalityFromMimeType,
  formatFileSize,
  exceedsMaxSize,
  matchesAcceptFilter,
} from "../utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFile(size: number): File {
  return { size } as File;
}

function mockFileWithType(type: string, name = "test"): File {
  return { type, name } as File;
}

// ---------------------------------------------------------------------------
// getModalityFromMimeType
// ---------------------------------------------------------------------------

describe("getModalityFromMimeType", () => {
  it('returns "image" for image/png', () => {
    expect(getModalityFromMimeType("image/png")).toBe("image");
  });

  it('returns "image" for image/jpeg', () => {
    expect(getModalityFromMimeType("image/jpeg")).toBe("image");
  });

  it('returns "audio" for audio/mp3', () => {
    expect(getModalityFromMimeType("audio/mp3")).toBe("audio");
  });

  it('returns "audio" for audio/wav', () => {
    expect(getModalityFromMimeType("audio/wav")).toBe("audio");
  });

  it('returns "video" for video/mp4', () => {
    expect(getModalityFromMimeType("video/mp4")).toBe("video");
  });

  it('returns "video" for video/webm', () => {
    expect(getModalityFromMimeType("video/webm")).toBe("video");
  });

  it('returns "document" for application/pdf', () => {
    expect(getModalityFromMimeType("application/pdf")).toBe("document");
  });

  it('returns "document" for text/plain', () => {
    expect(getModalityFromMimeType("text/plain")).toBe("document");
  });

  it('returns "document" for empty string (fallback)', () => {
    expect(getModalityFromMimeType("")).toBe("document");
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe("formatFileSize", () => {
  it('formats 0 bytes as "0 B"', () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it('formats 512 bytes as "512 B"', () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it('formats 1023 bytes as "1023 B"', () => {
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it('formats 1024 bytes as "1.0 KB"', () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it('formats 1536 bytes as "1.5 KB"', () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it('formats 1048575 bytes as "1024.0 KB" (one byte under 1 MB)', () => {
    expect(formatFileSize(1048575)).toBe("1024.0 KB");
  });

  it('formats 1048576 bytes as "1.0 MB"', () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });

  it('formats 10485760 bytes as "10.0 MB"', () => {
    expect(formatFileSize(10485760)).toBe("10.0 MB");
  });
});

// ---------------------------------------------------------------------------
// exceedsMaxSize
// ---------------------------------------------------------------------------

const MB_20 = 20 * 1024 * 1024;

describe("exceedsMaxSize", () => {
  it("returns false for a file exactly at the 20 MB default limit", () => {
    expect(exceedsMaxSize(mockFile(MB_20))).toBe(false);
  });

  it("returns true for a file one byte over the 20 MB default limit", () => {
    expect(exceedsMaxSize(mockFile(MB_20 + 1))).toBe(true);
  });

  it("returns false for a file well under the default limit", () => {
    expect(exceedsMaxSize(mockFile(1024))).toBe(false);
  });

  it("returns true when file exceeds a custom maxSize", () => {
    const MB_5 = 5 * 1024 * 1024;
    const MB_10 = 10 * 1024 * 1024;
    expect(exceedsMaxSize(mockFile(MB_10), MB_5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesAcceptFilter
// ---------------------------------------------------------------------------

describe("matchesAcceptFilter", () => {
  it('returns true for accept "*/*" regardless of file type', () => {
    expect(matchesAcceptFilter(mockFileWithType("image/png"), "*/*")).toBe(
      true,
    );
  });

  it("returns true for empty accept string (accept all)", () => {
    expect(matchesAcceptFilter(mockFileWithType("image/png"), "")).toBe(true);
  });

  it('returns true when accept "image/*" matches "image/png"', () => {
    expect(matchesAcceptFilter(mockFileWithType("image/png"), "image/*")).toBe(
      true,
    );
  });

  it('returns false when accept "image/*" rejects "audio/mp3"', () => {
    expect(matchesAcceptFilter(mockFileWithType("audio/mp3"), "image/*")).toBe(
      false,
    );
  });

  it('returns true for exact match accept "application/pdf"', () => {
    expect(
      matchesAcceptFilter(
        mockFileWithType("application/pdf"),
        "application/pdf",
      ),
    ).toBe(true);
  });

  it('returns false when exact accept "application/pdf" rejects "image/png"', () => {
    expect(
      matchesAcceptFilter(mockFileWithType("image/png"), "application/pdf"),
    ).toBe(false);
  });

  it('returns true for comma-separated accept "image/*,application/pdf" with "image/jpeg"', () => {
    expect(
      matchesAcceptFilter(
        mockFileWithType("image/jpeg"),
        "image/*,application/pdf",
      ),
    ).toBe(true);
  });

  it('returns true for comma-separated accept "image/*,application/pdf" with "application/pdf"', () => {
    expect(
      matchesAcceptFilter(
        mockFileWithType("application/pdf"),
        "image/*,application/pdf",
      ),
    ).toBe(true);
  });

  it("handles whitespace in comma-separated accept values", () => {
    expect(
      matchesAcceptFilter(
        mockFileWithType("application/pdf"),
        "image/* , application/pdf",
      ),
    ).toBe(true);
  });

  it("returns false for empty file type against a specific filter", () => {
    expect(matchesAcceptFilter(mockFileWithType(""), "image/*")).toBe(false);
  });
});
