require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const sharp = require('sharp');
const app = express();
const port = process.env.PORT || 5000;
const host = 'localhost'; // Bind to localhost

app.use(express.json());
app.use(cors()); // Enable CORS for all routes

const prisma = new PrismaClient();

// Access the secret from Secret Manager
async function accessSecretVersion() {
    const client = new SecretManagerServiceClient();
    try {
        const [version] = await client.accessSecretVersion({
            name: process.env.SECRET_NAME,
        });

        const payload = version.payload.data.toString('utf8');
        const keyFilePath = path.join(__dirname, 'service-account-key.json');
        fs.writeFileSync(keyFilePath, payload);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
    } catch (err) {
        console.error('Failed to access secret:', err);
        throw new Error('Failed to access secret');
    }
}

// Call the function to access the secret
accessSecretVersion().then(() => {
    // Set up Google Cloud Storage
    const storage = new Storage();
    const bucketName = process.env.BUCKET_NAME;
    const bucket = storage.bucket(bucketName);

    // Set up multer for file uploads
    const multerStorage = multer.memoryStorage();
    const upload = multer({ storage: multerStorage });

    // Serve static files from the "uploads" directory
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    // Root route
    app.get('/', (req, res) => {
        res.send('Welcome to the CartButler API this screen is just a landing page');
    });

    // Endpoint to upload an image
    app.post('/upload', upload.single('image'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const timestamp = Date.now();
        const originalFilename = `${timestamp}${path.extname(req.file.originalname)}`;
        const lowResFilename = `${timestamp}-lowres${path.extname(req.file.originalname)}`;

        const originalBlob = bucket.file(originalFilename);
        const lowResBlob = bucket.file(lowResFilename);

        const originalBlobStream = originalBlob.createWriteStream({
            resumable: false,
        });

        const lowResBlobStream = lowResBlob.createWriteStream({
            resumable: false,
        });

        // Handle errors for original image upload
        originalBlobStream.on('error', (err) => {
            console.error('Upload error:', err);
            res.status(500).json({ error: 'Upload error', details: err.message });
        });

        // Handle errors for low-res image upload
        lowResBlobStream.on('error', (err) => {
            console.error('Upload error:', err);
            res.status(500).json({ error: 'Upload error', details: err.message });
        });

        // Finish event for original image upload
        originalBlobStream.on('finish', () => {
            const originalUrl = `https://storage.googleapis.com/${bucket.name}/${originalBlob.name}`;
            const lowResUrl = `https://storage.googleapis.com/${bucket.name}/${lowResBlob.name}`;

            res.json({ originalUrl, lowResUrl });
        });

        // Resize the image to low resolution and upload both versions
        sharp(req.file.buffer)
            .resize(800) // Resize to 800px width for low resolution
            .toBuffer()
            .then((lowResBuffer) => {
                lowResBlobStream.end(lowResBuffer);
            })
            .catch((err) => {
                console.error('Sharp error:', err);
                res.status(500).json({ error: 'Image processing error', details: err.message });
            });

        // Upload the original image
        originalBlobStream.end(req.file.buffer);
    });

    // Example endpoint to list all categories
    app.get('/categories', async (req, res) => {
        try {
            const categories = await prisma.categories.findMany();
            res.json(categories);
        } catch (err) {
            console.error('Database query error:', err.message);
            res.status(500).json({ error: 'Database query error', details: err.message });
        }
    });

    // Product suggestions endpoint with multi-word search support
    app.get('/suggestions', async (req, res) => {
        try {
            const { query } = req.query; // Get query parameter

            if (!query) {
                return res.status(400).json({ error: 'Query parameter is required' });
            }

            const searchTerms = query.split(/\s+/); // Format to split with whitespace

            const conditions = searchTerms.map(term => ({
                name: {
                    contains: term.toLowerCase()
                }
            }));

            const pSuggestions = await prisma.pSuggestions.findMany({
                where: {
                    OR: conditions
                },
                orderBy: {
                    priority: 'desc' // Sorting by priority
                }
            });

            res.json(pSuggestions);
        } catch (err) {
            console.error('Database query error:', err.message);
            res.status(500).json({ error: 'Database query error', details: err.message });
        }
    });

    // Search endpoint to search for products
    app.get('/search', async (req, res) => {
        try {
            const { query, categoryID } = req.query; // Get query and categoryID parameters
    
            if (!query && !categoryID) {
                return res.status(400).json({ error: 'At least one of query or categoryID parameter is required' });
            }
    
            const searchConditions = [];
    
            if (query) {
                const searchTerms = query.split(/\s+/); // Split query into search terms
                searchTerms.forEach(term => {
                    searchConditions.push({
                        product_name: {
                            contains: term.toLowerCase()
                        }
                    });
                });
            }
    
            if (categoryID) {
                searchConditions.push({
                    category_id: parseInt(categoryID, 10)
                });
            }
    
            const products = await prisma.products.findMany({
                where: {
                    OR: searchConditions
                },
                orderBy: {
                    created_at: 'desc' // Sorting by creation date
                },
                select: {
                    id: true,
                    product_name: true,
                    price: true,
                    image_url: true,
                    category_id: true
                }
            });
    
            // Resize images to 160x160 pixels
            const resizedProducts = await Promise.all(products.map(async (product) => {
                const originalImageUrl = product.image_url;
                const imageName = path.basename(originalImageUrl);
                const resizedImageName = `160x160-${imageName}`;
                const resizedImageBlob = bucket.file(resizedImageName);
    
                // Check if the resized image already exists
                const [exists] = await resizedImageBlob.exists();
                if (!exists) {
                    const originalImageBlob = bucket.file(imageName);
                    const [originalImageBuffer] = await originalImageBlob.download();
    
                    const resizedImageBuffer = await sharp(originalImageBuffer)
                        .resize(160, 160)
                        .toBuffer();
    
                    await resizedImageBlob.save(resizedImageBuffer, {
                        resumable: false,
                    });
                }
    
                const resizedImageUrl = `https://storage.googleapis.com/${bucket.name}/${resizedImageName}`;
                return {
                    ...product,
                    image_url: resizedImageUrl
                };
            }));
    
            res.json(resizedProducts);
        } catch (err) {
            console.error('Database query error:', err.message);
            res.status(500).json({ error: 'Database query error', details: err.message });
        }
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
        console.error(err.stack);
        res.status(500).send('Something broke!');
    });

    app.listen(port, host, () => {
        console.log(`Server is running on http://${host}:${port}`);
    });
}).catch(err => {
    console.error('Failed to access secret:', err);
});