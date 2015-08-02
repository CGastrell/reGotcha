var request = require('request');
var cheerio = require('cheerio');
var debug = require('debug')('scavenger');
var fs = require('fs');
var deathByCaptcha = require('./lib/dbc');
var prompt = require('prompt');


var mysql = require('mysql');
var connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password : '',
  database : 'test'
});



var baseUrl = 'http://www.sssalud.gov.ar/index/';
var sssurl = 'http://www.sssalud.gov.ar/index/index.php?opc=bus650&user=GRAL&cat=consultas';
var picUrl = 'http://www.sssalud.gov.ar/index/simage/secureimage_show.php=sid=';
var captchaFile = 'k.png';
var dnis = require('./dnis.json');
var lastId = 589;
var captureDir = "captures/";

var dbc = null;
prompt.start();

debug('Scavenger session start');
var targets = [];
debug('Removing duplicates');
dnis.dnis.forEach(function(item){
  if(targets.indexOf(item) === -1) {
    targets.push(item);
  }
});
debug('Targets: %s', targets.length);

var test = [31063931,20128030698,28818411];

// var testString = "<tr> <th>Tipo de beneficiario</th> <td>RELACION DE DEPENDENCIA </td> </tr> <tr> <th>C&oacute;dirgo de Obra Social</th> <td><b>1-1190-2</b></td> </tr> <tr> <th>Denominaci&oacute;nr Obra Social</th> <td><b>OBRA SOCIAL DEL SINDICATO DE MECANICOS Y AFINES DEL TRANSPORTE AUTOMOTOR</b></td> </tr> <tr> <th>Fecha Alta Obra Social</th> <td><b>30-05-2014</b></td> </tr>"

// var $$$ = cheerio.load(testString);
// var codigo = $$$('th:contains("digo de Obra Social")').next().text();
// var nombre = $$$('th:contains("n Obra Social")').next().text();
// if(codigo) console.log('Has codigo');
// if(nombre) console.log('Has nombre');
// process.exit(0);


prompt.get([{name:'Username'}, {name:'Password', hidden: true}],function(err, result) {
  if(err) {
    debug('User cancelled');
    debug(err);
    process.exit(1);
  }
  dbc = new deathByCaptcha(result.Username, result.Password);
  next();
});


function next(){
  console.log("/////////////////////////////////////////////////////////");
  debug('Processing item %s', lastId);
  if(!targets[lastId]) {
    debug('All targets processed');
    process.exit(0);
  }
  capture(targets[lastId], function(err, data){
    if(err) {
      debug('Capture error. Last id was %s', lastId);
      debug(err);
      process.exit(1);
    }

    // if(!data.codigo && !data.nombre) {
    //   debug('Identifier %s had no data', test[lastId]);
    //   debug('Continuing...');
    // }

    if(data.os_fecha_alta) {
      var pieces = data.os_fecha_alta.split('-');
      pieces.reverse();
      data.os_fecha_alta = pieces.join('-');
    }

    connection.query('INSERT INTO oss SET ?', data, function(err, result) {
      if (err) {
        debug('Mysql error. Last id was %s', lastId);
        throw err;
      }

      lastId++;
      next();
    });


  });

}



function capture(identifier, callback) {

  debug('Capturing %s', identifier);
  var j = request.jar();
  request({url: sssurl, jar: j }, function(err, response, html){
    if(err) {
      debug('Error');
      debubg(err);
      return callback(err);
    }
    var $ = cheerio.load(html);
    // console.log(j.getCookies(sssurl));
    debug('Parsing form values');
    formData = {};
    // $('input[name=nro_doc]').val('31063931');
    $('form input').each(function(i, el){
      formData[$(this).attr('name')] = $(this).val();
    });
    
    picUrl = baseUrl + $('form img').attr('src');

    // debug('Creating file link');
    // var k = fs.createWriteStream(captchaFile);
    debug('Capturing captcha: %s', ($('form img').attr('src')));
    request({url: picUrl, jar: j, encoding: null}, function(picErr, picResponse, picBody){
      if(picErr) {
        debug('Error retrieving captcha pic');
        debug(picErr);
        return callback(picErr);
      }

      // console.log(picResponse);
      // fs.writeFileSync(captchaFile, picBody);
      debug('Requesting captcha solution...');
      dbc.solve(picBody, function(dbcErr, id, solution){
        if(dbcErr) {
          debug('DBC Error');
          debug(dbcErr);
          return callback(dbcErr);
        }
        debug('Captcha %s solved', id);
        debug('Captcha solution is %s', solution);

        formData.code = solution;
        if(identifier > 99999999) {
          var prefix = identifier.toString().substr(0,2);
          var dni = identifier.toString().substr(2,9);
          var sufix = identifier.toString().substr(9,10);
          formData.cuil_b = prefix + "-" + dni + "-" + sufix;
        }else{
          formData.nro_doc = identifier;
        }
        debug('Posting form with data:');
        debug(formData);
        request.post({url:sssurl, form: formData, jar: j}, function(formErr, formResponse, formBody){
          if(formErr) {
            debug('Error posting form');
            debug(formErr);
            return callback(formErr);
          }
          debug('Post response:');
          var $$ = cheerio.load(formBody);
          fs.writeFileSync(captureDir + identifier+".html", formBody);
          var codigo = $$('th:contains("digo de Obra Social")').next().text();
          var nombre = $$('th:contains("n Obra Social")').next().text();
          var rel_tipo = $$('th:contains("Tipo de beneficiario")').next().text();
          var fecha_alta = $$('th:contains("Fecha Alta Obra Social")').next().text();
          var data = {
            du_cuil: identifier,
            os_codigo: codigo.trim() || null,
            os_nombre: nombre.trim() || null,
            os_fecha_alta: fecha_alta.trim() || null,
            os_tipo: rel_tipo.trim() || null
          }
          console.log(data);
          callback(null, data);
        });
      });

      
    });

    return;
  });
}


function getNextJob(cb) {
  var row = null;
  connection.beginTransaction(function(transactionErr){
    if(transactionErr) {
      throw transactionErr;
    }
    connection.query('SET autocommit = 0', function(setErr, setResult){


      connection.query('SELECT id, DNI FROM KoKo WHERE done = ? LIMIT 1 FOR UPDATE', [0], function(err, result) {
        if (err) {
          debug('Mysql error. Last id was %s', lastId);
          throw err;
        }
        if(result.length < 1) {
          console.log('all done');
          process.exit(0);
        }
        row = result[0];
        connection.query('UPDATE KoKo SET done = ? WHERE id = ? LIMIT 1' ,[1, row.id], function(updErr, updResult){
          if(updErr) {
            throw updErr;
          }
          console.log(updResult);

          connection.commit(function(commitErr){
            if(commitErr) {
              return connection.rollback(function() {
                throw commitErr;
              });
            }

            connection.query('SELECT du_cuil FROM oss WHERE du_cuil = ?',[row.DNI], function(ossErr,ossResult){
              if(ossErr) {
                throw ossErr;
              }
              if(ossResult.length > 0) {
                
              }
              return cb && cb(row.DNI);
            });

          }); // commit


        }); // update

      }); // select
      
    });

  }); //transaction

}