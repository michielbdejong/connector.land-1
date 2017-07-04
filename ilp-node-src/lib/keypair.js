const crypto = require('crypto')
const tweetnacl = require('tweetnacl')

// include hardcoded base64url dependency;
function fromBase64(base64) {
  return base64
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function base64url(input) {
  if (Buffer.isBuffer(input)) {
      return fromBase64(input.toString("base64"));
  }
  return fromBase64(new Buffer(input, 'utf-8').toString("base64"));
}
function padString(input) {
    var segmentLength = 4;
    var stringLength = input.length;
    var diff = stringLength % segmentLength;
    if (!diff) {
        return input;
    }
    var position = stringLength;
    var padLength = segmentLength - diff;
    var paddedStringLength = stringLength + padLength;
    var buffer = new Buffer(paddedStringLength);
    buffer.write(input);
    while (padLength--) {
        buffer.write("=", position++);
    }
    return buffer.toString();
}
function toBase64(base64url) {
    base64url = base64url.toString();
    return padString(base64url)
        .replace(/\-/g, "+")
        .replace(/_/g, "/");
}
function toBuffer(base64url) {
    return new Buffer(toBase64(base64url), "base64");
}
// end base64url

function generateKeyPair() {
  console.log('generating keypair')
  const keypair = {
    priv: crypto.createHmac('sha256', base64url(crypto.randomBytes(33))).update('CONNECTOR_ED25519').digest('base64')
  }
  keypair.pub = base64url(tweetnacl.scalarMult.base(
    crypto.createHash('sha256').update(toBuffer(keypair.priv)).digest()
  ))
  console.log('generated', keypair)
  return keypair
}

module.exports.generate = generateKeyPair

TokenStore = function (peeringKeyPair) {
  this.peeringKeyPair = peeringKeyPair

  this.tokens = {
    token: {},
    authorization: {},
  }
}

TokenStore.prototype.getToken = function (input, peerPublicKey) {
  return this.tokens[input][peerPublicKey] || (this.tokens[input][peerPublicKey] = base64url(crypto.createHmac('sha256', tweetnacl.scalarMult(
    crypto.createHash('sha256').update(toBuffer(this.peeringKeyPair.priv)).digest(),
    toBuffer(peerPublicKey)
  )).update(input, 'ascii').digest()))
}

module.exports.TokenStore = TokenStore
