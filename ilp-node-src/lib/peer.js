const IDENTITY_CURVE = 'AAAAAAAAAAAAAAAAAAAAAP////////////////////8=' //  Buffer.from( Array(32+1).join('0') + Array(32+1).join('F'), 'hex').toString('base64')
                                                                      // [ [ '0', '0' ], [ '18446744073709551615', '18446744073709551615' ] ]
const MIN_MESSAGE_WINDOW = 10000

const Oer = require('oer-utils')
const uuid = require('uuid/v4')
const crypto = require('crypto');
const sha256 = (secret) => {
  return crypto
      .createHmac('sha256', secret)
      .digest('base64')
}

function Peer(uri, tokenStore, hopper, peerPublicKey, fetch, actAsConnector) {
  this.testRouteAnnounced = false
  // console.log('Peer', uri, tokenStore, hopper, peerPublicKey)
  const uriParts = uri.split('://')[1].split('/')
  const hostParts = uriParts.shift().split(':')
  this.path = '/' + uriParts.join('/')
  this.peerHost = hostParts[0]
  this.testLedger = 'g.dns.' + this.peerHost.split('.').reverse().join('.')
  if (hostParts.length > 1) {
    this.port = hostParts[1]
  }
  this.actAsConnector = actAsConnector
  this.rate = 1.0 // for now, all peers are in USD
  this.fetch = fetch
  this.quoteId = 0
  this.peerPublicKey = peerPublicKey
  // console.log('getting token', peerPublicKey)
  this.ledger = 'peer.' + tokenStore.getToken('token', peerPublicKey).substring(0, 5) + '.usd.9.';
  this.authToken = tokenStore.getToken('authorization', peerPublicKey)
  this.myPublicKey = tokenStore.peeringKeyPair.pub
  this.routes = {}
  this.hopper = hopper
  // console.log('hopper set, constructor done!')
}

Peer.prototype.newQuoteId = function () {
  var newQuoteId = new Date().getTime();
  while (newQuoteId < this.quoteId) {
    newQuoteId++;
  }
  this.quoteId = newQuoteId;
  return this.quoteId;
}

Peer.prototype.postToPeer = async function(method, postData, topLevel = false) {
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
      // console.log('fetch request resulted in', res)
      res.setEncoding('utf8')
      var str = ''
      res.on('data', (chunk) => {
        str += chunk
      })
      res.on('end', () => {
        // console.log('rpc response!', postData, str)
        resolve(str)
      })
    })
    req.on('error', reject)
    let obj = postData
    if (!topLevel) {
      obj = {
        ledger: this.ledger,
        // work around https://github.com/interledgerjs/ilp-plugin-virtual/issues/74
        from: this.ledger + this.myPublicKey,
        to: this.ledger + this.peerPublicKey,
        custom: postData
      }
    }
    req.write(JSON.stringify([ obj ], null, 2))
    req.end()
  })
}

Peer.prototype.requestQuote = function(destinationLedger) {
  return this.postToPeer('send_message', {
    method: 'quote_request',
    id: this.newQuoteId(),
    data: {
      source_amount: '10025',
      source_address: this.ledger + 'alice',
      destination_address: destinationLedger + 'bobby.tables',
      source_expiry_duration: '6000',
      destination_expiry_duration: '5'
    }
  })
}

function applyCurve(curve, ret) {
  let given, wanted, givenAmount
  if (typeof ret[0] === undefined ) {
    wanted = 0
    given = 1
    givenAmount = ret[1]
  } else {
    wanted = 0
    given = 1
    givenAmount = ret[0]
  }
  // linear search:
  for (let i=1; i < curve.length; i++) {
    if (curve[i][given] == givenAmount) {
      ret[wanted] = curve[i][wanted]
      return ret 
    } else if (curve[i][given] > givenAmount) {
      let fraction = (givenAmount - curve[i-1][given]) / (curve[i][given] - curve[i-1][given])
      ret[wanted] = curve[i-1][wanted] + fraction * (curve[i][wanted] - curve[i-1][wanted])
      return ret
    }
  }
}

