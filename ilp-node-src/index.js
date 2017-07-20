const keypair = require('./lib/keypair')
const getHostInfo = require('./lib/hostInfo')
const handleWebFinger = require('./lib/webfinger')
const Peer = require('./lib/peer').Peer
const Hopper = require('./lib/hopper').Hopper
const crypto = require('crypto')
const realFetch = require('node-fetch')

function rollingAvg(existing, measured, factor) {
  if (typeof existing === 'undefined') {
    console.log('rollingAvg', { existing, measured, factor })
    return measured
  }
  const ret = (existing * (factor - 1) + measured) / factor
  console.log('rollingAvg', { existing, measured, factor, ret })
  return ret
}

function hash(hostname) {
  if (typeof hostname !== 'string') {
    throw new Error('cannot hash!', JSON.stringify(hostname))
  }
  return crypto
      .createHash('sha256')
      .update(hostname)
      .digest('hex')
}

function IlpNode (kv, hostname, simulator, actAsConnector = false, networkPrefix = 'g.') {
  console.log('IlpNode constructor', hostname, actAsConnector)
  this.kv = kv
  this.actAsConnector = actAsConnector
  this.networkPrefix = networkPrefix
  if (simulator) {
    this.fetch = simulator
  } else {
    this.fetch = realFetch
  }
  this.hostname = hostname
  this.testLedgerBase = 'g.dns.' + this.hostname.split(/[:\.]/).reverse().join('.') + '.'
  this.previousStats = {
    hosts: {},
    ledgers: {},
    routes: {}
  }
  this.stats = {
    hosts: {},
    ledgers: {},
    routes: {}
  }
  this.peers = {}
  // console.log('instantiating hopper!')
  this.hopper = new Hopper(this)
  this.creds = {
    hosts: {},  // map hostname hashes back to hostname preimages
    ledgers: {} // for remembering RPC endpoints for peer ledgers
                // for stats on destination ledgers, see this.stats.ledgers (for stats export), copied from this.peers[peerHost].routes (for use by hopper)
  }
  this.ready = false
  this.lastLedgerStatsCollectionTime = 0
}

