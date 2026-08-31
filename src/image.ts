export interface PreparedImage {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}

/** WeChat rejects a body image over 1 MB, and a cover thumbnail over 64 KB. */
const BODY_LIMIT = 1024 * 1024;
const COVER_LIMIT = 64 * 1024;
const MAX_BODY_WIDTH = 1920;

type ImageKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'unknown';

/** Read the format from the file's own magic bytes; a vault filename may lie about it. */
export function sniffImageKind(bytes: ArrayBuffer): ImageKind {
  const head = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength));
  const starts = (...signature: number[]) => signature.every((byte, index) => head[index] === byte);
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  // WEBP is "RIFF" + 4 size bytes + "WEBP".
  if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'webp';
  return 'unknown';
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('无法编码图片。')),
    type,
    quality,
  ));
}

async function loadImage(bytes: ArrayBuffer, kind: ImageKind): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  // Give the blob its real MIME type: an object URL with an empty type leaves the decoder guessing.
  const type = kind === 'unknown' ? 'application/octet-stream' : `image/${kind}`;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('无法读取图片。'));
      image.src = url;
    });
    return { image, revoke: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function drawScaled(image: HTMLImageElement, maxWidth: number, opaque: boolean): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = createEl('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片画布。');
  if (opaque) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function prepareBodyImage(bytes: ArrayBuffer, label: string): Promise<PreparedImage> {
  const kind = sniffImageKind(bytes);

  // WeChat's body-image endpoint accepts JPEG and PNG. Anything already small enough is uploaded
  // untouched: re-encoding only loses quality, and a PNG would lose its transparency.
  if ((kind === 'jpeg' || kind === 'png') && bytes.byteLength <= BODY_LIMIT) {
    return { bytes, contentType: `image/${kind}`, filename: `image.${kind === 'jpeg' ? 'jpg' : 'png'}` };
  }
  if (kind === 'gif') {
    // The endpoint takes no GIF, so an animated one can only go up as its first frame.
    console.warn(`DGS WeChat Publisher: GIF 只能上传首帧，动画会丢失（${label}）。`);
  }

  const { image, revoke } = await loadImage(bytes, kind);
  try {
    // A PNG is kept as a PNG so transparency survives; everything else is flattened onto white.
    if (kind === 'png') {
      const canvas = drawScaled(image, MAX_BODY_WIDTH, false);
      const png = await canvasBlob(canvas, 'image/png');
      if (png.size <= BODY_LIMIT) {
        return { bytes: await png.arrayBuffer(), contentType: 'image/png', filename: 'image.png' };
      }
    }
    const canvas = drawScaled(image, MAX_BODY_WIDTH, true);
    for (const quality of [0.88, 0.78, 0.68, 0.58, 0.48]) {
      const blob = await canvasBlob(canvas, 'image/jpeg', quality);
      if (blob.size <= BODY_LIMIT) {
        return { bytes: await blob.arrayBuffer(), contentType: 'image/jpeg', filename: 'image.jpg' };
      }
    }
    throw new Error(`图片压缩后仍超过 1 MB：${label}`);
  } finally {
    revoke();
  }
}

export async function prepareCover(bytes: ArrayBuffer): Promise<PreparedImage> {
  // A cover is always re-encoded: WeChat wants a 900x500 thumbnail under 64 KB, so neither the
  // original framing nor its format survives anyway.
  const { image, revoke } = await loadImage(bytes, sniffImageKind(bytes));
  try {
    const canvas = createEl('canvas');
    canvas.width = 900;
    canvas.height = 500;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建封面画布。');
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) {
      const blob = await canvasBlob(canvas, 'image/jpeg', quality);
      if (blob.size <= COVER_LIMIT) {
        return { bytes: await blob.arrayBuffer(), contentType: 'image/jpeg', filename: 'cover.jpg' };
      }
    }
    throw new Error('封面压缩后仍超过微信 64 KB 限制。');
  } finally {
    revoke();
  }
}
