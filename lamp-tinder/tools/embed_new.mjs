// Fingerprint products that are new in data/catalog.json (CLIP, same model and quantisation as
// tools/embed.html) and drop fingerprints for products that are gone. Images are fetched into
// memory only; nothing is written to disk except data/embeddings.json.
//   cd lamp-tinder && node tools/embed_new.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

const MODEL = 'Xenova/clip-vit-base-patch32';
const cat = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const emb = JSON.parse(await readFile('data/embeddings.json', 'utf8'));
if (emb.model !== MODEL) throw new Error(`embeddings were made with ${emb.model}, expected ${MODEL}`);

const ids = new Set(cat.products.map(p => p.id));
const removed = Object.keys(emb.products).filter(id => !ids.has(id));
for (const id of removed) delete emb.products[id];
const todo = cat.products.filter(p => !emb.products[p.id]);
console.log(`${cat.products.length} products: ${todo.length} new, ${removed.length} removed`);

const thumb = u => /cdn\.shopify\.com|\/cdn\/shop\//.test(u) ? u + (u.includes('?') ? '&' : '?') + 'width=400' : u;
function toB64(vec) {
  let m = 0; for (const x of vec) m = Math.max(m, Math.abs(x));
  const q = Int8Array.from(vec, x => Math.round(x / m * 127));
  return Buffer.from(q.buffer).toString('base64');
}

if (todo.length) {
  const processor = await AutoProcessor.from_pretrained(MODEL);
  const model = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' });
  let done = 0, failed = [];
  for (const p of todo) {
    try {
      const img = await RawImage.read(thumb(p.image));
      const { image_embeds } = await model(await processor(img));
      const v = Array.from(image_embeds.data), n = Math.hypot(...v);
      emb.products[p.id] = toB64(v.map(x => x / n));
    } catch (e) { failed.push(p.id); }
    if (++done % 50 === 0) console.log(`  ${done}/${todo.length}`);
  }
  // products whose photo can't be fingerprinted are dropped from the catalog so the site never shows them unmatched
  if (failed.length) {
    console.log(`  ${failed.length} images failed; removing those products`);
    cat.products = cat.products.filter(p => !failed.includes(p.id));
    await writeFile('data/catalog.json', JSON.stringify(cat, null, 0));
  }
}
emb.built = new Date().toISOString().slice(0, 10);
await writeFile('data/embeddings.json', JSON.stringify(emb));
console.log('done');
