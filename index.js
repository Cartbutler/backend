// Basic backend setup
const express = require('express');
const mysql = require('mysql2');
const app = express();
const port = 5000; // The server listens on port 5000

app.use(express.json()); // Middleware to parse JSON bodies

// Database connection
const connection = mysql.createConnection({
    host: '104.197.180.231', 
    user: 'cartbutler8946', 
    password: 'conestoga8946',
    database: 'cartbutler8946' 
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err); // Log error if connection fails
        return;
    }
    console.log('Connected to the database'); // Log success message if connection is successful
});

// Default route for root URL
app.get('/', (req, res) => {
    res.send('Welcome to CartButler Application!'); // Respond with a welcome message
});

// GET - List all categories
app.get('/categories', (req, res) => {
    connection.query('SELECT * FROM categories', (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' }); // Respond with error if query fails
        }
        res.json(results); // Respond with the query results
    });
});

// GET - Search category by ID
app.get('/categories/:id', (req, res) => {
    const categoryId = parseInt(req.params.id);
    connection.query('SELECT * FROM categories WHERE category_id = ?', [categoryId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json(results[0]);
    });
});

// POST - Add new category
app.post('/categories', (req, res) => {
    const { category_name } = req.body;

    if (!category_name) {
        return res.status(400).json({ error: 'Category name is required' });
    }

    connection.query('INSERT INTO categories (category_name) VALUES (?)', [category_name], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' });
        }
        res.status(201).json({ category_id: results.insertId, category_name });
    });
});

// DELETE - Remove category by ID
app.delete('/categories/:id', (req, res) => {
    const categoryId = parseInt(req.params.id);
    connection.query('DELETE FROM categories WHERE category_id = ?', [categoryId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' });
        }
        if (results.affectedRows === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.status(200).json({ message: 'Category deleted successfully' });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`); // Log the server start message
});