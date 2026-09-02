/**
 * Minimal glTF 2.0 binary (GLB) writer for extruded city geometry.
 * Supports: POSITION, NORMAL, COLOR_0 (RGB float), _FEATURE_ID_0 + EXT_mesh_features,
 * and an EXT_structural_metadata property table (STRING / FLOAT32 / INT32 / UINT32 columns).
 * Output is directly usable as 3D Tiles 1.1 tile content.
 */

export interface MeshData {
  positions: Float32Array; // xyz, glTF y-up
  normals: Float32Array;
  colors?: Float32Array; // rgb per vertex
  featureIds?: Float32Array; // one per vertex
  indices: Uint32Array;
}

export type PropertyColumn =
  | { type: 'STRING'; values: string[] }
  | { type: 'FLOAT32'; values: number[] }
  | { type: 'INT32'; values: number[] }
  | { type: 'UINT32'; values: number[] };

export interface PropertyTable {
  className: string;
  count: number;
  properties: Record<string, PropertyColumn>;
}

export interface GlbOptions {
  propertyTable?: PropertyTable;
  doubleSided?: boolean;
  baseColor?: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  /** Optional extra materials & submeshes are out of scope: one primitive per GLB keeps draw calls minimal. */
  name?: string;
  /**
   * Quantize with KHR_mesh_quantization: positions → INT16 at `quantizeUnit` metres (node scale restores metres),
   * normals → normalized INT8, colours → normalized UINT8, feature IDs → UINT16. ~2.5× smaller than float.
   * Positions must fit ±32767 × unit (e.g. unit 0.1 m → ±3.3 km); the writer throws otherwise.
   */
  quantize?: boolean;
  quantizeUnit?: number;
}

const COMPONENT = {
  FLOAT: 5126,
  UNSIGNED_INT: 5125,
  UNSIGNED_BYTE: 5121,
  BYTE: 5120,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
} as const;
const TARGET = { ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963 } as const;

class BinBuilder {
  private chunks: Buffer[] = [];
  private offset = 0;
  bufferViews: Array<Record<string, unknown>> = [];

