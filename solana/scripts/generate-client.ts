import { resolve } from "node:path";

import { rootNodeFromAnchor, type AnchorIdl } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { format, resolveConfig } from "prettier";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "tests", "generated");
const prettierConfig = await resolveConfig(resolve(root, "package.json"));
const generatedDirectories = new Set([
  "accounts",
  "errors",
  "events",
  "instructions",
  "pdas",
  "programs",
  "types",
]);
const idl = (await Bun.file(resolve(root, "target", "idl", "timba.json")).json()) as AnchorIdl;
const codama = createFromRoot(rootNodeFromAnchor(idl));

await codama.accept(
  renderVisitor(resolve(root, "tests"), {
    deleteFolderBeforeRendering: true,
    formatCode: true,
    generatedFolder: "generated",
    kitImportStrategy: "rootOnly",
    syncPackageJson: false,
  }),
);

const generatedFiles = new Bun.Glob("**/*.ts").scan({ absolute: true, cwd: output });
for await (const generatedFile of generatedFiles) {
  const source = await Bun.file(generatedFile).text();
  // Renderer 2.7.0 forwards an explicitly undefined program address from
  // plugins. Keep the builder's default while supporting exact optional types.
  const strictSource = source.replaceAll(
    "?? config.programAddress",
    "?? config.programAddress ?? TIMBA_PROGRAM_ADDRESS",
  );
  const typescriptSource = strictSource.replaceAll(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (_match, prefix: string, specifier: string, suffix: string) => {
      const target = specifier.split("/").at(-1);
      const extension = target && generatedDirectories.has(target) ? "/index.ts" : ".ts";
      return `${prefix}${specifier}${extension}${suffix}`;
    },
  );
  await Bun.write(
    generatedFile,
    await format(typescriptSource, { ...prettierConfig, filepath: generatedFile }),
  );
}
