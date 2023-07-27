// Import required modules
const Adapter = require('../model/adapter');
const PCR = require('puppeteer-chromium-resolver');
const cheerio = require('cheerio');
const { Web3Storage, File } = require('web3.storage');
const storageClient = new Web3Storage({
  token: process.env.SECRET_WEB3_STORAGE_KEY,
});
const Data = require('../model/data');
const fs = require('fs');
const nytcookies = require('./nytcookies');

/**
 * Nytimes
 * @class
 * @extends Adapter
 * @description
 * Provides a crawler interface for the data gatherer nodes to use to interact with nytimes
 */

class Nytimes extends Adapter {
  constructor(credentials, db, maxRetry) {
    super(credentials, maxRetry);
    this.credentials = credentials;
    this.db = db;
    this.db.initializeData();
    this.proofs = new Data('proofs');
    this.proofs.initializeData();
    this.cids = new Data('cids');
    this.cids.initializeData();
    this.articles = [];
    this.toCrawl = [];
    this.parsed = {};
    this.lastSessionCheck = null;
    this.sessionValid = false;
    this.browser = null;
    this.cookies = nytcookies;
  }

  /**
   * checkSession
   * @returns {Promise<boolean>}
   * @description
   * 1. Check if the session is still valid
   * 2. If the session is still valid, return true
   * 3. If the session is not valid, check if the last session check was more than 1 minute ago
   * 4. If the last session check was more than 1 minute ago, negotiate a new session
   */
  checkSession = async () => {
    if (this.sessionValid) {
      return true;
    } else if (Date.now() - this.lastSessionCheck > 60000) {
      await this.negotiateSession();
      return true;
    } else {
      return false;
    }
  };

  /**
   * negotiateSession
   * @returns {Promise<void>}
   * @description
   * 1. Get the path to the Chromium executable
   * 2. Launch a new browser instance
   * 3. Open a new page
   * 4. Set the viewport size
   * 5. Queue nytimesLogin()
   */
  negotiateSession = async () => {
    const options = {};
    const stats = await PCR(options);

    this.browser = await stats.puppeteer.launch({
      headless: 'new',
      executablePath: stats.executablePath,
    });

    console.log('Step: Open NYT page');
    this.page = await this.browser.newPage();
    await this.page.setUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    );

    await this.page.setViewport({ width: 1920, height: 1000 });

    // Set cookies
    await this.page.setCookie(...this.cookies);
    await this.page.goto('https://nytimes.com/', {
      timeout: 1000000,
    });

    const [button] = await this.page.$x("//button[contains(., 'Continue')]");
    if (!button) {
      console.log('Test Passed');
      this.sessionValid = true;
      // TODO: If log in failed, close browser => open a headless:false browser => ask user login => save the cookies => run it again with new cookie
      // await this.nytimesLogin();
      return true;
    }
    this.sessionValid = true;

    await this.page.waitForTimeout(10000000);

