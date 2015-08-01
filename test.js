var whatsapi = require('whatsapi');

var wa = whatsapi.createAdapter({
  msisdn: '+5491166258669', // phone number with country code
  username: 'Christian Gastrell', // your name on WhatsApp
  password: '', // WhatsApp password
  ccode: '54' // country code
}, true);


wa.connect(function connected(err) {
  if (err) { console.log(err); return; }
  console.log('Connected');
  // Now login
  wa.login(logged);
});

function logged(err) {
  if (err) { console.log(err); return; }
  console.log('Logged in to WA server');
  // wa.sendIsOnline();
  wa.requestServerProperties(function gotProperties(err, res) {
    if (err) {
      console.log('Error: %s; Code: %s', err.message, err.code);
      return;
    }
    console.log(res);
  });
}


// wa.sendMessage("+5491155934137", "sent from node!", function(err, id) {
//     if (err) {
//       console.log(err.message);
//       return;
//     }
//     console.log('Server received message %s', id);
// });