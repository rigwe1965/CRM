import { CSV_BOM, csvLine } from "@/lib/export/csv";

/** Streams batches of rows as a CSV download. Stops after `limit` rows even if more arrive. */
export function csvResponse(
  file: string,
  headers: readonly string[],
  batches: AsyncGenerator<unknown[][]>,
  limit: number,
): Response {
  const enc = new TextEncoder();
  let started = false;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(enc.encode(CSV_BOM + csvLine(headers)));
          return;
        }
        const next = await batches.next();
        if (next.done || sent >= limit) {
          controller.close();
          return;
        }
        const rows = next.value.slice(0, limit - sent);
        sent += rows.length;
        if (rows.length) controller.enqueue(enc.encode(rows.map(csvLine).join("")));
      } catch (e) {
        console.error("[export] stream failed", file, e instanceof Error ? e.message : e);
        controller.error(e);
      }
    },
    async cancel() {
      await batches.return(undefined);
    },
  });
  // The name is built here from a fixed list and the date, never from user input.
  const name = `${file}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
