var request = require('request');
var cheerio = require('cheerio');
var debug = require('debug')('scavenger');
var fs = require('fs');
var deathByCaptcha = require('./lib/dbc');
var prompt = require('prompt');


var mysql = require('mysql');
var connection = null;


var MAX = 0;
var lastCount = 0;
var baseUrl = 'http://www.sssalud.gov.ar/index/';
var sssurl = 'http://www.sssalud.gov.ar/index/index.php?opc=bus650&user=GRAL&cat=consultas';
var picUrl = 'http://www.sssalud.gov.ar/index/simage/secureimage_show.php=sid=';
var captchaFile = 'k.png';
var captureDir = "captures/";

var dbc = null;
var cancelNextRound = false;

prompt.start();

debug('Scavenger session start');

prompt.get(
  [
    {name:'DBCUsername'},
    {name:'DBCPassword', hidden: true},
    {name:'DBPassword', hidden: true}
  ],function(err, result) {
    if(err) {
      debug('User cancelled');
      debug(err);
      process.exit(1);
    }
    connection = mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password : result.DBPassword,
      database : 'test'
    })
    dbc = new deathByCaptcha(result.DBCUsername, result.DBCPassword);

    //graceful shutdown
    var keypress = require('keypress');

    // make `process.stdin` begin emitting "keypress" events
    keypress(process.stdin);

    // listen for the "keypress" event
    process.stdin.on('keypress', function (ch, key) {
      // console.log('got "keypress"', key);
      if (key && key.ctrl && key.name == 'c') {
        debug('Abort by user. Powering off ...')
        process.stdin.pause();
        cancelNextRound = true;
      }
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    next();
  }
);


function next(){
  console.log("/////////////////////////////////////////////////////////");
  if(cancelNextRound) {
    debug('Exit');
    process.exit(0);
  }
  if(MAX > 0 && lastCount > MAX) {
    debug('Reached max jobs, aborting');
    process.exit(0);
    return;
  }
  debug('Requesting job...');
  getNextJob(function(jobErr, jobData, skip){
    if(jobErr){
      debug('Some error with the DB halted the execution');
      debug(jobErr);
      process.exit(1);
    }
    if(!jobData) {
      debug('All targets processed. Exiting after %s jobs processed', lastCount);
      process.exit(0);
    }

    debug('Got job data');
    console.log(jobData);

    if(skip) {
      debug('Skipping job, already in DB');
      return next();
    }

    if(!jobData.payload) {
      debug('Skipping job, empty payload');
      return next();
    }

    capture(jobData.payload, function(err, data){
      if(err) {
        debug('Capture error. Last id was %s', jobData.id);
        debug(err);
        rollbackJob(jobData.id, function(rollbackErr, rollbackResult){
          if(rollbackErr) {
            debug('MySql error, could not rollback job ID %s', jobData.id);
          }else{
            debug('Job ID %s set to undone.', jobData.id);
          }
          debug('Quitting now.');
          process.exit(1);
        });
        return;
      }

      if(data.os_fecha_alta) {
        var pieces = data.os_fecha_alta.split('-');
        pieces.reverse();
        data.os_fecha_alta = pieces.join('-');
      }

      connection.query('INSERT INTO oss SET ?', data, function(err, result) {
        if (err) {
          debug('Mysql error. Last id was %s', jobData.id);
          debug('Job was completed but could not write results');
          debug('Should rollback with:');
          debug('UPDATE jobs SET done = 0 WHERE id = %s', jobData.id);
          throw err;
        }
        lastCount++;
        next();
      });


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

function rollbackJob(id, callback) {
  debug('Rolling back job ID %s', id);
  connection.query('UPDATE jobs SET done = 0 WHERE id = ?',[id], function(err, result){
    if(err) {
      return callback && callback(err);
    }
    return callback && callback();
  });
}

function getNextJob(cb) {
  var row = null;
  debug('Transaction begun...');
  connection.beginTransaction(function(transactionErr){
    if(transactionErr) {
      return cb && cb(transactionErr);
    }
    connection.query('SET autocommit = 0', function(setErr, setResult){
      if (setErr) {
        return cb && cb(setErr);
      }

      connection.query('SELECT id, payload FROM jobs WHERE done = ? LIMIT 1 FOR UPDATE', [0], function(err, result) {
        if (err) {
          return cb && cb(err);
        }
        if(result.length < 1) {
          return cb && cb(null, null);
        }
        row = result[0];
        debug('Got job row %s',row.id);
        connection.query('UPDATE jobs SET done = ? WHERE id = ? LIMIT 1' ,[1, row.id], function(updErr, updResult){
          if(updErr) {
            return cb && cb(updErr);
          }
          debug('Job row removed from queue');

          connection.commit(function(commitErr){
            if(commitErr) {
              return connection.rollback(function() {
                return cb && cb(commitErr);
              });
            }
            debug('Transaction ended');
            connection.query('SELECT du_cuil FROM oss WHERE du_cuil = ?',[row.payload], function(ossErr,ossResult){
              if(ossErr) {
                return cb && cb(ossErr);
              }

              return cb && cb(null, row, ossResult.length > 0);
            });

          }); // commit

        }); // update

      }); // select
      
    }); // set

  }); //transaction

}