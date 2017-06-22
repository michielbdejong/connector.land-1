
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      });
      var result = {
        destination_account: `g.mylp.longplayer.${parts[1]}`,
        shared_secret: getSpspSecret(),
        maximum_destination_amount: '18446744073709552000',
        minimum_destination_amount: '1',
        ledger_info: {
          currency_code: 'USD',
          currency_scale: 9
        },
        receiver_info: {
          name: parts[1],
          image_url: 'http://barton.canvasdreams.com/~jaderiyg/wp-content/uploads/2014/01/r679226_5007507.jpg'
        }
      };
      console.log({ result });
      res.end(JSON.stringify(result, null, 2));
