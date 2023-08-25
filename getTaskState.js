const { Connection, PublicKey } = require('@_koi/web3.js');

async function main() {
  const connection = new Connection('https://k2-testnet.koii.live');
  const accountInfo = await connection.getAccountInfo(
    new PublicKey('CwU7UssbUTQ2kRxrytgpZDLLy89wekMGzov4BUi1Vtpg'),
  );
  console.log(JSON.parse(accountInfo.data + ''));
}

main();