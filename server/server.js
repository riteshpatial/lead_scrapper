require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const scrapeRouter = require('./routes/scrape');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', scrapeRouter);
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Serve React client in production
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (_, res) => res.sendFile(path.join(clientDist, 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🚀 Lead Scrapper running on http://localhost:${PORT}`);
});
