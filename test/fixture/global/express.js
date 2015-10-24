"use strict";

// A global fixture that creates an Express server that exercises #deet
//

var fs = require('fs');
var Path = require('path');
var express = require('express');
var app = express();

var deet = require('../../../lib')({
    validator: 'ajv',
    app: app,
    sanitizeURLEncoded : true,
    hidePoweredBy : true,
    hppProtection : true,
    xFrame : 'deny',
    xssFilter : true,
    xssCSP : {
		defaultSrc: ["'unsafe-inline'"],
		scriptSrc: ["*.localhost:2112 'unsafe-inline'"],
		styleSrc: ["'unsafe-inline'"],
		imgSrc: [],
		connectSrc: ["*"],
		fontSrc: [],
		objectSrc: [],
		mediaSrc: [],
		frameSrc: ["'deny'"]
	}
});

var sampleSchema = require('../../assets/sampleschema.json');

app.post('/', deet(sampleSchema), function(req, res) {

    res.status(200).json(req.validJSON);
});

app.get('/test/:firstName/:lastName', deet(sampleSchema), function(req, res) {

    res.status(200).json(req.validJSON);
})

app.get('/jquery', function(req, res) {

    fs.createReadStream('test/assets/jquery.min.js').pipe(res);
});

app.get('/', function(req, res) {

    res.writeHead(200, {
        Connection: 'close'
    });
    fs.createReadStream('test/assets/form.html').pipe(res);
});

var server = app.listen(2112, function () {
    console.log('Server listening on 2112');
});

// We're going to close this server in the test
//
module.exports = {
    express : {
        server: server,
        app: app
    }
}