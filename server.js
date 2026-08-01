// server.js - Backend server for Deriv API
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'Deriv Bot API is running!' });
});

// Proxy endpoint for Deriv API
app.post('/api/:action', async (req, res) => {
    try {
        const { action } = req.params;
        const { token, app_id, data } = req.body;
        
        console.log(`Calling Deriv API: ${action}`);
        
        const response = await axios.post(
            `https://api.binary.com/v3/${action}`,
            data || {},
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    app_id: app_id
                }
            }
        );
        
        console.log(`Deriv API response: ${response.status}`);
        res.json(response.data);
    } catch (error) {
        console.error('API Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ 
                error: error.response.data || error.message 
            });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`App ID: 33Zq0S246i4BC9ybK02cl`);
});
