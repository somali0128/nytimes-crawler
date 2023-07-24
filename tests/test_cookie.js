require('dotenv').config();
const PCR = require('puppeteer-chromium-resolver');
const NYTIMES_USERNAME = process.env.NYTIMES_USERNAME;
const NYTIMES_PASSWORD = process.env.NYTIMES_PASSWORD;
const fs = require('fs');

// let cookies;

let cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));

async function login(browser) {
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
        await page.type('#email', NYTIMES_USERNAME);
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
  await page.type('#password', NYTIMES_PASSWORD);
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
}

async function continueHeadless(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1000 });

  // Set cookies
  await page.setCookie(...cookies);
  await page.goto('https://nytimes.com/', {
    timeout: 100000,
  });

  const [button] = await page.$x("//button[contains(., 'Continue')]");
  if (button) {
    console.log('Test failed');
  } else {
    console.log('Test passed');
  }
  await page.waitForTimeout(3000456);
//   await page.close();
}

(async () => {
  // First, open browser in non-headless mode for login
  const options = {};
  const stats = await PCR(options);

//   let browser = await stats.puppeteer.launch({
//     headless: false,
//     executablePath: stats.executablePath,
//   });
//   await login(browser);
//   await browser.close();

  // Then, open new browser in headless mode and set the cookies
  browser = await stats.puppeteer.launch({
    headless: false,
    executablePath: stats.executablePath,
  });
  await continueHeadless(browser);
  await browser.close();
})();
