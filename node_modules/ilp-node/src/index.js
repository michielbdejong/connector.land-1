const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const keypair = require('./lib/keypair')
const getHostInfo = require('./lib/hostInfo')
const handleWebFinger = require('./lib/webfinger')
const Peer = require('./lib/rpc').Peer
const Hopper = require('./lib/hopper').Hopper

function IlpNode (statsFileName, credsFileName, hostname) {
  console.log('function IlpNode (', { statsFileName, credsFileName, hostname })
  this.hopper = new Hopper()
  this.statsFileName = statsFileName
  this.credsFileName = credsFileName
  this.hostname = hostname
  this.stats = {
    hosts: {},
    ledgers: {}
  }
  this.peers = {}
  this.creds = {}
  this.ready = false
}

IlpNode.prototype = {
  ensureReady: async function() {
    if (this.ready === false) {
      console.log('triggering init')
      this.ready = await this.init()
      console.log('init completed by us')
      this.ready = true
    }
    if (this.ready !== true) {
      console.log('init already triggered')
      await this.ready
      console.log('init completed by other')
    }
  },
  init: async function() {
    await this.readFile('stats', this.statsFileName)
    await this.readFile('creds', this.credsFileName)
    if (this.creds.keypair === undefined) {
      console.log('generating keypair')
      this.creds.keypair = keypair.generate()
      console.log(this.creds.keypair)
      await this.writeFile('creds', this.credsFileName)
      console.log('saved')
    }
    this.tokenStore = new keypair.TokenStore(this.creds.keypair)
  },
  readFile: async function(objName, fileName) {
    await new Promise((resolve, reject) => {
      fs.readFile(fileName, (err, buf) => {
        if (err) {
          console.log(`${objName} file ${fileName} does not exist, creating.`)
          this.writeFile(objName, fileName).then(resolve)
        } else {
          try {
            this[objName] = JSON.parse(buf)
          } catch(e) {
            console.error(`${objName} file ${fileName} exists but is corrupt, fatal.`)
            reject(e)
          }
        }
        resolve()
      })
    })
  },
  writeFile: async function(objName, fileName) {
    await new Promise((resolve, reject) => {
      fs.writeFile(fileName, JSON.stringify(this[objName], null, 2), (err) => {
        if (err) {
          mkdirp(path.dirname(fileName), (err2) => {
            if (err2) {
              reject(err2)
            } else {
              fs.writeFile(fileName, JSON.stringify(this[objName], null, 2), (err3) => {
                if (err3) {
                  reject(err3)
                } else {
                  resolve()
                }
              })
            }
          })
        } else {
          resolve()
        }
      })
    })
  },
  testAll: async function() {
    const promises = []
    await this.ensureReady()
    for (let hostname of Object.keys(this.stats.hosts)) {
      promises.push(this.testHost(hostname, false))
    }
    for (let prefix of Object.keys(this.stats.ledgers)) {
      promises.push(this.testPeer(this.stats.ledgers[prefix].hostname))
    }
    await Promise.all(promises)
    await this.writeFile('stats', this.statsFileName)
  },
  peerWith: async function(peerHostname) {
    await this.ensureReady()
    this.stats.hosts[peerHostname] = await getHostInfo(peerHostname, this.stats.hosts[peerHostname] || {})
    // console.log('this.stats.hosts[peerHostname]', this.stats.hosts[peerHostname])
    if (this.stats.hosts[peerHostname].pubKey && !this.peers[peerHostname]) {
      console.log('peering!')
      this.peers[peerHostname] = new Peer(peerHostname, this.tokenStore, this.hopper, this.stats.hosts[peerHostname].pubKey)
    }
    this.stats.ledgers[this.peers[peerHostname].ledger] = { hostname: peerHostname }
    console.log('linked', this.peers[peerHostname].ledger, peerHostname)
  },
  testHost: async function(testHostname, writeStats = true) {
    await this.ensureReady()
    this.peerWith(testHostname)
    if (writeStats) {
      await this.writeFile('stats', this.statsFileName)
    }
  },
  testPeer: async function(testHostname) {
    await this.ensureReady()
    this.stats.hosts[testHostname].limit = await this.peers[testHostname].getLimit()
    this.stats.hosts[testHostname].balance = await this.peers[testHostname].getBalance()
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
    await this.ensureReady()
    const peerHostname = this.stats.ledgers[params.prefix].hostname
    console.log('handle rpc', params, body, peerHostname)
    return this.peers[peerHostname].handleRpc(params, body)
  },
}

module.exports = IlpNode