Peer.prototype.respondQuote = function(curve, quote) {
  [ quote.sourceAmount, quote.destinationAmount ]  = applyCurve(curve, [ quote.sourceAmount, quote.destinationAmount ])
  quote.liquidity_curve = curve
  return this.postToPeer('send_request', {
    method: 'quote_response',
    id: quote.id,
    data: quote
  })
}

Peer.prototype.prepareTestPayment = async function() {
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
  return this.pay('2', sha256('something secret'), new Date().getTime() + 10000,  ilpPacket)
}

Peer.prototype.pay = async function(amountStr, condition, timeout, packet) {
  return this.postToPeer('send_transfer', {
    ilp: packet,
    id: uuid(),
    amount: amountStr,
    ilp: packet,
    executionCondition: condition,
    expiresAt: new Date(new Date().getTime() + timeout),
  }, true)
}

Peer.prototype.getLimit = function() {
  return this.postToPeer('get_limit').then(limit => {
    // console.log('GOT LIMIT!', limit, this.peerHost)
    return limit
  })
}

Peer.prototype.getBalance = function() {
  return this.postToPeer('get_balance').then(balance => {
    // console.log('GOT BALANCE!', balance, this.peerHost)
    return balance
  })
}

Peer.prototype.announceRoute = async function(ledger, curve) {
  // console.log('ANNOUNCING ROUTE!', this.peerHost, this.ledger, ledger, curve)
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
  // console.log('route announced, nice!')
}

Peer.prototype.announceTestRoute = async function() {
  if (this.testRouteAnnounced) {
    return
  }
  this.testRouteAnnounced = true
  console.log('I am', this.hopper.ilpNodeObj.hostname, 'test route announcing now to ', this.peerHost)
  return this.announceRoute(this.testLedger, IDENTITY_CURVE)
}

Peer.prototype.handleRpc = async function(params, bodyObj) {
  // console.log('incoming rpc', this.peerHost, params, bodyObj)
  switch(params.method) {
  case 'get_limit':
  case 'get_balance':
    return '0';
    break;
  case 'send_transfer':
    const response = this.hopper.forward(bodyObj[0])
    // in a future version of the protocol, this response may be put directly in the http response; for now, it's not:
    this.postToPeer(response.method, response)
    break;
  case 'send_request':
  case 'send_message':
    // console.log('GOT MESSAGE!!', params, bodyObj);
    // reverse engineered from https://github.com/interledgerjs/ilp-plugin-virtual/blob/v15.0.1/src/lib/plugin.js#L152:
    if (Array.isArray(bodyObj) && bodyObj[0].data) {
      bodyObj[0].custom = bodyObj[0].data
    }
    if (Array.isArray(bodyObj) && bodyObj[0].custom) {
      switch(bodyObj[0].custom.method) {
      case 'broadcast_routes':
        console.log('It is routes IN!', params, bodyObj)
        bodyObj[0].custom.data.new_routes.map(route => {
          console.log('adding the route; I am', this.hopper.ilpNodeObj.hostname, this.actAsConnector, 'the announcing peer is ', this.peerHost, 'the route is for', route.destination_ledger)
          this.hopper.table.addRoute(this.peerHost, route, this.actAsConnector)
          if (route.destination_ledger = this.testLedger) {
            console.log('loop found!')
            this.prepareTestPayment()
          } 
        })
        // console.log('new routes map', Object.keys(this.hopper.table))
        if (!this.actAsConnector) { // We are connectorland, send a test route:
          console.log(this.hopper.ilpNodeObj.hostname, 'not acting as a connector, so announcing a test route to ', this.peerHost)
          await this.announceTestRoute()
        }
        break
      case 'quote_request':
        const curve = this.hopper.makeCurve(this.peerHost, bodyObj[0].custom.data.destination_ledger)
        if (curve === undefined) {
          // todo: implement remote quoting
        } else {
          this.respondQuote(curve, bodyObj[0].custom.data)
        }
        break
      case 'quote_response':
        // todo: calculate gratuity compared to route
        break;
      default:
        console.error('Unknown message method', bodyObj[0].custom.method)
      }
    }
    return JSON.stringify({
      ledger: this.ledger,
      from: this.ledger + this.myPublicKey,
      to: this.ledger + this.peerPublicKey,
      custom: {}
    }, null, 2)
    break;
  default:
    return 'Unknown method';
  }
}

module.exports.Peer = Peer
