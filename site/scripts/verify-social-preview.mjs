import { readFile } from "node:fs/promises";

const html = await readFile("dist/index.html", "utf8");
const image = "https://oss.greenways.ai/visual-language/assets/og-historia.jpg";
const metaTags = [...html.matchAll(/<meta\b[^>]*>/g)].map((match) => match[0]);

function requireMeta(attribute, name, content) {
  const marker = `${attribute}="${name}"`;
  const tag = metaTags.find((candidate) => candidate.includes(marker));
  if (!tag) throw new Error(`Historia social metadata is missing: ${marker}`);
  if (!tag.includes(`content="${content}"`)) {
    throw new Error(`Historia social metadata has the wrong content for ${marker}`);
  }
}

requireMeta("property", "og:image", image);
requireMeta("property", "og:image:secure_url", image);
requireMeta("property", "og:image:type", "image/jpeg");
requireMeta("property", "og:image:width", "1200");
requireMeta("property", "og:image:height", "630");
requireMeta("name", "twitter:image", image);

for (const retired of ["opensource.greenways.ai", "historian-raven-day.webp"]) {
  if (html.includes(retired)) throw new Error(`Historia still advertises retired preview metadata: ${retired}`);
}

console.log("verified Historia social-preview metadata");
