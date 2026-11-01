export async function cropAvatar(file) {
  const image = await createImageBitmap(file);
  try {
    const side = Math.min(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to process the avatar image.");
    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512
    );
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob
        ? resolve(blob)
        : reject(new Error("Unable to process the avatar image.")), "image/png");
    });
  } finally {
    image.close();
  }
}
