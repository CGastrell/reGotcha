var nodemailer = require('nodemailer');

module.exports = Mailer;

function Mailer(options){
  if (!(this instanceof Mailer)) {
    return new Mailer(options);
  }
  this.options = options || {};

  // create reusable transporter object using SMTP transport
  this.transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: 'cgastrell@gmail.com',
      pass: options.pass
    }
  });

  // NB! No need to recreate the transporter object. You can use
  // the same transporter object for all e-mails

  // setup e-mail data with unicode symbols
  this.mailOptions = {
    from: 'Christian ✔ <cgastrell@gmail.com>', // sender address
    to: 'yabran@gmail.com', // list of receivers
    text: '', // plaintext body
    // html: '<b>Hello world ✔</b>', // html body
    subject: 'Hello ✔' // Subject line
  };
}

// send mail with defined transport object
Mailer.prototype.sendMail = function(extra, cb) {
  var options = this.mailOptions;
  options.text = extra.content;
  options.subject = extra.subject;
  this.transporter.sendMail(options, cb);
}