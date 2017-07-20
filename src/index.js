const Koa = require('koa')
const koaStatic = require('koa-static')
const IlpNode = require('../ilp-node-src')
const redis = require("redis")

const publicFolder = process.env.PUBLIC_FOLDER || './public'
const hostname = process.env.HOSTNAME || 'connector.land'
const port = process.env.PORT || 6001 // avoid port 6000 because of https://superuser.com/questions/188058/which-ports-are-considered-unsafe-on-chrome
const probeInterval = process.env.PROBE_INTERVAL || 10000

const redisClient = redis.createClient({ url: process.env.REDIS_URL })
redisClient.on('error', function (err) {
  console.log('Error ' + err)
})
console.log('created redis client for', process.env.REDIS_URL, process.env.HOSTNAME, process.env.NETWORK_PREFIX)
const ilpNode = new IlpNode(redisClient, hostname, undefined, false, process.env.NETWORK_PREFIX)

const app = new Koa()
app.use(async function(ctx, next) {
  switch(ctx.path) {
  case '/.well-known/webfinger':
  case '/rpc':
    return ilpNode.server(ctx.req, ctx.res)
  case '/stats':
    await ilpNode.ensureReady()
    await ilpNode.collectLedgerStats(10000)
    if (typeof ctx.query.test === 'string') {
      // console.log('testing!', ctx.query.test)
      await ilpNode.handleTest({ peer: ctx.query.test })
    }
    ctx.body = ilpNode.stats
    break
  default:
    return next()
  }
  ctx.type = 'json'
  // console.log('rendered', ctx.path, ctx.query, ctx.body)
})
app.use(koaStatic(publicFolder))
app.listen(port)
console.log('listening on ', port)
setInterval(() => {
  ilpNode.testAll()
}, probeInterval)
console.log('interval set!', probeInterval)
  ilpNode.testAll()
console.log('first test done!')
