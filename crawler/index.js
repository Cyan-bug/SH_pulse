require('dotenv').config();
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const cliProgress = require('cli-progress');
const robotsParser = require('robots-parser');
const fetch = require('node-fetch');
const videoPlayers = require('../config/video-players.json');
const mediaGroups = require('../config/media-groups.json');
const port = 3000;

console.log('SUPABASE_URL set:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_KEY set:', !!process.env.SUPABASE_KEY);

// Call createClient
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function crawlNow() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Fetching URLs from Supabase...');
    const { data: urls, error } = await supabase
      .from('crawl_targets_italy')
      .select('url');

    if (error) {
        console.error('Error fetching URLs from Supabase:', error);
        throw error; // This will stop execution if there's an error
    }
    if (!urls || urls.length === 0) {
      console.log('No URLs found.');
      return;
    }

    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(urls.length, 0);

    for (const entry of urls) {
      const baseUrl = entry.url.startsWith('http') ? entry.url : `https://${entry.url}`;

      try {
        // Check robots.txt
        const robotsTxtUrl = new URL('/robots.txt', baseUrl).href;
        let robotsTxt;
        try {
          const response = await fetch(robotsTxtUrl);
          if (response.ok) {
            robotsTxt = robotsParser(robotsTxtUrl, await response.text());
          }
        } catch (e) {
          console.warn(`No robots.txt found at ${robotsTxtUrl}`);
        }

        if (robotsTxt && !robotsTxt.isAllowed(baseUrl, '*')) {
          console.warn(`Crawling disallowed by robots.txt for ${baseUrl}`);
          continue;
        }

        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const articleLinks = await page.$$eval('a[href]', links =>
          links.map(a => a.href).filter(href => {
            try {
              const url = new URL(href);
              return (
                url.hostname.includes(location.hostname) && 
                (url.pathname.includes('article') ||
                url.pathname.includes('news') ||
                url.pathname.endsWith('.html'))
              );
            } catch {
              return false;
            }
          })
        );

        const uniqueArticles = [...new Set(articleLinks)].slice(0, 6);

        for (const articleUrl of uniqueArticles) {
          await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 60000 });
          await page.waitForTimeout(2000 + Math.random() * 2000); // Random small delay

          const requests = [];
          page.on('request', req => requests.push(req.url()));

          // Smart wait for player scripts
          const playerPatterns = Object.values(videoPlayers).flat();
          await page.waitForFunction((patterns) => {
            const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
            return patterns.some(pattern => scripts.some(src => src.includes(pattern)));
          }, playerPatterns, { timeout: 8000 }).catch(() => {});

          const results = await scrapePage(page, articleUrl, requests);

          // Save results
          await supabase.from('crawled_data_italy').insert([results]);

          console.log(`Saved: ${articleUrl}`);
          await page.waitForTimeout(3000 + Math.random() * 3000);
        }
      } catch (err) {
        console.error('Failed crawling base URL:', baseUrl, err);
      }

      progressBar.increment();
    }

    progressBar.stop();
    console.log('Crawling finished.');

  } catch (error) {
    console.error('Crawler failed:', error);
  } finally {
    await browser.close();
  }
}

async function scrapePage(page, targetUrl, requests) {
  const detectMediaGroup = (url) => {
    const domain = new URL(url).hostname.replace('www.', '');

    for (const [group, domains] of Object.entries(mediaGroups)) {
      if (group === 'Other Groups') continue;
      if (domains.some(d => domain.includes(d.replace('www.', '')))) {
        return group;
      }
    }

    for (const [group, domains] of Object.entries(mediaGroups.OtherGroups)) {
      if (domains.some(d => domain.includes(d.replace('www.', '')))) {
        return group;
      }
    }

    return 'Unknown';
  };

  const detectedPlayers = new Set();
  const mimePlayers = new Set();

  const scripts = await page.$$eval('script[src]', elements => elements.map(el => el.src));
  const iframes = await page.$$eval('iframe[src]', elements => elements.map(el => el.src));
  const videos = await page.$$eval('video source[src]', elements => elements.map(el => el.src));
  const allUrls = [...requests, ...scripts, ...iframes, ...videos];

  for (const [player, patterns] of Object.entries(videoPlayers)) {
    const matchFound = patterns.some(pattern =>
      allUrls.some(url => url.includes(pattern))
    );
    if (matchFound) {
      detectedPlayers.add(player);
    }
  }

  // MIME detection (video/mp4 etc)
  const mimeTypes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('video source'))
      .map(source => source.type)
      .filter(Boolean);
  });

  if (mimeTypes.some(type => type.startsWith('video/'))) {
    mimePlayers.add('Generic HTML5');
  }

  if (detectedPlayers.size === 0 && mimePlayers.size > 0) {
    detectedPlayers.add('Custom');
  }

  const adFormats = await page.evaluate(() =>
    Array.from(window.performance.getEntriesByType('resource')).map(r => r.name)
  );

  return {
    url: targetUrl,
    mediaGroup: detectMediaGroup(targetUrl),
    videoPlayers: Array.from(detectedPlayers),
    adFormats: {
      instream: adFormats.some(req => req.includes('vast.xml')),
      outstream: adFormats.some(req => req.includes('teads.tv') || req.includes('outbrain.com/lp-video'))
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = crawlNow;