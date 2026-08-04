#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagePath = resolve(root, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

const EXPECTED = Object.freeze({
  name: "@greenways-ai/historian",
  repository: "git+https://github.com/greenways-ai/historia.git",
  bugs: "https://github.com/greenways-ai/historia/issues",
  homepage: "https://opensource.greenways.ai/historia/"
});

const errors = [];

function requireValue(label, actual, expected) {
  if (actual !== expected) errors.push(`${label} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
}

requireValue("name", packageJson.name, EXPECTED.name);
requireValue("repository.type", packageJson.repository?.type, "git");
requireValue("repository.url", packageJson.repository?.url, EXPECTED.repository);
requireValue("bugs.url", packageJson.bugs?.url, EXPECTED.bugs);
requireValue("homepage", packageJson.homepage, EXPECTED.homepage);
requireValue("publishConfig.access", packageJson.publishConfig?.access, "public");

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(packageJson.version ?? ""))) {
  errors.push(`version is not a valid release version: ${JSON.stringify(packageJson.version)}`);
}

const bins = Object.entries(packageJson.bin ?? {});
if (!bins.length) errors.push("at least one package bin entry is required");
for (const [name, relativePath] of bins) {
  const path = String(relativePath ?? "");
  if (!path || path.startsWith("./") || path.startsWith("/") || path.includes("\\")) {
    errors.push(`bin.${name} must be a normalized package-relative POSIX path, found ${JSON.stringify(path)}`);
    continue;
  }
  const absolutePath = resolve(root, path);
  try {
    await access(absolutePath);
    const source = await readFile(absolutePath, "utf8");
    if (!source.startsWith("#!/usr/bin/env bun\n")) {
      errors.push(`bin.${name} must start with #!/usr/bin/env bun`);
    }
  } catch (error) {
    errors.push(`bin.${name} does not resolve to a readable file: ${path} (${error.code ?? error.message})`);
  }
}

for (const required of ["src", "analyzers", "docs", "skills", "spec", "extension", "apps", "README.md", "LICENSE"]) {
  if (!packageJson.files?.includes(required)) errors.push(`files must include ${required}`);
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, package: packageJson.name, version: packageJson.version, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    package: packageJson.name,
    version: packageJson.version,
    repository: packageJson.repository.url,
    bins: Object.keys(packageJson.bin).sort()
  }, null, 2));
}
