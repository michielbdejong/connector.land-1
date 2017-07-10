let handlers = {}
module.exports = async function(url) {
  console.log('handling fetch!', url, Object.keys(handlers))
  return handlers[url]
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
    write(str) {
      bodyStr = str
    },
    end() {
      handlers[url](bodyStr).then(response => {
        dataCb(response)
        endCb
      })
    }
  }
  callback(res)
}
