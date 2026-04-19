export async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let { width, height } = img;
      if (width > height) {
        if (width > MAX) { height = Math.round((height * MAX) / width); width = MAX; }
      } else {
        if (height > MAX) { width = Math.round((width * MAX) / height); height = MAX; }
      }
      canvas.width = width; canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('Compression failed'));
      }, 'image/jpeg', 0.75);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadPhoto(supabase, file, bucket, path) {
  const blob = await compressImage(file);
  const fullPath = `${path}/${Date.now()}.jpg`;
  const { data, error } = await supabase.storage.from(bucket).upload(fullPath, blob, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return publicUrl;
}
