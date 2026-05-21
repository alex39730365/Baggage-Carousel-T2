import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const mdRel = process.argv[2] ?? "통합문서.md";
const pdfRel = process.argv[3] ?? "통합문서.pdf";
const titleArg = process.argv[4];

const mdPath = join(root, mdRel);
const pdfPath = join(root, pdfRel);
const docTitle = titleArg ?? basename(mdRel, ".md");

if (!existsSync(mdPath)) {
  console.error("Markdown 파일을 찾을 수 없습니다:", mdPath);
  process.exit(1);
}

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error(
    "Chrome 또는 Edge 실행 파일을 찾지 못했습니다. CHROME_PATH 에 chrome.exe 또는 msedge.exe 전체 경로를 설정하세요."
  );
  process.exit(1);
}

const md = readFileSync(mdPath, "utf8");
marked.setOptions({ gfm: true });
const body = await marked.parse(md);
const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(docTitle)}</title>
<style>
  body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; margin: 0; padding: 12mm 14mm; }
  h1 { font-size: 1.35rem; border-bottom: 1px solid #bbb; padding-bottom: 0.35em; margin-top: 0; }
  h2 { font-size: 1.12rem; margin: 1.25em 0 0.5em; }
  h3 { font-size: 1rem; margin: 1em 0 0.4em; }
  p { margin: 0.5em 0; }
  ul, ol { margin: 0.4em 0; padding-left: 1.35em; }
  code { font-family: Consolas, "Courier New", monospace; background: #f3f3f3; padding: 0.08em 0.35em; border-radius: 3px; font-size: 0.88em; }
  pre { background: #f6f6f6; padding: 0.85em 1em; border-radius: 6px; overflow-x: auto; margin: 0.75em 0; }
  pre code { background: none; padding: 0; font-size: 0.82em; }
  table { border-collapse: collapse; width: 100%; margin: 0.75em 0; font-size: 0.92em; }
  th, td { border: 1px solid #ccc; padding: 0.35em 0.5em; vertical-align: top; }
  th { background: #eee; font-weight: 600; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1.25em 0; }
  blockquote { margin: 0.5em 0; padding-left: 0.9em; border-left: 3px solid #ccc; color: #444; }
  a { color: #0b57d0; }
</style>
</head>
<body>
${body}
</body>
</html>`;

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
});
await browser.close();
console.log("PDF 저장:", pdfPath);
