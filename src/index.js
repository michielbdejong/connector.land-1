const Koa = require('koa')
const koaStatic = require('koa-static')
const IlpNode = require('ilp-node')

const statsFile = process.env.STATS_FILE || './data/stats.json'
const credsFile = process.env.CREDS_FILE || './data/creds.json'
const publicFolder = process.env.PUBLIC_FOLDER || './public'
const hostname = process.env.HOSTNAME || 'connectorland.herokuapp.com'
const port = process.env.PORT
const probeInterval = process.env.PROBE_INTERVAL || 10000

const ilpNode = new IlpNode(statsFile, credsFile, hostname)

const app = new Koa()
app.use(async function(ctx, next) {
  console.log(ctx.path)
  switch(ctx.path) {
  case '/.well-known/webfinger': ctx.body = await ilpNode.handleWebFinger(ctx.query.resource, '/spsp')
    break
  case '/rpc':
    let str = ''
    await new Promise(resolve => {
      ctx.req.on('data', chunk => str += chunk)
      ctx.req.on('end', resolve)
    })
    ctx.body = await ilpNode.handleRpc(ctx.query, JSON.parse(str))
    break
  case '/spsp': ctx.body = await ilpNode.handleSpsp()
    break
  case '/stats':
    await ilpNode.ensureReady()
    if (typeof ctx.query.test === 'string') {
      await ilpNode.testHost(ctx.query.test)
    }
    ctx.body = ilpNode.stats
    break
  default:
    return next()
  }
  ctx.type = 'json'
  console.log('rendered', ctx.path, ctx.query, ctx.body)
})
app.use(koaStatic(publicFolder))
app.listen(port)

setInterval(() => {
  ilpNode.testAll()
}, probeInterval)
