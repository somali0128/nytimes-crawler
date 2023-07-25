require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const NYTIMES_API_KEY = process.env.NYTIMES_API_KEY;

async function fetchData(apiKey, query) {
  try {
    const response = await axios.get(
      `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${query}&api-key=${apiKey}`,
      {
        timeout: 10000,
      },
    );

    console.log(response.data);

    const docs = response.data.response.docs;

    // Process each doc in the array
    const processedDocs = docs.map(doc => {
      // Process the doc object here. This is a placeholder line.
      doc.newProperty = "new value";

      return doc;
    });

    // Save the processed docs array to a file
    fs.writeFile('docs.json', JSON.stringify(processedDocs, null, 2), (err) => {
      if (err) throw err;
      console.log('Data written to file');
    });

  } catch (error) {
    console.error(`Error: ${error}`);
  }
}

// Call the function with your API key
fetchData(NYTIMES_API_KEY, 'web3');
