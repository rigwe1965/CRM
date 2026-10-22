import { strToU8, Zip, ZipDeflate } from "fflate";
import { CSV_BOM, csvLine } from "@/lib/export/csv";
import { keepTenant } from "@/lib/tenant-context";

export type ZipFile = {
  /** File name inside the zip: fixed names from the registry, never user input. */
  name: string;
  headers: readonly string[];
  batches: AsyncGenerator<unknown[][]>;
};

/**
 * Builds a zip of CSV files plus a README, yielding compressed chunks as they are produced so a big
 * export is never held in memory whole. Each file is cut off at `limit` rows (callers check the counts
 * first and refuse, so this is only a backstop).
 */
async function* zipChunks(files: ZipFile[], readme: string, limit: number): AsyncGenerator<Uint8Array> {
  const out: Uint8Array[] = [];
  let failure: unknown;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else out.push(chunk);
  });
  const check = () => {
    if (failure) throw failure;
  };

  for (const file of files) {
    const entry = new ZipDeflate(file.name, { level: 6 });
    zip.add(entry);
    entry.push(strToU8(CSV_BOM + csvLine(file.headers)));
    let sent = 0;
    for await (const rows of file.batches) {
      if (sent >= limit) break;
      const part = rows.slice(0, limit - sent);
      sent += part.length;
      entry.push(strToU8(part.map(csvLine).join("")));
      check();
      while (out.length) yield out.shift()!;
    }
    entry.push(new Uint8Array(0), true);
    check();
    while (out.length) yield out.shift()!;
  }

  const note = new ZipDeflate("README.txt", { level: 6 });
  zip.add(note);
  note.push(strToU8(readme), true);
  zip.end();
  check();
  while (out.length) yield out.shift()!;
}

export function zipResponse(name: string, files: ZipFile[], readme: string, limit: number): Response {
  const chunks = zipChunks(files, readme, limit);
  // The rows are read while the response streams, after the route handler has returned: stay in its business.
  const inTenant = keepTenant();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await inTenant(() => chunks.next());
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (e) {
        console.error("[export] zip failed", e instanceof Error ? e.message : e);
        controller.error(e);
      }
    },
    async cancel() {
      await inTenant(() => chunks.return(undefined));
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
