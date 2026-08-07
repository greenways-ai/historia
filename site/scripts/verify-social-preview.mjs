import { readFile } from "node:fs/promises";

const html = await readFile("dist/index.html", "utf8");
const image = "https://oss.greenways.ai/visual-language/assets/og-historia.jpg";

for (const value of [
  `property="og:image" content="${image}"`,
  `property="og:image:secure_url" content="${image}"`,
  `property="og:image:type" content="image/jpeg"`,
  `property="og:image:width" content="1200"`,
  `property="og:image:height" content="630"`,
  `name="twitter:image" content="${image}"`,
]) {
  if (!html.includes(value)) throw new Error(`Historia social metadata is missing: ${value}`);
}

for (const retired of ["opensource.greenways.ai", "historian-raven-day.webp"]) {
  if (html.includes(retired)) throw new Error(`Historia still advertises retired preview metadata: ${retired}`);
}

console.log("verified Historia social-preview metadata");
