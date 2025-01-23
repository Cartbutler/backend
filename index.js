// Basic backend setup
const express = require('express');
const app = express();
const port = 5000;

app.use(express.json());

// Placeholder Endpoint for categories (will be connected after with DB or APIs if we can [: )
const categories = [
    { id: 1, name: 'Dairy Food' },
    { id: 2, name: 'Fruits' },
    { id: 3, name: 'Snacks' },
    { id: 4, name: 'Beverages' },
    { id: 5, name: 'Bakery' }
];

// Default route for root URL
app.get('/', (req, res) => {
    res.send('Welcome to CartButler Application!');
});

// GET - List all categories
app.get('/categories', (req, res) => {
    res.json(categories);
});

// GET - Search category by ID
app.get('/categories/:id', (req, res) => {
    const categoryId = parseInt(req.params.id); // req.params property in Express.js is used to access route parameters
    const category = categories.find(cat => cat.id === categoryId); // callback function to checkthe itens on the list with selected ID (cat represent the item/category)

    if (!category) {
        return res.status(404).json({ error: 'Category not found' });
    }

    res.json(category);
});

// POST - Add new category
app.post('/categories', (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Category name is required' });
    }

    const newCategory = {
        id: categories.length + 1,
        name
    };

    categories.push(newCategory);
    res.status(201).json(newCategory);
});

// DELETE - Remove category by ID
app.delete('/categories/:id', (req, res) => {
    const categoryId = parseInt(req.params.id);
    const index = categories.findIndex(cat => cat.id === categoryId);

    if (index === -1) {
        return res.status(404).json({ error: 'Category not found' });
    }

    categories.splice(index, 1);
    res.status(200).json({ message: 'Category deleted successfully' });
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
