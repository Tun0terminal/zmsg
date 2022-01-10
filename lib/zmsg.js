#!/usr/bin/env node
const {randomBytes} = require('bcrypto/lib/random');
const aes = require('bcrypto/lib/aes');
const secp256k1 = require('bcrypto/lib/secp256k1');
const sha256 = require('bcrypto/lib/sha256');
const base58 = require('bcrypto/lib/encoding/base58');
const {Address} = require('hsd/lib/primitives');
const {WalletClient, NodeClient} = require('hs-client');
const {Network} = require('hsd');
const fs = require('fs');
const network = Network.get('main');
const readline = require('readline');
const writable = require('stream').Writable;

var mutable = new writable({
  write: function(chunk, encoding, callback) {
    if (!this.muted)
      process.stdout.write(chunk, encoding);
    callback();
  }
});
const rl = readline.createInterface({
  input: process.stdin,
  output: mutable,
  terminal: true
});
mutable.muted = false;


const nodeOptions = {
  network: network.type,
  port: network.rpcPort,
  apiKey: fs.readFileSync("keys/node").toString().trim()
}
const walletOptions = {
  port: network.walletPort,
  apiKey: fs.readFileSync("keys/wallet").toString().trim()
}
const nodeClient = new NodeClient(nodeOptions);
const _walletClient = new WalletClient(walletOptions);
let walletClient;

(async function() {
  const argv=process.argv;
  const argc=argv.length;

  if(argc!=6 && argc!=7) {
    console.log("Encrypt Usage: ",argv[1],"<wallet>","<from>","<to>","\"<msg>\"");
    console.log("");
    console.log("Decrypt Usage: ",argv[1],"<wallet>","<from>","<to>","\"<encrypted-msg>\"","\"<IV>\"");
    process.exit();
  }
  walletClient = _walletClient.wallet(argv[2]);
  if(!walletClient) {
    console.log("Wallet ",argv[2],"not found");
    process.exit(0);
  }

  console.log("Enter Password:");
  const it = rl[Symbol.asyncIterator]();
  mutable.muted = true;
  const password = (await it.next()).value
  mutable.muted = false;

  if(argc==7) {
    const keys = await getKeys(argv[4],password);
    let targetPubkey = await getPubkeyFromName(argv[3]);
    let secret=getSecret(targetPubkey,keys.privateKey).toString('hex');
    let decrypted=decrypt(argv[5],secret,argv[6]);
    console.log("Decrypted: ",decrypted.toString());
    process.exit(0);
  }
  else if(argc==6) {
    const keys = await getKeys(argv[3],password);
    let targetPubkey = await getPubkeyFromName(argv[4]);
    let secret=getSecret(targetPubkey,keys.privateKey).toString('hex');
    let encrypted=encrypt(argv[5],secret);
    console.log("Encrypted: ",encrypted.cyphertext);
    console.log("IV: ",encrypted.iv);
    process.exit(0);
  }
})()

function decrypt(msg,key,iv) { return aes.decipher(Buffer.from(msg,'hex'),Buffer.from(key,'hex'),Buffer.from(iv,'hex')) }
function encrypt(msg,key) {
  let iv = randomBytes(16);
  return {cyphertext:aes.encipher(Buffer.from(msg),Buffer.from(key,'hex'),iv).toString('hex'), iv:iv.toString('hex')};
}

function getSecret(pub,priv) { return ecdh(Buffer.from(pub,'hex'),Buffer.from(priv,'hex')) }

async function getKeys(name,passphrase) {
  let me, privWIF, privkey58, privkey, _tmp;
  me = await getAddressFromName(name);
  privWIF = (await walletClient.getWIF(me, passphrase)).privateKey;
  privkey58 = base58.decode(privWIF).slice(1);
  _tmp = new Buffer.alloc(privkey58.length - 5);
  privkey58.copy(_tmp, 0, 0, privkey58.length - 5);
  privkey58=_tmp;
  privkey = privkey58.toString('hex');
  pubkey = await getPubkeyFromName(name);

  return {address:me, privateWIF:privWIF,publicKey:pubkey,privateKey:privkey};
}
async function getPubkeyFromName(name) { return await getPubkeyFromAddress(await getAddressFromName(name)) }
async function getPubkeyFromAddress(address) {
  let key=null;
  let result = await nodeClient.getTXByAddress(address);
  for(let x=0;x<result.length;x++) {
    let res = result[x].inputs;
    for(let y=0;y<res.length;y++) {
      let input = res[y];
      if(input.coin.address===address) key=input.witness[1];
    }
  }
  return key;
}
async function getAddressFromName(name) {
  let result = await nodeClient.execute('getnameinfo', [name]);
  if(!result || !result.info || !result.info.owner || !result.info.owner.hash) return null;
  result = await nodeClient.getCoin(result.info.owner.hash, result.info.owner.index);
  if(!result || !result.address) return null;
  return result.address;
} 
function ecdh(publicKey, privateKey) {
  const secret = secp256k1.derive(publicKey, privateKey, true);
  return sha256.digest(secret);
}