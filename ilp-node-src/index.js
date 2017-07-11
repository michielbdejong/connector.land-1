const keypair = require('./lib/keypair')
const getHostInfo = require('./lib/hostInfo')
const handleWebFinger = require('./lib/webfinger')
const Peer = require('./lib/peer').Peer
const Hopper = require('./lib/hopper').Hopper
const crypto = require('crypto')
const realFetch = require('node-fetch')


function hash(hostname) {
  return crypto
      .createHmac('sha256', 'hostname')
      .update(hostname)
      .digest('hex')
}

function IlpNode (kv, hostname, simulator, actAsConnector = false) {
  console.log('IlpNode constructor', hostname, actAsConnector)
  this.kv = kv
  this.actAsConnector = actAsConnector
  if (simulator) {
    this.fetch = simulator
  } else {
    this.fetch = realFetch
  }
  this.hostname = hostname
  this.testLedgerBase = 'g.dns.' + this.hostname.split('.').reverse().join('.') + '.'
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
    if (this.lastLedgerStatsCollectionTime > new Date().getTime() - minDelay) {
      return
    }
    // erase
    this.stats.ledgers = {}
    this.lastLedgerStatsCollectionTime = new Date().getTime()
    for (let peerHost in this.peers) {
      // console.log(this.stats, '1')
      const peerTitle = this.stats.hosts[hash(peerHost)].title
      for (let dest in this.peers[peerHost].routes) {
        if (typeof this.stats.ledgers[dest] === 'undefined') {
          this.stats.ledgers[dest] = {
             ledgerName: dest,
             routes: {}
          }
        }
        this.stats.ledgers[dest].routes[peerTitle] = this.peers[peerHost].routes[dest]
      }
    }
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
    // console.log('testAll!!!!testAll!!!!testAll!!!!testAll!!!!')
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
      promises.push(this.testHost(this.creds.hosts[hostnameHash].hostname, false))
      // this fills up the 'hosts' portion of the stats, by calling both testHost and testPeer
      // the 'ledgers' portion is filled up by incoming route broadcasts
      // testPeer then looks at ledgers that are reachable from this peer and tries to send to them
    }

    await Promise.all(promises)
    await this.save('stats')
    await this.save('creds')
  },
  peerWith: async function(peerHostname) {
    // console.log(this.hostname, 'peers with', peerHostname)
    await this.ensureReady()
    // console.log(this.creds, this.stats, this.previousStats, '2')
    this.creds.hosts[hash(peerHostname)] = { hostname: peerHostname }
    this.stats.hosts[hash(peerHostname)] = await getHostInfo(peerHostname, this.previousStats.hosts[peerHostname] || {}, this.fetch)
    if (this.stats.hosts[hash(peerHostname)].pubKey && !this.peers[peerHostname]) {
      console.log('INSTANTIATING PEER!', peerHostname, 'should I act as a connector?', this.hostname, this.actAsConnector)
      this.peers[peerHostname] = new Peer(this.stats.hosts[hash(peerHostname)].peersRpcUri, this.tokenStore, this.hopper, this.stats.hosts[hash(peerHostname)].pubKey, this.fetch, this.actAsConnector, this.testLedgerBase)
    }
    this.creds.ledgers[this.peers[peerHostname].ledger] = { hostname: peerHostname }
    // console.log('linked', this.peers[peerHostname].ledger, peerHostname)
    await this.save('creds')
    await new Promise(resolve => {
      setTimeout(resolve, 100) // wait for peer to also add trustline in triangle set up
      //TODO: avoid needing this by checking if a route broadcast failed, and repeating it in that case
    })
    // console.log('peer was added, testing it now', this.creds.ledgers, this.hostname, peerHostname, this.peers[peerHostname].ledger, this.peers[peerHostname].myPublicKey, this.peers[peerHostname].peerPublicKey)
    await this.testPeer(peerHostname)
  },
  testHost: async function(testHostname, writeStats = true) {
    await this.ensureReady()
    this.peerWith(testHostname)
    if (writeStats) {
      await this.save('stats')
    }
  },
  testPeer: async function(testHostname) {
    // console.log('testing the peer!', testHostname)
    await this.ensureReady()
    this.stats.hosts[hash(testHostname)].limit = await this.peers[testHostname].getLimit()
    // console.log('FOUND LIMIT!', testHostname, this.stats.hosts[hash(testHostname)].limit)
    this.stats.hosts[hash(testHostname)].balance = await this.peers[testHostname].getBalance()
    // console.log('FOUND BALANCE!', testHostname, this.stats.hosts[hash(testHostname)].balance)
    // console.log('announcing test route to', testHostname)
    if (!this.actAsConnector) {
      await this.peers[testHostname].announceTestRoute()
      setTimeout(() => {
        // console.log('route announced, now let\'s see if a payment works!', Object.keys(this.stats.ledgers))
        // prepare a test payment to each ledger that was announced by this peer:
        Object.keys(this.stats.ledgers).map(ledgerName => {
          console.log('testLedgerBase', this.testLedgerBase)
          if (ledgerName.startsWith(this.testLedgerBase)) {
            // console.log('looking for peerLedgers', ledgerName)
            for (let peerLedger of this.stats.ledgers[ledgerName].routes) {
              if (peerLedger === testHostname) {
                console.log('found a route to test', testHostname, ledgerName)
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
  handleWebFinger: async function(resource) {
    await this.ensureReady()
    return handleWebFinger(resource, this.creds, this.hostname)
  },
  handleRpc: async function(params, body) {
    // console.log('handleRpc 1', params, body)
    await this.ensureReady()
    // console.log('handleRpc 2')
    if (!this.creds.ledgers[params.prefix]) {
      // console.log('peer not found!', this.creds.ledgers, params, JSON.stringify(this.creds.ledgers))
      return 'error please retry'
    }
    // console.log('handleRpc 3')
    if (typeof this.creds.ledgers[params.prefix] === 'undefined') {
      return 'unknown ledger ' + params.prefix
    }
    const peerHostname = this.creds.ledgers[params.prefix].hostname
    // console.log('handle rpc 4', params, body, peerHostname, JSON.stringify(Object.keys(this.peers)), 'are the peer keys')
    return this.peers[peerHostname].handleRpc(params, body)
  },
}

module.exports = IlpNode
