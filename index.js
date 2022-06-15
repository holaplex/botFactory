const {
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  Connection,
  SystemProgram,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');

const anchor = require('@project-serum/anchor')
const yargs = require("yargs");
const { bs58 } = require('@project-serum/anchor/dist/cjs/utils/bytes')
const fs = require('fs');
let keyPair;

function loadWalletKey(keypair) {
  if (!keypair || keypair == "") {
    throw new Error("Keypair is required!");
  }

  const decodedKey = new Uint8Array(
    keypair.endsWith(".json") && !Array.isArray(keypair)
      ? JSON.parse(fs.readFileSync(keypair).toString())
      : bs58.decode(keypair)
  );

  const loaded = Keypair.fromSecretKey(decodedKey);
  return loaded;
}

async function main() {
  const options = yargs
    .usage("Usage: -keypair <Keypair>")
    .option("keypair", { alias: "keypair", describe: "keypair file path", type: "string", demandOption: true })
    .argv;

  // const options = {
  //   keypair: "./tyC67y6sqLrvgoF5QmWKP31kVxvAvcikZxobb6Cd7zB.json",
  // };

  const keyPair = loadWalletKey(options.keypair);


  // check ./tmp/keypairs.json exists
  let exists = false;
  try {
    exists = fs.existsSync("./tmp/keypairs.json");
  } catch (error) {
    exists = false;
  }

  console.log('reading from disk? ', exists)

  const keypairs = exists
    ? readKeyPairs("./tmp/keypairs.json")
    : (() => {
        const items = generateKeyPairs(20_000);
        saveKeyPairs(items);
        return items;
      })();

  console.log(keypairs.length,  ' <<< this many kps')
  const fundingAmount = 100000

  keypairs.forEach((kp) => {
    console.log('attempting fund: ', kp.publicKey.toString())
    fundWallet(fundingAmount, kp, keyPair);
  });
}

const generateKeyPairs = (amount = 20_000) =>
  [...new Array(amount)].map(() => Keypair.generate());

const saveKeyPairs = (keypairs) => {
  const dir = "./tmp";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const file = dir + "/keypairs.json";
  let exists = false;
  try {
    exists = fs.statSync(file).isFile();
  } catch (e) {
    exists = false;
  }
  if (!exists) {
    fs.writeFileSync(file, JSON.stringify(
      keypairs.map(kp => ({
        public_key: kp.publicKey.toString(),
        secret_key: [...kp.secretKey]
      }))
      ));
  }
};

const readKeyPairs = (file) => {
  const readfile = fs.readFileSync(file, "utf-8");

  const json = JSON.parse(readfile);
  console.log('file legnth: ', json.length)
  return json.map((i) => Keypair.fromSecretKey(new Uint8Array(i.secret_key)));
};

async function fundWallet(lamports, toPubkey, fromKeypair) {
  const connection = new anchor.web3.Connection(
    "https://solana-api.projectserum.com"
  );
  const transaction = new Transaction();
  const latest = await connection.getRecentBlockhash()
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = fromKeypair.publicKey;

  const signer = fromKeypair;
  const wallet = new anchor.Wallet(signer);
  const provider = new anchor.AnchorProvider(connection, wallet, {});

  console.log(toPubkey.publicKey.toString(), "<<< DEST")

  const balance = await connection.getBalance(toPubkey.publicKey)
  if (balance > 0) {
    console.log(toPubkey.publicKey.toString(), " already funded")
    return;
  }

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPubkey.publicKey,
      lamports,
    })
  );
  const result = await provider.sendAndConfirm(transaction);
  console.log(result);
}

main();