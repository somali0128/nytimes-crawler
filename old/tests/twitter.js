require('dotenv').config();
const Nytimes = require('../adapters/nytimes');
const Data = require('../../model/data');

const run = async () => {
    const args = process.argv.slice(2);

    var searchTerm = args.length > 0 ? args[0] : 'Web3';

    let query = {
        limit: 100,
        searchTerm: searchTerm,
        query: `https://twitter.com/search?q=${searchTerm}&src=typed_query`,
        depth: 3,
        getRound: nameSpaceGetRoundMock,
        round: nameSpaceGetRoundMock()
    }

    const username = process.env.NYTIMES_USERNAME;
    const password = process.env.NYTIMES_PASSWORD;

    let credentials = {
        username: username,
        password: password
    }
    
    let data = new Data('nytimes', db);

    let adapter = new Nytimes(credentials, data, 3);

    await adapter.negotiateSession(); 
    
    await adapter.crawl(query);
}

const nameSpaceGetRoundMock = () => {
    return 6;
}

run ()
