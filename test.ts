const mimeType = 'image/png';
const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const buffer = Buffer.from(base64Image, 'base64');
const blob = new Blob([buffer], { type: mimeType });
const formData = new FormData();
formData.append('file', blob, 'image.png');
formData.append('messaging_product', 'whatsapp');

console.log('FormData size:', [...formData.entries()].length);
