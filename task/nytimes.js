require('dotenv').config();
const fs = require('fs').promises;
const Data = require('../model/data');
const nytimesDB = new Data('nytimes');
const proofDB = new Data('proof');
proofDB.initializeData();
const Nytimes = require('../adapters/nytimes_adapter');
const { Web3Storage, File } = require('web3.storage');
const storageClient = new Web3Storage({
  token: process.env.SECRET_WEB3_STORAGE_KEY,
});
const { namespaceWrapper } = require('../_koiiNode/koiiNode');
const dataFromCid = require('../helpers/dataFromCid');
const DEBUG_MODE = process.env.DEBUG_MODE;
const LOCALE = process.env.LOCALE;

const { Connection, PublicKey } = require('@_koi/web3.js');

//Import SEARCH_TERM from env, if not present, use false
let SEARCH_TERM;
if (process.env.SEARCH_TERM && process.env.SEARCH_TERM.trim() !== '') {
  SEARCH_TERM = process.env.SEARCH_TERM;
} else {
  SEARCH_TERM = false;
}

const MAX_PAGES = process.env.MAX_PAGES || 10;

async function main(round) {
  let credentials = {
    username: process.env.NYTIMES_USERNAME,
    password: process.env.NYTIMES_PASSWORD,
  };

  let alterationCheck = false;

  //Decide if this round we will "alteration check" from a previous submission
  if ((round + 1) % 5 === 0) {
    let result = await articleAlterationCheck(round);
    alterationCheck = [
      result.linksArray,
      result.contentHashArray,
      result.titleArray,
      result.descriptionArray,
    ];
  }

  let adapter = alterationCheck
    ? new Nytimes(
        credentials,
        nytimesDB,
        3,
        LOCALE,
        DEBUG_MODE,
        SEARCH_TERM,
        MAX_PAGES,
        alterationCheck,
      )
    : new Nytimes(
        credentials,
        nytimesDB,
        3,
        LOCALE,
        DEBUG_MODE,
        SEARCH_TERM,
        MAX_PAGES,
      );

  await adapter.negotiateSession();

  const articleList = await adapter.crawl(round);

  const articleListMeta = JSON.stringify(articleList);
  const articleListMetaFile = new File(
    [articleListMeta],
    `articleList-round${round}.json`,
    {
      type: 'application/json',
    },
  );

  const articleListCid = await storageClient.put([articleListMetaFile]);
  await proofDB.create({ articleListCid, round });
  await adapter.stop();

  return articleListCid;
}

async function submit(round) {
  try {
    const value = await proofDB.getItem(round);
    const articleListCid = value.articleListCid;

    const submission = {
      value: articleListCid,
      node_pubkey: await namespaceWrapper.getMainAccountPubkey(),
      node_signature: await namespaceWrapper.payloadSigning(articleListCid),
    };

    await proofDB.create(submission);

    const proofFile = new File(
      [JSON.stringify(submission)],
      `articleList-proof-${round}.json`,
      {
        type: 'application/json',
      },
    );

    const proof_cid = await storageClient.put([proofFile]);
    return proof_cid;
  } catch (err) {
    console.log('ERROR IN SUBMIT' + err);
  }
}

async function auditSubmission(submission, round) {
  const outputraw = await dataFromCid(submission);
  if (!outputraw) {
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO FAKE VALUE');
    return false;
  }
  const output = outputraw.data;
  // console.log('OUTPUT', output);
  const { value, node_pubkey, node_signature } = output;
  const voteResp = await namespaceWrapper.verifySignature(
    node_signature,
    node_pubkey,
  );
  const cleanVoteRespData = voteResp.data.replace(/"/g, '');

  if (!voteResp || cleanVoteRespData !== value) {
    console.log('cleanVoteRespData', cleanVoteRespData);
    console.log('value received', value);
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO DATA MISMATCH');
    return false;
  }
  const articleList = await dataFromCid(value);
  if (!articleList) {
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO FAKE articleList CID');
    return false;
  }
  if (!articleList.data) {
    console.log('NO ARTICLE LIST DATA');
    return true;
  }
  // Check if the steam special is valid
  // If format of steam_special_resp.data is image, return true
  // Else return false
  if (!typeof articleList.data === 'json') {
    console.log('VOTE FALSE');
    console.log('SLASH VOTE DUE TO FAKE articleList');
    return false;
  }

  console.log('VOTE TRUE');
  return true;
}

async function articleAlterationCheck(round) {
  let choosenCid = null;
  async function getCidToCheck() {
    try {
      try {
        // Try reading the first file.
        return await fs.readFile('localKOIIDB.db', 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File not found. Try reading the fallback file.
          return await fs.readFile('KOIIDB.db', 'utf8');
        } else {
          // If it's an error other than file not found, re-throw it.
          throw error;
        }
      }

      const lines = fileContent.trim().split('\n');
      const eligibleLists = [];

      lines.forEach(line => {
        try {
          const jsonObject = JSON.parse(line);
          if (jsonObject.articleListCid) {
            eligibleLists.push(jsonObject);
          }
        } catch (e) {
          console.error('Error parsing JSON:', e);
        }
      });

      if (eligibleLists.length > 0) {
        let randomIndex = Math.floor(Math.random() * eligibleLists.length);
        let value = eligibleLists[randomIndex]['articleListCid'];

        while (value === null) {
          randomIndex = Math.floor(Math.random() * eligibleLists.length);
          value = eligibleLists[randomIndex]['articleListCid'];
        }

        return value;
      }
      return null;
    } catch (err) {
      console.error('Error reading the file:', err);
      throw err;
    }
  }

  choosenCid = await getCidToCheck();

  const { data: dataToCheck } = await dataFromCid(choosenCid);

  const linksArray = dataToCheck.map(item => item.link);
  console.log('linksArray', linksArray);
  const contentHashArray = dataToCheck.map(item => item.contentHash);
  const titleArray = dataToCheck.map(item => item.title);
  const descriptionArray = dataToCheck.map(item => item.description);

  return {
    linksArray: linksArray,
    contentHashArray: contentHashArray,
    titleArray: titleArray,
    descriptionArray: descriptionArray,
  };
}

module.exports = { main, submit, auditSubmission };
