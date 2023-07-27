require('dotenv').config();
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

async function main(round) {
  let credentials = {
    username: process.env.NYTIMES_USERNAME,
    password: process.env.NYTIMES_PASSWORD,
  };

  let adapter = new Nytimes(credentials, nytimesDB, 3);

  await adapter.negotiateSession();

  const articleList = await adapter.crawl(round);
  console.log(articleList);

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

  return articleListCid;
}

async function submit(round) {
    try {
    const value = await proofDB.getItem(round);
    const articleListCid = value.articleListCid;

    const submission = {
      value: articleListCid,
      node_pubkey: await namespaceWrapper.getMainAccountPubkey(),
      node_signature: await namespaceWrapper.payloadSigning(value),
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

module.exports = { main, submit };
