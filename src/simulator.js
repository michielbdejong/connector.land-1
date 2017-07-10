let handlers = {}
module.exports = async function(url) {
  if (typeof handlers[url.split('?')[0]] === 'undefined') {
    console.error('cannot fetch!', url.split('?'), Object.keys(handlers))
  }
  let ret = await (handlers[url.split('?')[0]] || (() => Promise.resolve()))(url)
  return { json: () => ret }
}

module.exports.registerUri = function(url, handler) {
  handlers[url] = handler
}

module.exports.request = function(options, callback) {
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
      if (typeof handlers[url.split('?')[0]] === 'undefined') {
        console.error('searching handler', url.split('?')[0], Object.keys(handlers))
      }
      let params = {}
      let pairs = url.split('?')[1].split('&')
      pairs.map(pair => {
        params[pair.split('=')[0]] = pair.split('=')[1]
      })
      // console.log('RPC PARAMS', params, typeof handlers[url.split('?')[0]], bodyStr)
      try {
        (handlers[url.split('?')[0]] || (() => Promise.resolve()))(params, bodyStr).then(response => {
          // console.log('in simulator response handler!', response)
          dataCb(response)
          endCb()
        })
      } catch(e) {
        console.log('what went wrong', e)
      }
    },
    on() {}
  }
}
