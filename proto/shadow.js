var debug = require('debug')('PROTO:SHADOW')
    , net = require('net')
    , util = require('util')
    , stream = require('stream')
    , crypto = require('crypto')
    , socks5 = require('./socks5')
    , config = require('../util/config');

var _host = config('proto', 'shadow', 'host') || '127.0.0.1';
var _port = config('proto', 'shadow', 'port') || 7070;
var _pass = config('proto', 'shadow', 'pass') || "cool";

// ---- shadow client interface

function createConnection(){ // port,host,options
  var options = {};

  if (typeof arguments[0] === 'object') {
    options = arguments[0];
  } else if (typeof arguments[1] === 'object') {
    options = arguments[1];
    options.port = arguments[0];
  } else if (typeof arguments[2] === 'object') {
    options = arguments[2];
    options.port = arguments[0];
    options.host = arguments[1];
  } else {
    if (typeof arguments[0] === 'number') {
      options.port = arguments[0];
    }
    if (typeof arguments[1] === 'string') {
      options.host = arguments[1];
    }
  }
  var socks = new ShadowSocks(_host, _port, _pass);
  return socks.connect(options.port, options.host);
};

exports.createConnection = createConnection;

// ---- shadow encode decode

var Max = Math.pow(2,32);

function merge_sort(array, comp){

  function merge(left, right) {
    var result = new Array();
    while ((left.length > 0) && (right.length > 0)) {
      if (comp(left[0], right[0]) <= 0)
        result.push(left.shift());
      else
        result.push(right.shift());
    }
    while (left.length > 0) result.push(left.shift());
    while (right.length > 0) result.push(right.shift());
    return result;
  }

  if (array.length < 2) return array;
  var middle = Math.ceil(array.length / 2);
  return merge(
    merge_sort(array.slice(0, middle), comp),
    merge_sort(array.slice(middle), comp)
  );
}

function genTable(key){
  var md5 = crypto.createHash('md5');
  md5.update(key);
  var hash = new Buffer(md5.digest(), 'binary');
  var al = hash.readUInt32LE(0);
  var ah = hash.readUInt32LE(4);
  var en_table = new Array(256);
  var de_table = new Array(256);
  for(var i=0; i<256; i++){
    en_table[i] = i;
  }
  for(var i=1; i<1024; i++){
    en_table = merge_sort(en_table, function(x,y){
      return ((ah % (x + i)) * Max + al) % (x + i) - ((ah % (y + i)) * Max + al) % (y + i);
    });
  }
  for(var i=0; i<256; i++){
    de_table[en_table[i]] = i;
  }
  return [en_table, de_table];
}

var tables = genTable(_pass);

var _en_table = tables[0];
var _de_table = tables[1];

function trans(table, buf){
  var buf2 = new Buffer(buf.length);
  for(var i=0; i<buf.length; i++){
    buf2[i] = table[buf[i]];
  }
  return buf2;
}

function encode(buf){
  var b = Buffer.isBuffer(buf) ? buf : new Buffer(buf);
  return trans(_en_table, buf);
};
function decode(buf){
  return trans(_de_table, buf);
};

exports.encode = encode;
exports.decode = decode;

/*
var buff1 = new Buffer("abcdefg");
debug("buff1", buff1);
var buff2 = encode(buff1);
debug("buff2", buff2);
var buff3 = decode(buff2);
debug("buff3", buff3);
*/

// ---- shadow client implement

function ShadowSocks(host, port, pass) {
  stream.Stream.call(this);

  this.socket = new net.Socket();
  this._host = host;
  this._port = port;
  this._pass = pass;
}
//inherits(ShadowSocks, net.Socket);
//inherits(ShadowSocks, events.EventEmitter);
util.inherits(ShadowSocks, stream.Stream);

ShadowSocks.prototype.setTimeout = function(msecs, callback) {
  this.socket.setTimeout(msecs, callback);
};

ShadowSocks.prototype.setNoDelay = function() {
  this.socket.setNoDelay();
};

ShadowSocks.prototype.setKeepAlive = function(setting, msecs) {
  this.socket.setKeepAlive(setting, msecs);
};

ShadowSocks.prototype.address = function() {
  return this.socket.address();
};

ShadowSocks.prototype.pause = function() {
  this.socket.pause();
};

ShadowSocks.prototype.resume = function() {
  this.socket.resume();
};

ShadowSocks.prototype.end = function(data, encoding) {
  return this.socket.end(data, encoding);
};

ShadowSocks.prototype.destroy = function(exception) {
  this.socket.destroy(exception);
};

ShadowSocks.prototype.destroySoon = function() {
  this.socket.destroySoon();
  this.writable = false; // node's http library asserts writable to be false after destroySoon
};

ShadowSocks.prototype.setEncoding = function(encoding) {
  this.socket.setEncoding(encoding);
};

ShadowSocks.prototype.write = function(data, arg1, arg2) {
  var en = encode(data);
  return this.socket.write(en, arg1, arg2);
};

ShadowSocks.prototype.connect = function(port, host) {
  var self = this;
  // ----
  self.socket.on('timeout', function(){
    // debug("TIMEOUT");
    self.emit('timeout');
  });
  self.socket.on('error', function(e){
    // debug("ERROR", e);
    // debug('onerror',self._events.error);
    self.emit('error',e);
  });
  // ----
  self.socket.connect(self._port, self._host, function() {
    self.socket.removeAllListeners(); // added
    self.establish_socks_connection(host, port);
  });
  return self;
};

ShadowSocks.prototype.establish_socks_connection = function(host, port) {
  var self = this;

  self.connect_socks_to_host(host, port, function() {
    self.socket.on('data', function(data) {
      var de = decode(data);
      self.emit('data', de);
    });

    self.socket.on('close', function(had_error) {
      self.emit('close', had_error);
    });

    self.socket.on('end', function() {
      self.emit('end');
    });

    self.socket.on('error', function(error) {
      self.emit('error', error);
    });

    self.socket._httpMessage = self._httpMessage;
    self.socket.parser = self.parser;
    self.socket.ondata = self.ondata;
    self.writable = true;
    self.emit('connect');
  });
};

ShadowSocks.prototype.connect_socks_to_host = function(host, port, cb) {
  var buffer = socks5.encodeAddress({host:host, port:port});
  this.write(buffer);
  if(cb) cb();
}