IlpNode.prototype = {
  ensureReady: async function() {
    if (this.ready === false) {
      // console.log('triggering init')
      this.ready = await this.init()
      // console.log('init completed by us')
      this.ready = true
    }
    if (this.ready !== true) {
      // console.log('init already triggered')
      await this.ready
      // console.log('init completed by other')
    }
  },
  
  collectLedgerStats: async function(minDelay) {
//    if (this.lastLedgerStatsCollectionTime > new Date().getTime() - minDelay) {
// 
//      return
//    }
    this.stats.ledgers = this.hopper.table.collectLedgerStats((peerHost) => { return this.stats.hosts[hash(peerHost)].title })
    console.log('ledger stats collected!', this.stats.ledgers, Object.keys(this.hopper.table.subTables))
    this.lastLedgerStatsCollectionTime = new Date().getTime()
    await this.save('stats')
  },
  load: function(key) {
    return new Promise((resolve, reject) => {
      this.kv.get(key, (err, reply) => {
        if (err) {
          reject(err)
        } else {
          resolve(reply)
        }
      })
    }).then(reply => {
      if (reply !== null) {
        // console.log('reply!', reply)
        this[key] = JSON.parse(reply)
      }
    })
  },
  save: function(key) {
    return new Promise((resolve, reject) => {
      this.kv.set(key, JSON.stringify(this[key]), (err, reply) => {
        if (err) {
          reject(err)
        } else {
          resolve(reply)
        }
      })
    })
  },
  init: async function() {
    await this.load('stats')
    await this.load('creds')
    if (this.creds.keypair === undefined) {
      // console.log('generating keypair')
      this.creds.keypair = keypair.generate()
      // console.log(this.creds.keypair)
      await this.save('creds')
      // console.log('saved')
    }
    this.tokenStore = new keypair.TokenStore(this.creds.keypair)
  },
  testAll: async function() {
    console.log('testAll!!!!testAll!!!!testAll!!!!testAll!!!!', this.stats)
    const promises = []
    await this.ensureReady()
    this.previousStats = this.stats || { hosts: {}, ledger: {}, routes: {} } // for use in running averages
    this.stats = {
      hosts: {},
      ledgers: {},
      routes: {}
    }
    // console.log('in testAll!', this.creds)
    for (let hostnameHash of Object.keys(this.creds.hosts)) {
      // peerWithAndTest: async function(peerHostname, rpcPath, ledgerPrefix, token) {
      promises.push(this.peerWithAndTest(this.creds.hosts[hostnameHash].hostname))
      // this fills up the 'hosts' portion of the stats, by calling both testHost and testPeer
      // the 'ledgers' portion is filled up by incoming route broadcasts
      // testPeer then looks at ledgers that are reachable from this peer and tries to send to them
    }
    console.log('testAll peers (this.creds.hosts from kv-store)', this.creds.hosts)
    await Promise.all(promises)
    console.log('saving stats', this.stats)
    await this.save('stats')
    await this.save('creds')
  },
  peerWithAndTest: async function(peerHostname) {
    console.log('peerWithAndTest', peerHostname)
    const creds = this.creds.hosts[hash(peerHostname)]
    console.log(this.hostname, 'peers with', peerHostname, creds)
    await this.ensureReady()
    // console.log(this.creds, this.stats, this.previousStats, '2')
    if (!creds) {
      this.creds.hosts[hash(peerHostname)] = { hostname: peerHostname }
    }
    if (creds && creds.rpcPath && creds.ledgerPrefix && creds.token) {
      // when peering using ilp_secret, the 'to' account doesn't really matter, so setting it to 'server':
      let protocol = 'https'
      if (peerHostname.split(':')[0] === 'localhost') {
        protocol = 'http'
      }
      // this overwrites the existing values, but they were already moved to `this.previousStats`, and then
      // overwritten, at the start of testAll
      this.stats.hosts[hash(peerHostname)] = {
        title: 'ilp-secret-peer-' + hash(peerHostname).substring(0, 7),
        version: 'Unknown'
      }

      this.peers[peerHostname] = new Peer(protocol + '://' + peerHostname + '/' + creds.rpcPath, {
        peeringKeyPair: { pub: 'me' },
        getToken: () => creds.token,
        getLedgerPrefix: () => creds.ledgerPrefix
      }, this.hopper, 'peer', this.fetch, this.actAsConnector, this.testLedgerBase)
      console.log('created peer from peer caps!', peerHostname)
    } else {
      console.log('getting host info!')
      const hostInfo = await getHostInfo(peerHostname, this.previousStats.hosts[peerHostname] || {}, this.fetch)
      console.log('got host info!', hostInfo)
      this.creds.hosts[hash(peerHostname)] = Object.assign({ hostname: peerHostname }, hostInfo)
      this.stats.hosts[hash(peerHostname)] = {
        title: hostInfo.title || (hostInfo.pubKey ? 'webfinger-peer-' + hostInfo.pubKey : undefined),
        pubKey: hostInfo.pubKey,
        version: hostInfo.version
      }
      console.log(this.stats.hosts)
      if (this.stats.hosts[hash(peerHostname)].pubKey && !this.peers[peerHostname]) {
        console.log('INSTANTIATING PEER!', peerHostname, 'should I act as a connector?', this.hostname, this.actAsConnector)
        this.peers[peerHostname] = new Peer(this.creds.hosts[hash(peerHostname)].peersRpcUri, this.tokenStore, this.hopper, this.stats.hosts[hash(peerHostname)].pubKey, this.fetch, this.actAsConnector, this.testLedgerBase)
        console.log('created peer from WebFinger!', peerHostname)
      }
    }
    if (this.peers[peerHostname] && this.peers[peerHostname].ledger) {
      this.creds.ledgers[this.peers[peerHostname].ledger] = { hostname: peerHostname }
    }
    // console.log('linked', this.peers[peerHostname].ledger, peerHostname)
    await new Promise(resolve => {
      setTimeout(resolve, 100) // wait for peer to also add trustline in triangle set up
      //TODO: avoid needing this by checking if a route broadcast failed, and repeating it in that case
    })
    // console.log('peer was added, testing it now', this.creds.ledgers, this.hostname, peerHostname, this.peers[peerHostname].ledger, this.peers[peerHostname].myPublicKey, this.peers[peerHostname].peerPublicKey)
    return this.testPeer(peerHostname)
  },
  testPeer: async function(testHostname) {
    console.log('testing the peer!', testHostname, this.creds.hosts[hash(testHostname)], this.stats.hosts[hash(testHostname)])
    await this.ensureReady()
    if (!this.peers[testHostname]) {
      console.warn('Attempt to test non-peer', testHostname)
      return
    }
    if (!this.stats.hosts[hash(testHostname)]) {
      console.log('testPeer creating new stats entry', this.stats.hosts, hash(testHostname))
      this.stats.hosts[hash(testHostname)] = {}
    }
    const startTime = new Date().getTime()
    let success = 1
    try {
      this.stats.hosts[hash(testHostname)].limit = await this.peers[testHostname].getLimit()
      this.stats.hosts[hash(testHostname)].lastDownTime = new Date().getTime()
    } catch(e) {
      console.log('no success', e)
      success = 0
    }
    this.stats.hosts[hash(testHostname)].latency = new Date().getTime() - startTime
    const previousHealth = this.previousStats.hosts[hash(testHostname)] && this.previousStats.hosts[hash(testHostname)].health
    console.log('calling rollingAvg, before', previousHealth, this.stats.hosts[hash(testHostname)].health)
    this.stats.hosts[hash(testHostname)].health = rollingAvg(previousHealth, success, 100)
    console.log('calling rollingAvg, after', previousHealth, this.stats.hosts[hash(testHostname)].health)
    console.log('stats updated', this.stats.hosts[hash(testHostname)])

    try {
      this.stats.hosts[hash(testHostname)].balance = await this.peers[testHostname].getBalance()
    } catch(e) {
    }

    if (!this.actAsConnector) {
      await this.peers[testHostname].announceTestRoute()
      setTimeout(() => {
        // console.log('route announced, now let\'s see if a payment works!', Object.keys(this.stats.ledgers))
        // prepare a test payment to each ledger that was announced by this peer:
        Object.keys(this.stats.ledgers).map(ledgerName => {
          // console.log('testLedgerBase', this.testLedgerBase)
          if (ledgerName.startsWith(this.testLedgerBase)) {
            // console.log('looking for peerLedgers', ledgerName)
            for (let peerLedger in this.stats.ledgers[ledgerName].routes) {
              if (peerLedger === testHostname) {
                // console.log('found a route to test', testHostname, ledgerName)
                this.peers[testHostname].prepareTestPayment(ledgerName)
              }
            }
          }
        })
        // console.log('done testing payments for', testHostname)
      }, 100)
    }
  },
  announceRoute: async function(ledger, curve, peerHostname) {
    await this.ensureReady()
    return this.peers[peerHostname].announceRoute(ledger, curve)
  },
  announceTestRoute: async function(peerHostname) {
    await this.ensureReady()
    return this.peers[peerHostname].announceTestRoute()
  },
  prepareTestPayment: async function(outThrough, backInThrough) {
    await this.ensureReady()
    return this.peers[peerHostname].prepareTestPayment(this.testLedgerBase + 'test-to-peer.' + this.peers[backInThrough].peerPublicKey + '.')
  },
  
  handleWebFinger: async function(resource) {
    await this.ensureReady()
    return handleWebFinger(resource, this.creds, this.hostname)
  },
  handleRpc: async function(params, body) {
    // console.log('handleRpc 1', params, body)
    await this.ensureReady()
    // console.log('handleRpc 2')
    if (!this.creds.ledgers[params.prefix]) {
      console.log('peer not found!', this.creds.ledgers, params, JSON.stringify(this.creds.ledgers))
      return 'error please retry'
      // peer not found! { 'peer.UswSQ.usd.9.': { hostname: 'connector.land' } } {} {"peer.UswSQ.usd.9.":{"hostname":"connector.land"}}
    }
    // console.log('handleRpc 3')
    if (typeof this.creds.ledgers[params.prefix] === 'undefined') {
      return 'unknown ledger ' + params.prefix
    }
    const peerHostname = this.creds.ledgers[params.prefix].hostname
    // console.log('handle rpc 4', params, body, peerHostname, JSON.stringify(Object.keys(this.peers)), 'are the peer keys')
    return this.peers[peerHostname].handleRpc(params, body)
  },
  handleTest: async function(params, res) {
    console.log('handleTest', params)
    if (typeof params.peer !== 'string') {
      return 'Please provide either "?peer=ilp_secret:..." or "?peer=example.com" query parameter'
    }
    // 'ilp_secret:'+base64url(Buffer.from('https://' + CONNECTORLAND_LEDGER_PREFIX + ':' + token + '@' + ilpDomain + '/rpc', 'ascii'))
    if (params.peer.startsWith('ilp_secret:')) {
      const peerCaps = Buffer.from(params.peer.substring('ilp_secret:'.length), 'base64').toString('ascii')
      console.log('handling test', peerCaps)
      const [ /* 'PROTOCOL://LEDGER:TOKEN@HOST/PATH */, protocol, ledgerPrefix, token, hostname, rpcPath ] = peerCaps.match(/(http[s]{0,1}):\/\/(.*):(.*)\@(.*)\/(.*)/i)
      const uri = protocol + '://' + hostname + '/' + rpcPath
      // this.storeToken(uri, ledger, token)
      this.creds.hosts[hash(hostname)] = {
        hostname,
        rpcPath,
        ledgerPrefix,
        token
      }
      await this.save('creds')
      // peerWithAndTest: async function(peerHostname, rpcPath, ledgerPrefix, token) {
      console.log('peering and testing...', this.creds.hosts, this.creds.hosts[hash(hostname)])
      await this.peerWithAndTest(hostname)
    } else { // interpret as a hostname, e.g. "ilp-kit.example.com"
      await this.peerWithAndTest(params.peer)
    }
    await this.save('stats')
    await this.save('creds')
  },
  server(req, res) {
    const pathParts = req.url.split('?')
    let params = {}
    if (pathParts.length > 1) {
      pathParts[1].split('&').map(pair => {
        const pairParts = pair.split('=')
        params[pairParts[0]] = pairParts[1]
      })
    }
    console.log('calced params!', params, req.url) 
    if (pathParts[0] === '/.well-known/webfinger') {
      promise = this.handleWebFinger(params.resource)
    } else if (pathParts[0] === '/rpc') {
      let str = ''
      req.on('data', (chunk) => { str += chunk })
      promise = new Promise(resolve => { req.on('end', resolve) }).then(() => {
        let body = ''
        try {
          body = JSON.parse(str)
        } catch(e) {}
        console.log('calling rpc', params, body)
        return this.handleRpc(params, body)
      })
    } else {
      promise = Promise.resolve('wrong url ' + req.url)
    }
    promise.then(ret => {
      res.write(JSON.stringify(ret))
      res.end()
    })
  }
}

module.exports = IlpNode