    return true;
  };

  /**
   * nytimesLogin
   * @returns {Promise<void>}
   * @description
   * 1. Go to nytimes.com
   * 2. Go to login page
   * 3. Fill in username
   * 4. Fill in password
   * 5. Click login
   * 6. Wait for login to complete
   * 7. Check if login was successful
   * 8. If login was successful, return true
   * 9. If login was unsuccessful, return false
   * 10. If login was unsuccessful, try again
   */
  nytimesLogin = async () => {
    console.log('Step: Open new page');
    let page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36',
    );

    // TODO - Enable console logs in the context of the page and export them for diagnostics here
    await page.setViewport({ width: 1920, height: 1000 });

    //   await page.goto('https://www.nytimes.com/', { timeout: 1000000 });

    await page.waitForTimeout(3346);
    await page.goto(
      'https://myaccount.nytimes.com/auth/login?response_type=cookie',
      {
        timeout: 100000,
      },
    );

    for (let i = 0; i < 100; i++) {
      try {
        const emailField = await page.$('#email');
        if (emailField) {
          console.log('Email inbox found');
          console.log('Step: Type email and press Enter');
          await page.type('#email', this.credentials.username);
          console.log('Email found');
          await page.keyboard.press('Enter');
          await page.waitForNavigation({ timeout: 5000 });
          break;
        } else {
          console.log('Email inbox not found' + i);
          await page.waitForTimeout(3000);
        }
      } catch (err) {
        console.log('Caught navigation error', err);
      }
    }

    await page.waitForTimeout(2185);
    console.log('Step: Type password and press Enter');
    await page.type('#password', this.credentials.password);
    console.log('Password found');
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ timeout: 1000000 });
    const [button] = await page.$x("//button[contains(., 'Continue')]");
    if (button) {
      await button.click();
    }
    // Wait for one second before trying again
    await page.waitForTimeout(3456);
    cookies = await page.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    await page.close();
    console.log('Step: Login successful');

    return true;
  };

  /**
   * crawl
   * @param {string} query
   * @returns {Promise<string[]>}
   * @description Crawls the queue of known links
   */
  crawl = async round => {
    try {
      if (!this.sessionValid) {
        await this.negotiateSession();
      }

      if (this.toCrawl.length === 0) {
        await this.fetchList();
      }

      await this.parseItem(round);

      return this.articles;
    } catch (err) {
      console.log('ERROR IN CRAWL' + err);
      return false;
    }
  };

  /**
   * fetchList
   * @param {string} url
   * @returns {Promise<string[]>}
   * @description Fetches a list of links from a given url
   */
  fetchList = async () => {
    if (!this.sessionValid) {
      await this.negotiateSession();
    }
    try {
      const html = await this.page.content();
      const $ = cheerio.load(html);
      const self = this;

      $('section.story-wrapper a').each(
        function (i, elem) {
          const link = $(elem).attr('href');
          const title = $(elem).find('h3.indicate-hover').text();
          const description = $(elem).find('p.summary-class').text();

          // check if link, title and description are not undefined or empty
          // TODO: we need another option to fetch the following list of links
          if (
            link &&
            !link.includes('https://theathletic.com/') &&
            !link.includes('https://www.nytimes.com/video/') &&
            !link.includes('https://www.nytimes.com/live/') &&
            !link.includes('https://www.nytimes.com/interactive/') &&
            !link.includes('https://www.nytimes.com/explain/') &&
            (title || description)
          ) {
            self.articles.push({
              title,
              description,
              link,
            });
            self.toCrawl.push(link);
          }
        }.bind(this),
      );

      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  };

  /**
   * parseItem
   * @param {string} url - the url of the item to parse
   * @param {object} query - the query object to use for parsing
   * @returns {object} - the parsed item
   * @description - this function should parse the item at the given url and return the parsed item data
   *               according to the query object and for use in either crawl() or validate()
   */
  parseItem = async round => {
    if (!this.sessionValid) {
      await this.negotiateSession();
    }
    try {
      console.log('Step: Parse Item');
      console.log('To parse', this.toCrawl.length);

      await this.page.setJavaScriptEnabled(false);

      // crawl each link in the toCrawl array
      for (const link of this.toCrawl) {
        await this.page.goto(link, {
          timeout: 10000,
          waitUntil: 'domcontentloaded',
        });
        await Promise.race([
          this.page.waitForSelector('article#story'),
          this.page.waitForSelector(
            'article.live-blog-content.meteredContent[data-testid="live-blog-content"]',
          ),
        ]);

        const articleHtml = await this.page.content();
        const _$ = cheerio.load(articleHtml);

        const author = _$('span[itemprop="name"]').text();
        // Select the article#story element
        let articleContent = _$('article#story');

        // Remove the div elements with id that starts with 'story-ad-'
        articleContent.find('div[id^="story-ad-"]').remove();
        articleContent.find('div[data-testid="brand-bar"]').remove();
        articleContent.find('div#sponsor-wrapper').remove();
        articleContent.find('div#top-wrapper').remove();
        articleContent.find('div#bottom-wrapper').remove();
        articleContent.find('div[role="toolbar"]').remove();

        // Get the modified HTML content
        articleContent = _$('<div>').append(articleContent).html();

        articleContent =
          '<meta charset="UTF-8">' +
          articleContent.replace(/’/g, "'").replace(/—/g, '--');

        // _$('section[name="articleBody"] .StoryBodyCompanionColumn').each(
        //   function (i, element) {
        //     articleContent += _$(this).text() + '\n\n';
        //   },
        // );

        // find the corresponding article in the articles array and add the author to it
        for (let article of this.articles) {
          if (article.link === link) {
            article.author = author;
            article.releaseDate = await this.extractDateFromURL(article.link);
            let cid = await this.getArticleCID(round, article, articleContent);
            article.cid = cid;
            await this.db.create(article);

            // TEST:Use fs write the articleContent to a file, name is article title
            // fs.writeFileSync(
            //   `./articles/${article.title}.html`,
            //   articleContent,
            // );
            // fs.writeFileSync(
            //   `./articles/${article.title}.json`,
            //   JSON.stringify(article),
            // );

            break;
          }
        }

        // remove the link from the toCrawl array
        this.toCrawl = this.toCrawl.filter(item => item !== link);
      }
      // console.log(this.articles);
      return true;
    } catch (err) {
      console.log('ERROR IN PARSE ITEM' + err);
      return false;
    }
  };

  /**
   * extractDateFromURL
   * @param {string} url
   * @returns
   */
  extractDateFromURL = async url => {
    // The URL is split into an array of strings using '/' as the separator
    const splitURL = url.split('/');

    // We know that the date parts are at the indices 3, 4 and 5 of the array
    const [year, month, day] = splitURL.slice(3, 6);

    return `${year}-${month}-${day}`;
  };
  /**
   * getArticleCID
   * @param {string} round - the round to get the Article cid for
   * @returns {string} - the cid of the Article
   * @description - this function should return the cid of the Article for the given round
   * if the Article has not been uploaded yet, it should upload it and return the cid
   */
  getArticleCID = async (round, article, articleContent) => {
    try {
      const encoder = new TextEncoder();

      const articleContentEncoded = encoder.encode(articleContent);
      const articleFile = new File(
        [articleContentEncoded],
        `${article.title}.html`,
        {
          type: 'text/html;charset=UTF-8',
        },
      );

      const articleMetaEncoded = encoder.encode(JSON.stringify(article));
      const articleMeta = new File(
        [articleMetaEncoded],
        `${article.title}.json`,
        {
          type: 'application/json;charset=UTF-8',
        },
      );

      const cid = await storageClient.put([articleFile, articleMeta]);
      return cid;
    } catch (err) {
      console.log('ERROR IN GET ARTICLE CID' + err);
      return false;
    }
  };

  /**
   * stop
   * @returns {Promise<boolean>}
   * @description Stops the crawler
   */
  stop = async () => {
    return (this.break = true);
  };
}

module.exports = Nytimes;
