import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("exibe barra de progresso acessível no resumo público", async () => {
  const html = await readFile(join(root, "public", "poster.html"), "utf8");
  assert.match(html, /id="progress-track"/);
  assert.match(html, /id="progress-fill"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="0"/);

  const js = await readFile(join(root, "public", "poster.js"), "utf8");
  assert.match(js, /progressFill\.style\.width = `\$\{progress\}%`/);
  assert.match(js, /setAttribute\("aria-valuenow", String\(progress\)\)/);
  assert.match(js, /progressWrap\.classList\.toggle\("is-complete"/);

  const css = await readFile(join(root, "public", "poster.css"), "utf8");
  assert.match(css, /\.progress-track\s*\{/);
  assert.match(css, /\.progress-fill\s*\{/);
});
