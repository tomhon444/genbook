import { PDFDocument, PDFArray, PDFDict, PDFRef, PDFRawStream, PDFName, decodePDFRawStream } from 'pdf-lib';
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 2097152) process.exit(1);
  chunks.push(chunk);
}
try {
  const bytes = Buffer.concat(chunks);
  if (!/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0, 8).toString('ascii')) || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'))) throw Error();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
  if (doc.isEncrypted || doc.getPages().length === 0) throw Error();
  const seen = new Set();
  function visit(object) {
    if (seen.has(object)) return;
    seen.add(object);
    if (object instanceof PDFRef) {
      const target = doc.context.lookup(object);
      if (!target) throw Error();
      visit(target);
    } else if (object instanceof PDFRawStream) visit(object.dict);
    else if (object instanceof PDFDict) object.values().forEach(visit);
    else if (object instanceof PDFArray) object.asArray().forEach(visit);
  }
  visit(doc.catalog);
  for (const page of doc.getPages()) {
    page.getSize();
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray().map(item => doc.context.lookup(item)) : contents ? [contents] : [];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) throw Error();
      decodePDFRawStream(stream).decode();
    }
  }
} catch { process.exit(1); }
