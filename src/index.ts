import { Keypair, Transaction, SystemProgram, PublicKey } from "@solana/web3.js";
import _ from "lodash";
import pLimit from "p-limit";

import * as anchor from "@project-serum/anchor";
import yargs from "yargs";
import bs58 from "bs58";
import fs from "fs";
const DIR = "./wallets";

const connection = new anchor.web3.Connection("https://solana-mainnet.g.alchemy.com/v2/G3UIfMpRUh_DP7nA-qTR5g5YfmURypQ-");

function convertToNumber(input: string | number) {
  return typeof input === "string" ? parseInt(input) : input;
}

const loadWalletKey = (keypair: string) => {
  if (!keypair?.length) {
    throw new Error("Keypair is required!");
  }

  const decodedKey = new Uint8Array(
    keypair.endsWith(".json") && !Array.isArray(keypair) ? JSON.parse(fs.readFileSync(keypair).toString()) : bs58.decode(keypair)
  );

  const loaded = Keypair.fromSecretKey(decodedKey);
  return loaded;
};

const generateKeyPairs = (amount = 1) => [...new Array(amount)].map(() => Keypair.generate());

const saveKeyPairs = (keypairs: Keypair[], destination: string) => {
  if (!fs.existsSync(DIR)) {
    fs.mkdirSync(DIR);
  }
  const file = destination;
  let exists = false;
  try {
    exists = fs.statSync(file).isFile();
  } catch (e) {
    exists = false;
  }
  if (!exists) {
    fs.writeFileSync(
      file,
      JSON.stringify(
        keypairs.map((kp) => ({
          public_key: kp.publicKey.toString(),
          secret_key: [...kp.secretKey],
        }))
      )
    );
  }
};

const readKeyPairs = (file: string) => {
  const readfile = fs.readFileSync(file, "utf-8");

  const json = JSON.parse(readfile) as [
    {
      public_key: string;
      secret_key: number[];
    }
  ];
  console.log("file legnth: ", json.length);
  return json.map((i: { secret_key: number[] }) => Keypair.fromSecretKey(new Uint8Array(i.secret_key)));
};

const createFundWalletIx = async (lamports: number, toPubkey: { publicKey: PublicKey }, fromKeypair: Keypair) => {
  try {
    const balance = await connection.getBalance(toPubkey.publicKey);
    const fundingAmount: number = lamports - balance;
    if (fundingAmount <= 0) {
      console.log(toPubkey.publicKey.toString(), " already funded to ", balance);
      return null;
    }
    console.log("Funding ", toPubkey.publicKey.toString(), " with ", fundingAmount);
    const ix = SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPubkey.publicKey,
      lamports: fundingAmount,
    });

    return ix;
  } catch (e) {
    console.log("Error getting balance for", toPubkey.publicKey.toString(), e);
  }
};

const main = async () => {
  const options = yargs(process.argv)
    .usage("Usage: --keypair <Keypair>")
    .option("keypair", {
      alias: "keypair",
      describe: "keypair file path, ex file contents [1, 3, 5, 12 ...]",
      type: "string",
      demandOption: true,
    })
    .option("dest", {
      alias: "destWallet",
      describe: "dest wallet file to save or load in /tmp, defaults to keypairs.json",
      type: "string",
      demandOption: false,
    })
    .option("amount", {
      alias: "amount",
      describe: "amount to fund each wallet, rent exemption of 896_799 lamports will be added to this amount",
      type: "number",
      default: 1_000_000,
      demandOption: false,
    })
    .option("num", {
      alias: "num",
      describe: "number of wallets to make for new file",
      type: "number",
      default: 10_000,
      demandOption: false,
    }).argv as any;

  const limit = pLimit(10);
  console.log("wallet destination file:", options.dest);
  const destination = `./${DIR}/${options.dest}`;
  const keyPair = loadWalletKey(options.keypair);
  const fundingAmount = convertToNumber(options.amount) + 896_799;
  let exists = false;
  try {
    exists = fs.existsSync(destination);
  } catch (error) {
    exists = false;
  }
  const balance = await connection.getBalance(keyPair.publicKey);
  console.log(`funding wallet balance: ${balance}`);
  console.log("reading from disk? ", exists);
  console.log(`funding all wallets to ${fundingAmount}`);
  const keypairs = exists
    ? readKeyPairs(destination)
    : (() => {
        const items = generateKeyPairs(options.num);
        saveKeyPairs(items, destination);
        return items;
      })();

  console.log(keypairs.length, " <<< this many kps");

  const ixs = keypairs.map((kp) => createFundWalletIx(fundingAmount, kp, keyPair));

  const ixGroups = _.chunk(await Promise.all(ixs.filter((i) => !!i) as Promise<anchor.web3.TransactionInstruction>[]), 5);

  const txs = ixGroups.map((ixGroup) =>
    limit(async () => {
      const transaction = new Transaction();
      const latest = await connection.getRecentBlockhash();
      transaction.recentBlockhash = latest.blockhash;
      transaction.feePayer = keyPair.publicKey;

      const signer = keyPair;
      const wallet = new anchor.Wallet(signer);
      const provider = new anchor.AnchorProvider(connection, wallet, {});

      transaction.add(...ixGroup);

      const result = await provider.sendAndConfirm(transaction);
      return result;
    })
  );

  const results = await Promise.allSettled(txs);

  // Check results that are fine
  const goodResults = results.filter((r) => r.status === "fulfilled");
  console.log(goodResults.length, " good results");
  goodResults.forEach((r) => {
    console.log((r as any)?.value ?? "???");
  });
  // Check results that are not fine
  const badResults = results.filter((r) => r.status === "rejected");
  console.log(badResults.length, " bad results");
  badResults.forEach((r) => {
    console.log((r as any).reason);
  });
};

main().then().catch();
