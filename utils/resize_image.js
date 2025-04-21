// This function is available in the backend but not being used in the frontend currently, it shall be updated in the future.

const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp');

const storage = new Storage();
const bucket_name = process.env.GCLOUD_STORAGE_BUCKET;
const bucket = storage.bucket(bucket_name);

async function resize_image_async(image_url, image_name) {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(image_url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image from URL: ${image_url}`);
        }
        const buffer = await response.buffer();

        const resized_buffer = await sharp(buffer)
            .resize(160, 160)
            .toBuffer();

        const resized_image_name = `160x160-${image_name}`;
        const resized_image_blob = bucket.file(resized_image_name);

        const [exists] = await resized_image_blob.exists();
        if (!exists) {
            await resized_image_blob.save(resized_buffer);
        }
    } catch (err) {
        console.error('Image resizing error:', err.message);
    }
}

module.exports = resize_image_async;