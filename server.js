const express = require('express');
const path = require('path');
const crawlNow = require(path.join(__dirname, 'crawler', 'index'));

const app = express();
const port = process.env.PORT || 3000;

// Define the /crawl-now endpoint
app.get('/crawl-now', async (req, res) => {
  try {
    console.log('Crawler started!');
    await crawlNow();  // Trigger the crawlNow function
    res.send('Crawl triggered successfully!');
  } catch (error) {
    console.error('Error triggering crawl:', error); // <--- ADD THIS
    res.status(500).send(`Error triggering crawl: ${error.message}`); // <--- ADD THIS
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});