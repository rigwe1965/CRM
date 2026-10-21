import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvLine } from "@/lib/export/csv";

describe("csvCell", () => {
  it("writes plain values as they are and empties as blank", () => {
    expect(csvCell("Ada")).toBe("Ada");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("writes numbers, booleans and dates without quoting", () => {
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(new Date("2026-10-20T08:00:00Z"))).toBe("2026-10-20T08:00:00.000Z");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(new Date("nope"))).toBe("");
  });

  it("writes Decimal-like values as numbers", () => {
    expect(csvCell({ toNumber: () => -7.25 })).toBe("-7.25");
  });

  it("quotes commas, quotes and line breaks, and doubles inner quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("neutralises formula injection in text", () => {
    for (const evil of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1", "\n=1+1", " =1+1", '=HYPERLINK("http://evil","x")']) {
      const cell = csvCell(evil);
      expect(cell.startsWith(`"'`), evil).toBe(true);
    }
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
  });

  it("leaves text that merely contains those characters alone", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("Mary-Jane")).toBe("Mary-Jane");
    expect(csvCell("me@example.com")).toBe("me@example.com");
  });
});

describe("csvLine", () => {
  it("joins cells and ends the line with CRLF", () => {
    expect(csvLine(["a", 1, null, "x,y"])).toBe('a,1,,"x,y"\r\n');
  });
  it("has a UTF-8 byte order mark constant for Excel", () => {
    expect(CSV_BOM).toBe("﻿");
  });
});
