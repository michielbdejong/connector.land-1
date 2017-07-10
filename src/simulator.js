let handlers = {}
module.exports = async function(url) {
  console.log('handling fetch!', url.split('?'), Object.keys(handlers))
  let ret = await handlers[url.split('?')[0]](url)
  console.log('waited for ret', ret)
  return { json: () => ret }
}

module.exports.registerUri = function(url, handler) {
  handlers[url] = handler
}

module.exports.request = function(options, callback) {
  console.log('handling request!', options, Object.keys(handlers))
  let url = 'https://' + options.host + options.path
  let bodyStr = ''
  let dataCb = function() {}
  let endCb = function() {}
  const res = {
    setEncoding() {},
    on(eventName, cb) {
      if (eventName === 'data') {
        dataCb = cb
      }
      if (eventName === 'end') {
        endCb = cb
      }
    },
  }
  callback(res)
  return {
    write(str) {
      bodyStr += str
    },
    end() {
      handlers[url.split('?')[0]](bodyStr).then(response => {
        dataCb(response)
        endCb()
      })
    },
    on() {}
  }
}
