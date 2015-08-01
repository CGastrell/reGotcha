var request = require('request');
var cheerio = require('cheerio');
var debug = require('debug')('scavenger');
var fs = require('fs');
var deathByCaptcha = require('gsacaptchabreaker');

var baseUrl = 'http://www.sssalud.gov.ar/index/';
var sssurl = 'http://www.sssalud.gov.ar/index/index.php?opc=bus650&user=GRAL&cat=consultas';
var picUrl = 'http://www.sssalud.gov.ar/index/simage/secureimage_show.php=sid=';
var captchaFile = 'k.png';

var dbc = new deathByCaptcha('','');
process.stdin.setEncoding('utf8');

debug('Scavender session start');

debug('Requesting %s', picUrl);
var j = request.jar();
request({url: sssurl, jar: j }, function(err, response, html){
  if(err) {
    debug('Error');
    debubg(err);
    return;
  }
  var $ = cheerio.load(html);
  // console.log(j.getCookies(sssurl));
  debug('Parsing form values');
  formData = {};
  $('input[name=nro_doc]').val('31063931');
  $('form input').each(function(i, el){
    formData[$(this).attr('name')] = $(this).val();
  });
  
  picUrl = baseUrl + $('form img').attr('src');

  debug('Creating file link');
  var k = fs.createWriteStream(captchaFile);
  debug('Capturing captcha: %s', ($('form img').attr('src')));
  var req = request({url: picUrl, jar: j});
  req.pipe(k);
  req.on('end', function(){
    // k.end();
    // console.log(j.getCookies(sssurl));
    // console.log(j.getCookies(picUrl));
    process.stdin.on('data', function(text){
      formData.code = text.substr(0, text.indexOf('\n'));
      debug('Sending form with data:');
      console.log(formData);

      request.post({url:sssurl, form: formData, jar: j}, function(formErr, formResponse, formBody){
        debug('Post response:');
        // console.log(formBody);
        var $$ = cheerio.load(formBody);
        console.log($$('body').html());
        process.exit();
      });
    });
    console.log('Enter code:');
    process.stdin.resume();
    
  });

  return;
});