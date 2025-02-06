require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Import the cors package
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 5000;
const host = 'localhost'; // Bind to localhost

app.use(express.json());
app.use(cors()); // Enable CORS for all routes

const prisma = new PrismaClient();

// Ensure the uploads directory exists
const uploadsDir = path.join('/tmp', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Serve static files from the "uploads" directory
app.use('/uploads', express.static(uploadsDir));

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the CartButler API this screen is just a landing page');
});

// Endpoint to upload an image
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ url: `/uploads/${req.file.filename}` });
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
            },
            take: 5 // Limit results
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
        const { query } = req.query; // Get query parameter

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const searchTerms = query.split(/\s+/); // Split query into search terms

        const conditions = searchTerms.map(term => ({
            product_name: {
                contains: term.toLowerCase()
            }
        }));

        const products = await prisma.products.findMany({
            where: {
                OR: conditions
            },
            orderBy: {
                created_at: 'desc' // Sorting by creation date
            },
            take: 10 // Limit results
        });

        res.json(products);
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