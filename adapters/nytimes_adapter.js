// Import required modules
const Adapter = require('../model/adapter');
const PCR = require('puppeteer-chromium-resolver');
const cheerio = require('cheerio');
const crypto = require('crypto');
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
  constructor(credentials, db, maxRetry, locale, debug, searchterm) {
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
    this.locale = locale || 'US';
    this.debug = debug || false;
    this.searchterm = false;
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

    const headless = this.debug === 'true' ? false : 'new';
    this.browser = await stats.puppeteer.launch({
      headless: headless,
      executablePath: stats.executablePath,
    });

    console.log('Step: Open NYT page');
    console.log(this.searchterm);
    this.page = await this.browser.newPage();
    await this.page.setUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    );

    await this.page.setViewport({ width: 1920, height: 1000 });

    // Set cookies
    await this.page.setCookie(...this.cookies);

    //Edit the baseURL according to the locale
    let baseURL;

    if (this.locale == 'CN') {
      if (this.searchterm) {
        baseURL = 'https://cn.nytimes.com/' + `search?query=${this.searchterm}`;
      } else {
        baseURL = 'https://cn.nytimes.com/';
      }
    } else if (this.locale == 'ES') {
      if (this.searchterm) {
        baseURL =
          'https://www.nytimes.com/' + `search?query=${this.searchterm}`;
      } else {
        baseURL = 'https://www.nytimes.com/es/';
      }
    } else {
      if (this.searchterm) {
        baseURL =
          'https://www.nytimes.com/' + `search?query=${this.searchterm}`;
      } else {
        baseURL = 'https://www.nytimes.com/';
      }
    }

    await this.page.goto(baseURL, {
      timeout: 1000000,
    });
    await this.page.waitForTimeout(2000); // wait for 2 seconds

    //Load all the articles, if we are searching for a term
    if (this.searchterm) {
      while (true) {
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });

        const showMoreButton = await this.page.$(
          '[data-testid="search-show-more-button"]',
        );
        if (showMoreButton) {
          await showMoreButton.click();
          await this.page.waitForTimeout(2000); // wait for 2 seconds
        } else {
          break; // exit the loop if the button is not found
        }
      }
    }

    const [button] = await this.page.$x("//button[contains(., 'Continue')]");
    if (!button) {
      console.log('Cookie Passed');
      this.sessionValid = true;
      return true;
    }

    this.sessionValid = true;

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
      console.log('Step: Crawl');
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
      if (this.locale === 'CN') {
        return await this.fetchCNList($, self);
      } else if (this.locale === 'ES') {
        return await this.fetchESList($, self);
      } else {
        return await this.fetchUSList($, self);
      }
    } catch (err) {
      console.log(err);
      return false;
    }
  };

  /**
   * fetchUSList will fetch the list under the US section
   * @param {string} $ - the cheerio object
   * @param {object} self - the this object
   * @returns true
   */
  fetchUSList = async ($, self) => {
    if (self.searchterm === false) {
      console.log('Fetching US List');
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
            !link.includes('https://www.nytimes.com/wirecutter') &&
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
    } else {
      async function scrollToBottomAndClick() {}

      await scrollToBottomAndClick();

      console.log('Fetching US List with a search term');
      $('ol li a').each(
        function (i, elem) {
          const link = 'https://www.nytimes.com/' + $(elem).attr('href');
          const title = $(elem).find('h4').text();
          const description = $(elem).find('p').text();

          // check if link, title and description are not undefined or empty
          // TODO: we need another option to fetch the following list of links
          if (
            link &&
            !link.includes('https://theathletic.com/') &&
            !link.includes('https://www.nytimes.com/video/') &&
            !link.includes('https://www.nytimes.com/live/') &&
            !link.includes('https://www.nytimes.com/interactive/') &&
            !link.includes('https://www.nytimes.com/explain/') &&
            !link.includes('https://www.nytimes.com/wirecutter') &&
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
    }
  };

  /**
   * fetchCNList will fethc the list under the CN section
   * @param {string} $ - the cheerio object
   * @param {object} self - the this object
   * @returns true
   */
  fetchCNList = async ($, self) => {
    console.log('Fetching CN List');
    $('div.leadNewsContainer').each(
      function (i, elem) {
        const titleElement = $(elem).find('h2.leadHeadline a');
        const title = titleElement.text();
        const link = 'https://cn.nytimes.com' + titleElement.attr('href');
        const description = $(elem).find('p.summary').text();

        if (link && (title || description)) {
          self.articles.push({
            title,
            description,
            link,
          });
          self.toCrawl.push(link);
        }
      }.bind(this),
    );

    $('ul.regularSummaryList li').each(
      function (i, elem) {
        const linkElement = $(elem).find('h3.regularSummaryHeadline a');
        const link = 'https://cn.nytimes.com' + linkElement.attr('href');
        const title = linkElement.text();
        const description = $(elem).find('p.summary').text();

        if (link && (title || description)) {
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
  };

  /**
   * fetchESList will fethc the list under the ES section
   * @param {string} $ - the cheerio object
   * @param {object} self - the this object
   * @returns true
   */
  fetchESList = async ($, self) => {
    console.log('Fetching ES List');

    $('ol li').each(
      function (i, elem) {
        const titleElement = $(elem).find('h3 a');
        const titleElement2 = $(elem).find('a h3');
        const descriptionElement = $(elem).find('p').first();
        const title = titleElement.text()
          ? titleElement.text()
          : titleElement2.text()
          ? titleElement2.text()
          : descriptionElement.text();
        const description = titleElement.text()
          ? descriptionElement.text()
          : titleElement2.text()
          ? descriptionElement.text()
          : '';
        const link =
          'https://nytimes.com' +
          (titleElement.attr('href')
            ? titleElement.attr('href')
            : titleElement2.parent().attr('href')
            ? titleElement2.parent().attr('href')
            : $(elem).find('p a').attr('href'));

        if (link && (title || description)) {
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
        try {
          await this.page.goto(link, {
            timeout: 50000,
          });

          await this.page.waitForFunction(
            'document.querySelector("div#app") && document.querySelector("div#app").innerText.length > 0',
            { timeout: 50000 },
          );
        } catch (error) {
          console.log(`Error loading page or timeout exceeded: ${error}`);
        }

        const articleHtml = await this.page.content();
        const _$ = cheerio.load(articleHtml);

        let author = '';
        let articleText = '';
        let articleContent = '';

        if (this.locale === 'CN') {
          // Fetch the CN article
          author = _$('address').text();

          _$('div.article-paragraph').each(function (i, elem) {
            articleText += _$(this).text() + ' ';
          });

          // Select the article#story element
          articleContent = _$('article.article-content');

          // Remove the div elements with id that starts with 'story-ad-'
          articleContent.find('div[id^="medium-rectangle-ad-"]').remove();

          // Get the modified HTML content
          articleContent = _$('<div>').append(articleContent).html();

          articleContent =
            '<meta charset="UTF-8">' +
            articleContent.replace(/’/g, "'").replace(/—/g, '--');
        } else if (this.locale === 'ES') {
          // Fetch the US article
          author = _$('span.last-byline[itemprop="name"]').text() + ', ';

          _$('p').each(function (i, elem) {
            articleText += _$(this).text() + ' ';
          });

          // Select the article#story element
          articleContent = _$('article#story');

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
        } else {
          // Fetch the US article
          author = _$('span.last-byline[itemprop="name"]').text() + ', ';

          _$('div.StoryBodyCompanionColumn').each(function (i, elem) {
            articleText += _$(this).text() + ' ';
          });

          // Select the article#story element
          articleContent = _$('article#story');

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
        }

        // find the corresponding article in the articles array and add the author to it
        for (let article of this.articles) {
          if (article.link === link) {
            article.author = author;
            article.releaseDate = await this.extractDateFromURL(article.link);
            let cid = await this.getArticleCID(round, article, articleContent);
            article.contentHash = await this.hashText(articleText);
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
            // fs.writeFileSync(
            //   `./articles/${article.title.split('/').join('-')}.txt`,
            //   articleText,
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
    const splitURL = url.split('/');
    let date;

    if (url.includes('www.nytimes.com')) {
      const [year, month, day] = splitURL.slice(3, 6);
      date = `${year}-${month}-${day}`;
    } else if (url.includes('cn.nytimes.com')) {
      const dateString = splitURL[4]; // get the date part
      // Reformat the string from 'YYYYMMDD' to 'YYYY-MM-DD'
      date = `${dateString.slice(0, 4)}-${dateString.slice(
        4,
        6,
      )}-${dateString.slice(5, 7)}`;
    } else if (url.includes('https://nytimes.com/es/')) {
      const [year, month, day] = splitURL.slice(4, 7);
      date = `${year}-${month}-${day}`;
    } else {
      throw new Error(`Unexpected URL format: ${url}`);
    }

    return date;
  };

  /**
   * hashText
   * @param {string} text - the text to hash
   * @returns {Promise<boolean>}
   * @description - this function should return the hash of the given text
   */
  hashText = async text => {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
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
    try {
      this.browser.close();
      return true;
    } catch (err) {
      console.log('ERROR IN STOP' + err);
      return false;
    }
  };
}

module.exports = Nytimes;
