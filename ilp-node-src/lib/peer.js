const IDENTITY_CURVE = 'AAAAAAAAAAAAAAAAAAAAAP////////////////////8=' //  Buffer.from( Array(32+1).join('0') + Array(32+1).join('F'), 'hex').toString('base64')
                                                                      // [ [ '0', '0' ], [ '18446744073709551615', '18446744073709551615' ] ]
const MIN_MESSAGE_WINDOW = 10000

const Oer = require('oer-utils')
const uuid = require('uuid/v4')
const crypto = require('crypto')
const sha256 = (secret) => { return crypto.createHmac('sha256', secret).digest('base64') }

function Peer(uri, tokenStore, hopper, peerPublicKey, fetch, actAsConnector) {
  const uriParts = uri.split('://')[1].split('/')
  const hostParts = uriParts.shift().split(':')
  this.path = '/' + uriParts.join('/')
  this.peerHost = hostParts[0]
  if (hostParts.length > 1) {
    this.port = hostParts[1]
  }
  this.actAsConnector = actAsConnector
  this.rate = 1.0 // for now, all peers are in USD
  this.fetch = fetch
  this.quoteId = 0
  this.peerPublicKey = peerPublicKey
  this.ledger = 'peer.' + tokenStore.getToken('token', peerPublicKey).substring(0, 5) + '.usd.9.';
  this.authToken = tokenStore.getToken('authorization', peerPublicKey)
  this.myPublicKey = tokenStore.peeringKeyPair.pub
  this.routes = {}
  this.hopper = hopper
  this.testLedger = 'g.dns.' + this.hopper.ilpNodeObj.hostname.split('.').reverse().join('.') + '.'
  this.testRouteAnnounced = false
}

Peer.prototype = {
    //////////////
   // OUTGOING //
  //////////////
  postToPeer: async function(method, postData, topLevel = false) {
    // if topLevel is false, the postData is embedded in a 'custom' field of a bigger
    // object, otherwise it's not.
    const options = {
      host: this.peerHost,
      port: this.port,
      path: this.path + `?method=${method}&prefix=${this.ledger}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.authToken
      }
    }
    return await new Promise((resolve, reject) => {
      const req = this.fetch.request(options, (res) => {
        res.setEncoding('utf8')
        var str = ''
        res.on('data', (chunk) => { str += chunk })
        res.on('end', () => { resolve(str) })
      })
      req.on('error', reject)
      let arr = postData
      if (typeof this !== 'object') {
        console.error('ledger panic 1')
      }
      if (!topLevel) {
        arr = [ {
          ledger: this.ledger,
          // work around https://github.com/interledgerjs/ilp-plugin-virtual/issues/74
          from: this.ledger + this.myPublicKey,
          to: this.ledger + this.peerPublicKey,
          custom: postData
        } ]
      }
      req.write(JSON.stringify(arr, null, 2))
      req.end()
    })
  },
    /////////////////////
   // OUTGOING ROUTES //
  /////////////////////
  announceRoute: async function(ledger, curve) {
      if (typeof this !== 'object') {
        console.error('ledger panic 2')
      }
    await this.postToPeer('send_request', {
      method: 'broadcast_routes',
      data: {
        new_routes: [ {
          source_ledger: this.ledger,
          destination_ledger: ledger,
          points: curve,
          min_message_window: 1,
          paths: [ [] ],
          source_account: this.ledger + this.myPublicKey
        } ],
        hold_down_time: 45000,
        unreachable_through_me: []
      }
    })
  },
  announceTestRoute: async function() {
    if (this.testRouteAnnounced) { return }
    this.testRouteAnnounced = true
    return this.announceRoute(this.testLedger, IDENTITY_CURVE)
  },
    /////////////////////////
   // OUTGOING TRANSFERS //
  ////////////////////////
  sendTransfer: async function(amountStr, condition, expiresAtMs, packet, outgoingUuid) {
    return this.postToPeer('send_transfer', [ {
      id: outgoingUuid,
      amount: amountStr,
      ilp: packet,
      executionCondition: condition,
      expiresAt: new Date(expiresAtMs),
    } ], true)
  },
  prepareTestPayment: async function() {
    const writer1 = new Oer.Writer()
    writer1.writeUInt32(0)
    writer1.writeUInt32(1)
    writer1.writeVarOctetString(Buffer.from(this.testLedger + 'test', 'ascii'))
    writer1.writeVarOctetString(Buffer.from('', 'base64'))
    writer1.writeUInt8(0)
    const writer2 = new Oer.Writer()
    writer2.writeUInt8(1) // TYPE_ILP_PAYMENT
    writer2.writeVarOctetString(writer1.getBuffer())
    const ilpPacket = writer2.getBuffer().toString('base64')
    const testPaymentId = uuid()
    const testPaymentPreimage = crypto.randomBytes(32).toString('base64')
    const testPaymentCondition = sha256(testPaymentPreimage)
    this.hopper.paymentsInitiatedById[testPaymentId] = testPaymentPreimage
    this.hopper.paymentsInitiatedByCondition[testPaymentCondition] = testPaymentPreimage
    return this.sendTransfer('2', testPaymentCondition, new Date().getTime() + 10000,  ilpPacket, testPaymentId)
  },  
  getLimit() { return this.postToPeer('get_limit') },
  getBalance() { return this.postToPeer('get_balance') },
    //////////////
   // INCOMING //
  //////////////
  handleRpc: async function(params, bodyObj) {
    switch(params.method) {
    case 'send_request':
      if (Array.isArray(bodyObj) && bodyObj[0].data) {
        bodyObj[0].custom = bodyObj[0].data
      }
      if (Array.isArray(bodyObj) && bodyObj[0].custom) {
        switch(bodyObj[0].custom.method) {
        case 'broadcast_routes':
          bodyObj[0].custom.data.new_routes.map(route => {
            this.hopper.table.addRoute(this.peerHost, route, this.actAsConnector)
            // if (route.destination_ledger = this.testLedger && !this.actAsConnector) {
            //   this.prepareTestPayment()
            // } 
          })
          break
        default:
          console.error('Unknown ledger-level request method', bodyObj[0].custom.method)
        }
      }
      if (typeof this !== 'object') {
        console.error('ledger panic 3')
      }
      return JSON.stringify({
        ledger: this.ledger,
        from: this.ledger + this.myPublicKey,
        to: this.ledger + this.peerPublicKey,
        custom: {}
      }, null, 2)
      break;
    case 'send_transfer':
      this.hopper.handleTransfer(bodyObj[0], this.peerHost).then(result => { this.postToPeer(result.method, result.body, true) })
      return true
      break;
    case 'fulfill_condition':
    case 'reject_incoming_transfer':
      this.hopper.handleTransferResult(params.method, bodyObj)
      break;
    case 'get_limit':
    case 'get_balance':
      return '0';
      break;
    default:
      return 'Unknown rpc-level request method';
    }
  }
}

module.exports.Peer = Peer