  add(data: ArrayBufferView, target?: number, byteStride?: number): number {
    const pad = (4 - (this.offset % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.offset += pad;
    }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const view: Record<string, unknown> = { buffer: 0, byteOffset: this.offset, byteLength: buf.byteLength };
    if (target) view.target = target;
    if (byteStride) view.byteStride = byteStride;
    this.bufferViews.push(view);
    this.chunks.push(buf);
    this.offset += buf.byteLength;
    return this.bufferViews.length - 1;
  }

  finish(): Buffer {
    const pad = (4 - (this.offset % 4)) % 4;
    if (pad) this.chunks.push(Buffer.alloc(pad));
    return Buffer.concat(this.chunks);
  }
}

function minMax(arr: Float32Array, stride: number): { min: number[]; max: number[] } {
  const min = new Array(stride).fill(Infinity);
  const max = new Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i += stride) {
    for (let k = 0; k < stride; k++) {
      const v = arr[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function encodeStrings(values: string[]): { data: Uint8Array; offsets: Uint32Array } {
  const enc = new TextEncoder();
  const parts = values.map((v) => enc.encode(v ?? ''));
  const offsets = new Uint32Array(parts.length + 1);
  let total = 0;
  parts.forEach((p, i) => {
    offsets[i] = total;
    total += p.byteLength;
  });
  offsets[parts.length] = total;
  const data = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.byteLength;
  }
  return { data, offsets };
}

export function buildGlb(mesh: MeshData, opts: GlbOptions = {}): Buffer {
  const bin = new BinBuilder();
  const accessors: Array<Record<string, unknown>> = [];
  const attributes: Record<string, number> = {};
  const vertexCount = mesh.positions.length / 3;

  const quantize = opts.quantize ?? false;
  const unit = opts.quantizeUnit ?? 0.1;
  const { min, max } = minMax(mesh.positions, 3);
  let nodeScale: number[] | undefined;

  if (quantize) {
    const limit = 32767 * unit;
    if (min.some((v) => v < -limit) || max.some((v) => v > limit)) {
      throw new Error(
        `quantize: positions exceed ±${limit} m (min ${min.map((v) => v.toFixed(0))}, max ${max.map((v) => v.toFixed(0))})`,
      );
    }
    const q = new Int16Array(mesh.positions.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(mesh.positions[i] / unit);
    // glTF requires vertex attribute strides to be multiples of 4: pack 3×int16 + 1 pad → 8-byte stride
    const packed = new Int16Array((q.length / 3) * 4);
    for (let v = 0; v < q.length / 3; v++) {
      packed[v * 4] = q[v * 3];
      packed[v * 4 + 1] = q[v * 3 + 1];
      packed[v * 4 + 2] = q[v * 3 + 2];
    }
    const pv = bin.add(packed, TARGET.ARRAY_BUFFER, 8);
    const qmin = min.map((v) => Math.round(v / unit));
    const qmax = max.map((v) => Math.round(v / unit));
    accessors.push({
      bufferView: pv,
      componentType: COMPONENT.SHORT,
      count: vertexCount,
      type: 'VEC3',
      min: qmin,
      max: qmax,
    });
    attributes.POSITION = accessors.length - 1;
    nodeScale = [unit, unit, unit];

    const n8 = new Int8Array(vertexCount * 4);
    for (let v = 0; v < vertexCount; v++) {
      n8[v * 4] = Math.round(mesh.normals[v * 3] * 127);
      n8[v * 4 + 1] = Math.round(mesh.normals[v * 3 + 1] * 127);
      n8[v * 4 + 2] = Math.round(mesh.normals[v * 3 + 2] * 127);
    }
    const nv = bin.add(n8, TARGET.ARRAY_BUFFER, 4);
    accessors.push({
      bufferView: nv,
      componentType: COMPONENT.BYTE,
      normalized: true,
      count: vertexCount,
      type: 'VEC3',
    });
    attributes.NORMAL = accessors.length - 1;

    if (mesh.colors) {
      const c8 = new Uint8Array(vertexCount * 4);
      for (let v = 0; v < vertexCount; v++) {
        c8[v * 4] = Math.round(Math.min(1, mesh.colors[v * 3]) * 255);
        c8[v * 4 + 1] = Math.round(Math.min(1, mesh.colors[v * 3 + 1]) * 255);
        c8[v * 4 + 2] = Math.round(Math.min(1, mesh.colors[v * 3 + 2]) * 255);
        c8[v * 4 + 3] = 255;
      }
      const cv = bin.add(c8, TARGET.ARRAY_BUFFER, 4);
      accessors.push({
        bufferView: cv,
        componentType: COMPONENT.UNSIGNED_BYTE,
        normalized: true,
        count: vertexCount,
        type: 'VEC4',
      });
      attributes.COLOR_0 = accessors.length - 1;
    }
    if (mesh.featureIds) {
      const f16 = new Uint16Array(vertexCount);
      for (let v = 0; v < vertexCount; v++) {
        if (mesh.featureIds[v] > 65535) throw new Error('quantize: more than 65536 features in one tile');
        f16[v] = mesh.featureIds[v];
      }
      const fv = bin.add(f16, TARGET.ARRAY_BUFFER, 2);
      accessors.push({
        bufferView: fv,
        componentType: COMPONENT.UNSIGNED_SHORT,
        count: vertexCount,
        type: 'SCALAR',
      });
      attributes._FEATURE_ID_0 = accessors.length - 1;
    }
  } else {
    const posView = bin.add(mesh.positions, TARGET.ARRAY_BUFFER);
    accessors.push({
      bufferView: posView,
      componentType: COMPONENT.FLOAT,
      count: vertexCount,
      type: 'VEC3',
      min,
      max,
    });
    attributes.POSITION = accessors.length - 1;

    const nrmView = bin.add(mesh.normals, TARGET.ARRAY_BUFFER);
    accessors.push({ bufferView: nrmView, componentType: COMPONENT.FLOAT, count: vertexCount, type: 'VEC3' });
    attributes.NORMAL = accessors.length - 1;

    if (mesh.colors) {
      const colView = bin.add(mesh.colors, TARGET.ARRAY_BUFFER);
      accessors.push({
        bufferView: colView,
        componentType: COMPONENT.FLOAT,
        count: vertexCount,
        type: 'VEC3',
      });
      attributes.COLOR_0 = accessors.length - 1;
    }

    if (mesh.featureIds) {
      const fidView = bin.add(mesh.featureIds, TARGET.ARRAY_BUFFER);
      accessors.push({
        bufferView: fidView,
        componentType: COMPONENT.FLOAT,
        count: vertexCount,
        type: 'SCALAR',
      });
      attributes._FEATURE_ID_0 = accessors.length - 1;
    }
  }

  const idxView = bin.add(mesh.indices, TARGET.ELEMENT_ARRAY_BUFFER);
  accessors.push({
    bufferView: idxView,
    componentType: COMPONENT.UNSIGNED_INT,
    count: mesh.indices.length,
    type: 'SCALAR',
  });
  const indicesAccessor = accessors.length - 1;

  const primitive: Record<string, unknown> = { attributes, indices: indicesAccessor, material: 0, mode: 4 };
  const extensionsUsed: string[] = [];
  const extensionsRequired: string[] = [];
  const rootExtensions: Record<string, unknown> = {};
  if (quantize) {
    extensionsUsed.push('KHR_mesh_quantization');
    extensionsRequired.push('KHR_mesh_quantization');
  }

  if (mesh.featureIds && opts.propertyTable) {
    const pt = opts.propertyTable;
    extensionsUsed.push('EXT_mesh_features', 'EXT_structural_metadata');
    primitive.extensions = {
      EXT_mesh_features: { featureIds: [{ featureCount: pt.count, attribute: 0, propertyTable: 0 }] },
    };
    const classProps: Record<string, unknown> = {};
    const tableProps: Record<string, unknown> = {};
    for (const [name, col] of Object.entries(pt.properties)) {
      if (col.type === 'STRING') {
        const { data, offsets } = encodeStrings(col.values);
        const values = bin.add(data);
        const stringOffsets = bin.add(offsets);
        classProps[name] = { type: 'STRING' };
        tableProps[name] = { values, stringOffsets, stringOffsetType: 'UINT32' };
      } else {
        const typed =
          col.type === 'FLOAT32'
            ? new Float32Array(col.values)
            : col.type === 'INT32'
              ? new Int32Array(col.values)
              : new Uint32Array(col.values);
        const values = bin.add(typed);
        classProps[name] = { type: 'SCALAR', componentType: col.type };
        tableProps[name] = { values };
      }
    }
    rootExtensions.EXT_structural_metadata = {
      schema: { id: 'shanghai3d', classes: { [pt.className]: { properties: classProps } } },
      propertyTables: [{ name: pt.className, class: pt.className, count: pt.count, properties: tableProps }],
    };
  }

  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'shanghai-3d pipeline' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: opts.name ?? 'mesh', ...(nodeScale ? { scale: nodeScale } : {}) }],
    meshes: [{ primitives: [primitive] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: opts.baseColor ?? [1, 1, 1, 1],
          metallicFactor: opts.metallic ?? 0.0,
          roughnessFactor: opts.roughness ?? 0.85,
        },
        doubleSided: opts.doubleSided ?? false,
      },
    ],
    accessors,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  if (extensionsUsed.length) gltf.extensionsUsed = extensionsUsed;
  if (extensionsRequired.length) gltf.extensionsRequired = extensionsRequired;
  if (Object.keys(rootExtensions).length) gltf.extensions = rootExtensions;

  const binChunk = bin.finish();
  (gltf.buffers as Array<{ byteLength: number }>)[0].byteLength = binChunk.byteLength;

  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.byteLength % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const totalLength = 12 + 8 + jsonBuf.byteLength + 8 + binChunk.byteLength;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.byteLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN'
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binChunk]);
}
