const IlpNode = require('../ilp-node-src')
let storage = {}

const simulator = require('./simulator')

const node1 = new IlpNode({ set: function(k, v, cb) { storage['1_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['1_' + k] || null) } }, 'asdf1.com', simulator, false)
const node2 = new IlpNode({ set: function(k, v, cb) { storage['2_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['2_' + k] || null) } }, 'asdf2.com', simulator, true)
const node3 = new IlpNode({ set: function(k, v, cb) { storage['3_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['3_' + k] || null) } }, 'asdf3.com', simulator, true)

simulator.registerUri('https://asdf1.com/.well-known/webfinger', url => {
  return node1.handleWebFinger(url.split('?resource=')[1])
})
simulator.registerUri('https://asdf1.com/rpc', node1.handleRpc.bind(node1))

simulator.registerUri('https://asdf2.com/.well-known/webfinger', url => {
  return node2.handleWebFinger(url.split('?resource=')[1])
})
simulator.registerUri('https://asdf2.com/rpc', node2.handleRpc.bind(node2))

simulator.registerUri('https://asdf3.com/.well-known/webfinger', url => {
  return node3.handleWebFinger(url.split('?resource=')[1])
})
simulator.registerUri('https://asdf3.com/rpc', node3.handleRpc.bind(node3))

node1.peerWith('asdf2.com')
node1.peerWith('asdf3.com')

node2.peerWith('asdf3.com')
node2.peerWith('asdf1.com')

node3.peerWith('asdf1.com')
node3.peerWith('asdf2.com')

setTimeout(() => 0, 1000)
