import { resolve } from "path";

// The deployed SBF binary defines the executable-line inventory. LLVM's host
// build has different macro expansion and debug locations; use its hits only
// for those same source lines, including guards blocked by account validation.
export function supplementSourceHits(sbf: string, host: string, base: string): string {
  const hits = new Map<string, number>();
  let source = "";
  for (const entry of host.split(/\r?\n/)) {
    if (entry.startsWith("SF:")) source = resolve(base, entry.slice(3));
    else if (entry.startsWith("DA:")) {
      const [line, count] = entry.slice(3).split(",");
      const key = `${source}\0${line}`;
      hits.set(key, (hits.get(key) ?? 0) + Number(count));
    }
  }
  return sbf
    .split(/\r?\n/)
    .map((entry) => {
      if (entry.startsWith("SF:")) source = resolve(base, entry.slice(3));
      if (!entry.startsWith("DA:")) return entry;
      const [line, count, ...checksum] = entry.slice(3).split(",");
      const total = Number(count) + (hits.get(`${source}\0${line}`) ?? 0);
      return `DA:${line},${total}${checksum.length ? `,${checksum.join(",")}` : ""}`;
    })
    .join("\n");
}

if (import.meta.main) {
  const [sbf, host, output] = process.argv.slice(2);
  if (!sbf || !host || !output) throw new Error("Expected SBF, host and output LCOV paths");
  await Bun.write(
    output,
    supplementSourceHits(
      await Bun.file(sbf).text(),
      await Bun.file(host).text(),
      resolve("solana"),
    ),
  );
}
