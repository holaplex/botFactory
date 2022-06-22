import {
  Keypair,
  Transaction,
  SystemProgram,
  PublicKey,
} from '@solana/web3.js';
import _ from 'lodash';
import pLimit from 'p-limit';

import * as anchor from '@project-serum/anchor';
import yargs from 'yargs';
import bs58 from 'bs58';
import fs from 'fs';

const connection = new anchor.web3.Connection(
  'https://autumn-falling-bush.solana-devnet.quiknode.pro/d780e0b6a44a10fbe4982403eb88b4e58cfaa78a/',
);

const loadWalletKey = (keypair: string) => {
  if (!keypair?.length) {
    throw new Error('Keypair is required!');
  }

  const decodedKey = new Uint8Array(
    keypair.endsWith('.json') && !Array.isArray(keypair)
      ? JSON.parse(fs.readFileSync(keypair).toString())
      : bs58.decode(keypair),
  );

  const loaded = Keypair.fromSecretKey(decodedKey);
  return loaded;
};

const generateKeyPairs = (amount = 20_000) =>
  [...new Array(amount)].map(() => Keypair.generate());

const saveKeyPairs = (keypairs: Keypair[]) => {
  const dir = './tmp';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const file = dir + '/keypairs.json';
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
        })),
      ),
    );
  }
};

const readKeyPairs = (file: string) => {
  const readfile = fs.readFileSync(file, 'utf-8');

  const json = JSON.parse(readfile) as [
    {
      public_key: string;
      secret_key: number[];
    },
  ];
  console.log('file legnth: ', json.length);
  return json.map((i: { secret_key: number[] }) =>
    Keypair.fromSecretKey(new Uint8Array(i.secret_key)),
  );
};

const createFundWalletIx = async (
  lamports: number,
  toPubkey: { publicKey: PublicKey },
  fromKeypair: Keypair,
) => {
  console.log(toPubkey.publicKey.toString(), '<<< DEST');

  const balance = await connection.getBalance(toPubkey.publicKey);
  if (balance > 0) {
    console.log(toPubkey.publicKey.toString(), ' already funded');
    return null;
  }

  const ix = SystemProgram.transfer({
    fromPubkey: fromKeypair.publicKey,
    toPubkey: toPubkey.publicKey,
    lamports,
  });

  return ix;
};

const main = async () => {
  const limit = pLimit(10);
  const options = yargs(process.argv)
    .usage('Usage: --keypair <Keypair>')
    .option('keypair', {
      alias: 'keypair',
      describe: 'keypair file path',
      type: 'string',
      demandOption: true,
    }).argv as any;

  const keyPair = loadWalletKey(options.keypair);

  let exists = false;
  try {
    exists = fs.existsSync('./tmp/keypairs.json');
  } catch (error) {
    exists = false;
  }

  console.log('reading from disk? ', exists);

  const keypairs = exists
    ? readKeyPairs('./tmp/keypairs.json')
    : (() => {
        const items = generateKeyPairs(20_000);
        saveKeyPairs(items);
        return items;
      })();

  console.log(keypairs.length, ' <<< this many kps');
  const fundingAmount = 100000;

  const ixs = keypairs.map((kp) =>
    createFundWalletIx(fundingAmount, kp, keyPair),
  );

  const ixGroups = _.chunk(
    await Promise.all(
      ixs.filter((i) => !!i) as Promise<anchor.web3.TransactionInstruction>[],
    ),
    5,
  );

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
    }),
  );

  const results = await Promise.allSettled(txs);

  // Check results that are fine
  const goodResults = results.filter((r) => r.status === 'fulfilled');
  console.log(goodResults.length, ' good results');
  goodResults.forEach((r) => {
    console.log((r as any)?.value ?? '???');
  });
  // Check results that are not fine
  const badResults = results.filter((r) => r.status === 'rejected');
  console.log(badResults.length, ' bad results');
  badResults.forEach((r) => {
    console.log((r as any).reason);
  });
};

main();
