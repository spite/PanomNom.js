(() => {
  // ../src/base64.js
  var base64 = {};
  base64.PADCHAR = "=";
  base64.ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  base64.makeDOMException = function() {
    var e, tmp;
    try {
      return new DOMException(DOMException.INVALID_CHARACTER_ERR);
    } catch (tmp2) {
      var ex = new Error("DOM Exception 5");
      ex.code = ex.number = 5;
      ex.name = ex.description = "INVALID_CHARACTER_ERR";
      ex.toString = function() {
        return "Error: " + ex.name + ": " + ex.message;
      };
      return ex;
    }
  };
  base64.getbyte64 = function(s, i) {
    var idx = base64.ALPHA.indexOf(s.charAt(i));
    if (idx === -1) {
      throw base64.makeDOMException();
    }
    return idx;
  };
  base64.decode = function(s) {
    s = "" + s;
    var getbyte64 = base64.getbyte64;
    var pads, i, b10;
    var imax = s.length;
    if (imax === 0) {
      return s;
    }
    if (imax % 4 !== 0) {
      throw base64.makeDOMException();
    }
    pads = 0;
    if (s.charAt(imax - 1) === base64.PADCHAR) {
      pads = 1;
      if (s.charAt(imax - 2) === base64.PADCHAR) {
        pads = 2;
      }
      imax -= 4;
    }
    var x = [];
    for (i = 0; i < imax; i += 4) {
      b10 = getbyte64(s, i) << 18 | getbyte64(s, i + 1) << 12 | getbyte64(s, i + 2) << 6 | getbyte64(s, i + 3);
      x.push(String.fromCharCode(b10 >> 16, b10 >> 8 & 255, b10 & 255));
    }
    switch (pads) {
      case 1:
        b10 = getbyte64(s, i) << 18 | getbyte64(s, i + 1) << 12 | getbyte64(s, i + 2) << 6;
        x.push(String.fromCharCode(b10 >> 16, b10 >> 8 & 255));
        break;
      case 2:
        b10 = getbyte64(s, i) << 18 | getbyte64(s, i + 1) << 12;
        x.push(String.fromCharCode(b10 >> 16));
        break;
    }
    return x.join("");
  };
  base64.getbyte = function(s, i) {
    var x = s.charCodeAt(i);
    if (x > 255) {
      throw base64.makeDOMException();
    }
    return x;
  };
  base64.encode = function(s) {
    if (arguments.length !== 1) {
      throw new SyntaxError("Not enough arguments");
    }
    var padchar = base64.PADCHAR;
    var alpha = base64.ALPHA;
    var getbyte = base64.getbyte;
    var i, b10;
    var x = [];
    s = "" + s;
    var imax = s.length - s.length % 3;
    if (s.length === 0) {
      return s;
    }
    for (i = 0; i < imax; i += 3) {
      b10 = getbyte(s, i) << 16 | getbyte(s, i + 1) << 8 | getbyte(s, i + 2);
      x.push(alpha.charAt(b10 >> 18));
      x.push(alpha.charAt(b10 >> 12 & 63));
      x.push(alpha.charAt(b10 >> 6 & 63));
      x.push(alpha.charAt(b10 & 63));
    }
    switch (s.length - imax) {
      case 1:
        b10 = getbyte(s, i) << 16;
        x.push(alpha.charAt(b10 >> 18) + alpha.charAt(b10 >> 12 & 63) + padchar + padchar);
        break;
      case 2:
        b10 = getbyte(s, i) << 16 | getbyte(s, i + 1) << 8;
        x.push(alpha.charAt(b10 >> 18) + alpha.charAt(b10 >> 12 & 63) + alpha.charAt(b10 >> 6 & 63) + padchar);
        break;
    }
    return x.join("");
  };
})();
