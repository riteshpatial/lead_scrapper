# Lead Scrapper

A full-stack web application that extracts business leads (name, phone, email, address, social media) from any website — with real-time streaming, deep scraping, and CSV/JSON export.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Scraping Strategies](#scraping-strategies)
- [API Endpoints](#api-endpoints)
- [Frontend Features](#frontend-features)
- [Lead Data Fields](#lead-data-fields)
- [Setup & Installation](#setup--installation)
- [How to Run](#how-to-run)

---

## Project Overview

Lead Scrapper intelligently visits any business directory or dealer listing website and automatically extracts:

- Business / dealer names
- Phone numbers & emails
- Full addresses (parsed into city, locality, pincode)
- Social media links (Facebook, Instagram, LinkedIn, Twitter, YouTube)
- Ratings, status (Open/Closed), and services
- Business hours and descriptions (via deep scrape)

It supports **three scraping modes**:

| Mode | How It Works |
|------|-------------|
| **Direct URL** | Paste any URL — scraper auto-detects listings and extracts |
| **State-by-state (links)** | Auto-detects state navigation links, scrapes each state page sequentially with live SSE progress |
| **State-by-state (dropdown)** | Auto-detects dropdown filters, selects each state, clicks Search, extracts results |

---

## Project Structure

```
lead_scrapper/
│
├── client/                          # React frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── App.jsx                  # Main app — state management, SSE streaming
│   │   └── components/
│   │       ├── Header.jsx           # App header
│   │       ├── ScrapeForm.jsx       # URL input form
│   │       ├── FilterPanel.jsx      # State selector UI (dropdown / links)
│   │       ├── StatsBar.jsx         # Live stats — leads, emails, phones, time
│   │       ├── LeadCard.jsx         # Individual lead card view
│   │       ├── TableView.jsx        # Table view of all leads
│   │       └── ExportButtons.jsx    # CSV & JSON export
│   ├── package.json
│   └── vite.config.js
│
├── server/                          # Node.js backend (Express)
│   ├── server.js                    # Express app entry point (port 5000)
│   ├── routes/
│   │   └── scrape.js                # API routes: /scrape, /analyze, /scrape-states-stream
│   └── scrapers/
│       └── leadScraper.js           # Core scraping engine (Puppeteer + Cheerio)
│
└── package.json                     # Root package
```

---

## Tech Stack

### Backend

| Package | Purpose |
|---------|---------|
| `express` | HTTP server & API routing |
| `puppeteer` | Headless Chrome browser — renders JS-heavy pages |
| `cheerio` | HTML parsing (jQuery-style) for structured data |
| `cors` | Cross-origin requests from frontend |
| `dotenv` | Environment variable management |
| `nodemon` | Auto-restart in development |

### Frontend

| Package | Purpose |
|---------|---------|
| `react 18` | UI framework |
| `vite` | Fast dev server + build tool |
| `tailwindcss` | Utility-first styling |
| `axios` | API calls to backend |
| Native `fetch` + `ReadableStream` | SSE streaming for live state-by-state progress |

---

## How It Works

```
User pastes URL
      ↓
POST /api/scrape
      ↓
Puppeteer launches headless Chrome
      ↓
Page loads → auto-scroll → click "Load More" if present
      ↓
4-Strategy listing detection runs
      ↓
      ├── Listings found? → Extract all cards → normalise leads
      │
      ├── No listings? → Check for state filters (dropdown / nav links)
      │       ↓
      │   FilterPanel shown in UI
      │       ↓
      │   User picks states → POST /api/scrape-states-stream (SSE)
      │       ↓
      │   Each state scraped sequentially → results streamed live to UI
      │
      └── Single page? → Extract emails, phones, social, structured data
              ↓
          Also visits /contact, /about, /team sub-pages automatically

Deep Scrape (optional):
      ↓
Visit each dealer's own website
      ↓
Extract extra phones, emails, social media, hours, description
```

---

## Scraping Strategies

The engine runs **4 detection strategies** in order — stops at the first one that finds ≥ 2 cards:

| Strategy | Method | Best For |
|----------|--------|----------|
| **Strategy 1** | Find `mailto:` / `tel:` anchor tags → walk up DOM to card container | Sites with proper contact links |
| **Strategy 2** | Walk text nodes for plain-text emails → walk up DOM to card | Sites with text emails (not links) |
| **Strategy 3** | Group elements by repeated CSS class name → find groups with contact info | Directory sites with consistent card classes |
| **Strategy 4** | Find sibling elements with same tag under a parent → filter by contact presence | List/grid layouts with homogeneous structure |

Each card extracts:
- Dealer name (from `h1-h6`, class name patterns, or first valid text line)
- Company name (from `<strong>`, `<b>`, or company-class elements)
- Phones (from `tel:` links + plain text lines matching phone patterns)
- Emails (from `mailto:` links + regex on text)
- Address (remaining lines — parsed into city, locality, pincode)
- Rating, status, services, website, Google Maps link, detail page link

---

## API Endpoints

### `POST /api/scrape`
Scrape up to 10 URLs at once.

**Request:**
```json
{ "urls": ["https://example.com/dealers"] }
```

**Response:**
```json
{
  "success": true,
  "total": 42,
  "results": [ { "dealerName": "...", "phone": "...", "email": "...", ... } ],
  "filters": null
}
```

---

### `POST /api/analyze`
Detect if a URL has state/region filter controls (without scraping).

**Request:**
```json
{ "url": "https://example.com/find-dealer" }
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com/find-dealer",
  "filters": {
    "type": "dropdown",
    "stateOptions": [ { "value": "TX", "label": "Texas" }, ... ],
    "stateSelectorCSS": "select[name='state']",
    "searchSelector": "button[type='submit']"
  }
}
```

---

### `POST /api/scrape-states-stream`
Scrape all states sequentially with **Server-Sent Events (SSE)** live streaming.

**Request:**
```json
{
  "type": "dropdown",
  "url": "https://example.com/dealers",
  "stateSelectorCSS": "select[name='state']",
  "searchSelector": "#search-btn",
  "stateOptions": [ { "value": "TX", "label": "Texas" } ],
  "deepScrape": false
}
```

**SSE Event Types:**

| Event | When |
|-------|------|
| `start` | Beginning to scrape a state |
| `progress` | Mid-scrape status message (selecting, clicking, loading) |
| `result` | State done — includes all leads found + running total |
| `error` | One state failed — continues to next |
| `done` | All states complete — total lead count |
| `fatal` | Unrecoverable error |

---

### `GET /health`
```json
{ "status": "ok" }
```

---

## Frontend Features

| Feature | Description |
|---------|-------------|
| **URL input** | Paste single or multiple URLs |
| **Auto filter detection** | If a state dropdown or nav links found, FilterPanel appears automatically |
| **State multi-select** | Select all or specific states to scrape |
| **Deep Scrape toggle** | Visit each dealer's own website for extra data (slower but richer) |
| **Live progress** | Real-time state-by-state progress with lead count as they stream in |
| **Cards view** | Each lead as an individual card with all fields |
| **Table view** | All leads in a sortable table |
| **Stats bar** | Total leads, emails, phones, scrape time |
| **Export CSV** | Download all leads as CSV |
| **Export JSON** | Download all leads as JSON |

---

## Lead Data Fields

Each extracted lead contains:

| Field | Description |
|-------|-------------|
| `dealerName` | Business / dealer name |
| `companyName` | Company / brand name (if separate) |
| `city` | City (parsed from address) |
| `locality` | Locality / area (parsed from address) |
| `pinCode` | ZIP / PIN code (parsed from address) |
| `address` | Full raw address string |
| `phone` | Primary phone number |
| `phones` | All phone numbers found (up to 8) |
| `email` | Primary email |
| `emails` | All emails found (up to 10) |
| `rating` | Star rating (if available) |
| `status` | Open Now / Closed |
| `services` | Tags / service labels |
| `website` | Business website URL |
| `socialMedia` | Facebook, Instagram, LinkedIn, Twitter, YouTube links |
| `openingHours` | Business hours (deep scrape) |
| `description` | Business description (deep scrape) |
| `sourceUrl` | Page where lead was found |
| `scrapedAt` | ISO timestamp |

---

## Setup & Installation

### Prerequisites

- **Node.js** v18+ 
- **npm**

### Step 1 — Clone the Repository

```bash
git clone https://github.com/riteshpatial/lead_scrapper.git
cd lead_scrapper
```

### Step 2 — Install Server Dependencies

```bash
cd server
npm install
```

### Step 3 — Install Client Dependencies

```bash
cd ../client
npm install
```

---

## How to Run

### Start the Backend (Terminal 1)

```bash
cd server
npm run dev        # development (nodemon auto-restart)
# or
npm start          # production
```

Server runs at: **http://localhost:5000**

### Start the Frontend (Terminal 2)

```bash
cd client
npm run dev
```

Frontend runs at: **http://localhost:5173**

> The Vite dev server proxies `/api` requests to `localhost:5000` automatically.

---

## Usage Flow

```
1. Open http://localhost:5173
2. Paste a business directory URL in the input box
3. Click Scrape
4. If state filters detected → FilterPanel appears → select states → click Scrape
5. Watch leads stream in live (state by state)
6. Toggle between Cards and Table view
7. Click Export CSV or Export JSON to download
```

---

## Author

**Ritesh Patial** — Full Stack Developer

GitHub: [github.com/riteshpatial](https://github.com/riteshpatial)
