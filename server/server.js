require('dotenv').config();
const express = require('express');
const cors = require('cors');
const scrapeRouter = require('./routes/scrape');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', scrapeRouter);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`\n🚀 Lead Scrapper API running on http://localhost:${PORT}`);
});
