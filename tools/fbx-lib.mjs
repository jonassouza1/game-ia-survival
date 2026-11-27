// Leitor/escritor mínimo de FBX binário (v7500+, offsets de 64 bits). Preserva os bytes das propriedades;
// só os offsets dos nós são recalculados. Usado por optimize-zombie-fbx.mjs para trocar as texturas embutidas.
export function parseFBX(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = dv.getUint32(23, true);
  if (version < 7500) throw new Error(`FBX v${version} não suportado (precisa ser >= 7500)`);
  const readNode = (off) => {
    const end = Number(dv.getBigUint64(off, true));
    if (end === 0) return null;
    const np = Number(dv.getBigUint64(off + 8, true));
    const plen = Number(dv.getBigUint64(off + 16, true));
    const nl = dv.getUint8(off + 24);
    const name = buf.toString('latin1', off + 25, off + 25 + nl);
    const propsStart = off + 25 + nl;
    const propsBytes = buf.subarray(propsStart, propsStart + plen);
    let q = propsStart + plen;
    const children = [];
    let nullTerminated = false;
    while (q < end) {
      const c = readNode(q);
      if (!c) { q += 25; nullTerminated = true; break; }
      children.push(c); q = c.end;
    }
    if (q !== end) throw new Error(`Nó ${name}: fim inesperado (${q} != ${end})`);
    return { name, np, propsBytes, children, nullTerminated, end };
  };
  const roots = [];
  let p = 27;
  for (;;) {
    const n = readNode(p);
    if (!n) { p += 25; break; }
    roots.push(n); p = n.end;
  }
  return { header: buf.subarray(0, 27), roots, footer: buf.subarray(p), version };
}

export function serializeFBX(tree) {
  const parts = [tree.header];
  let pos = tree.header.length;
  const push = (b) => { parts.push(b); pos += b.length; };
  const writeNode = (n) => {
    const nameBuf = Buffer.from(n.name, 'latin1');
    const head = Buffer.alloc(25);
    const headIndex = parts.length;
    push(head);                                   // preenchido depois (endOffset)
    push(nameBuf);
    push(n.propsBytes);
    for (const c of n.children) writeNode(c);
    if (n.nullTerminated) push(Buffer.alloc(25));
    head.writeBigUInt64LE(BigInt(pos), 0);
    head.writeBigUInt64LE(BigInt(n.np), 8);
    head.writeBigUInt64LE(BigInt(n.propsBytes.length), 16);
    head.writeUInt8(nameBuf.length, 24);
    parts[headIndex] = head;
  };
  tree.roots.forEach(writeNode);
  push(Buffer.alloc(25));                         // registro nulo final
  // rodapé: id (16 bytes) + preenchimento até alinhar em 16 + restante (versão, zeros e assinatura)
  const oldPad = tree.footer.length - 16 - 4 - 4 - 120 - 16;
  push(tree.footer.subarray(0, 16));
  push(Buffer.alloc(oldPad >= 0 && oldPad <= 16 ? (16 - (pos % 16)) % 16 : 0));
  push(tree.footer.subarray(16 + oldPad));
  return Buffer.concat(parts);
}

// Propriedades: tipo 'S' (string) e 'R' (bytes) → leitura/escrita de uma propriedade única.
export function readProps(node) {
  const b = node.propsBytes, out = [];
  let q = 0;
  for (let i = 0; i < node.np; i++) {
    const t = String.fromCharCode(b[q++]);
    if ('YCIFDL'.includes(t)) { const n = { Y: 2, C: 1, I: 4, F: 4, D: 8, L: 8 }[t]; out.push({ t, raw: b.subarray(q, q + n) }); q += n; }
    else if ('fdlib'.includes(t)) { const cl = b.readUInt32LE(q + 8); out.push({ t, raw: b.subarray(q, q + 12 + cl) }); q += 12 + cl; }
    else if (t === 'S' || t === 'R') { const n = b.readUInt32LE(q); out.push({ t, data: b.subarray(q + 4, q + 4 + n) }); q += 4 + n; }
    else throw new Error(`Tipo de propriedade desconhecido: ${t}`);
  }
  return out;
}
export function writeProps(node, props) {
  const parts = [];
  for (const p of props) {
    parts.push(Buffer.from(p.t, 'latin1'));
    if (p.data) { const l = Buffer.alloc(4); l.writeUInt32LE(p.data.length); parts.push(l, p.data); } else parts.push(p.raw);
  }
  node.propsBytes = Buffer.concat(parts);
}
