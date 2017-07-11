const IDENTITY_CURVE = 'AAAAAAAAAAAAAAAAAAAAAP////////////////////8=' //  Buffer.from( Array(32+1).join('0') + Array(32+1).join('F'), 'hex').toString('base64')
                                                                      // [ [ '0', '0' ], [ '18446744073709551615', '18446744073709551615' ] ]
const MIN_MESSAGE_WINDOW = 10000

const Oer = require('oer-utils')
const uuid = require('uuid/v4')
const crypto = require('crypto')
const sha256 = (secret) => { return crypto.createHmac('sha256', secret).digest('base64') }

function Peer(uri, tokenStore, hopper, peerPublicKey, fetch, actAsConnector, testLedgerBase) {
  this.uri = uri
  this.peerHost = uri.split('://')[1].split('/')[0].split(':').reverse().join('.') // e.g. 8000.localhost or asdf1.com
  this.actAsConnector = actAsConnector
  this.fetch = fetch
  this.peerPublicKey = peerPublicKey
  this.ledger = 'peer.' + tokenStore.getToken('token', peerPublicKey).substring(0, 5) + '.usd.9.';
  this.authToken = tokenStore.getToken('authorization', peerPublicKey)
  this.myPublicKey = tokenStore.peeringKeyPair.pub
  this.hopper = hopper
  this.testLedger = testLedgerBase + 'test-to-peer.' + this.peerPublicKey + '.'
  this.testRouteAnnounced = false
}

Peer.prototype = {
  postToPeer: async function(method, postData) {
    return this.fetch(this.uri+ `?method=${method}&prefix=${this.ledger}`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.authToken
      }, body: JSON.stringify(postData, null, 2)
    }).then(res => res.json())
  },
    /////////////////////
   // OUTGOING ROUTES //
  /////////////////////
  announceRoute: async function(ledger, curve) {
      if (typeof this !== 'object') {
        console.error('ledger panic 2')
      }
    await this.postToPeer('send_request', [ {
      ledger: this.ledger, from: this.ledger + this.myPublicKey, to: this.ledger + this.peerPublicKey, custom: {
        method: 'broadcast_routes', data: { new_routes: [ {
            source_ledger: this.ledger,
            destination_ledger: ledger,
            points: curve,
            min_message_window: 1,
            paths: [ [] ],
            source_account: this.ledger + this.myPublicKey
          } ], hold_down_time: 45000, unreachable_through_me: []
        }
      }
    } ])
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
          console.log('received routes!', this.peerHost, bodyObj[0].custom.data.new_routes)
          bodyObj[0].custom.data.new_routes.map(route => {
            this.hopper.table.addRoute(this.peerHost, route, this.actAsConnector)
            if (route.destination_ledger = this.testLedger && !this.actAsConnector) {
              this.prepareTestPayment()
            } 
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
