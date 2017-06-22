const Koa = require('koa')
const koaStatic = require('koa-static')
const IlpNode = require('../../src/index')
const ilpNode = {}

function startServer(port) {
  const statsFile = `./data${port}/stats.json`
  const credsFile = `./data${port}/creds.json`
  const publicFolder = `./data${port}/statics/`
  const hostname = `localhost:${port}`
  const probeInterval = 10000
  
  ilpNode[port] = new IlpNode(statsFile, credsFile, hostname)
  
  const app = new Koa()
  app.use(async function(ctx, next) {
    console.log(ctx.path)
    switch(ctx.path) {
    case '/.well-known/webfinger': ctx.body = await ilpNode[port].handleWebFinger(ctx.query.resource)
      break
    case '/api/peers/rpc':
      let postData = null
      if (ctx.query.method === 'send_message') {
        postData = await new Promise(resolve => {
          let str = ''
          ctx.req.on('data', chunk => {
             str += chunk
          })
          ctx.req.on('end', () => {
            console.log('where is hte body?', str)
            resolve(JSON.parse(str))
          })
        })
      }
      ctx.body = await ilpNode[port].handleRpc(ctx.query, postData)
      break
    case '/spsp': ctx.body = await ilpNode[port].handleSpsp()
      break
    case '/stats':
      if (typeof ctx.query.test === 'string') {
        await ilpNode[port].testHost(ctx.query.test)
      }
      ctx.body = ilpNode[port].stats
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
    ilpNode[port].testAll()
  }, probeInterval)
}

other = {
  8001: 8002,
  8002: 8001
};

[8001, 8002].map(async function(port) {
  await startServer(port)
  await ilpNode[port].peerWith(`localhost:${other[port]}`)
  console.log(port, 'start tests')
  await ilpNode[port].testAll()
  console.log(port, 'announce route')
  await ilpNode[port].announceRoute(`g.dns.land.connector.${port}`, [
    [0, 0],
    [1, 3495575220000],
    [20, 63495575220000],
    [400, 463495575220000],
    [8000, 9463495575220000],
    [160000, 1009463495575220000],
    [3200000, 11009463495575220000],
    [100000000000000000, 11009463495575220000]
  ], `localhost:${other[port]}`)
})
