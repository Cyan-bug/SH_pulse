require('dotenv').config();
const express = require('express');
const app = express();
const runCrawler = require('./crawler/index.js');

app.use(express.json());

// Manual trigger
app.post('/crawl-now', async (req, res) => {
  try {
    console.log('Manual crawl started...');
    await runCrawler();
    res.status(200).send('Crawl completed successfully.');
  } catch (error) {
    console.error('Crawl failed:', error);
    res.status(500).send('Crawl failed.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));