const IlpNode = require('../ilp-node-src')
let storage = {}

const simulator = require('./simulator')

const node1 = new IlpNode({ set: function(k, v, cb) { storage['1_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['1_' + k] || null) } }, 'asdf1.com', simulator, false)
const node2 = new IlpNode({ set: function(k, v, cb) { storage['2_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['2_' + k] || null) } }, 'asdf2.com', simulator, true)
const node3 = new IlpNode({ set: function(k, v, cb) { storage['3_' + k] = v; cb() }, get: function(k, cb) { cb(null, storage['3_' + k] || null) } }, 'asdf3.com', simulator, true)

simulator.registerUri('https://asdf1.com/.well-known/webfinger', url => {
  return node1.handleWebFinger(url.split('?resource=')[1])
})
simulator.registerUri('https://asdf1.com/rpc', (url, params, bodyStr) => {
  console.log('handler called!', { url, params, bodyStr })
  let bodyObj
  try {
    bodyObj = JSON.parse(bodyStr)
  } catch(e) {
    console.log('BODY WAS NOT JSON!',  bodyStr)
  }
  return node1.handleRpc(params, bodyObj)
})

simulator.registerUri('https://asdf2.com/.well-known/webfinger', url => {
  return node2.handleWebFinger(url.split('?resource=')[1])
})
simulator.registerUri('https://asdf2.com/rpc', (url, params, bodyStr) => {
  let bodyObj
  try {
    bodyObj = JSON.parse(bodyStr)
  } catch(e) {
    console.log('BODY WAS NOT JSON!',  bodyStr)
  }
  return node2.handleRpc(params, bodyObj)
})

simulator.registerUri('https://asdf3.com/.well-known/webfinger', url => {
  return node3.handleWebFinger(url.split('?resource=')[1])
})
simulator.registerUri('https://asdf3.com/rpc', (url, params, bodyStr) => {
  let bodyObj
  try {
    bodyObj = JSON.parse(bodyStr)
  } catch(e) {
    console.log('BODY WAS NOT JSON!',  bodyStr)
  }
  return node3.handleRpc(params, bodyObj)
})

node1.peerWith('asdf2.com')
node1.peerWith('asdf3.com')

node2.peerWith('asdf3.com')
node2.peerWith('asdf1.com')

node3.peerWith('asdf1.com')
node3.peerWith('asdf2.com')

setTimeout(() => {
  const stressTestStartTime = new Date().getTime()
  let promises = []
  const batchSize = 10000
  for (let i = 0; i < batchSize; i++) {
    promises.push(node1.peers['asdf3.com'].prepareTestPayment('g.dns.com.asdf1.'))
  }
  Promise.all(promises).then(() => {
    const endTime = new Date().getTime()
    console.log('stress test took', endTime - stressTestStartTime, { batchSize }, 'that means req/ms', 6* batchSize / (endTime - stressTestStartTime), 'because each transfer is 6 simulated RPC calls')
  })
}, 500)
