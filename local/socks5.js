var debug = require('debug')('LOCAL:SOCKS5')
    , url = require('url')
    , net = require('net')
    , util = require('util')
    , d = require('domain').create()
    , socks5 = require('../proto/socks5')
    , config = require('../util/config');

// ---- timeout

var connectTimeout = 2000; // 2 second
var transferTimeout = 30000; // 30 second

// ---- upstream socket

var protocol = config('local','proto') || 'direct';

var upstream = require('../proto/'+protocol);

// ----

function serve(sock){
  var self = this;
  debug("connections:%s", self.connections);
  var usock = null;
  function close(){
    // debug('%s END', sock.remoteAddress);
    debug("connections:%s", self.connections);
    try { sock.destroy(); } catch(x){ }
    try { usock.destroy(); } catch(x){ }
  }
  function error(e){
    debug('%s ERROR %j', sock.remoteAddress, e);
    close();
  }
  function timeout(){
    debug('%s TIMEOUT', sock.remoteAddress);
    close();
  }
  function handshake(d){
    sock.removeListener('data', handshake);
    sock.on('data', request);
    // sock.ondata = request;
    // todo check v5
    // todo auth
    sock.write(new Buffer([0x05, 0x00])); // socks5 noauth 
  }
  function request(d){
    sock.removeListener('data', request);
    // delete sock.ondata;
    // todo check v5
    var cmd = d[1];
    var address = socks5.decodeAddress(d,3);
    var host = address.host;
    var port = address.port;
    // debug("REQUEST %d %s:%s", cmd, host, port);
    if (cmd == 0x01) { // connect
      usock = upstream.connect(port, host);
      usock.on('end', close);
      usock.on('error', error);
      usock.on('connect', function(){
        // debug('%s -> %s', sock.remoteAddress, host);
        // debug('%s BEGIN', sock.remoteAddress);
        usock.setNoDelay(true);
        usock.pipe(sock);
	// usock.setTimeout(0);
	// usock.setTimeout(transferTimeout, timeout);
        sock.pipe(usock);
	// sock.setTimeout(0);
	// sock.setTimeout(transferTimeout, timeout);
        var resp = new Buffer(d.length);
        d.copy(resp);
        resp[0] = 0x05;
        resp[1] = 0x00;
        resp[2] = 0x00;
        sock.write(resp);
      });
      // usock.setTimeout(connectTimeout, timeout);
      /*
    } else if (cmd == 0x02) { // bind
    } else if (cmd == 0x03) { // udp associate
      */
    } else { // unsupport
      sock.end(new Buffer([0x05,0x07,0x00,0x01]));
      error('UNSUPPORT_CMD');
    }
  }
  sock.on('data', handshake);
  // sock.ondata = handshake;
  sock.on('end', close);
  sock.on('error', error);
  sock.setNoDelay(true);
  // sock.setTimeout(transferTimeout, timeout);
}

// ----

function start(opt){
  var port = opt.port || 1080;
  var onListening = function(){
    debug("listening on %j", this.address());
  };
  var onConnection = function(sock){
    // debug("%s connect", sock.remoteAddress);
    serve.call(this, sock);
  };
  var onClose = function(){
    debug("closed %j", this.address());
  };
  var onError = function(err){
    debug("error %j", err);
  };

  d.on('error', function(e){
    // debug('ERROR', e, e.stack);
    debug('!!!! ERROR %s', e.message);
  });
  d.run(function(){
    var server = net.createServer();
    server.on('listening', onListening);
    server.on('connection', onConnection);
    server.on('close', onClose);
    server.on('error', onError);
    server.listen(port);
  });
}
exports.start = start;

// ---- 

if(!module.parent) {
  start({port:1080});
}
