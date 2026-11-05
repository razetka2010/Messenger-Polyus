import { getActiveAccountKey } from "./apiClient.mjs";

function upload(url, body, contentType, signal, onProgress, headers = {}) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const accountKey = getActiveAccountKey();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    if (accountKey) request.setRequestHeader("X-Polus-Account", accountKey);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener("load", () => {
      if (accountKey && getActiveAccountKey() !== accountKey) {
        reject(new DOMException("The active account changed during the upload.", "AbortError"));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error("The server returned an invalid response."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error?.message || "Unable to upload the file."));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => reject(new Error("Unable to upload the file.")));
    request.addEventListener("abort", () => reject(new DOMException("Upload cancelled.", "AbortError")));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}

export function uploadAttachment(chatId, file, signal, onProgress, { encrypted = false } = {}) {
  const fileName = encrypted ? "encrypted.bin" : file.name;
  const mimeType = encrypted ? "application/octet-stream" : file.type;
  return upload(
    `/api/chats/${encodeURIComponent(chatId)}/attachments`,
    file,
    mimeType || "application/octet-stream",
    signal,
    onProgress,
    {
      "X-File-Name": encodeURIComponent(fileName),
      ...(mimeType ? { "X-File-Mime-Type": mimeType } : {}),
      ...(encrypted ? { "X-Polus-Encrypted": "true" } : {})
    }
  );
}

export function uploadAttachmentThumbnail(chatId, attachmentId, blob, signal, onProgress) {
  const url = `/api/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(attachmentId)}/thumbnail`;
  return upload(url, blob, blob.type || "image/webp", signal, onProgress);
}

export async function createImageThumbnail(file) {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 480 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create an image preview.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to create an image preview.")), "image/webp", 0.78);
    });
  } finally {
    image.close();
  }
}
